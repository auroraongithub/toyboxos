import json
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest

from pull_calendar import feed_urls, insert_events, parse_feed


def feed(events):
    return "BEGIN:VCALENDAR\r\n" + events + "END:VCALENDAR\r\n"


def event(uid="123@example", title="Quiz", start="20261028T100000Z", extra=""):
    return f"BEGIN:VEVENT\r\nUID:{uid}\r\nSUMMARY:{title}\r\n" f"DTSTART:{start}\r\n{extra}END:VEVENT\r\n"


class CalendarImportTest(unittest.TestCase):
    def test_parses_moodle_fields_and_folded_escaped_text(self):
        events, skipped = parse_feed(
            feed(
                event(
                    title="Quiz\\, part\r\n two closes",
                    extra="CATEGORIES:Course (CS 3145)\r\nBEGIN:VALARM\r\nSUMMARY:Alarm\r\nEND:VALARM\r\n",
                )
            )
        )
        self.assertEqual(skipped, 0)
        self.assertEqual(
            events["m123"],
            {
                "title": "Quiz, parttwo closes",
                "start": "2026-10-28T10:00:00Z",
                "code": "CS 3145",
                "kind": "closes",
                "source": "moodle",
                "icalUid": "123@example",
            },
        )

    def test_timezone_and_date_only(self):
        text = feed(event().replace("DTSTART:20261028T100000Z", 'DTSTART;TZID="Asia/Manila":20261028T180000'))
        self.assertEqual(parse_feed(text)[0]["m123"]["start"], "2026-10-28T10:00:00Z")
        text = feed(event().replace("DTSTART:20261028T100000Z", "DTSTART;VALUE=DATE:20261028"))
        self.assertEqual(parse_feed(text)[0]["m123"]["start"], "2026-10-27T16:00:00Z")

    def test_invalid_cancelled_and_incomplete_events(self):
        parsed, skipped = parse_feed(feed(event(start="invalid") + event("124@example", extra="STATUS:CANCELLED\r\n")))
        self.assertEqual(parsed, {})
        self.assertEqual(skipped, 1)
        with self.assertRaises(ValueError):
            parse_feed("<html>Login required</html>")
        with self.assertRaises(ValueError):
            parse_feed("BEGIN:VCALENDAR\nBEGIN:VEVENT\nEND:VCALENDAR")

    def test_ids_and_months_are_stable(self):
        text = feed(event("uuid-without-numeric-id@example"))
        self.assertEqual(parse_feed(text), parse_feed(text))
        self.assertLessEqual(len(next(iter(parse_feed(text)[0]))), 80)
        urls = list(feed_urls("https://example.com/calendar?authtoken=private&preset_time=monthnow"))
        self.assertEqual(len(urls), 2)
        self.assertIn("preset_time=monthnext", urls[1])

    def test_existing_records_tombstones_and_other_collections_never_change(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as temp:
            db = Path(temp) / "sos.db"
            with closing(sqlite3.connect(db)) as connection, connection:
                connection.execute("CREATE TABLE docs(c,id,data,u,d,seq,PRIMARY KEY(c,id))")
                original = [
                    ("classes", "m123", '{"title":"User edit"}', 7, 0, 1),
                    ("classes", "m124", "{}", 8, 1, 2),
                    ("events", "personal", '{"title":"Personal event"}', 9, 0, 3),
                    ("ticks", "m123", '{"done":true}', 10, 0, 4),
                ]
                connection.executemany("INSERT INTO docs VALUES(?,?,?,?,?,?)", original)
            events, _ = parse_feed(feed(event() + event("124@example") + event("125@example")))
            result = insert_events(db.as_uri() + "?mode=rw", events)
            self.assertEqual(result, {"added": 1, "existing": 2, "fetched": 3})
            with closing(sqlite3.connect(db)) as connection, connection:
                self.assertEqual(
                    connection.execute("SELECT * FROM docs WHERE seq<=4 ORDER BY seq").fetchall(), original
                )
                added = connection.execute("SELECT * FROM docs WHERE id='m125'").fetchone()
                self.assertEqual(added[4:], (0, 5))
                self.assertEqual(json.loads(added[2])["source"], "moodle")
                before = connection.execute("SELECT * FROM docs ORDER BY seq").fetchall()
            self.assertEqual(insert_events(db, events)["added"], 0)
            with closing(sqlite3.connect(db)) as connection, connection:
                self.assertEqual(connection.execute("SELECT * FROM docs ORDER BY seq").fetchall(), before)
            missing = Path(temp) / "missing.db"
            with self.assertRaises(sqlite3.OperationalError):
                insert_events(missing.as_uri() + "?mode=rw", events)
            self.assertFalse(missing.exists())


if __name__ == "__main__":
    unittest.main()
