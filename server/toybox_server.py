"""toybox sync server as one program (the packaged build: server/package.py, PyInstaller), also how install.sh and Docker
run it. Double-click it, or run  toybox-server [--port 8787] [--data DIR] [--quiet] [pair]. Your data lives apart from
the program: Windows %LOCALAPPDATA%\\toybox-server, macOS ~/Library/Application Support/toybox-server, Linux
~/.local/share/toybox-server (or $SOS_HOME). The app itself is built in; updates (server/updates.py) land in the data
folder. The desktop app runs this same program for "Host sync on this computer" (--quiet, its own data folder).
It runs the server as a child process: exit code 75 = restart (an update brought new server code, loaded from
<data>/code/<build>); new code that dies within a minute of starting is dropped and the previous code comes back."""

import importlib.machinery
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import webbrowser

RUNTIME = (
    1  # bump when server code starts needing something this program doesn't carry (a new stdlib module, a new build)
)
RESTART = 75


def _home():
    if os.environ.get("SOS_HOME"):
        return os.environ["SOS_HOME"]
    if os.name == "nt":
        root = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":
        root = os.path.expanduser("~/Library/Application Support")
    else:
        root = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return os.path.join(root, "toybox-server")


def _args(argv):
    o = {"port": None, "data": None, "quiet": False, "browser": True, "child": False, "rest": []}
    it = iter(argv)
    for a in it:
        if a == "--port":
            o["port"] = next(it, None)
        elif a == "--data":
            o["data"] = next(it, None)
        elif a == "--quiet":
            o["quiet"] = True
        elif a == "--no-browser":
            o["browser"] = False
        elif a == "--child":
            o["child"] = True
        elif a in ("-h", "--help"):
            print(__doc__)
            sys.exit(0)
        else:
            o["rest"].append(a)
    return o


def _busy(port):
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


# ---------- updated server code ----------
def _code(home):
    f = os.path.join(home, "code", "current.json")
    try:
        with open(f) as fh:
            c = json.load(fh)
        return c if isinstance(c, dict) and re.fullmatch(r"[0-9a-z]{4,16}", str(c.get("dir", ""))) else None
    except (OSError, ValueError):
        return None


def _write_code(home, c):
    f = os.path.join(home, "code", "current.json")
    if c is None:
        try:
            os.remove(f)
        except OSError:
            pass
        return
    with open(f + ".tmp", "w") as fh:
        json.dump(c, fh)
    os.replace(f + ".tmp", f)


class _Overlay:
    """Imports the server's own modules from <data>/code/<build> ahead of the copies built into this program."""

    def __init__(self, d):
        self.d = d
        self.names = {f[:-3] for f in os.listdir(d) if f.endswith(".py")} - set(sys.stdlib_module_names)

    def find_spec(self, name, path=None, target=None):
        return importlib.machinery.PathFinder.find_spec(name, [self.d]) if name in self.names and path is None else None

    def invalidate_caches(self):
        pass


# ---------- the supervisor ----------
def _bind_children():
    """Children die with this process, however it ends (the desktop app kills it to stop hosting)."""
    try:
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes

            class Basic(ctypes.Structure):
                _fields_ = [
                    ("a", ctypes.c_int64),
                    ("b", ctypes.c_int64),
                    ("LimitFlags", wintypes.DWORD),
                    ("c", ctypes.c_size_t),
                    ("d", ctypes.c_size_t),
                    ("e", wintypes.DWORD),
                    ("f", ctypes.c_size_t),
                    ("g", wintypes.DWORD),
                    ("h", wintypes.DWORD),
                ]

            class Ext(ctypes.Structure):
                _fields_ = [
                    ("Basic", Basic),
                    ("Io", ctypes.c_uint64 * 6),
                    ("i", ctypes.c_size_t),
                    ("j", ctypes.c_size_t),
                    ("k", ctypes.c_size_t),
                    ("l", ctypes.c_size_t),
                ]

            k = ctypes.windll.kernel32
            k.CreateJobObjectW.restype = wintypes.HANDLE
            job = k.CreateJobObjectW(None, None)
            info = Ext()
            info.Basic.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            k.SetInformationJobObject(wintypes.HANDLE(job), 9, ctypes.byref(info), ctypes.sizeof(info))
            k.AssignProcessToJobObject(wintypes.HANDLE(job), wintypes.HANDLE(k.GetCurrentProcess()))
            return job  # kept open for the life of this process
        if sys.platform.startswith("linux"):
            import ctypes
            import signal

            libc = ctypes.CDLL(None)
            return lambda: libc.prctl(1, signal.SIGTERM)  # PR_SET_PDEATHSIG, run in the child
    except Exception:
        pass  # best effort: without it, child processes just aren't tied to this one
    return None


def supervise(argv, o, home):
    bind = _bind_children()
    cmd = (
        [sys.executable]
        + ([] if getattr(sys, "frozen", False) else [os.path.abspath(__file__)])
        + list(argv)
        + ["--child"]
    )
    fast = 0
    while True:
        t = time.time()
        kw = {"preexec_fn": bind} if callable(bind) else {}
        p = subprocess.Popen(cmd, **kw)
        try:
            rc = p.wait()
        except KeyboardInterrupt:
            try:
                p.wait(10)
            except (subprocess.TimeoutExpired, KeyboardInterrupt):
                p.kill()
            return 0
        if rc == RESTART:
            continue
        c = _code(home)
        if c and c.get("trial") and time.time() - t < 60:
            print("toybox sync: the updated server code didn't start, going back to the previous version.", flush=True)
            _write_code(home, {"dir": c["prev"]} if c.get("prev") else None)
            with open(os.path.join(home, "code", "failed"), "w") as fh:
                fh.write(c["dir"])  # the app says so (updates.status)
            continue
        fast = fast + 1 if time.time() - t < 30 else 0
        if rc == 0 or fast >= 5:
            return rc
        time.sleep(2)  # a crash: start again, but not in a tight loop


def run(argv):
    o = _args(argv)
    home = os.path.abspath(o["data"] or _home())
    os.makedirs(home, exist_ok=True)
    os.environ["SOS_HOME"] = home
    if o["port"]:
        os.environ["SOS_PORT"] = str(int(o["port"]))
    port = int(os.environ.get("SOS_PORT", "8787"))
    builtin = os.path.join(getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__))), "www")
    if os.path.isdir(builtin):
        os.environ.setdefault("SOS_WWW_BUILTIN", builtin)
    if os.environ.get("SOS_WWW"):
        os.environ["SOS_WWW"] = os.path.abspath(os.environ["SOS_WWW"])
    os.environ.setdefault("SOS_UPDATES", "1")
    os.environ["SOS_RUNTIME"] = str(
        RUNTIME if getattr(sys, "frozen", False) else 1_000_000
    )  # from source, any code runs
    os.chdir(home)
    if o["rest"] == ["pair"]:
        import server

        return server.main(["pair"])
    if not o["child"]:
        if _busy(port):
            print("toybox sync is already running on port %d." % port)
            if not o["quiet"] and o["browser"]:
                webbrowser.open("http://127.0.0.1:%d/" % port)
            time.sleep(3)
            return 0
        return supervise(argv, o, home)
    # ---------- the server itself ----------
    os.environ["SOS_SUPERVISED"] = "1"
    c = _code(home)
    try:  # code from an update only when it's newer than the code this program (or install) came with
        with open(os.path.join(os.environ.get("SOS_WWW_BUILTIN") or "", "version.json")) as fh:
            base = int(json.load(fh)["build"], 36)
    except (OSError, ValueError, KeyError):
        base = 0
    if c and int(c["dir"], 36) > base and os.path.isdir(os.path.join(home, "code", c["dir"])):
        sys.meta_path.insert(0, _Overlay(os.path.join(home, "code", c["dir"])))
        if c.get("trial"):  # it started: keep it
            keep = threading.Timer(60, lambda: _write_code(home, {"dir": c["dir"], "prev": c.get("prev")}))
            keep.daemon = True
            keep.start()
    first = not os.path.exists(os.path.join(home, "token.txt")) and not os.environ.get("SOS_TOKEN")
    import server
    import host  # reads the settings above at import

    if o["quiet"]:
        return server.main()
    code = server.pair_new()["code"]
    addrs = host.info(port)
    print("\n  toybox sync is running. Keep this window open (closing it stops sync).\n")
    print("  This computer:      http://127.0.0.1:%d" % port)
    for u in addrs["lan"]:
        print("  On this Wi-Fi:      " + u)
    ts = addrs["tailscale"]
    if ts.get("https") or ts.get("ip"):
        print("  Tailscale:          " + (ts.get("https") or ts["ip"]))
    print("\n  Pairing code:       %s   (works once, for 10 minutes)" % code)
    print("  Open one of the addresses on your phone, or type it with the code in the app's Start > Sync.")
    print("  New code any time:  toybox-server pair\n  Your data:          %s\n" % home, flush=True)
    if first and o["browser"]:
        threading.Timer(1.0, lambda: webbrowser.open("http://127.0.0.1:%d/#pair=%s" % (port, code))).start()
    try:
        server.main()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    try:
        sys.exit(run(sys.argv[1:]) or 0)
    except OSError as e:
        print("toybox sync couldn't start: %s" % e)
        time.sleep(8)
        sys.exit(1)
