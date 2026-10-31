"""Self-updates from the release channel (server/release.py makes the releases). On for the packaged program, the desktop
app's server, install.sh and Docker (toybox_server.py sets SOS_UPDATES=1); off on a server that deploys from git.
- every 6 hours: fetch latest.json; a newer release is downloaded, its sha256 checked, and unpacked (paths checked)
- the app: a new folder in <home>/web, switched to by <home>/web/current; with app editing set up, app_changes.rebase
  puts the user's applied changes back on top and sets aside the ones that no longer fit
- the server: its files go to <home>/code/<build>; toybox_server.py loads them after a restart (exit 75) and goes back
  to the old ones if the new code dies on start. A release needing a newer program (runtime) only updates the app.
Settings in <home>/update.json: {"auto": true, "url": "..."}; POST /api/update/status|check|apply|set."""

import hashlib
import json
import os
import re
import shutil
import sys
import threading
import time
import urllib.parse
import urllib.request
import zipfile
import app_changes


# the release channel: SOS_UPDATE_URL, else channel.txt shipped next to this file by whoever packaged the build; none = no updates
def _channel():
    for d in (
        getattr(sys, "_MEIPASS", ""),
        os.path.dirname(os.path.abspath(__file__)),
    ):  # the packaged program, then this folder
        try:
            with open(os.path.join(d, "channel.txt")) as f:
                return f.read().strip()
        except OSError:
            pass
    return ""


DEFAULT_URL = os.environ.get("SOS_UPDATE_URL") or _channel()
HOME = os.environ.get("SOS_HOME") or os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HOME, "update.json")
WEB = os.path.join(HOME, "web")
CODE = os.path.join(HOME, "code")
MAX_ZIP, MAX_FILES = 200 * 1024 * 1024, 5000
EVERY = 6 * 3600
TOPS = ("dist/", "server/", "src/", "assets/", "vendor/")
_lock = threading.Lock()
st = {"state": "idle", "err": "", "latest": None, "checked": 0}
_www = lambda: os.path.join(HOME, "www")  # replaced by server.py with its own lookup
_restart = lambda: os._exit(75)


def on():
    return os.environ.get("SOS_UPDATES") == "1"


def runtime():
    return int(os.environ.get("SOS_RUNTIME") or 0)


def settings():
    try:
        with open(STATE) as f:
            o = json.load(f)
        return o if isinstance(o, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(**kw):
    o = {**settings(), **kw}
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(o, f)
    os.replace(tmp, STATE)


def _n(b):
    try:
        return int(str(b), 36)
    except ValueError:
        return 0


def current():
    try:
        with open(os.path.join(_www(), "version.json")) as f:
            return json.load(f).get("build") or ""
    except (OSError, ValueError):
        return ""


def upstream():
    """The newest release this server took in (the live build can be newer: the user's own changes get new build ids)."""
    return max(settings().get("upstream") or "", current(), key=_n)


def _get(url, limit):
    u = urllib.parse.urlparse(url)
    if u.scheme != "https" and u.hostname not in ("127.0.0.1", "localhost"):
        raise ValueError("Updates only come over https.")
    req = urllib.request.Request(url, headers={"User-Agent": "toybox-server", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read(limit + 1)
    if len(data) > limit:
        raise ValueError("The update is too big.")
    return data


def status(_b=None):
    m = st["latest"]
    cur = current()
    newer = bool(m and _n(m["build"]) > _n(upstream()))
    return {
        "enabled": on(),
        "auto": settings().get("auto", True),
        "build": cur,
        "upstream": upstream(),
        "latest": m and m["build"],
        "newer": newer,
        "code_ok": bool(m) and int(m.get("runtime") or 1) <= runtime(),
        "state": st["state"],
        "err": st["err"],
        "checked": st["checked"],
        "set_aside": settings().get("set_aside") or [],
        "code_failed": _failed(),
    }


def _failed():
    """A release whose server part didn't start (toybox_server.py went back to the previous code)."""
    try:
        with open(os.path.join(CODE, "failed")) as f:
            return f.read().strip()[:16]
    except OSError:
        return ""


def check(_b=None):
    if not on():
        raise ValueError("Updates are managed another way on this server.")
    url = settings().get("url") or os.environ.get("SOS_UPDATE_URL") or DEFAULT_URL
    if not url:
        raise ValueError("No release channel is set for this server.")
    try:
        m = json.loads(_get(url, 64 * 1024))
        if not (
            isinstance(m, dict)
            and re.fullmatch(r"[0-9a-z]{4,16}", str(m.get("build", "")))
            and re.fullmatch(r"[0-9a-f]{64}", str(m.get("sha256", "")))
            and isinstance(m.get("url"), str)
        ):
            raise ValueError("The release channel sent something unexpected.")
        m["url"] = urllib.parse.urljoin(url, m["url"])
        st.update(latest=m, err="", checked=time.time())
    except Exception as e:
        st.update(
            err=str(e)[:200] if isinstance(e, ValueError) else "Couldn't reach the release channel.",
            checked=time.time(),
        )
    return status()


def _unpack(data, dest):
    with zipfile.ZipFile(__import__("io").BytesIO(data)) as z:
        names = z.namelist()
        if len(names) > MAX_FILES:
            raise ValueError("Too many files in the update.")
        total = 0
        for i in z.infolist():
            n = i.filename
            if (
                n.startswith(("/", "\\"))
                or ".." in n.replace("\\", "/").split("/")
                or ":" in n
                or not (n in ("manifest.json", ".gitignore") or n.startswith(TOPS))
            ):
                raise ValueError("The update has an unexpected file: " + n[:80])
            total += i.file_size
        if total > 4 * MAX_ZIP:
            raise ValueError("The update is too big.")
        z.extractall(dest)
    with open(os.path.join(dest, "manifest.json")) as f:
        return json.load(f)


def _install_web(inc, build):
    os.makedirs(WEB, exist_ok=True)
    dest = os.path.join(WEB, build)
    if os.path.exists(dest):
        shutil.rmtree(dest)
    shutil.move(os.path.join(inc, "dist"), dest)
    tmp = os.path.join(WEB, "current.tmp")
    with open(tmp, "w") as f:
        f.write(build)
    os.replace(tmp, os.path.join(WEB, "current"))
    keep = {build}
    for d in sorted((d for d in os.listdir(WEB) if os.path.isdir(os.path.join(WEB, d))), key=_n)[:-2]:
        if d not in keep:
            shutil.rmtree(os.path.join(WEB, d), ignore_errors=True)


def _code_dir():
    try:
        with open(os.path.join(CODE, "current.json")) as f:
            return json.load(f).get("dir") or ""
    except (OSError, ValueError):
        return ""


def _install_code(inc, man, build):
    """-> True when the server needs a restart for new code."""
    names = [
        n
        for n in man.get("server") or []
        if re.fullmatch(r"[a-z_][a-z0-9_]*\.(py|json)", n) and n[:-3] not in sys.stdlib_module_names
    ]
    src = os.path.join(inc, "server")
    running = os.path.join(CODE, _code_dir()) if _code_dir() else os.path.dirname(os.path.abspath(__file__))

    def read(p):
        with open(p, "rb") as f:
            return f.read()

    def same(n):
        try:
            return read(os.path.join(src, n)) == read(os.path.join(running, n))
        except OSError:
            return False

    if all(same(n) for n in names):
        return False
    os.makedirs(CODE, exist_ok=True)
    dest = os.path.join(CODE, build)
    if os.path.exists(dest):
        shutil.rmtree(dest)
    os.makedirs(dest)
    for n in names:
        shutil.copyfile(os.path.join(src, n), os.path.join(dest, n))
    prev = _code_dir()
    tmp = os.path.join(CODE, "current.tmp")
    with open(tmp, "w") as f:
        json.dump({"dir": build, "prev": prev, "trial": True}, f)
    os.replace(tmp, os.path.join(CODE, "current.json"))
    for d in os.listdir(CODE):
        if os.path.isdir(os.path.join(CODE, d)) and d not in (build, prev):
            shutil.rmtree(os.path.join(CODE, d), ignore_errors=True)
    return True


def apply(_b=None):
    if not on():
        raise ValueError("Updates are managed another way on this server.")
    if not _lock.acquire(blocking=False):
        raise ValueError("An update is already running.")
    inc = os.path.join(HOME, "update-incoming")
    try:
        check()
        m = st["latest"]
        if not m:
            raise ValueError(st["err"] or "No release found.")
        if _n(m["build"]) <= _n(upstream()):
            return status()
        st.update(state="downloading", err="")
        data = _get(m["url"], MAX_ZIP)
        if hashlib.sha256(data).hexdigest() != m["sha256"]:
            raise ValueError("The download doesn't match the release; nothing changed.")
        shutil.rmtree(inc, ignore_errors=True)
        os.makedirs(inc)
        st["state"] = "installing"
        man = _unpack(data, inc)
        if man.get("build") != m["build"]:
            raise ValueError("The release doesn't match its description; nothing changed.")
        aside = []
        if app_changes.available():
            aside = app_changes.rebase(inc, m["build"])["set_aside"]
        else:
            _install_web(inc, m["build"])
        # new server code only where toybox_server.py supervises (it loads <home>/code and restarts us)
        restart = (
            os.environ.get("SOS_SUPERVISED") == "1"
            and int(man.get("runtime") or 1) <= runtime()
            and _install_code(inc, man, m["build"])
        )
        _save(upstream=m["build"], set_aside=(settings().get("set_aside") or []) + aside, at=time.time())
        st.update(state="restarting" if restart else "idle")
        if restart:
            threading.Timer(1.0, _restart).start()
        return status()
    except Exception as e:
        st.update(
            state="idle",
            err=str(e)[:200]
            if isinstance(e, ValueError)
            else "The update failed (%s); nothing changed." % type(e).__name__,
        )
        return status()
    finally:
        shutil.rmtree(inc, ignore_errors=True)
        _lock.release()


def set_(b):
    if "auto" in b:
        _save(auto=bool(b["auto"]))
    if b.get("dismiss"):
        _save(set_aside=[])
        try:
            os.remove(os.path.join(CODE, "failed"))
        except OSError:
            pass
    return status()


def _loop():
    time.sleep(90)
    while True:
        if settings().get("auto", True):
            check()
            if status()["newer"]:
                apply()
        time.sleep(EVERY)


def init(www, restart=None):
    global _www, _restart
    _www = www
    if restart:
        _restart = restart
    if on():
        threading.Thread(target=_loop, daemon=True).start()


ROUTES = {"/api/update/status": status, "/api/update/check": check, "/api/update/apply": apply, "/api/update/set": set_}
