"""Builds the sync server as one program with PyInstaller (python -m pip install pyinstaller first):
  python server/package.py            -> native/toybox-server-<os>[.exe]   one file to double-click or run
  python server/package.py --sidecar  -> build/server/toybox-server/        a folder the desktop installer bundles
Run it on each OS you want a program for (Linux: inside WSL). The app (dist/, `npm run build`) is built in."""

import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRV = os.path.join(ROOT, "server")
SKIP = (
    "test_",
    "admin",
    "pull_",
    "setup_",
    "moodle_setup",
    "ingest",
    "package",
    "release",
)  # cron jobs, home-server-only services, build scripts

# standard library the current code doesn't use yet, so server code that arrives by self-update can (else: bump RUNTIME)
EXTRA = [
    "csv",
    "uuid",
    "gzip",
    "bz2",
    "lzma",
    "tarfile",
    "statistics",
    "decimal",
    "fractions",
    "xml.etree.ElementTree",
    "xml.dom.minidom",
    "email.message",
    "email.parser",
    "email.policy",
    "smtplib",
    "imaplib",
    "http.cookies",
    "http.cookiejar",
    "concurrent.futures",
    "asyncio",
    "queue",
    "heapq",
    "bisect",
    "textwrap",
    "unicodedata",
    "calendar",
    "zoneinfo",
    "plistlib",
    "configparser",
    "tomllib",
    "shlex",
    "fnmatch",
    "glob",
    "pprint",
    "dataclasses",
    "enum",
    "typing",
    "functools",
    "itertools",
    "operator",
    "weakref",
    "copy",
    "struct",
    "array",
    "hmac",
    "base64",
    "binascii",
    "colorsys",
    "wave",
    "mimetypes",
    "ipaddress",
    "selectors",
    "ssl",
]


def runtime_files():
    """The server's own modules (and providers.json): what the packaged program and a release's code update carry."""
    return sorted(f for f in os.listdir(SRV) if (f.endswith(".py") and not f.startswith(SKIP)) or f == "providers.json")


def main():
    sidecar = "--sidecar" in sys.argv
    dist = os.path.join(ROOT, "dist")
    if not os.path.isfile(os.path.join(dist, "index.html")):
        sys.exit("Build the app first: npm run build")
    work = os.path.join(ROOT, "build", "pyi")
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    mods = [f[:-3] for f in runtime_files() if f.endswith(".py") and f != "toybox_server.py"]
    sep = ";" if os.name == "nt" else ":"
    out = os.path.join(ROOT, "build", "server") if sidecar else os.path.join(ROOT, "native")
    name = (
        "toybox-server"
        if sidecar
        else "toybox-server-" + {"win32": "windows", "darwin": "macos"}.get(sys.platform, "linux")
    )
    icon = os.path.join(ROOT, "src-tauri", "icons", "icon.ico")
    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--console",
        "--name",
        name,
        "--onedir" if sidecar else "--onefile",
        "--distpath",
        out,
        "--workpath",
        work,
        "--specpath",
        work,
        "--paths",
        SRV,
        "--add-data",
        os.path.join(SRV, "providers.json") + sep + ".",
        "--add-data",
        dist + sep + "www",
        "--exclude-module",
        "tkinter",
    ]
    # your release channel (gitignored server/channel.txt, one URL); without it the program never self-updates
    if os.path.isfile(os.path.join(SRV, "channel.txt")):
        cmd += ["--add-data", os.path.join(SRV, "channel.txt") + sep + "."]
    if os.name == "nt" and os.path.isfile(icon):
        cmd += ["--icon", icon]
    for m in sorted(mods) + EXTRA:
        cmd += ["--hidden-import", m]
    cmd.append(os.path.join(SRV, "toybox_server.py"))
    subprocess.run(cmd, check=True)
    print("built", os.path.join(out, name))


if __name__ == "__main__":
    main()
