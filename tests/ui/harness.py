"""Shared setup for the browser tests: a local sync server on a temporary data folder serving the built app (dist/),
and Playwright contexts for a desktop window (1280x820) and a phone (Pixel 7) with seeded sample data.

Needs `npm run build` first, and `pip install playwright` + `python -m playwright install chromium` once."""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from contextlib import contextmanager

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TOKEN = "test-token"
SHOTS = os.path.join(ROOT, "build", "ui-shots")
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "layout_checks.js"), encoding="utf-8") as f:
    CHECKS = f.read()
# every optional module the server can offer, so their windows are tested too
CAPS = {"caps": ["jobs", "moodle", "admin", "hermes", "changes", "ai"]}
MODULES = {"ai": True, "jobs": True, "moodle": True, "nijika": True, "hermes": True, "changes": True}


def sample_data():
    now = int(time.time() * 1000)

    def docs(**rows):
        return {k: {**v, "_u": now} for k, v in rows.items()}

    job = {
        "title": "Virtual assistant for a small agency",
        "fit": 72,
        "pay": "$5/hr",
        "type": "Part time",
        "posted": "2026-10-29",
        "why": "Fits your admin and writing background.",
        "flags": ["low pay"],
        "url": "https://example.com",
        "status": "new",
    }
    sub = {"name": "Spotify", "slug": "spotify", "amt": 149, "cur": "PHP", "cycle": "mo", "next": "2026-11-05"}
    return {
        "config": docs(modules=MODULES),
        "jobs": docs(j1=job),
        "tasks": docs(t1={"title": "Write the report", "proj": "", "col": "todo"}),
        "events": docs(e1={"title": "Quiz", "start": "2026-10-31T09:00:00+08:00", "allDay": False}),
        "tx": docs(x1={"type": "out", "amt": 250, "cur": "PHP", "note": "lunch", "date": "2026-10-30"}),
        "pages": docs(p1={"title": "Biology", "kind": "subject", "icon": "", "body": "cells"}),
        "reminders": docs(r1={"title": "call mom", "at": "2026-10-31T17:00:00+08:00"}),
        "links": docs(l1={"name": "Example", "url": "https://example.com"}),
        "habits": docs(h1={"name": "Water", "days": []}),
        "wishes": docs(w1={"name": "Headphones", "price": 1500, "cur": "PHP"}),
        "subs": docs(s1=sub),
        "chats": docs(c1={"title": "Test chat", "src": []}),
        "amsg": docs(
            m1={"c": "c1", "o": 1, "r": "user", "t": "hi"},
            m2={"c": "c1", "o": 2, "r": "assistant", "t": "hey. what is up"},
        ),
    }


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def server():
    """Yields the base URL of a fresh sync server serving dist/, with a fake AI key."""
    if not os.path.isfile(os.path.join(ROOT, "dist", "index.html")):
        sys.exit("Build the app first: npm run build")
    home = tempfile.mkdtemp(prefix="toybox-ui-")
    with open(os.path.join(home, "openrouter_key.txt"), "w") as f:
        f.write("sk-test-not-real")
    port = free_port()
    env = dict(os.environ, SOS_HOME=home, SOS_PORT=str(port), SOS_HOST="127.0.0.1", SOS_TOKEN=TOKEN)
    env["SOS_WWW"] = os.path.join(ROOT, "dist")
    log = open(os.path.join(home, "server.log"), "w")
    script = os.path.join(ROOT, "server", "server.py")
    proc = subprocess.Popen([sys.executable, script], env=env, cwd=home, stdout=log, stderr=subprocess.STDOUT)
    url = "http://127.0.0.1:%d" % port
    for _ in range(100):
        try:
            urllib.request.urlopen(url + "/", timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    try:
        yield url
    finally:
        proc.kill()
        proc.wait()
        log.close()


def seed_script(url, data=None, extra=None):
    """An init script that fills localStorage once per tab: set up, synced to the test server, with sample data."""
    seed = {
        "os-setup": True,
        "os-sync-asked": True,
        "os-sync": {"url": url, "token": TOKEN, "on": True},
        "sos-db": data if data is not None else sample_data(),
        **(extra or {}),
    }
    sets = "".join("localStorage.setItem(%s,%s);" % (json.dumps(k), json.dumps(json.dumps(v))) for k, v in seed.items())
    return "if(!sessionStorage.seeded){sessionStorage.seeded=1;" + sets + "}"


def new_context(browser, pw, phone, url, caps=None, **seed):
    """caps: what the test server claims to offer (default: everything)."""
    if phone:
        ctx = browser.new_context(**pw.devices["Pixel 7"])
    else:
        ctx = browser.new_context(viewport={"width": 1280, "height": 820})
    ctx.route("**/fonts.g*/**", lambda r: r.abort())
    ctx.route("**/api/caps", lambda r: r.fulfill(json=caps or CAPS))
    ctx.add_init_script(seed_script(url, **seed))
    return ctx


def open_window(page, win):
    """Makes `win` the only open window (the current screen on phones) and waits for it."""
    page.evaluate(
        "w => { localStorage.setItem('os-open', JSON.stringify([w])); localStorage.setItem('os-view', JSON.stringify(w)); }",
        win,
    )
    page.reload()
    page.wait_for_selector(".win[data-win='%s']" % win, timeout=8000)
    page.wait_for_timeout(600)


def shot(page, name):
    os.makedirs(SHOTS, exist_ok=True)
    page.screenshot(path=os.path.join(SHOTS, name + ".png"))
