"""Run a local model for Osage (stdlib only, Windows/Linux).

  python server/local-ai/local_ai.py install      once: run the helper at every login (it uses almost no memory)
  python server/local-ai/local_ai.py              status + what it found
  python server/local-ai/local_ai.py start [name] load a model now (not needed: Osage loads it when you pick it)
  python server/local-ai/local_ai.py stop         unload the model (frees VRAM); quit = stop the helper too
  python server/local-ai/local_ai.py list | uninstall | set --server PATH --models DIR [--only NAMES --idle MIN --ctx N --kv TYPE]

The helper listens on 127.0.0.1:8085 (OpenAI-compatible, the app finds it by itself). It lists your .gguf models without
loading anything, starts llama-server (llama.cpp, or a fork such as TurboQuant) on the first message to a model, and unloads it
after 10 idle minutes, so VRAM is only used while you chat. Settings live in ~/.toybox-local-ai.json."""

import re
import argparse
import atexit
import glob
import http.client
import http.server
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

HOME = os.path.expanduser("~")
CFG = os.path.join(HOME, ".toybox-local-ai.json")
LOG = os.path.join(HOME, ".toybox-local-ai.log")
EXE = "llama-server.exe" if os.name == "nt" else "llama-server"
PORT = 8085  # 8080 is taken by too many other things
SKIP = (
    "mmproj",
    "vocab",
    "dflash",
    "draft",
)  # projectors, tokenizer stubs and speculative-decoding drafts aren't chat models
PREFER = (
    "qwen3.5-4b",
    "qwen3-4b",
    "qwen3.5-9b",
    "qwen3-8b",
    "gemma-4",
    "gemma",
)  # the first that exists is the default (Qwen handles Osage's tools; Gemma E2B is chat only)


def load():
    try:
        with open(CFG) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save(c):
    with open(CFG, "w") as f:
        json.dump(c, f, indent=1)


def roots():
    """Places worth looking in: the home folder and, on Windows, every drive's top level."""
    r = [HOME]
    if os.name == "nt":
        r += [d + ":\\" for d in "CDEFGH" if os.path.isdir(d + ":\\")]
    else:
        r += [p for p in ("/mnt", "/opt", "/srv") if os.path.isdir(p)]
    return r


def find_server(c):
    for p in (c.get("server"), os.environ.get("LLAMA_SERVER"), shutil.which("llama-server")):
        if p and os.path.isfile(p):
            return p
    for r in roots():
        for pat in (
            "*/build/bin/Release/" + EXE,
            "*/build/bin/" + EXE,
            "*/*/build/bin/Release/" + EXE,
            "*/*/build/bin/" + EXE,
            "*/" + EXE,
        ):
            hit = sorted(glob.glob(os.path.join(r, pat)))
            if hit:
                return hit[0]
    return None


def find_models(c):
    """Folders holding .gguf files: the one you set, else every models folder found near the home folder / drive roots."""
    if c.get("models") or os.environ.get("LOCAL_AI_MODELS"):
        cand = [c.get("models") or os.environ["LOCAL_AI_MODELS"]]
    elif c.get("found") and all(list_ggufs(d) for d in c["found"]):
        return c["found"]  # remembered from the last scan (the scan takes a few seconds)
    else:
        cand = [os.path.join(HOME, "models")]
        for r in roots():
            cand += [p for n in range(1, 4) for p in glob.glob(os.path.join(r, *["*"] * n, "models"))]
    out = []
    for d in cand:
        if d and os.path.isdir(d) and d not in out and list_ggufs(d):
            out.append(d)
    if out and not c.get("models"):
        c["found"] = out
        save(c)
    return out


def list_ggufs(d):
    out = [p for p in glob.glob(os.path.join(d, "*.gguf")) if not any(s in os.path.basename(p).lower() for s in SKIP)]
    return sorted(out, key=lambda p: -os.path.getsize(p))


def all_ggufs(dirs):
    return [p for d in dirs for p in list_ggufs(d)]


def pick(files, want):
    low = [(p, os.path.basename(p).lower()) for p in files]
    if want:
        hit = [p for p, n in low if want.lower() in n]
        return hit[0] if hit else None
    for pref in PREFER:
        hit = [p for p, n in low if pref in n]
        if hit:
            return hit[0]
    return files[0] if files else None


def alias(path):
    return os.path.basename(path)[:-5].replace("-Q4_K_M", "").replace("-it-fraQtl-HiFi", "")


def mmproj_for(path):
    """Gemma-style vision projector that sits next to the model (name shares the family)."""
    stem = os.path.basename(path).lower()
    for p in glob.glob(os.path.join(os.path.dirname(path), "mmproj*.gguf")):
        fam = os.path.basename(p).lower().replace("mmproj-", "").replace(".gguf", "")
        fam = re.sub(r"-(?:b?f16|f32|q\d.*)$", "", fam.split("-it")[0])
        if fam and fam in stem:
            return p
    return None


def has(server, flag):
    try:
        return flag in subprocess.run([server, "--help"], capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return False


def up(port, wait=0.0):
    end = time.time() + wait
    while True:
        try:
            urllib.request.urlopen(
                "http://127.0.0.1:%d/health" % port, timeout=1.5
            ).close()  # 503 while the model is still loading
            with urllib.request.urlopen("http://127.0.0.1:%d/v1/models" % port, timeout=1.5) as r:
                return [m["id"] for m in json.load(r).get("data", [])]
        except Exception:
            if time.time() >= end:
                return None
            time.sleep(1)


BACK = 18085  # llama-server itself; the helper on PORT is what the app talks to
HIDE = 0x08000000 | 0x00000200  # Windows: no console window, own process group
LOWPRI = HIDE | 0x00004000  # + below-normal priority, so a busy model never makes the desktop stutter


def launch_args(c, model, ctx=None, kv=None):
    s, _ = find_server(c), find_models(c)
    if not s:
        raise RuntimeError(
            "llama-server not found. Build llama.cpp (cmake -B build -DGGML_CUDA=ON) or run: set --server PATH"
        )
    turbo = has(s, "turbo3")
    ctx = ctx or c.get("ctx") or (16384 if os.path.getsize(model) > 4.5 * 2**30 or not turbo else 32768)
    # KV cache precision: measured on an RTX 4070 laptop (Qwen3.5-4B, 32K) q8_0 is the fastest and most exact for only ~0.25 GB more than
    # turbo3; past 32K the cache grows, so step down to the compact turbo types (when the build has them)
    kv = kv or c.get("kv") or ("q8_0" if ctx <= 32768 or not turbo else "turbo4" if ctx <= 131072 else "turbo3")
    gem = (
        "gemma" in os.path.basename(model).lower()
    )  # Gemma's card: top-k 64, top-p 0.95 (keeps the cool 0.3 temperature for tool calls)
    smp = {
        "temp": 0.3,
        "top-p": 0.95 if gem else 0.8,
        "top-k": 64 if gem else 20,
        "min-p": 0,
        **(c.get("sampling") or {}),
    }  # Qwen's non-thinking settings, cooler than the card's 0.7: measured on Osage's real request, 0.3 + a firm "search first" rule made vague "up to date" questions call the search tool 8 of 8 times (0.8: 1 of 8)
    args = [
        s,
        "-m",
        model,
        "--alias",
        alias(model),
        "--host",
        "127.0.0.1",
        "--port",
        str(BACK),
        "-c",
        str(ctx),
        "-ngl",
        "99",
        "--parallel",
        "1",
        "--no-mmap",
        "-ub",
        "256",
        "-cram",
        "256",
        "-t",
        str(c.get("threads", 4)),
        "-tb",
        str(c.get("threads", 4)),  # -ub 256: least VRAM, no speed lost
        "--jinja",
        "--flash-attn",
        "on",
        "--cache-type-k",
        kv,
        "--cache-type-v",
        kv,
    ]
    for k, v in smp.items():
        args += ["--" + k, str(v)]
    mm = (
        mmproj_for(model) if c.get("vision") else None
    )  # measured (Gemma E2B): the projector costs +0.8 GB VRAM and ~12% speed, so image input is opt-in: set --vision on
    if mm:
        args += ["--mmproj", mm]
    return args


def rss_mb(pid):
    """Resident RAM of a process in MB (Windows: GetProcessMemoryInfo, Linux: /proc), 0 when unknown."""
    try:
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes

            class PMC(ctypes.Structure):
                _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
                    (n, ctypes.c_size_t)
                    for n in (
                        "PeakWorkingSetSize",
                        "WorkingSetSize",
                        "QuotaPeakPagedPoolUsage",
                        "QuotaPagedPoolUsage",
                        "QuotaPeakNonPagedPoolUsage",
                        "QuotaNonPagedPoolUsage",
                        "PagefileUsage",
                        "PeakPagefileUsage",
                    )
                ]

            k = ctypes.windll.kernel32
            k.OpenProcess.restype = wintypes.HANDLE
            h = k.OpenProcess(0x1000 | 0x0400, False, pid)  # QUERY_LIMITED_INFORMATION | QUERY_INFORMATION
            if not h:
                return 0
            m = PMC()
            m.cb = ctypes.sizeof(m)
            ok = ctypes.windll.psapi.GetProcessMemoryInfo(wintypes.HANDLE(h), ctypes.byref(m), m.cb)
            k.CloseHandle(h)
            return round(m.WorkingSetSize / 2**20) if ok else 0
        for l in open("/proc/%d/status" % pid):
            if l.startswith("VmRSS:"):
                return round(int(l.split()[1]) / 1024)
    except Exception:
        pass
    return 0


def vram_mb():
    """Total VRAM in use on the first NVIDIA GPU (the whole desktop, not just the model), 0 when there is no nvidia-smi."""
    try:
        o = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=3,
            **({"creationflags": 0x08000000} if os.name == "nt" else {}),
        ).stdout.split()
        return int(o[0])
    except Exception:
        return 0


class Sup:
    """Owns one llama-server at a time: starts it for the model a request names, swaps models, unloads when idle."""

    def __init__(self, c):
        self.c = c
        self.lock = threading.Lock()
        self.proc = None
        self.model = None
        self.loading = False
        self.last = time.time()
        self.busy = 0

    def files(self):
        only = [
            x.lower() for x in self.c.get("only") or []
        ]  # "set --only qwen3.5-4b,gemma": show just these in the app's menu
        return [
            p for p in all_ggufs(find_models(self.c)) if not only or any(x in os.path.basename(p).lower() for x in only)
        ]

    def resolve(self, want):
        files = self.files()
        for p in files:
            if want and alias(p).lower() == want.lower():
                return p
        return pick(files, want) or pick(files, None)

    def running(self):
        return self.proc is not None and self.proc.poll() is None

    def _kill(self):
        if self.running():
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(self.proc.pid), "/T", "/F"], capture_output=True)
            else:
                self.proc.terminate()
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None
        self.model = None

    def stop(self):
        with self.lock:
            self._kill()

    def ensure(self, want):
        with self.lock:
            path = self.resolve(want)
            if not path:
                raise RuntimeError("No .gguf models found. Run: set --models DIR")
            if self.running() and self.model == path:
                return
            self._kill()
            self.loading = True
            try:
                log = open(LOG, "w")
                self.proc = subprocess.Popen(
                    launch_args(self.c, path),
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL,
                    **({"creationflags": LOWPRI} if os.name == "nt" else {"preexec_fn": lambda: os.nice(5)}),
                )
                for _ in range(240):
                    if up(BACK, wait=0.5) or self.proc.poll() is not None:
                        break
                if not self.running() or not up(BACK):
                    err = [l for l in open(LOG, errors="replace").read().splitlines() if " E " in l][-2:]
                    self._kill()
                    raise RuntimeError(
                        "llama-server didn't start: " + ("; ".join(l.split(" E ", 1)[-1] for l in err) or "see " + LOG)
                    )
                self.model = path
            finally:
                self.loading = False

    def reap(self):
        while True:
            time.sleep(30)
            idle = float(self.c.get("idle", 10)) * 60
            if self.running() and not self.busy and not self.loading and time.time() - self.last > idle:
                self.stop()


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    sup = None
    httpd = None

    def log_message(self, *a):
        pass

    def _head(self, code, ctype="application/json", length=None):
        self.send_response(code)
        for k, v in (
            ("Access-Control-Allow-Origin", "*"),
            ("Access-Control-Allow-Headers", "*"),
            ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
            ("Access-Control-Allow-Private-Network", "true"),
            ("Content-Type", ctype),
            ("Connection", "close"),
        ):
            self.send_header(k, v)
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.end_headers()
        self.close_connection = True

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self._head(code, length=len(b))
        self.wfile.write(b)

    def do_OPTIONS(self):
        self._head(204, length=0)

    def do_GET(self):
        S = self.sup
        if self.path.rstrip("/") == "/v1/models":
            return self._json(
                200,
                {
                    "object": "list",
                    "data": [{"id": i, "object": "model"} for i in dict.fromkeys(alias(p) for p in S.files())],
                },
            )
        if self.path == "/status":
            on = S.running() and S.model
            return self._json(
                200,
                {
                    "loaded": alias(S.model) if on else None,
                    "loading": S.loading,
                    "idle_min": float(S.c.get("idle", 10)),
                    "ram_mb": rss_mb(S.proc.pid) if on else 0,
                    "vram_mb": vram_mb() if on else 0,
                    "vision": bool(S.c.get("vision")),
                    "can_vision": any(mmproj_for(p) for p in S.files()),
                },
            )
        self._json(404, {"error": {"message": "not found"}})

    def do_POST(self):
        S = self.sup
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        try:
            want = (json.loads(body or b"{}") or {}).get("model")
        except ValueError:
            want = None
        if self.path == "/unload":
            S.stop()
            return self._json(200, {"ok": True})
        if (
            self.path == "/vision"
        ):  # {"on": bool}: saved, and the model reloads with/without its projector on the next message
            try:
                on = bool((json.loads(body or b"{}") or {}).get("on"))
            except ValueError:
                on = False
            S.c["vision"] = on
            save(S.c)
            S.stop()
            return self._json(200, {"ok": True, "vision": on})
        if self.path == "/quit":
            self._json(200, {"ok": True})
            S.stop()
            threading.Thread(target=self.httpd.shutdown, daemon=True).start()
            return
        if self.path == "/load" or self.path.startswith("/v1/"):
            S.busy += 1
            S.last = time.time()
            try:
                try:
                    S.ensure(want)
                except RuntimeError as e:
                    return self._json(502, {"error": {"message": str(e)}})
                if self.path == "/load":
                    return self._json(200, {"ok": True, "loaded": alias(S.model)})
                conn = http.client.HTTPConnection("127.0.0.1", BACK, timeout=900)
                try:
                    conn.request("POST", self.path, body, {"Content-Type": "application/json"})
                    r = conn.getresponse()
                    self._head(r.status, r.getheader("Content-Type") or "application/json")
                    while True:
                        chunk = r.read1(8192)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        self.wfile.flush()
                        S.last = time.time()
                except (ConnectionError, OSError):
                    pass  # the app pressed Stop: closing the socket makes llama-server stop generating
                finally:
                    conn.close()
            finally:
                S.busy -= 1
                S.last = time.time()
            return
        self._json(404, {"error": {"message": "not found"}})


def ask(path, data=None, wait=3):
    req = urllib.request.Request(
        "http://127.0.0.1:%d%s" % (int(load().get("port", PORT)), path),
        None if data is None else json.dumps(data).encode(),
        {"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=wait) as r:
        return json.load(r)


def helper_up():
    try:
        ask("/status")
        return True
    except Exception:
        return False


def spawn_helper():
    exe = sys.executable
    if os.name == "nt" and os.path.isfile(os.path.join(os.path.dirname(exe), "pythonw.exe")):
        exe = os.path.join(os.path.dirname(exe), "pythonw.exe")
    kw = {"creationflags": HIDE | 0x00000008} if os.name == "nt" else {"start_new_session": True}
    subprocess.Popen(
        [exe, os.path.abspath(__file__), "serve"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        **kw,
    )
    for _ in range(20):
        time.sleep(0.5)
        if helper_up():
            return True
    return False


def cmd_serve(c, a):
    S = Sup(c)
    Handler.sup = S
    threading.Thread(target=S.reap, daemon=True).start()
    atexit.register(S.stop)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", int(c.get("port", PORT))), Handler)
    srv.daemon_threads = True
    Handler.httpd = srv
    srv.serve_forever()


def cmd_status(c, a):
    s, m = find_server(c), find_models(c)
    print("llama-server:", s or "not found (build llama.cpp, or: set --server PATH)")
    print("models folders:", ", ".join(m) or "not found (set --models DIR)")
    print("models:", ", ".join(os.path.basename(p) for p in all_ggufs(m)) or "none")
    if not helper_up():
        return print("helper: not running (python server/local-ai/local_ai.py install)")
    st = ask("/status")
    print(
        "helper: running; model:",
        st["loaded"] or "none loaded (loads on the first message)",
        "- unloads after %g idle min" % st["idle_min"],
    )


def cmd_list(c, a):
    m = find_models(c)
    if not m:
        sys.exit("No .gguf folder found. Use: set --models DIR")
    for p in all_ggufs(m):
        print("%5.1f GB  %s" % (os.path.getsize(p) / 2**30, os.path.basename(p)))


def cmd_set(c, a):
    for k in ("server", "models"):
        if getattr(a, k):
            c[k] = os.path.abspath(getattr(a, k))
    if a.vision:
        c["vision"] = a.vision == "on"
    if a.only is not None:
        c["only"] = [x.strip() for x in a.only.split(",") if x.strip()]
    for k in ("port", "idle", "ctx", "kv"):
        if getattr(a, k) is not None:
            c[k] = getattr(a, k)
    save(c)
    print("saved", CFG, "(restart the helper: quit, then start)" if helper_up() else "")


def cmd_start(c, a):
    if not helper_up() and not spawn_helper():
        sys.exit("Couldn't start the helper.")
    want = alias(pick(all_ggufs(find_models(c)), a.model) or "") if a.model else None
    if a.model and not want:
        sys.exit("No model matches '%s'. See: list" % a.model)
    print("loading...")
    try:
        print("ready:", ask("/load", {"model": want}, wait=300)["loaded"])
    except urllib.error.HTTPError as e:
        sys.exit(json.load(e)["error"]["message"])


def cmd_stop(c, a):
    if helper_up():
        ask("/unload", {})
        print("unloaded")
    else:
        print("The helper isn't running.")


def cmd_quit(c, a):
    if helper_up():
        ask("/quit", {})
        print("helper stopped")
    else:
        print("The helper isn't running.")


def autostart_file():
    if os.name == "nt":
        return os.path.join(
            os.environ.get("APPDATA", HOME),
            "Microsoft",
            "Windows",
            "Start Menu",
            "Programs",
            "Startup",
            "toybox-local-ai.vbs",
        )
    return os.path.join(HOME, ".config", "systemd", "user", "toybox-local-ai.service")


def cmd_install(c, a):
    f = autostart_file()
    os.makedirs(os.path.dirname(f), exist_ok=True)
    me = os.path.abspath(__file__)
    if os.name == "nt":
        exe = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
        open(f, "w").write(
            'CreateObject("Wscript.Shell").Run """%s"" ""%s"" serve", 0, False\n'
            % (exe if os.path.isfile(exe) else sys.executable, me)
        )
    elif sys.platform.startswith("linux"):
        open(f, "w").write(
            "[Unit]\nDescription=toybox.os local AI helper\n\n[Service]\nExecStart=%s %s serve\nRestart=on-failure\n\n[Install]\nWantedBy=default.target\n"
            % (sys.executable, me)
        )
        subprocess.run(["systemctl", "--user", "daemon-reload"])
        subprocess.run(["systemctl", "--user", "enable", "--now", "toybox-local-ai"])
    else:
        return print("Autostart isn't set up for this system. Run: python %s serve (at login)" % me)
    if not helper_up():
        spawn_helper()
    print("installed:", f)
    cmd_status(c, a)


def cmd_uninstall(c, a):
    cmd_quit(c, a)
    f = autostart_file()
    if os.name != "nt" and sys.platform.startswith("linux"):
        subprocess.run(["systemctl", "--user", "disable", "--now", "toybox-local-ai"])
    if os.path.isfile(f):
        os.remove(f)
    print("removed autostart")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")
    for n in ("status", "list", "stop", "quit", "install", "uninstall", "serve"):
        sub.add_parser(n)
    st = sub.add_parser("start")
    st.add_argument("model", nargs="?")
    se = sub.add_parser("set")
    se.add_argument("--server")
    se.add_argument("--models")
    se.add_argument("--port", type=int)
    se.add_argument("--idle", type=float, help="minutes before an unused model unloads")
    se.add_argument("--only", help="comma-separated parts of file names to offer in the app (empty = all)")
    se.add_argument("--ctx", type=int)
    se.add_argument(
        "--vision", choices=["on", "off"], help="load the vision projector next to the model (+0.8 GB VRAM)"
    )
    se.add_argument("--kv", help="KV cache type, e.g. turbo2, turbo3, q8_0")
    a = ap.parse_args()
    {
        "list": cmd_list,
        "set": cmd_set,
        "start": cmd_start,
        "stop": cmd_stop,
        "quit": cmd_quit,
        "install": cmd_install,
        "uninstall": cmd_uninstall,
        "serve": cmd_serve,
    }.get(a.cmd, cmd_status)(load(), a)
