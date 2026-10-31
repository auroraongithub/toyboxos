#!/usr/bin/env python3
"""Install the home server's daily calendar cron job, preserving other cron jobs."""

from datetime import datetime, timezone
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import time


def main():
    base = Path(__file__).resolve().parent
    if time.strftime("%z") != "+0000":
        raise SystemExit("This schedule expects the server's system timezone to be UTC")
    if not (base / "moodle-calendar.json").is_file() or not (base / "data/sos.db").is_file():
        raise SystemExit("Private calendar config and sync database must exist first")
    crontab, flock = shutil.which("crontab"), shutil.which("flock")
    if not crontab or not flock:
        raise SystemExit("crontab and flock are required")
    os.umask(0o077)
    (base / "moodle-calendar.json").chmod(0o600)
    current = subprocess.run([crontab, "-l"], capture_output=True, text=True)
    if current.returncode and "no crontab" not in current.stderr.lower():
        raise SystemExit("Could not read existing crontab; no changes made")
    old = current.stdout
    backup = (
        base
        / "data/backups"
        / ("crontab-before-calendar-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + ".txt")
    )
    backup.parent.mkdir(mode=0o700, exist_ok=True)
    backup.write_text(old)
    marker = "# toybox-os-calendar"
    lines = [line for line in old.splitlines() if not line.endswith(marker)]
    command = shlex.join(
        [flock, "-n", str(base / "data/calendar-pull.lock"), sys.executable, str(base / "pull_calendar.py")]
    )
    # cron uses the server's UTC timezone: 22:17 UTC is 06:17 the next day in UTC+8.
    lines.append(
        "17 22 * * * " + command + " >> " + shlex.quote(str(base / "data/calendar-pull.log")) + " 2>&1 " + marker
    )
    subprocess.run([crontab, "-"], input="\n".join(lines) + "\n", text=True, check=True)
    print("Daily calendar cron installed: 06:17 Asia/Manila (22:17 UTC).")


if __name__ == "__main__":
    main()
