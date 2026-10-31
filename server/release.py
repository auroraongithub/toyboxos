"""Packs a release for self-updating servers (server/updates.py), after `npm run build`:
  python server/release.py OUT_DIR
-> OUT_DIR/toybox-<build>.zip (the built app, the server's runtime files, and the app source that Osage's changes are
   re-applied onto) and OUT_DIR/latest.json {build, api, runtime, url, sha256, size}. Keeps the newest 3 zips.
deploy.sh and autodeploy.sh publish into the home server's data/releases, served at /releases/.
The channel is public, so a release is always the neutral default pack: the app is rebuilt with SOS_PACK=default into a
temp folder and src/packs/ carries only default (character packs stay private)."""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "server"))
from package import runtime_files
from toybox_server import RUNTIME

PRIVATE = os.path.join("src", "packs") + os.sep


def tree(name, base_dir=ROOT, arc_top=None):
    base = os.path.join(base_dir, name)
    for d, _, files in os.walk(base):
        rel_d = os.path.relpath(d, base_dir) + os.sep
        if rel_d.startswith(PRIVATE) and not rel_d.startswith(PRIVATE + "default" + os.sep):
            continue
        for f in sorted(files):
            p = os.path.join(d, f)
            if not os.path.islink(p):
                rel = os.path.relpath(p, base_dir).replace(os.sep, "/")
                yield p, (arc_top + rel[len(name) :] if arc_top else rel)


def neutral_build():
    """The app built with the default pack, in a temp folder (removed by the caller)."""
    out = tempfile.mkdtemp(prefix="toybox-release-")
    subprocess.run(
        ["node", "build.mjs"],
        cwd=ROOT,
        check=True,
        stdout=subprocess.DEVNULL,
        env=dict(os.environ, SOS_PACK="default", SOS_OUT=out),
    )
    return out


def main(out):
    dist = neutral_build()
    try:
        pack(out, dist)
    finally:
        shutil.rmtree(dist, ignore_errors=True)


def pack(out, dist):
    v = json.load(open(os.path.join(dist, "version.json")))
    build = v["build"]
    os.makedirs(out, exist_ok=True)
    name = "toybox-%s.zip" % build
    tmp = os.path.join(out, name + ".tmp")
    server = runtime_files()
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for p, arc in tree(os.path.basename(dist), os.path.dirname(dist), "dist"):
            z.write(p, arc)
        for top in ("src", "assets", "vendor"):
            for p, arc in tree(top):
                z.write(p, arc)
        for f in server:
            z.write(os.path.join(ROOT, "server", f), "server/" + f)
        z.write(os.path.join(ROOT, ".gitignore"), ".gitignore")
        z.writestr(
            "manifest.json", json.dumps({"build": build, "api": v.get("api", 1), "runtime": RUNTIME, "server": server})
        )
    os.replace(tmp, os.path.join(out, name))
    data = open(os.path.join(out, name), "rb").read()
    latest = {
        "build": build,
        "api": v.get("api", 1),
        "runtime": RUNTIME,
        "url": name,
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
        "commit": v.get("commit", ""),
        "subject": v.get("subject", ""),
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(os.path.join(out, "latest.json.tmp"), "w") as f:
        json.dump(latest, f)
    os.replace(os.path.join(out, "latest.json.tmp"), os.path.join(out, "latest.json"))
    zips = sorted(
        (f for f in os.listdir(out) if f.startswith("toybox-") and f.endswith(".zip")),
        key=lambda f: os.path.getmtime(os.path.join(out, f)),
    )
    for f in zips[:-3]:
        os.remove(os.path.join(out, f))
    print("release", build, "%.1f MB" % (len(data) / 1e6))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
