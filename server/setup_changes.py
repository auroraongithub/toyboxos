#!/usr/bin/env python3
"""Install the private source workspace and a fixed compiler for Osage's frontend drafts."""

import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request


def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True, stdout=subprocess.DEVNULL)


def install_moodle_runtime(snapshot, base):
    """Bootstrap a fixed file set for hosts whose current deployer predates Moodle support."""
    names = ("moodle.py", "moodle_setup.py", "MOODLE.md")
    members = {member.name: member for member in snapshot.getmembers()}
    if not any("runtime/" + name in members for name in names):
        return  # Older frontend-only snapshots remain supported.
    contents = {}
    for name in names:
        member = members.get("runtime/" + name)
        if member is None or not member.isfile() or member.size > 1024 * 1024:
            raise ValueError("Invalid Moodle runtime snapshot")
        contents[name] = snapshot.extractfile(member).read()
    for name, content in contents.items():
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=base, delete=False) as output:
                temporary = Path(output.name)
                os.chmod(temporary, 0o600)
                output.write(content)
            os.replace(temporary, base / name)
        finally:
            if temporary and temporary.exists():
                temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("history", type=Path)
    parser.add_argument("--refresh", action="store_true", help="Refresh source after a trusted external deployment")
    args = parser.parse_args()
    base = Path(__file__).resolve().parent
    root = base / "app-changes"
    os.umask(0o077)
    if (root / "source").exists() and not args.refresh:
        raise SystemExit("Workspace already exists; update its source through a reviewed commit")
    root.mkdir(exist_ok=True)
    tools = root / "tools"
    tools.mkdir(exist_ok=True)
    # Official pinned npm package; no install scripts, npm runtime or model-chosen packages.
    compiler = tools / "esbuild"
    if not compiler.exists():
        with urllib.request.urlopen("https://registry.npmjs.org/@esbuild%2flinux-x64/0.24.2", timeout=30) as response:
            package = json.load(response)
        with urllib.request.urlopen(package["dist"]["tarball"], timeout=60) as response:
            archive = response.read(20 * 1024 * 1024)
        algorithm, digest = package["dist"]["integrity"].split("-", 1)
        if algorithm != "sha512" or base64.b64encode(hashlib.sha512(archive).digest()).decode() != digest:
            raise SystemExit("Compiler integrity check failed")
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as bundle:
            binary = bundle.extractfile("package/bin/esbuild").read()
        compiler.write_bytes(binary)
        compiler.chmod(0o700)
    source = root / "source"
    if not source.exists():
        run("git", "clone", "--quiet", str(args.history.resolve()), str(source))
    elif subprocess.check_output(["git", "status", "--porcelain"], cwd=source).strip():
        raise SystemExit("Source has uncommitted edits; refresh stopped")
    with tarfile.open(args.snapshot, "r:gz") as snapshot:
        # This archive is generated from local frontend files, not from model output.
        snapshot.extractall(
            source, members=[m for m in snapshot.getmembers() if not m.name.startswith("runtime/")], filter="data"
        )
        install_moodle_runtime(snapshot, base)
    run("git", "config", "user.name", "Osage", cwd=source)
    run("git", "config", "user.email", "osage@toybox.local", cwd=source)
    run("git", "add", "src", "assets", "vendor", ".gitignore", cwd=source)
    # character packs are gitignored upstream but must stay in Osage's private source, or drafts would build without them
    if (source / "src/packs").exists():
        run("git", "add", "-f", "src/packs", cwd=source)
    if subprocess.check_output(["git", "status", "--porcelain"], cwd=source).strip():
        run("git", "commit", "--quiet", "-m", "Baseline: approved Osage preview and release workflow", cwd=source)
    shutil.copytree(source / "node_modules/marked", tools / "marked", dirs_exist_ok=True)
    releases = root / "releases"
    releases.mkdir(exist_ok=True)
    www = base / "www"
    if not www.is_symlink():
        initial = releases / ("initial-" + json.loads((www / "version.json").read_text())["build"])
        www.rename(initial)
        www.symlink_to(initial, target_is_directory=True)
    build_id = json.loads((source / "dist/version.json").read_text())["build"]
    release = releases / build_id
    if release.exists():
        raise SystemExit("Build already published; rebuild before refreshing")
    shutil.copytree(source / "dist", release)
    import app_changes

    app_changes.activate(release)
    print("Source history, pinned compiler and versioned frontend release installed.")


if __name__ == "__main__":
    main()
