"""Where other devices can reach this server, for the app's Pair a device sheet (POST /api/host/info, token):
addresses on the local network and, when Tailscale is installed, its address and https name. /api/host/share turns on
`tailscale serve` for this port so phones get an https address that works anywhere. Nothing here reads a secret."""

import ipaddress
import json
import os
import re
import shutil
import socket
import subprocess

QUIET = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW: the desktop app's server has no console to flash


def _ts():
    exe = shutil.which("tailscale")
    if not exe and os.name == "nt":
        for d in (os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramFiles(x86)", "")):
            f = os.path.join(d, "Tailscale", "tailscale.exe")
            if d and os.path.isfile(f):
                exe = f
                break
    if not exe and os.path.isfile("/Applications/Tailscale.app/Contents/MacOS/Tailscale"):
        exe = "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
    return exe


def _run(args, timeout=8):
    """-> (exit code, output). A command that waits for the user (serve not enabled yet) is cut off; its output still counts."""
    try:
        r = subprocess.run(
            args, capture_output=True, text=True, timeout=timeout, creationflags=QUIET, stdin=subprocess.DEVNULL
        )
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired as e:
        out = e.stdout or b""
        err = e.stderr or b""
        dec = lambda b: b.decode("utf-8", "replace") if isinstance(b, bytes) else (b or "")
        return -1, dec(out) + dec(err)
    except OSError as e:
        return -2, str(e)


def _ips():
    """IPv4 addresses of this machine, the one with the default route first."""
    found = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        found.append(s.getsockname()[0])
        s.close()  # nothing is sent
    except OSError:
        pass
    try:
        found += [i[4][0] for i in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)]
    except OSError:
        pass
    out = []
    for a in dict.fromkeys(found):
        try:
            ip = ipaddress.ip_address(a)
        except ValueError:
            continue
        if ip.is_loopback or ip.is_link_local:
            continue
        out.append(ip)
    return out


TS_NET = ipaddress.ip_network("100.64.0.0/10")


def _serving(exe, port):
    """The https address `tailscale serve` already gives this port, if any."""
    code, out = _run([exe, "serve", "status", "--json"])
    if code != 0:
        return None
    try:
        d = json.loads(out or "{}")
    except ValueError:
        return None
    for name, web in (d.get("Web") or {}).items():
        for h in (web.get("Handlers") or {}).values():
            if re.search(r"(127\.0\.0\.1|localhost):%d\b" % port, str(h.get("Proxy") or "")):
                host, _, p = name.partition(":")
                return "https://" + host + ("" if p in ("", "443") else ":" + p)
    return None


def info(port):
    ips = _ips()
    lan = ["http://%s:%d" % (ip, port) for ip in ips if ip not in TS_NET and ip.is_private]
    ts = {"installed": False}
    exe = _ts()
    if exe:
        ts["installed"] = True
        code, out = _run([exe, "status", "--json"])
        try:
            d = json.loads(out) if code == 0 else {}
        except ValueError:
            d = {}
        me = d.get("Self") or {}
        ts["running"] = d.get("BackendState") == "Running"
        v4 = [a for a in me.get("TailscaleIPs") or [] if "." in a]
        if v4:
            ts["ip"] = "http://%s:%d" % (v4[0], port)
        if me.get("DNSName"):
            ts["name"] = me["DNSName"].rstrip(".")
        if ts["running"]:
            ts["https"] = _serving(exe, port)
    else:
        v4 = [ip for ip in ips if ip in TS_NET]  # Tailscale without its command (rare): its address still shows
        if v4:
            ts.update(installed=True, running=True, ip="http://%s:%d" % (v4[0], port))
    return {"port": port, "lan": lan, "tailscale": ts}


def share(port):
    """`tailscale serve --bg` this port on https. The first time, Tailscale may ask for https to be enabled for the tailnet:
    that link comes back as {enable: url} for the app to open."""
    exe = _ts()
    if not exe:
        raise ValueError("Tailscale isn't installed on this computer.")
    code, out = _run([exe, "serve", "--bg", "--https=443", "http://127.0.0.1:%d" % port], timeout=20)
    m = re.search(r"https://login\.tailscale\.com/\S+", out)
    if m:
        return {"enable": m.group(0).rstrip(".,")}
    url = _serving(exe, port)
    if url:
        return {"https": url}
    msg = out.strip().splitlines()[-1] if out.strip() else "Tailscale answered %d." % code
    if "access denied" in out.lower() or "permission" in out.lower():
        msg = "Tailscale needs permission: run  tailscale set --operator=$USER  once (Linux), then try again."
    raise ValueError(msg[:300])
