# Moodle connection

Read-only access to your own Moodle courses, so the Moodle window and the assistant can list courses, deadlines,
assignments and announcements and read course files. Nothing is synced into the app; it is read on demand.

## Connect

On the server, in a private terminal (the Home server window's terminal works), from the install folder:

```sh
python3 moodle_setup.py
```

It asks for the Moodle address (https only; saved in `moodle.json`), your username and a hidden password. The password
is exchanged over HTTPS at `/login/token.php` for the `moodle_mobile_app` service; only the resulting token is saved,
in `moodle_key.txt` (mode 0600). If your account already has an API token, use `python3 moodle_setup.py --token`.
`--site URL` sets the address without asking; `SOS_MOODLE_SITE` overrides it.

```sh
python3 moodle_setup.py --status
python3 moodle_setup.py --disconnect
```

Disconnect removes the local token only; revoke it in Moodle if needed. No restart is needed either way. Never put a
credential in command arguments, chat, shell history or the app database, and never have an assistant read the key file.

Only use access your account is allowed to have: an enabled web service does not by itself mean your school approves
custom clients, and a permission error is final.

## API contract

`POST /api/moodle` uses Toybox's existing sync `Authorization: Bearer ...`, **not** the Moodle token. All JSON responses disable caching. Credential fields, URLs, site overrides, and arbitrary function names are rejected. The origin is fixed to the configured site and outgoing redirects are disabled.

Examples (IDs are examples only; use the actual IDs returned):

| Body | Result |
| --- | --- |
| `{"action":"status"}` | `{connected,site}` when unconfigured; otherwise account `userid`, `name`, `downloadfiles`, and supported read `functions`. Invalid/expired credentials return an error, not `connected:true`. |
| `{"action":"courses"}` | Moodle's enrolled-course array, using the saved token's user ID. |
| `{"action":"contents","course":123}` | Course sections/modules and file contents. Requires enrollment. |
| `{"action":"assignments","course":123}` | Moodle assignment metadata, instructions, and due dates for that course. |
| `{"action":"forums","course":123}` | Course forums. Announcements are commonly a forum with `type:"news"`. |
| `{"action":"discussions","course":123,"forum":456,"page":0}` | One page of 20 discussions in a forum verified against that course. |
| `{"action":"posts","course":123,"forum":456,"page":0,"discussion":789}` | Posts for a discussion listed on that forum page. Use its `discussion` field, not the first post ID. |
| `{"action":"download","course":123,"module":321,"file":0}` | `{id,name,size,type}` for a private cached download. `module` is the course module's `id`; `file` is the zero-based index after filtering its `contents` to `type:"file"`. |

JSON errors are HTTP 400 with a fixed, credential-free `error` message. Missing/incorrect Toybox bearer authorization is HTTP 401. Raw Moodle error/debug responses never reach the model. Missing Moodle functions or disabled file downloads fail explicitly; do not work around them by scraping sessions or weakening authentication.

Downloads are fetched only from files returned by the enrolled course's contents, on the site's `/webservice/pluginfile.php/` route. External repository links are not fetched. The Moodle token is appended internally and never returned. Files up to 30 MiB are stored under ``data/moodle/``, outside `www/` and outside the existing public `/api/file/` store. Downloads are not executed or extracted.

`GET /api/moodle/file/<id>` returns cached bytes **only with the Toybox bearer header**; it uses `Content-Disposition: attachment`, `Cache-Control: no-store`, and `nosniff`. An ordinary link or `<img>` cannot authenticate it. A frontend should fetch with the bearer header, create a local blob URL, and revoke the URL after use. There is no direct public URL or secret-bearing query URL to give the assistant.


This backend reads and downloads only: no submissions, quiz attempts, posts or completion changes.

Tests: `python -m unittest discover -s server -p "test_moodle.py"` (fake credentials and a local fake Moodle).
