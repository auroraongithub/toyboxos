#!/usr/bin/env python3
"""Put things into toybox.os from the laptop. Reads JSON from a file or stdin, sends it to the local server (the token
is read from token.txt next to this script, so an agent never needs to see it).

  python3 ingest.py jobs jobs.json            # a JSON list of jobs
  hermes-output | python3 ingest.py jobs -    # same, from stdin
  python3 ingest.py jots - <<< '["idea one","idea two"]'

Accepts a JSON list, or {"items":[...]}, or JSON lines. For jots, plain strings are fine."""

import json
import os
import sys
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
TOKEN = os.environ.get("SOS_TOKEN") or open(os.path.join(BASE, "token.txt")).read().strip()
URL = os.environ.get("SOS_URL", "http://127.0.0.1:" + os.environ.get("SOS_PORT", "8787")) + "/api/ingest"


def load(path):
    raw = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
    raw = raw.strip()
    try:
        data = json.loads(raw)
    except ValueError:
        data = [json.loads(line) for line in raw.splitlines() if line.strip()]  # JSON lines
    return data.get("items", []) if isinstance(data, dict) else data


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    col, items = sys.argv[1], load(sys.argv[2])
    if col == "jots":
        items = [{"text": x} if isinstance(x, str) else x for x in items]
    req = urllib.request.Request(
        URL,
        json.dumps({"c": col, "items": items}).encode(),
        {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
    )
    try:
        print(urllib.request.urlopen(req, timeout=30).read().decode())
    except urllib.error.HTTPError as e:
        sys.exit("server said %s: %s" % (e.code, e.read().decode()))


main()
