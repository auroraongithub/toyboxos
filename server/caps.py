"""What this server can do, for GET /api/caps. The app only shows modules whose server side is really here
(Moodle, the admin service, Hermes, app editing). Each one is found by the file or program it needs, never by
reading a secret; caps.json next to this file can force any of them on or off: {"moodle": false}."""

import json
import os
import shutil

BASE = os.environ.get("SOS_HOME") or os.path.dirname(os.path.abspath(__file__))
here = lambda *p: os.path.exists(os.path.join(BASE, *p))


def caps():
    found = {
        "sync": True,
        "ai": True,  # /api/ai answers (503 no_key says why it can't run)
        "agent": True,  # background assistant runs
        "moodle": here("moodle_key.txt"),  # server/moodle.py signed in (moodle_setup.py)
        "admin": here("admin_token.txt"),  # admin.py (terminal, files, services) is set up
        "hermes": bool(shutil.which("hermes") or os.path.exists("/usr/local/bin/hermes")),
        "changes": here("app-changes", "source"),  # app editing (setup_changes.py)
        "github": here("github_token.txt"),  # repo access through admin.py
        "jobs": here("jobs_profile.md"),  # pull_jobs.py has a profile to score against
    }
    try:
        with open(os.environ.get("SOS_CAPS") or os.path.join(BASE, "caps.json")) as f:
            over = json.load(f)
        found.update({k: bool(v) for k, v in over.items() if isinstance(k, str)})
    except (OSError, ValueError, AttributeError):
        pass
    return {"caps": sorted(k for k, v in found.items() if v)}
