#!/usr/bin/env python3
"""Pull Moodle calendars into the sync DB, inserting new classes only."""

import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import sys
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


BASE = Path(__file__).resolve().parent
MAX_FEED = 2 * 1024 * 1024


def unescape(value):
    return re.sub(r"\\([nN,;\\])", lambda m: "\n" if m[1] in "nN" else m[1], value)


def start_time(value, params):
    if params.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", value):
        # Match the app's date grouping: midnight in the user's timezone.
        stamp = datetime.strptime(value, "%Y%m%d").replace(tzinfo=ZoneInfo("Asia/Manila"))
    else:
        utc = value.endswith("Z")
        raw = value.removesuffix("Z")
        fmt = "%Y%m%dT%H%M%S" if len(raw) == 15 else "%Y%m%dT%H%M"
        zone = timezone.utc if utc else ZoneInfo(params.get("TZID", "Asia/Manila"))
        stamp = datetime.strptime(raw, fmt).replace(tzinfo=zone)
    return stamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_feed(text):
    lines = re.sub(r"\r?\n[ \t]", "", text.lstrip("\ufeff")).splitlines()
    if "BEGIN:VCALENDAR" not in lines or "END:VCALENDAR" not in lines:
        raise ValueError("Response is not a complete iCalendar feed")
    events, current, depth, skipped = {}, None, 0, 0
    for line in lines:
        if line == "BEGIN:VEVENT":
            current, depth = {}, 0
        elif line == "END:VEVENT" and current is not None:
            try:
                uid = unescape(current["UID"][0]).strip()
                title = unescape(current["SUMMARY"][0]).strip()
                if not uid or not title:
                    raise ValueError("Missing event identity")
                start, params = current["DTSTART"]
                categories = unescape(current.get("CATEGORIES", ("", {}))[0])
                course = re.search(r"\(([^()]*)\)\s*$", categories)
                numeric = re.fullmatch(r"(\d+)@.+", uid)
                # Keep the old scheduled import's Moodle IDs for deduplication.
                key = "m" + (numeric[1] if numeric else hashlib.sha256(uid.encode()).hexdigest())
                if "RECURRENCE-ID" in current:
                    key = "m" + hashlib.sha256((uid + "|" + current["RECURRENCE-ID"][0]).encode()).hexdigest()
                if "RRULE" in current:
                    raise ValueError("Feed must supply expanded event occurrences")
                if current.get("STATUS", ("", {}))[0] != "CANCELLED":
                    kind = (
                        "opens"
                        if title.lower().endswith("opens")
                        else "closes"
                        if title.lower().endswith("closes")
                        else "due"
                    )
                    events[key] = {
                        "title": title,
                        "start": start_time(start, params),
                        "code": course[1].strip() if course else "",
                        "kind": kind,
                        "source": "moodle",
                        "icalUid": uid,
                    }
            except (KeyError, ValueError):
                skipped += 1
            current = None
        elif current is not None:
            # Ignore nested VALARM fields such as their own SUMMARY.
            if line.startswith("BEGIN:"):
                depth += 1
            elif line.startswith("END:"):
                depth -= 1
            elif depth == 0 and ":" in line:
                head, value = line.split(":", 1)
                name, *parts = head.split(";")
                params = dict(part.split("=", 1) for part in parts if "=" in part)
                params = {k.upper(): v.strip('"') for k, v in params.items()}
                current.setdefault(name.upper(), (value, params))
    if current is not None:
        raise ValueError("Incomplete calendar event")
    return events, skipped


def feed_urls(url):
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        raise ValueError("Calendar URL must use HTTPS")
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    for period in ("monthnow", "monthnext"):
        yield urlunsplit(parts._replace(query=urlencode({**query, "preset_time": period}), fragment=""))


def fetch_events(url):
    events, skipped = {}, 0
    # Fetch both successfully before writing anything to the DB.
    for address in feed_urls(url):
        request = Request(address, headers={"User-Agent": "toybox.os calendar sync"})
        with urlopen(request, timeout=45) as response:
            data = response.read(MAX_FEED + 1)
        if len(data) > MAX_FEED:
            raise ValueError("Calendar feed exceeds size limit")
        parsed, bad = parse_feed(data.decode("utf-8-sig"))
        events.update(parsed)
        skipped += bad
    return events, skipped


def insert_events(db, events):
    """One write transaction: existing records and tombstones are immutable here."""
    now = int(time.time() * 1000)
    added = existing = 0
    with closing(sqlite3.connect(db, timeout=30, uri=True)) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        sequence = connection.execute("SELECT COALESCE(MAX(seq),0) FROM docs").fetchone()[0]
        for key, event in events.items():
            if connection.execute("SELECT 1 FROM docs WHERE c='classes' AND id=?", (key,)).fetchone():
                existing += 1
                continue
            sequence += 1
            data = {**event, "at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}
            connection.execute(
                "INSERT INTO docs(c,id,data,u,d,seq) VALUES('classes',?,?,?,0,?)",
                (key, json.dumps(data, separators=(",", ":")), now, sequence),
            )
            added += 1
    return {"added": added, "existing": existing, "fetched": len(events)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=BASE / "moodle-calendar.json")
    parser.add_argument("--db", type=Path, default=BASE / "data/sos.db")
    args = parser.parse_args()
    try:
        url = json.loads(args.config.read_text())["url"]
        events, skipped = fetch_events(url)
        # mode=rw prevents accidentally creating an empty database at a typo path.
        result = insert_events(args.db.resolve().as_uri() + "?mode=rw", events)
        result["skipped_invalid"] = skipped
        print(json.dumps(result))
    except Exception as error:
        # HTTP exception messages can contain the private feed URL.
        print("Calendar pull failed (" + type(error).__name__ + "); no feed credentials logged.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
