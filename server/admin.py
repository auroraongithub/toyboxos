#!/usr/bin/env python3
"""toybox.os admin service for the home server: terminal (PTY over WebSocket), files, services. python3 stdlib only.
Security: binds 127.0.0.1 only; reached through `tailscale serve --https=8443` (tailnet only, NEVER funnel).
Auth: Authorization: Bearer <admin token> (./admin_token.txt, separate from the sync token).
Things a browser can't send a header with (WebSocket, <img>/<video> src, downloads) use short-lived HMAC-signed URLs
minted by an authenticated call. Other devices pair with a one-time code made on a device that already has the token."""

import base64
import fcntl
import hashlib
import hmac
import json
import mimetypes
import os
import pty
import re
import secrets
import shutil
import signal
import socket
import struct
import subprocess
import termios
import threading
import time
import urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

BASE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("SOS_ADMIN_PORT", "8790"))
HOST = os.environ.get("SOS_ADMIN_HOST", "127.0.0.1")
TOKEN_FILE = os.path.join(BASE, "admin_token.txt")
if not os.environ.get("SOS_ADMIN_TOKEN") and not os.path.exists(TOKEN_FILE):
    fd = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.write(fd, secrets.token_urlsafe(32).encode())
    os.close(fd)
TOKEN = os.environ.get("SOS_ADMIN_TOKEN") or open(TOKEN_FILE).read().strip()
KEY = hashlib.sha256(b"sos-admin-sign|" + TOKEN.encode()).digest()
HOME = os.path.expanduser("~")
# Roots the file manager may touch. Copyparty's volumes (/ = ~/storage, /media = ~/media) live under ~ already;
# they're listed separately so the app can show them as places.
ROOTS = [r for r in (os.environ.get("SOS_ADMIN_ROOTS") or HOME).split(":") if r]


# This machine's own setup lives in admin.json next to this file (never in the code), e.g.
#   {"places": [["Media", "~/media"]], "user_units": ["hermes-gateway"], "system_units": ["nginx"],
#    "links": [["jellyfin", 8096, "http"]], "link_host": "100.x.y.z", "origins": ["https://box.tailnet.ts.net"], "gh_repo": "you/repo"}
def _conf():
    try:
        with open(os.path.join(BASE, "admin.json")) as f:
            o = json.load(f)
        return o if isinstance(o, dict) else {}
    except (OSError, ValueError):
        return {}


CONF = _conf()


def _tailscale():
    """This machine's tailnet IP and https names, so links and CORS work without being written down anywhere."""
    try:
        o = json.loads(
            subprocess.run(["tailscale", "status", "--json"], capture_output=True, timeout=5).stdout or b"{}"
        )
        me = o.get("Self") or {}
        dns = (me.get("DNSName") or "").rstrip(".")
        ip = next((a for a in me.get("TailscaleIPs") or [] if "." in a), "")
        return ip, ({"https://" + dns, "https://" + dns + ":8443"} if dns else set())
    except (OSError, ValueError, subprocess.SubprocessError):
        return "", set()


_TS_IP, _TS_ORIGINS = _tailscale()
PLACES = [["Home", HOME]] + [[str(l), os.path.expanduser(str(d))] for l, d in CONF.get("places") or []]
TRASH = os.path.join(HOME, ".local/share/Trash")
LINK_HOST = os.environ.get("SOS_ADMIN_LINK_HOST") or CONF.get("link_host") or _TS_IP or socket.gethostname()
HERMES = os.environ.get("SOS_HERMES", "/usr/local/bin/hermes")
ORIGINS = (
    {"tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"}
    | _TS_ORIGINS
    | set(CONF.get("origins") or [])
    | {o for o in (os.environ.get("SOS_ADMIN_ORIGINS") or "").split(",") if o}
)
LOCAL_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")
MAXTEXT = 2 * 1024 * 1024
MAXUP = 4 * 1024 * 1024 * 1024
# the server's own units: sos-* on older setups, toybox-* from install.sh; only the ones installed here are listed
_OWN = [
    u
    for u in ("sos-sync", "sos-admin", "toybox-sync", "toybox-admin")
    if os.path.exists(os.path.join(HOME, ".config/systemd/user", u + ".service"))
]
USER_UNITS = list(dict.fromkeys((CONF.get("user_units") or []) + _OWN))
SYS_UNITS = list(CONF.get("system_units") or [])
LINKS = [[str(n), int(p), str(sc)] for n, p, sc in CONF.get("links") or []]
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")


class Err(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code


# ---------- signing (WebSocket attach, raw file URLs) ----------
def sign(scope, ttl):
    exp = int(time.time()) + ttl
    return exp, hmac.new(KEY, f"{scope}|{exp}".encode(), hashlib.sha256).hexdigest()[:40]


def check_sig(scope, exp, sig):
    try:
        exp = int(exp)
    except (TypeError, ValueError):
        return False
    if exp < time.time():
        return False
    good = hmac.new(KEY, f"{scope}|{exp}".encode(), hashlib.sha256).hexdigest()[:40]
    return hmac.compare_digest(good, str(sig or ""))


# ---------- pairing: an authenticated device makes a code, a new device trades it for the token ----------
PAIR = {}  # code -> [expires, tries]
PAIR_ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
PAIR_FAILS = []


def pair_new():
    for k in [k for k, v in PAIR.items() if v[0] < time.time()]:
        PAIR.pop(k, None)
    code = "".join(secrets.choice(PAIR_ALPHA) for _ in range(8))
    PAIR[code] = [time.time() + 300, 0]
    return {"code": code, "ttl": 300}


def pair_claim(body):
    now = time.time()
    PAIR_FAILS[:] = [t for t in PAIR_FAILS if t > now - 600]
    if len(PAIR_FAILS) >= 20:
        raise Err(429, "too many tries, wait 10 minutes")
    code = re.sub(r"[^A-Z0-9]", "", str(body.get("code") or "").upper())
    v = PAIR.pop(code, None)
    if not v or v[0] < now:
        PAIR_FAILS.append(now)
        raise Err(403, "wrong or expired code")
    return {"token": TOKEN}


# ---------- files ----------
def safe(p, must_exist=True):
    if not p:
        raise Err(400, "no path")
    p = os.path.expanduser(str(p))
    if not os.path.isabs(p):
        p = os.path.join(HOME, p)
    real = os.path.realpath(p)
    if not any(real == r or real.startswith(r.rstrip("/") + "/") for r in map(os.path.realpath, ROOTS)):
        raise Err(403, "outside allowed folders")
    if must_exist and not os.path.lexists(real):
        raise Err(404, "not found")
    return real


def entry(dirpath, name):
    fp = os.path.join(dirpath, name)
    try:
        st = os.lstat(fp)
        link = os.path.islink(fp)
        isdir = os.path.isdir(fp)
        if link:
            try:
                st = os.stat(fp)
            except OSError:
                pass
        return {"n": name, "d": isdir, "s": st.st_size, "m": int(st.st_mtime), "l": link}
    except OSError:
        return {"n": name, "d": False, "s": 0, "m": 0, "l": True}


def fs_ls(q):
    p = safe(q.get("p") or HOME)
    if not os.path.isdir(p):
        raise Err(400, "not a folder")
    try:
        names = os.listdir(p)
    except PermissionError:
        raise Err(403, "permission denied")
    items = [entry(p, n) for n in names]
    items.sort(key=lambda e: (not e["d"], e["n"].lower()))
    return {
        "p": p,
        "items": items,
        "places": [[l, d] for l, d in PLACES if os.path.isdir(d)],
        "free": shutil.disk_usage(p).free,
    }


def fs_read(q):
    p = safe(q.get("p"))
    if os.path.isdir(p):
        raise Err(400, "is a folder")
    st = os.stat(p)
    if st.st_size > MAXTEXT:
        raise Err(413, "too big to edit here (2 MB max)")
    raw = open(p, "rb").read()
    if b"\0" in raw[:8192]:
        raise Err(415, "binary file")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    return {"p": p, "text": text, "m": str(st.st_mtime_ns)}


def fs_write(b):
    p = safe(b.get("p"), must_exist=False)
    if os.path.isdir(p):
        raise Err(400, "is a folder")
    if b.get("m") and os.path.exists(p) and str(os.stat(p).st_mtime_ns) != str(b["m"]):
        raise Err(409, "changed on the server since you opened it")
    if b.get("new") and os.path.lexists(p):
        raise Err(409, "already exists")
    data = str(b.get("text") or "").encode("utf-8")
    tmp = p + ".sos-tmp"
    mode = os.stat(p).st_mode & 0o7777 if os.path.exists(p) else 0o644
    with open(tmp, "wb") as f:
        f.write(data)
    os.chmod(tmp, mode)
    os.replace(tmp, p)
    return {"p": p, "m": str(os.stat(p).st_mtime_ns)}


def fs_mkdir(b):
    p = safe(b.get("p"), must_exist=False)
    if os.path.lexists(p):
        raise Err(409, "already exists")
    os.makedirs(p)
    return {"p": p}


def fs_move(b):
    src = safe(b.get("p"))
    dst = safe(b.get("to"), must_exist=False)
    if os.path.lexists(dst):
        raise Err(409, "something with that name is already there")
    if dst.startswith(src.rstrip("/") + "/"):
        raise Err(400, "can't move a folder into itself")
    shutil.move(src, dst)
    return {"p": dst}


def fs_trash(b):
    """freedesktop trash (~/.local/share/Trash), so the desktop's own trash sees it too; returns an id for undo"""
    p = safe(b.get("p"))
    if p in map(os.path.realpath, ROOTS) or p.rstrip("/") == HOME:
        raise Err(400, "won't trash a root folder")
    os.makedirs(TRASH + "/files", exist_ok=True)
    os.makedirs(TRASH + "/info", exist_ok=True)
    base = os.path.basename(p)
    tid = base
    i = 1
    while os.path.lexists(f"{TRASH}/files/{tid}") or os.path.exists(f"{TRASH}/info/{tid}.trashinfo"):
        i += 1
        tid = f"{base}.{i}"
    with open(f"{TRASH}/info/{tid}.trashinfo", "w") as f:
        f.write(f"[Trash Info]\nPath={urllib.parse.quote(p)}\nDeletionDate={time.strftime('%Y-%m-%dT%H:%M:%S')}\n")
    shutil.move(p, f"{TRASH}/files/{tid}")
    return {"id": tid}


def fs_restore(b):
    tid = os.path.basename(str(b.get("id") or ""))
    info = f"{TRASH}/info/{tid}.trashinfo"
    if not tid or not os.path.exists(info):
        raise Err(404, "not in the trash")
    m = re.search(r"^Path=(.*)$", open(info).read(), re.M)
    dst = safe(urllib.parse.unquote(m.group(1)), must_exist=False)
    if os.path.lexists(dst):
        raise Err(409, "something new is in its place")
    shutil.move(f"{TRASH}/files/{tid}", dst)
    os.remove(info)
    return {"p": dst}


def fs_sign(b):
    p = safe(b.get("p"))
    exp, sig = sign("raw:" + p, 6 * 3600)
    return {"q": urllib.parse.urlencode({"p": p, "e": exp, "s": sig})}


# ---------- services ----------
def run(cmd, timeout=20):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return r.returncode, r.stdout, r.stderr


_sudo = [0, False]


def can_sudo():
    if time.time() - _sudo[0] > 60:
        _sudo[0] = time.time()
        try:
            _sudo[1] = run(["sudo", "-n", "/usr/bin/systemctl", "--version"], 5)[0] == 0
        except Exception:
            _sudo[1] = False
    return _sudo[1]


def unit_state(units, user):
    cmd = (
        ["systemctl"]
        + (["--user"] if user else [])
        + ["show", "-p", "Id,ActiveState,SubState,Description,ActiveEnterTimestamp"]
        + [u + ".service" for u in units]
    )
    _, out, _ = run(cmd)
    res = []
    for block, u in zip(out.strip().split("\n\n"), units):
        kv = dict(l.split("=", 1) for l in block.splitlines() if "=" in l)
        res.append(
            {
                "name": u,
                "state": kv.get("ActiveState", "?"),
                "sub": kv.get("SubState", ""),
                "desc": kv.get("Description", ""),
                "since": kv.get("ActiveEnterTimestamp", ""),
            }
        )
    return res


def docker_list():
    code, out, err = run(["docker", "ps", "-a", "--format", "{{json .}}"])
    if code:
        return [], err.strip()[:200]
    res = []
    for l in out.splitlines():
        try:
            d = json.loads(l)
        except ValueError:
            continue
        res.append(
            {
                "name": d.get("Names"),
                "image": d.get("Image"),
                "state": d.get("State"),
                "status": d.get("Status"),
                "ports": d.get("Ports", "")[:200],
            }
        )
    res.sort(key=lambda x: (x["state"] != "running", x["name"]))
    return res, ""


def exec_cmd(b):
    """One shell command for Osage (the app only sends it after the user taps Allow). Output is capped for the model."""
    cmd = str(b.get("cmd") or "").strip()
    if not cmd or len(cmd) > 4000:
        raise Err(400, "no command")
    t = max(5, min(300, int(b.get("t") or 60)))
    try:
        r = subprocess.run(
            ["bash", "-lc", cmd], capture_output=True, text=True, timeout=t, cwd=HOME, stdin=subprocess.DEVNULL
        )
        code, out, err = r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired as e:
        code, out, err = (
            -1,
            (e.stdout or b"").decode("utf-8", "replace") if isinstance(e.stdout, bytes) else (e.stdout or ""),
            "timed out after %ds" % t,
        )
    cap = lambda x: x if len(x) <= 12000 else x[:4000] + "\n...[%d chars cut]...\n" % (len(x) - 12000) + x[-8000:]
    return {"code": code, "out": cap(out), "err": cap(err)}


GH_REPO = os.environ.get("SOS_GH_REPO") or CONF.get("gh_repo") or ""
GH_WRITE = [
    ("PUT", r"pulls/\d+/merge"),
    ("POST", r"issues/\d+/comments"),
    ("PATCH", r"pulls/\d+"),
    ("PATCH", r"issues/\d+"),
    ("POST", r"issues"),
    ("POST", r"pulls/\d+/reviews"),
]


def gh(b):
    """GitHub REST for this one repo, with the token kept here (github_token.txt). Reads pass; writes only from
    GH_WRITE (merge, comment, close, open an issue, review). The app asks the user before sending any write."""
    import urllib.request
    import urllib.error

    method = str(b.get("method") or "GET").upper()
    path = str(b.get("path") or "").lstrip("/")
    if not re.fullmatch(r"[A-Za-z0-9_./?=&,-]*", path) or ".." in path:
        raise Err(400, "bad path")
    if method != "GET" and not any(m == method and re.fullmatch(p, path.split("?")[0]) for m, p in GH_WRITE):
        raise Err(403, "not allowed")
    try:
        tok = open(os.path.join(BASE, "github_token.txt")).read().strip()
    except OSError:
        raise Err(503, "no GitHub token on the server yet")
    if not GH_REPO:
        raise Err(503, "no repository set (gh_repo in admin.json)")
    url = "https://api.github.com/repos/%s/%s" % (GH_REPO, path) if path else "https://api.github.com/repos/" + GH_REPO
    data = json.dumps(b["body"]).encode() if isinstance(b.get("body"), dict) else None
    req = urllib.request.Request(
        url,
        data,
        method=method,
        headers={
            "Authorization": "Bearer " + tok,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "toybox-os",
            **({"Content-Type": "application/json"} if data else {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            out = r.read()
        status = r.status
    except urllib.error.HTTPError as e:
        out, status = e.read(), e.code
    try:
        j = json.loads(out or b"null")
    except ValueError:
        j = out.decode("utf-8", "replace")[:4000]
    return {"status": status, "data": j}


def svc_list(_q):
    dk, derr = docker_list()
    return {
        "docker": dk,
        "docker_err": derr,
        "user": unit_state(USER_UNITS, True),
        "system": unit_state(SYS_UNITS, False),
        "sudo": can_sudo(),
        "links": [{"name": n, "url": f"{s}://{LINK_HOST}:{p}"} for n, p, s in LINKS],
    }


def svc_act(b):
    kind, name, act = b.get("kind"), str(b.get("name") or ""), b.get("act")
    if act not in ("start", "stop", "restart") or not NAME.match(name):
        raise Err(400, "bad request")
    if kind == "docker":
        if name not in {d["name"] for d in docker_list()[0]}:
            raise Err(404, "no such container")
        code, out, err = run(["docker", act, name], 90)
    elif kind == "user":
        if name not in USER_UNITS:
            raise Err(404, "not a managed unit")
        if name == "sos-admin" and act == "stop":
            raise Err(400, "stopping the admin service would lock you out; use the terminal")
        if name == "sos-admin":  # restart myself after answering
            subprocess.Popen(["sh", "-c", "sleep 1; systemctl --user restart sos-admin"], start_new_session=True)
            return {"ok": True}
        code, out, err = run(["systemctl", "--user", act, name + ".service"], 90)
    elif kind == "system":
        if name not in SYS_UNITS:
            raise Err(404, "not a managed unit")
        if not can_sudo():
            raise Err(403, "needs sudo with a password; run it in the terminal: sudo systemctl " + act + " " + name)
        code, out, err = run(["sudo", "-n", "/usr/bin/systemctl", act, name + ".service"], 90)
    else:
        raise Err(400, "bad kind")
    if code:
        raise Err(500, (err or out).strip()[:400] or "failed")
    return {"ok": True}


def svc_logs(q):
    kind, name = q.get("kind"), str(q.get("name") or "")
    n = max(10, min(2000, int(q.get("n") or 200)))
    if not NAME.match(name):
        raise Err(400, "bad name")
    if kind == "docker":
        cmd = ["docker", "logs", "--tail", str(n), "--timestamps", name]
    elif kind == "user" and name in USER_UNITS:
        cmd = ["journalctl", "--user", "-u", name + ".service", "-n", str(n), "--no-pager", "-o", "short-iso"]
    elif kind == "system" and name in SYS_UNITS:
        cmd = ["journalctl", "-u", name + ".service", "-n", str(n), "--no-pager", "-o", "short-iso"]
    else:
        raise Err(400, "bad request")
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20)
    return {"text": r.stdout.decode("utf-8", "replace")[-400000:]}


# ---------- terminal sessions ----------
SESS = {}
SLOCK = threading.Lock()


class Sess:
    def __init__(self, kind, cols, rows):
        self.id = secrets.token_urlsafe(12)
        self.kind = kind
        self.buf = bytearray()
        self.ws = None
        self.lock = threading.Lock()
        self.alive = True
        self.seen = time.time()
        self.code = None
        master, slave = pty.openpty()
        self.fd = master
        self.resize(cols, rows)
        env = {k: v for k, v in os.environ.items() if not k.startswith("SOS_")}
        env.update(
            TERM="xterm-256color",
            COLORTERM="truecolor",
            HOME=HOME,
            SHELL="/bin/bash",
            LANG=env.get("LANG", "C.UTF-8"),
            PATH=HOME + "/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        )
        cmd = ["/bin/bash", "-l"] if kind == "shell" else ["/bin/bash", "-lc", f"{HERMES}; exec /bin/bash -l"]

        def ctty():
            os.setsid()
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)

        self.proc = subprocess.Popen(
            cmd, stdin=slave, stdout=slave, stderr=slave, cwd=HOME, env=env, preexec_fn=ctty, close_fds=True
        )
        os.close(slave)
        threading.Thread(target=self.pump, daemon=True).start()

    def resize(self, cols, rows):
        cols, rows = max(2, min(500, int(cols or 80))), max(2, min(300, int(rows or 24)))
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    def pump(self):
        while True:
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                data = b""
            if not data:
                break
            with self.lock:
                self.buf += data
                if len(self.buf) > 256 * 1024:
                    del self.buf[: len(self.buf) - 192 * 1024]
                ws = self.ws
            if ws:
                ws.send(data, 2)
        self.code = self.proc.wait()
        self.alive = False
        with self.lock:
            ws = self.ws
        if ws:
            ws.send(json.dumps({"exit": self.code}).encode(), 1)
            ws.close()

    def write(self, data):
        if self.alive:
            try:
                os.write(self.fd, data)
            except OSError:
                pass

    def kill(self):
        try:
            os.killpg(self.proc.pid, signal.SIGHUP)
        except OSError:
            pass

        def hard():
            time.sleep(3)
            if self.proc.poll() is None:
                try:
                    os.killpg(self.proc.pid, signal.SIGKILL)
                except OSError:
                    pass
            try:
                os.close(self.fd)
            except OSError:
                pass

        threading.Thread(target=hard, daemon=True).start()


def reaper():
    while True:
        time.sleep(60)
        with SLOCK:
            for sid, s in list(SESS.items()):
                if (not s.alive and time.time() - s.seen > 600) or (s.ws is None and time.time() - s.seen > 24 * 3600):
                    s.kill()
                    SESS.pop(sid, None)


threading.Thread(target=reaper, daemon=True).start()


def term_new(b):
    kind = b.get("kind") if b.get("kind") in ("shell", "hermes") else "shell"
    with SLOCK:
        if len(SESS) >= 16:
            raise Err(429, "too many terminals open; close some")
        s = Sess(kind, b.get("cols"), b.get("rows"))
        SESS[s.id] = s
    return term_ticket({"id": s.id})


def term_ticket(b):
    sid = str(b.get("id") or "")
    if sid not in SESS:
        raise Err(404, "terminal is gone")
    exp, sig = sign("ws:" + sid, 60)
    return {"id": sid, "q": urllib.parse.urlencode({"id": sid, "e": exp, "s": sig}), "alive": SESS[sid].alive}


def term_list(_q):
    return {"items": [{"id": s.id, "kind": s.kind, "alive": s.alive} for s in SESS.values()]}


def term_close(b):
    with SLOCK:
        s = SESS.pop(str(b.get("id") or ""), None)
    if s:
        s.kill()
    return {"ok": True}


# ---------- minimal RFC 6455 ----------
class WS:
    def __init__(self, sock):
        self.sock = sock
        self.wl = threading.Lock()
        self.open = True

    def send(self, data, op=2):
        n = len(data)
        hdr = bytes([0x80 | op]) + (
            bytes([n])
            if n < 126
            else bytes([126]) + struct.pack(">H", n)
            if n < 65536
            else bytes([127]) + struct.pack(">Q", n)
        )
        with self.wl:
            if not self.open:
                return
            try:
                self.sock.sendall(hdr + data)
            except OSError:
                self.open = False

    def close(self):
        self.send(b"\x03\xe8", 8)
        self.open = False
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def _read(self, n):
        b = bytearray()
        while len(b) < n:
            c = self.sock.recv(n - len(b))
            if not c:
                raise EOFError
            b += c
        return bytes(b)

    def recv(self):
        """-> (opcode, payload) for whole messages; handles ping/continuation"""
        msg, mop = bytearray(), None
        while True:
            h = self._read(2)
            fin, op, ln = h[0] & 0x80, h[0] & 0x0F, h[1] & 0x7F
            if ln == 126:
                ln = struct.unpack(">H", self._read(2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", self._read(8))[0]
            if ln > 4 * 1024 * 1024:
                raise EOFError
            mask = self._read(4) if h[1] & 0x80 else b"\0\0\0\0"
            data = bytearray(self._read(ln))
            for i in range(ln):
                data[i] ^= mask[i & 3]
            if op == 9:
                self.send(bytes(data), 10)
                continue
            if op == 10:
                continue
            if op == 8:
                return 8, b""
            if op:
                mop = op
            msg += data
            if fin:
                return mop, bytes(msg)


# ---------- HTTP ----------
GET = {
    "/api/fs/ls": fs_ls,
    "/api/fs/read": fs_read,
    "/api/svc": svc_list,
    "/api/svc/logs": svc_logs,
    "/api/term": term_list,
}
POST = {
    "/api/fs/write": fs_write,
    "/api/fs/mkdir": fs_mkdir,
    "/api/fs/move": fs_move,
    "/api/fs/trash": fs_trash,
    "/api/fs/restore": fs_restore,
    "/api/fs/sign": fs_sign,
    "/api/svc/act": svc_act,
    "/api/term/new": term_new,
    "/api/term/ticket": term_ticket,
    "/api/exec": exec_cmd,
    "/api/gh": gh,
    "/api/term/close": term_close,
    "/api/pair/new": lambda b: pair_new(),
}


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "sos-admin"

    def log_message(self, *a):
        pass

    def cors(self):
        o = self.headers.get("Origin", "")
        if o in ORIGINS or LOCAL_ORIGIN.match(o):
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")

    def send_json(self, code, obj):
        b = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def authed(self):
        a = self.headers.get("Authorization", "")
        return a.startswith("Bearer ") and hmac.compare_digest(a[7:].strip().encode(), TOKEN.encode())

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAXTEXT * 2:
            raise Err(413, "too big")
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def route(self, method):
        u = urllib.parse.urlparse(self.path)
        path = u.path
        q = dict(urllib.parse.parse_qsl(u.query))
        try:
            if method == "GET" and path == "/api/ping":
                if not self.authed():
                    raise Err(401, "unauthorized")
                return self.send_json(200, {"ok": True, "host": socket.gethostname()})
            if method == "GET" and path == "/api/term/ws":
                return self.websocket(q)
            if method == "GET" and path == "/api/fs/raw":
                return self.raw(q)
            if method == "POST" and path == "/api/pair/claim":
                return self.send_json(200, pair_claim(self.body()))
            if not self.authed():
                raise Err(401, "unauthorized")
            if method == "PUT" and path == "/api/fs/upload":
                return self.upload(q)
            fn = (GET if method == "GET" else POST if method == "POST" else {}).get(path)
            if not fn:
                raise Err(404, "not found")
            return self.send_json(200, fn(q if method == "GET" else self.body()))
        except Err as e:
            self.send_json(e.code, {"error": str(e)})
        except PermissionError:
            self.send_json(403, {"error": "permission denied"})
        except FileNotFoundError:
            self.send_json(404, {"error": "not found"})
        except subprocess.TimeoutExpired:
            self.send_json(504, {"error": "timed out"})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            self.send_json(500, {"error": type(e).__name__ + ": " + str(e)[:300]})

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def do_PUT(self):
        self.route("PUT")

    def upload(self, q):
        p = safe(q.get("p"), must_exist=False)
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAXUP:
            raise Err(413, "too big")
        if os.path.lexists(p) and q.get("over") != "1":
            raise Err(409, "already exists")
        tmp = p + ".sos-part"
        with open(tmp, "wb") as f:
            left = n
            while left:
                c = self.rfile.read(min(1 << 20, left))
                if not c:
                    break
                f.write(c)
                left -= len(c)
        if left:
            os.remove(tmp)
            raise Err(400, "upload cut off")
        os.replace(tmp, p)
        self.send_json(200, {"p": p})

    def raw(self, q):
        p = q.get("p", "")
        if not check_sig("raw:" + p, q.get("e"), q.get("s")):
            raise Err(401, "link expired")
        p = safe(p)
        if os.path.isdir(p):
            raise Err(400, "is a folder")
        size = os.path.getsize(p)
        ctype = mimetypes.guess_type(p)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/json", "application/javascript"):
            ctype = "text/plain; charset=utf-8"
        start, end = 0, size - 1
        rng = re.match(r"bytes=(\d*)-(\d*)$", self.headers.get("Range", ""))
        if rng and size:
            if rng.group(1):
                start = int(rng.group(1))
                end = int(rng.group(2)) if rng.group(2) else size - 1
            else:
                start = max(0, size - int(rng.group(2) or 0))
            end = min(end, size - 1)
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        self.send_response(206 if rng and size else 200)
        self.cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1 if size else 0))
        self.send_header("Cache-Control", "private, max-age=600")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "sandbox")
        if rng and size:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        disp = "attachment" if q.get("dl") == "1" else "inline"
        self.send_header("Content-Disposition", f"{disp}; filename*=UTF-8''{urllib.parse.quote(os.path.basename(p))}")
        self.end_headers()
        if not size:
            return
        with open(p, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left:
                c = f.read(min(1 << 20, left))
                if not c:
                    break
                self.wfile.write(c)
                left -= len(c)

    def websocket(self, q):
        sid = q.get("id", "")
        if not check_sig("ws:" + sid, q.get("e"), q.get("s")):
            raise Err(401, "unauthorized")
        o = self.headers.get("Origin", "")
        if o and not (o in ORIGINS or LOCAL_ORIGIN.match(o)):
            raise Err(403, "origin not allowed")
        s = SESS.get(sid)
        if not s:
            raise Err(404, "terminal is gone")
        key = self.headers.get("Sec-WebSocket-Key")
        if not key or "websocket" not in self.headers.get("Upgrade", "").lower():
            raise Err(400, "websocket only")
        acc = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", acc)
        self.end_headers()
        self.wfile.flush()
        self.close_connection = True
        ws = WS(self.connection)
        with s.lock:
            old, s.ws = s.ws, ws
            backlog = bytes(s.buf)
        if old:
            old.close()
        ws.send(json.dumps({"hello": s.kind, "alive": s.alive}).encode(), 1)
        if backlog:
            ws.send(backlog, 2)
        if not s.alive:
            ws.send(json.dumps({"exit": s.code}).encode(), 1)
        try:
            while ws.open:
                op, data = ws.recv()
                if op == 8:
                    break
                s.seen = time.time()
                if op == 2:
                    s.write(data)
                elif op == 1:
                    m = json.loads(data or b"{}")
                    if "i" in m:
                        s.write(m["i"].encode("utf-8"))
                    if "r" in m:
                        s.resize(*m["r"])
        except (EOFError, OSError, ValueError):
            pass
        finally:
            with s.lock:
                if s.ws is ws:
                    s.ws = None
            s.seen = time.time()
            ws.open = False


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def cli_pair():
    """`python3 admin.py pair`: a one-time code for the first device, from the running service on this machine."""
    import urllib.request

    req = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/api/pair/new",
        b"{}",
        method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            print(json.loads(r.read())["code"])
    except OSError:
        raise SystemExit("the admin service isn't running on port %d" % PORT)


if __name__ == "__main__":
    import sys

    if sys.argv[1:2] == ["pair"]:
        cli_pair()
        raise SystemExit
    print(f"sos-admin on http://{HOST}:{PORT}", flush=True)
    Server((HOST, PORT), H).serve_forever()
