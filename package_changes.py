"""Package frontend source and its built release for nijika, excluding secrets and runtime data."""

from pathlib import Path
import subprocess
import tarfile

base = Path(__file__).resolve().parent
stage = base / ".osage-stage"
stage.mkdir(exist_ok=True)
with tarfile.open(stage / "frontend.tar.gz", "w:gz") as archive:
    for name in ("src", "assets", "vendor", "node_modules/marked", "dist"):
        for path in sorted((base / name).rglob("*")):
            if path.is_file() and not path.is_symlink() and path.name != "artifact.html":
                archive.add(path, arcname=path.relative_to(base).as_posix(), recursive=False)
    archive.add(base / ".gitignore", arcname=".gitignore")
    # Existing nijika deployers use a fixed server-file list. Ship new connector files through
    # setup_changes.py, which those deployers already refresh before restarting the server.
    for name in ("moodle.py", "moodle_setup.py", "MOODLE.md"):
        path = base / "server" / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("Missing or linked Moodle runtime file: " + name)
        archive.add(path, arcname="runtime/" + name, recursive=False)
subprocess.run(["git", "bundle", "create", str(stage / "history.bundle"), "--all"], cwd=base, check=True)
print("Frontend snapshot and history ready in .osage-stage")
