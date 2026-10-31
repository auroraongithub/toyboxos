# Feeding toybox.os from another program

Anything running on the server machine (a script, a scheduled job, another agent) can hand items to toybox.os with one
command, and they reach every device through normal sync.

```
python3 ingest.py jobs results.json      # a JSON list
some-program | python3 ingest.py jobs -  # from stdin
```

Run it from the server's install folder; it reads `token.txt` itself. Over HTTP the same thing is
`POST /api/ingest {"c": "jobs", "items": [...]}` with the sync token.

Re-sending the same item never duplicates it (the id is a hash of its URL or title), and the status set in the app
(saved, applied, skip) is never overwritten. New jobs arrive as `new`.

## A job
```json
{"title":"Virtual Assistant (part-time)","url":"https://example.com/job/123","fit":82,
 "pay":"$4-6/hr","type":"part-time","posted":"2026-10-27",
 "why":"One short sentence on why it fits","flags":["remote","per-project"]}
```
`title` is required. `fit` is 0-100 (the Jobs screen sorts by it). `url` must be http(s). Everything else is optional.

## Other collections
`jots` takes a JSON list of strings (they land in the Inbox). `links`, `reminders` and `events` take
`{"title", "url"|"at"|"start", ...}` objects the same way.

Only collect from sites whose terms and robots.txt allow automated access.
