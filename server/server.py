#!/usr/bin/env python3
"""toybox.os sync server. One file, python3 stdlib only.
- serves the app (./www) and the sync API (/api/*) from one port
- storage: SQLite (./data/sos.db), last-write-wins per document
- auth: Authorization: Bearer <token>  (token in ./token.txt, $SOS_TOKEN_FILE or $SOS_TOKEN; made on first start)
- new devices pair with a one-time code instead of typing the token: `python3 server.py pair`, or Start > Sync >
  Pair another device on a device that is already connected"""

import json
import os
import re
import sqlite3
import hmac
import mimetypes
import time
import sys
import secrets
import hashlib
import threading
import urllib.error
import ai
import app_changes
import moodle
import agent
import caps
import aiconf
import host
import updates
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, quote

BASE = os.path.dirname(os.path.abspath(__file__))
HOME = (
    os.environ.get("SOS_HOME") or BASE
)  # data folder; the packaged server (toybox_server.py) keeps it apart from the code
DB = os.environ.get("SOS_DB", os.path.join(HOME, "data", "sos.db"))


def _build_of(d):
    try:
        with open(os.path.join(d, "version.json")) as f:
            return int(json.load(f)["build"], 36)
    except (OSError, ValueError, KeyError, TypeError):
        return -1


_www_cache = {}


def www():
    """The app folder: $SOS_WWW, else the newest of a self-update (web/current), <home>/www and the one built in, so a
    newer installer or install.sh run wins over an older update."""
    if os.environ.get("SOS_WWW"):
        return os.environ["SOS_WWW"]
    c = []
    try:
        with open(os.path.join(HOME, "web", "current")) as f:
            b = f.read().strip()
        if re.fullmatch(r"[0-9a-z]{4,16}", b):
            c.append(os.path.join(HOME, "web", b))
    except OSError:
        pass
    c += [os.path.join(HOME, "www"), os.environ.get("SOS_WWW_BUILTIN") or "", os.path.join(BASE, "www")]
    c = [w for w in c if w and os.path.isdir(w)]
    key = tuple((w, os.path.getmtime(w)) for w in c)
    if _www_cache.get("k") != key:
        _www_cache.update(k=key, v=max(c, key=_build_of) if c else os.path.join(BASE, "www"))
    return _www_cache["v"]


RELEASES = os.path.join(
    HOME, "data", "releases"
)  # the release channel this server publishes, if any (deploy.sh / autodeploy.sh)
PORT = int(os.environ.get("SOS_PORT", "8787"))
HOST = os.environ.get("SOS_HOST", "0.0.0.0")
TOKEN_FILE = os.environ.get("SOS_TOKEN_FILE", os.path.join(HOME, "token.txt"))


def _token():
    if os.environ.get("SOS_TOKEN"):
        return os.environ["SOS_TOKEN"]
    if not os.path.exists(TOKEN_FILE):
        os.makedirs(os.path.dirname(TOKEN_FILE) or ".", exist_ok=True)
        fd = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(secrets.token_urlsafe(32) + "\n")
    return open(TOKEN_FILE).read().strip()


TOKEN = _token()
if not TOKEN:
    sys.exit("The sync token is empty; delete token.txt to get a new one.")
MAXBODY = 8 * 1024 * 1024
FILES = os.environ.get("SOS_FILES", os.path.join(HOME, "data", "files"))
DEPLOY = os.environ.get("SOS_DEPLOY_STATUS", os.path.join(HOME, "data", "deploy.json"))  # written by autodeploy.sh
MAXFILE = 15 * 1024 * 1024
STORE = os.environ.get("SOS_STORE", os.path.join(HOME, "store"))  # a pack store of your own: index.json + packs/<id>/*
STORE_PATH = re.compile(r"^/store/(index\.json|packs/[a-z0-9][a-z0-9-]{1,31}/[a-z0-9_.-]{1,40}\.(?:json|webp|png|jpe?g|gif))$")
FILE_ID = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
FILE_TYPES = {
    "application/json",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/avif",
    "application/pdf",
    "application/epub+zip",
    "text/plain",
    "text/markdown",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    # your own alarm sounds (core/sounds.js)
    "audio/ogg",
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/mp4",
    "audio/x-m4a",
    "audio/aac",
    "audio/webm",
    "audio/flac",
}
os.makedirs(FILES, exist_ok=True)

os.makedirs(os.path.dirname(DB), exist_ok=True)


class _Conn(sqlite3.Connection):
    """`with conn() as c:` commits and then closes. A plain sqlite3 connection only commits there, and the open
    handles piled up until the process hit its file limit and every database call failed."""

    def __exit__(self, *exc):
        try:
            return super().__exit__(*exc)
        finally:
            self.close()


def conn():
    c = sqlite3.connect(DB, timeout=10, factory=_Conn)
    c.execute("PRAGMA journal_mode=WAL")
    return c


ai.init(conn)
updates.init(www)
agent.init(conn)
app_changes.recover()
AI_JSON = {
    "/api/src": lambda b: ai.add_source(b, FILES, FILE_ID),
    "/api/src/search": ai.search,
    "/api/src/read": ai.read,
    "/api/moodle": moodle.handle,
    "/api/moodle/save": agent.moodle_save,
    "/api/agent/start": agent.start,
    "/api/agent/poll": agent.poll,
    "/api/agent/result": agent.result,
    "/api/agent/stop": agent.stop,
    "/api/agent/active": agent.active,
    "/api/src/del": ai.delete,
    "/api/web/read": ai.web_read,
    "/api/web/search": ai.web_search,
    "/api/change/list": app_changes.listing,
    "/api/change/create": app_changes.create,
    "/api/change/detail": app_changes.detail,
    "/api/change/apply": app_changes.apply,
    "/api/change/rollback": app_changes.rollback,
    "/api/change/discard": app_changes.discard,
    "/api/pair/new": lambda b: pair_new(),
    **aiconf.ROUTES,
    "/api/host/info": lambda b: host.info(PORT),
    "/api/host/share": lambda b: host.share(PORT),
    **updates.ROUTES,
}
with conn() as c:
    c.execute(
        """CREATE TABLE IF NOT EXISTS docs(c TEXT, id TEXT, data TEXT, u INTEGER, d INTEGER, seq INTEGER, PRIMARY KEY(c,id))"""
    )
    c.execute("CREATE INDEX IF NOT EXISTS docs_seq ON docs(seq)")

# ---------- pairing: a one-time code (8 letters/digits, 10 minutes) traded for the token ----------
# codes live hashed in data/pair.json so `python3 server.py pair` (another process) can make them
PAIR_FILE = os.path.join(os.path.dirname(DB), "pair.json")
PAIR_ALPHA, PAIR_TTL, PAIR_FAILS, PAIR_LOCK = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", 600, [], threading.Lock()
_ph = lambda code: hashlib.sha256(code.encode()).hexdigest()


def _pairs():
    try:
        with open(PAIR_FILE) as f:
            d = json.load(f)
        return {k: v for k, v in d.items() if isinstance(v, (int, float)) and v > time.time()}
    except (OSError, ValueError):
        return {}


def _save_pairs(d):
    tmp = PAIR_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f)
    os.chmod(tmp, 0o600)
    os.replace(tmp, PAIR_FILE)


def pair_new(_=None):
    code = "".join(secrets.choice(PAIR_ALPHA) for _ in range(8))
    with PAIR_LOCK:
        d = _pairs()
        d[_ph(code)] = time.time() + PAIR_TTL
        _save_pairs(d)
    return {"code": code[:4] + "-" + code[4:], "ttl": PAIR_TTL}


def pair_claim(body):
    """-> (status, json). 20 wrong codes in 10 minutes locks it for everyone, so 31^8 codes can't be guessed."""
    now = time.time()
    with PAIR_LOCK:
        PAIR_FAILS[:] = [t for t in PAIR_FAILS if t > now - 600]
        if len(PAIR_FAILS) >= 20:
            return 429, {"error": "Too many tries. Wait 10 minutes."}
        code = re.sub(r"[^A-Z0-9]", "", str(body.get("code") or "").upper())
        d = _pairs()
        hit = d.pop(_ph(code), None) if len(code) == 8 else None
        if hit:
            _save_pairs(d)
        else:
            PAIR_FAILS.append(now)
            return 403, {"error": "Wrong or expired code."}
    return 200, {"token": TOKEN}


def sync(body):
    since = int(body.get("since") or 0)
    with conn() as c:
        for r in body.get("docs") or []:
            cc, id_, u, d = str(r["c"])[:40], str(r["id"])[:80], int(r.get("u") or 0), 1 if r.get("d") else 0
            row = c.execute("SELECT u FROM docs WHERE c=? AND id=?", (cc, id_)).fetchone()
            if row and row[0] > u:
                continue  # server copy is newer
            seq = c.execute("SELECT COALESCE(MAX(seq),0)+1 FROM docs").fetchone()[0]
            c.execute(
                "INSERT OR REPLACE INTO docs VALUES(?,?,?,?,?,?)",
                (cc, id_, json.dumps(r.get("data") or {}, separators=(",", ":")), u, d, seq),
            )
        rows = c.execute("SELECT c,id,data,u,d,seq FROM docs WHERE seq>? ORDER BY seq", (since,)).fetchall()
        top = c.execute("SELECT COALESCE(MAX(seq),0) FROM docs").fetchone()[0]
    return {"seq": top, "docs": [{"c": a, "id": b, "data": json.loads(x), "u": u, "d": d} for a, b, x, u, d, _ in rows]}


INGEST_COLS = {"jobs", "jots", "links", "events", "reminders"}


def _clip(v, n=2000):
    return v[:n] if isinstance(v, str) else v


def ingest(body):
    """For agents/scripts on the laptop (Hermes etc.): POST /api/ingest {"c":"jobs","items":[{...}]}.
    Ids are stable (hash of url/title), so re-sending the same listing never duplicates it, and for jobs the status you set
    in the app (saved/applied/skip) is never overwritten."""
    import hashlib

    cc = str(body.get("c") or "")
    if cc not in INGEST_COLS:
        raise ValueError("c must be one of: " + ", ".join(sorted(INGEST_COLS)))
    now = int(time.time() * 1000)
    iso = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    added = updated = skipped = 0
    docs = []
    with conn() as c:
        for it in (body.get("items") or [])[:500]:
            if not isinstance(it, dict):
                skipped += 1
                continue
            d = {k: _clip(v) for k, v in it.items() if k not in ("id", "_id", "_u", "_d")}
            if cc == "jobs":
                url = str(d.get("url") or "")
                if not d.get("title") or (url and not re.match(r"^https?://", url)):
                    skipped += 1
                    continue
                try:
                    d["fit"] = max(0, min(100, int(d.get("fit") or 0)))
                except (TypeError, ValueError):
                    d["fit"] = 0
                fl = d.get("flags")
                d["flags"] = [str(x)[:40] for x in fl][:8] if isinstance(fl, list) else []
                d.setdefault("status", "new")
            elif cc == "jots":
                if not str(d.get("text") or "").strip():
                    skipped += 1
                    continue
            elif not (d.get("title") or d.get("name")):
                skipped += 1
                continue
            key = str(
                it.get("id")
                or hashlib.sha1(
                    (str(d.get("url") or d.get("title") or d.get("text") or d.get("name"))).lower().encode()
                ).hexdigest()[:20]
            )[:80]
            row = c.execute("SELECT data,d FROM docs WHERE c=? AND id=?", (cc, key)).fetchone()
            if row and not row[1]:
                old = json.loads(row[0])
                if cc == "jobs":
                    for k in ("status", "statusAt", "at"):
                        if k in old:
                            d[k] = old[k]
                updated += 1
            else:
                added += 1
            d.setdefault("at", iso)
            docs.append({"c": cc, "id": key, "data": d, "u": now, "d": 0})
    if docs:
        sync({"since": 10**15, "docs": docs})
    return {"ok": True, "added": added, "updated": updated, "skipped": skipped}


class H(BaseHTTPRequestHandler):
    server_version = "sos"

    def log_message(self, *a):
        pass

    def _send(self, code, body=b"", ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _len(self, cap=None):
        """Content-Length as a number; junk counts as 0 (the body is then empty and the request fails as bad input)."""
        try:
            n = max(0, int(self.headers.get("Content-Length") or 0))
        except ValueError:
            n = 0
        return min(n, cap) if cap else n

    def _auth(self):
        t = (self.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
        return hmac.compare_digest(t.encode(), TOKEN.encode())

    def do_OPTIONS(self):
        self._send(
            204,
            b"",
            extra={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Authorization,Content-Type",
                "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
            },
        )

    def do_PUT(self):
        # page attachments: PUT /api/file/<id> (token), raw bytes. Ids are random and long, so GET needs no token (plain <img src>).
        p = urlparse(self.path).path
        cors = {"Access-Control-Allow-Origin": "*"}
        m = re.match(r"^/api/file/([^/]+)$", p)
        if not m or not FILE_ID.match(m.group(1)):
            return self._send(404, {"error": "not found"}, extra=cors)
        if not self._auth():
            return self._send(401, {"error": "bad token"}, extra=cors)
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype not in FILE_TYPES:
            return self._send(415, {"error": "images, documents and sounds only"}, extra=cors)
        n = self._len()
        if n <= 0 or n > MAXFILE:
            return self._send(413, {"error": "too big"}, extra=cors)
        data = self.rfile.read(n)
        f = os.path.join(FILES, m.group(1))
        with open(f + ".tmp", "wb") as fh:
            fh.write(data)
        with open(f + ".type", "w") as fh:
            fh.write(ctype)
        os.replace(f + ".tmp", f)
        self._send(200, {"ok": True, "size": n}, extra=cors)

    def do_POST(self):
        p = urlparse(self.path).path
        cors = {"Access-Control-Allow-Origin": "*"}
        if p.startswith(("/api/moodle", "/api/agent/")):
            cors["Cache-Control"] = "no-store"
        if p == "/api/pair/claim":
            n = self._len(4096)
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                body = {}
            code, out = pair_claim(body if isinstance(body, dict) else {})
            return self._send(code, out, extra={**cors, "Cache-Control": "no-store"})
        if p not in ("/api/sync", "/api/ingest", "/api/ai") and p not in AI_JSON:
            return self._send(404, {"error": "not found"}, extra=cors)
        if not self._auth():
            return self._send(401, {"error": "bad token"}, extra=cors)
        n = self._len()
        if n > MAXBODY:
            return self._send(413, {"error": "too big"}, extra=cors)
        if p == "/api/ai":
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                return self._send(400, {"error": "bad json"}, extra=cors)
            return ai.chat(self, body)
        try:
            out = (AI_JSON.get(p) or (ingest if p == "/api/ingest" else sync))(json.loads(self.rfile.read(n) or b"{}"))
        except (ValueError, urllib.error.URLError, TimeoutError) as e:
            return self._send(400, {"error": str(e)[:300]}, extra=cors)  # bad input, unreachable links
        except Exception as e:
            print("error on", p, type(e).__name__, flush=True)  # details stay on the server
            return self._send(
                500, {"error": "Something went wrong on the server (" + type(e).__name__ + ")."}, extra=cors
            )
        self._send(200, out, extra=cors)

    def do_GET(self):
        p = urlparse(self.path).path
        if p.startswith("/api/moodle/file/"):
            headers = {
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
            }
            if not self._auth():
                return self._send(401, {"error": "bad token"}, extra=headers)
            try:
                data, metadata = moodle.read_file(p.removeprefix("/api/moodle/file/"))
            except moodle.MoodleError as error:
                return self._send(404, {"error": str(error)}, extra=headers)
            headers["Content-Disposition"] = "attachment; filename*=UTF-8''" + quote(metadata["name"], safe="")
            return self._send(200, data, metadata["type"], headers)
        preview = re.fullmatch(r"/preview/([a-f0-9]{32})/", p)
        if preview:
            try:
                data = app_changes.preview(preview[1])
            except (ValueError, OSError):
                return self._send(404, {"error": "Preview unavailable"})
            return self._send(
                200,
                data,
                "text/html; charset=utf-8",
                {
                    "Cache-Control": "no-store",
                    "X-Content-Type-Options": "nosniff",
                    "Content-Security-Policy": "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'",
                    "Referrer-Policy": "no-referrer",
                },
            )
        if p == "/api/ping":
            return self._send(
                200 if self._auth() else 401, {"ok": self._auth()}, extra={"Access-Control-Allow-Origin": "*"}
            )
        if p == "/api/deploy":  # what the home server is building right now, for the app's update light
            if not self._auth():
                return self._send(401, {"error": "bad token"}, extra={"Access-Control-Allow-Origin": "*"})
            try:
                with open(DEPLOY, encoding="utf-8") as f:
                    st = json.load(f)
            except (OSError, ValueError):
                st = {"state": "none"}
            return self._send(200, st, extra={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"})
        if p == "/api/caps":
            if not self._auth():
                return self._send(401, {"error": "bad token"}, extra={"Access-Control-Allow-Origin": "*"})
            return self._send(200, caps.caps(), extra={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"})
        if p in ("/api/ai/usage", "/api/ai/models"):  # models = the catalogue with live state; usage adds month totals
            if not self._auth():
                return self._send(401, {"error": "bad token"}, extra={"Access-Control-Allow-Origin": "*"})
            return self._send(
                200, ai.usage() if p.endswith("usage") else ai.catalog(), extra={"Access-Control-Allow-Origin": "*"}
            )
        if p == "/api/export":
            if not self._auth():
                return self._send(401, {"error": "bad token"})
            return self._send(200, sync({"since": 0}))
        m = re.match(r"^/api/file/([^/]+)$", p)
        if m:
            f = os.path.join(FILES, m.group(1))
            if not FILE_ID.match(m.group(1)) or not os.path.isfile(f):
                return self._send(404, {"error": "not found"}, extra={"Access-Control-Allow-Origin": "*"})
            try:
                ctype = open(f + ".type").read().strip()
            except OSError:
                ctype = "application/octet-stream"
            with open(f, "rb") as fh:
                data = fh.read()
            return self._send(
                200,
                data,
                ctype,
                {
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "public, max-age=31536000, immutable",
                    "X-Content-Type-Options": "nosniff",
                },
            )
        if p.startswith("/api/"):
            return self._send(404, {"error": "not found"})
        st = STORE_PATH.match(p)
        if st:
            f = os.path.join(STORE, *st[1].split("/"))
            if not os.path.isfile(f):
                return self._send(404, {"error": "not found"}, extra={"Access-Control-Allow-Origin": "*"})
            with open(f, "rb") as fh:
                data = fh.read()
            return self._send(
                200,
                data,
                mimetypes.guess_type(f)[0] or "application/octet-stream",
                {"Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"},
            )
        rel = re.fullmatch(r"/releases/(latest\.json|toybox-[0-9a-z]{4,16}\.zip)", p)
        if rel:
            f = os.path.join(RELEASES, rel[1])
            if not os.path.isfile(f):
                return self._send(404, {"error": "not found"})
            with open(f, "rb") as fh:
                data = fh.read()
            return self._send(
                200,
                data,
                "application/json" if f.endswith(".json") else "application/zip",
                {
                    "Cache-Control": "no-cache" if f.endswith(".json") else "public, max-age=31536000, immutable",
                    "X-Content-Type-Options": "nosniff",
                },
            )
        root = os.path.realpath(www())
        f = os.path.realpath(os.path.join(root, os.path.normpath(p.lstrip("/")) or "index.html"))
        if os.path.commonpath([root, f]) != root or not os.path.isfile(f):
            f = os.path.join(root, "index.html")
        if not os.path.isfile(f):
            return self._send(404, b"no app installed in ./www yet", "text/plain")
        ctype = mimetypes.guess_type(f)[0] or "application/octet-stream"
        if f.endswith(".webmanifest"):
            ctype = "application/manifest+json"
        with open(f, "rb") as fh:
            data = fh.read()
        # the installed apps (tauri:// origin) fetch version.json + app.js/css from here for live updates, so these need CORS too
        self._send(
            200,
            data,
            ctype,
            {
                "Cache-Control": "no-cache"
                if f.endswith(("sw.js", "index.html", "version.json"))
                else "public, max-age=3600",
                "Access-Control-Allow-Origin": "*",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "same-origin",
                "X-Frame-Options": "SAMEORIGIN",
                "Content-Security-Policy": "frame-ancestors 'self'",
            },
        )


def main(argv=()):
    if list(argv) == ["pair"]:
        print(pair_new()["code"])
        return
    srv = ThreadingHTTPServer((HOST, PORT), H)
    print(f"toybox sync on http://{HOST}:{PORT}  (db: {DB})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main(sys.argv[1:])
