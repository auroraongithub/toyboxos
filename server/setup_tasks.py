#!/usr/bin/env python3
"""Install the home server's daily job search and exchange-rate cron jobs (next to the calendar one), preserving other cron jobs.
Times are Manila; cron runs on the server's UTC clock."""

from datetime import datetime, timezone
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import time

# marker -> (UTC schedule, script, log)
TASKS = {
    "# toybox-os-jobs": ("45 22 * * *", "pull_jobs.py", "jobs-pull.log"),  # 06:45 Manila
    "# toybox-os-fx": ("17 22,5,12 * * *", "pull_fx.py", "fx-pull.log"),  # 06:17 / 13:17 / 20:17 Manila
}


def main():
    base = Path(__file__).resolve().parent
    if time.strftime("%z") != "+0000":
        raise SystemExit("These schedules expect the server's system timezone to be UTC")
    if not (base / "data/sos.db").is_file():
        raise SystemExit("The sync database must exist first")
    crontab, flock = shutil.which("crontab"), shutil.which("flock")
    if not crontab or not flock:
        raise SystemExit("crontab and flock are required")
    current = subprocess.run([crontab, "-l"], capture_output=True, text=True)
    if current.returncode and "no crontab" not in current.stderr.lower():
        raise SystemExit("Could not read existing crontab; no changes made")
    old = current.stdout
    backup = (
        base
        / "data/backups"
        / ("crontab-before-tasks-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + ".txt")
    )
    backup.parent.mkdir(mode=0o700, exist_ok=True)
    backup.write_text(old)
    lines = [line for line in old.splitlines() if not any(line.endswith(m) for m in TASKS)]
    for marker, (when, script, log) in TASKS.items():
        lock = str(base / ("data/" + script.replace(".py", ".lock")))
        command = shlex.join([flock, "-n", lock, sys.executable, str(base / script)])
        lines.append(when + " " + command + " >> " + shlex.quote(str(base / "data" / log)) + " 2>&1 " + marker)
    subprocess.run([crontab, "-"], input="\n".join(lines) + "\n", text=True, check=True)
    print("Installed: job search 06:45, exchange rate 06:17/13:17/20:17 (Asia/Manila).")


if __name__ == "__main__":
    main()
