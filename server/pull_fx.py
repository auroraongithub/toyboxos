#!/usr/bin/env python3
"""Refresh config/fx {usdphp, rates, at} in the sync DB from open.er-api.com (no key needed). Other fx fields are kept;
a failed fetch leaves the stored rate alone."""

import argparse
from contextlib import closing
from email.utils import parsedate_to_datetime
import json
from pathlib import Path
import sqlite3
import sys
import time
from urllib.request import Request, urlopen

BASE = Path(__file__).resolve().parent
SOURCE = "https://open.er-api.com/v6/latest/USD"


def fetch():
    with urlopen(Request(SOURCE, headers={"User-Agent": "toybox.os fx"}), timeout=30) as r:
        j = json.loads(r.read(1024 * 1024))
    rate = float(j["rates"]["PHP"])
    if not 20 < rate < 200:
        raise ValueError("implausible rate")
    at = parsedate_to_datetime(j["time_last_update_utc"]).isoformat().replace("+00:00", "Z")
    # every currency per USD, so a profile with any home currency can convert (the app reads rates, older apps usdphp)
    rates = {
        k: float("%.6g" % float(v))
        for k, v in j["rates"].items()
        if len(k) == 3 and k.isalpha() and k.isupper() and float(v) > 0
    }
    return rate, at, rates


def store(db, rate, at, rates=None):
    now = int(time.time() * 1000)
    with closing(sqlite3.connect(db, timeout=30, uri=True)) as c, c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT data,d FROM docs WHERE c='config' AND id='fx'").fetchone()
        data = json.loads(row[0]) if row and not row[1] else {}
        if data.get("usdphp") == rate and data.get("at") == at and (rates is None or data.get("rates") == rates):
            return False
        data.update(usdphp=rate, at=at)
        if rates:
            data["rates"] = rates
        seq = c.execute("SELECT COALESCE(MAX(seq),0)+1 FROM docs").fetchone()[0]
        c.execute(
            "INSERT OR REPLACE INTO docs(c,id,data,u,d,seq) VALUES('config','fx',?,?,0,?)",
            (json.dumps(data, separators=(",", ":")), now, seq),
        )
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=BASE / "data/sos.db")
    a = ap.parse_args()
    try:
        rate, at, rates = fetch()
        changed = store(a.db.resolve().as_uri() + "?mode=rw", rate, at, rates)
    except Exception as e:
        print(
            json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "error": type(e).__name__}),
            file=sys.stderr,
        )
        return 1
    print(
        json.dumps(
            {
                "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "usdphp": rate,
                "rate_at": at,
                "changed": changed,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
