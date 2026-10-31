# Sync server

The sync server keeps your devices in step and serves the app from the same address. It is one Python file with
no dependencies beyond Python 3.9+, and it stores everything in a single SQLite database. Without it the app still
works, but everything stays on one device.

## Install

The easiest way: in the desktop app (Windows), Start > Sync > tick **Host sync on this computer**. The app runs the
server itself while it is open or in the tray, connects to it, and **Pair a device** shows a QR code and a pairing
code for your phone. **Set up** next to Tailscale walks through reaching it from anywhere.

Without the desktop app, download a server program from the
[latest release](https://github.com/auroraongithub/toyboxos/releases/latest): `toybox-server-windows.exe`,
`toybox-server-linux-x64` or `toybox-server-linux-arm64` (Raspberry Pi and other ARM boards). It needs nothing
installed. On Windows double-click it; on Linux run `chmod +x toybox-server-linux-*` once, then start it. It keeps your
data in `%LOCALAPPDATA%	oybox-server` (Linux `~/.local/share/toybox-server`), opens the app in your browser on the
first run and prints the addresses and a pairing code. `toybox-server pair` prints a new code; `--port` and `--data`
change the port and data folder. The Linux programs need glibc 2.35 or newer (Ubuntu 22.04, Debian 12, Raspberry Pi OS
bookworm). To build one yourself: `python server/package.py` (PyInstaller) on the OS you want it for.

To keep it running after you log out on Linux, use `install.sh` below instead, which sets it up as a service.

On a Linux or macOS machine that stays on (an old laptop, a mini PC, a Raspberry Pi), from a clone of the repo:

    bash server/install.sh

The script builds the app if needed (that needs Node 18+), installs everything to `~/toybox-server`, starts it as a
service and prints the address and a pairing code. Open the address on your device and enter the code when Setup
asks for it. Running the script again updates the server and keeps your data and token.

With Docker instead:

    docker compose up -d
    docker compose exec toybox python3 server.py pair

The second command prints a pairing code. Data lives in `./toybox-data`.

## Updates

The packaged program, the desktop app's server, `install.sh` and Docker installs update themselves from the toybox
release channel every 6 hours (Start > Sync shows the server's version, has Install now, and a switch to turn automatic
updates off). Your own "Change the app" edits are put back on top of each new version; any that no longer fit are set
aside and listed there. If new server code fails to start, the previous version comes back by itself.

## Adding devices

Each pairing code works once, for 10 minutes. To get one, either run `python3 server.py pair` in the install
folder, or use Start > Sync > Pair another device on a device that is already connected. The token itself is in
`token.txt` (or `/data/token.txt` in Docker), and the app also accepts it where it asks for a code.

## Using it away from home

On your home network the app works at the printed `http://` address. Phones only install the app (and keep it
working offline) when it is served over `https`, and you need a public address to sync from elsewhere. The easiest
way is Tailscale: install it on the server, then run `tailscale funnel --bg 8787`, and use the `https://…ts.net`
address it prints. A reverse proxy such as Caddy in front of port 8787 works too.

## Home server window (optional)

Start > Home server gives you a terminal, a file manager and service status for the machine the server runs on. It
is a second, separate service (`admin.py`) with its own token, and it is never on the public internet: it listens on
127.0.0.1 only and is published to your own Tailscale network on port 8443. Anyone with its token has a shell on that
machine, so keep it that way and never use `tailscale funnel` for it.

It needs Linux with systemd and [Tailscale](https://tailscale.com/download) on the server, and Tailscale on every
device that uses the window. It isn't available on Windows, macOS or in Docker. Install it with the sync server:

    bash server/install.sh --admin

The script starts it as the `toybox-admin` user service, publishes it with `tailscale serve --bg --https=8443`
(the first time that may need `sudo`, or `sudo tailscale set --operator=$USER` once), then prints its address and a
pairing code. In the app turn on Profile > Modules > Home server (it is listed once the server has it), open
Start > Home server, enter the address (`https://<machine>.<tailnet>.ts.net:8443`) and
the code. Codes work once, for 5 minutes. For the next device use the window's settings button > Pair another device,
or run `python3 ~/toybox-server/admin.py pair` on the server.

What the window shows is up to you, in `admin.json` next to `admin.py` (start from `admin.example.json`):

- `places`: extra folders for the Files tab, as `[label, path]`. Your home folder is always there.
- `user_units` / `system_units`: systemd services to list. The sync and admin services are added for you.
  Restarting system services needs passwordless `sudo`; without it the window shows status and logs only.
- `links`: web apps on the server as `[name, port, "http" or "https"]`, opened at the machine's tailnet address.
- `origins`: extra web addresses the app is opened from, if not the server's own.
- `gh_repo`: `owner/repo` for the assistant's GitHub tool (token in `github_token.txt`).

Docker containers show up by themselves when the user can run `docker`. Restart after editing:
`systemctl --user restart toybox-admin`.

## Settings

Environment variables: `SOS_PORT` (8787), `SOS_HOST` (0.0.0.0), `SOS_DB`, `SOS_FILES`, `SOS_TOKEN_FILE`, `SOS_WWW`.
AI keys for the assistant are added in the app (Start > Models and keys) and kept in `secrets.json` next to
`server.py`; environment variables such as `OPENROUTER_API_KEY` work too. See [PROVIDERS.md](PROVIDERS.md).

## Backups

`sqlite3 data/sos.db ".backup backup.db"`, or copy `data/sos.db` while the server is idle. Everything is one table
of JSON documents, last write wins. `GET /api/export` (with the token) dumps it all.

## Daily Moodle calendar pull (optional)

`pull_calendar.py` imports your Moodle calendar feed once a day (`python3 setup_calendar.py` adds the cron entry,
06:17 in your timezone; it keeps your other cron entries and backs up the old crontab in `data/backups/`). The feed
URL is private: it lives only in `moodle-calendar.json` (mode 600), outside `www/` and source control, as
`{"url":"<calendar export URL>"}`.

It only inserts new `classes` documents with stable ids from the feed's UIDs. Existing documents, completion ticks,
personal events and deletions are never changed, so repeated runs add nothing new and later edits to an imported event
are not applied. The feed must load and parse before anything is written, and all writes happen in one SQLite
transaction. `flock` prevents overlapping runs. Log: `data/calendar-pull.log` (counts and credential-free errors only).
Tests: `python3 -m unittest test_pull_calendar -v`.
