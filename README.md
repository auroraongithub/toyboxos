<p align="center"><img src="assets/wordmark-dark.png" alt="toybox.os" width="356"></p>

# toybox.os

A personal operating system that runs in the browser. Notes, calendar, tasks, money, habits, a whiteboard and an
optional AI assistant live together in one grayscale, Windows XP–style desktop that also works as a phone app.

It is **local-first**: every device keeps its own full copy of your data and works offline. A small sync server that
you host yourself keeps your devices in step. It runs as a PWA, as a Windows desktop app and as an Android app.

## Features

The app is organised into hubs that make up the taskbar on desktop and the bottom bar on phones.

**Today**: the home screen, with today's classes, deadlines, events, reminders and habits, plus a timer and a
quick-add box.

- **Habits**: daily check-offs and streaks.
- **Timer**: Pomodoro or countdown. On Android it keeps running in a notification after the app is closed.

**Plan**

- **Calendar**: events and deadlines as a list or a month grid, multi-day events, and a weekly class timetable.
- **Board**: a kanban board for tasks, grouped by project.
- **Reminders**: reminders and loud alarms, one-off or repeating, on both phone and desktop.

**Notes**

- **Pages**: a wiki with a block editor, page tree, `[[links]]`, backlinks, flashcards and spaced review. Imported
  PDF, DOCX and EPUB files open in a built-in reader.
- **Inbox**: one-line jots to sort later. Any jot can grow into a page.
- **Draw**: an endless whiteboard with pen pressure, shape snapping, sticky notes and maths that solves itself.
- **Graph**, **Calc** (units, currency and a graphing calculator) and **Links** (bookmarks).

**Money**: income and expenses in two currencies, monthly budgets, subscriptions, loans (owed and owing) and a
wishlist.

### Quick add

Every quick-add box and the command bar share one parser that tolerates typos and any word order. For example,
`remind me to call mom tomorrow 6pm` creates a reminder, `₱250 lunch` logs an expense, and a pasted URL becomes a
link.

### Optional modules

These are off by default. Turn them on in Profile > Modules. The ones marked _server_ also need the sync server to
support them.

| Module         | What it does                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assistant      | An AI chat ("study buddy") that can read and edit anything in the app, search the web and use your sources. Bring your own provider keys, or run a local model. |
| Change the app | Describe a UI change in plain words. It is built in a sandbox, previewed, and applied only when you press Apply. _server_                                           |
| Jobs           | A daily feed of job listings scored against your profile. _server_                                                                                                   |
| Moodle         | Read-only view of your school's Moodle courses, deadlines and files. _server_                                                                                        |
| Home server    | Terminal, file manager and service status for the machine running the server. _server_                                                                               |

### Look and feel

The whole look comes from a **pack**: art, colours, fonts, wallpaper, mascot and badges. The Theme editor changes any
of it from inside the app, including the app icon on the taskbar, tray and browser tab (Art > App icon). Only the neutral `default` pack ships in this repository (see [Art packs](#art-packs)).

## How it works

- Every change is saved on the device first, so nothing waits on the network.
- When sync is on, the device sends its changes to the server every 20 seconds and on every edit. Each document is
  kept if it is newer (last write wins), and deletes travel as tombstones.
- The server is a single Python file using only the standard library, with everything stored in one SQLite
  database.
- AI keys stay on the server and are never sent back to the app. Long assistant chats run on the server, so they
  finish even after you close the app.
- New versions are published as [releases](https://github.com/auroraongithub/toyboxos/releases). Servers update
  themselves from the latest one, and installed apps update from their server.

[`docs/toybox-map.html`](docs/toybox-map.html) has diagrams of every window and server piece and where each one
lives in the code.

## Getting started

### 1. Run the sync server

The quickest way is Docker:

```sh
docker compose up -d
docker compose exec toybox python3 server.py pair
```

The first command builds the app and starts the server on port 8787. The second prints a one-time pairing code. Your
data is stored in `./toybox-data`.

Other options:

- a Linux or macOS service via `bash server/install.sh`
- a standalone Windows or Linux executable
- hosting from inside the Windows desktop app

All of these are covered in [`server/README.md`](server/README.md), along with HTTPS, using the server away from home,
and backups.

On a Linux server, `bash server/install.sh --admin` also sets up the Home server window (terminal, files, services)
for your own Tailscale network; see [Home server window](server/README.md#home-server-window-optional).

### 2. Connect your devices

Open `http://<server>:8787` and enter the pairing code when Setup asks for it. To add more devices, get a new code
from Start > Sync > Pair another device.

Phones can only install the PWA when it is served over HTTPS. [Tailscale Funnel](https://tailscale.com/kb/1223/funnel)
or a reverse proxy such as Caddy gives you that.

You can also use the app without a server. It works fully offline, but your data stays on that one device.

## Development

You need Node 18+ and Python 3.9+.

```sh
npm install
npm run build        # builds the PWA into dist/
```

Serve `dist/` from the sync server or any static host. To use a pack other than `default`, set `SOS_PACK=<name>`
when you build.

### Tests and linting

```sh
npm test                                              # unit tests (Node)
python -m unittest discover -s server -p "test_*.py"  # server tests
npm run lint                                          # Prettier + ruff (pip install ruff)
npm run format
```

The browser tests drive the built app in desktop and phone sizes with Playwright. Run `npm run build` first, and set
up Playwright once:

```sh
pip install playwright && python -m playwright install chromium
npm run test:ui
```

### Native apps

`src-tauri` holds the [Tauri 2](https://tauri.app) shells for Windows (tray icon, title bar, built-in server) and
Android (alarms, timer notification). The app itself is the same web build, so most updates reach installed apps
without a new installer.

```sh
npx tauri build          # Windows installer
npx tauri android build  # Android APK
```

### Project layout

| Path           | Contents                                                       |
| -------------- | -------------------------------------------------------------- |
| `src/core`     | Data store, sync, dates, money, the quick-add parser, AI calls |
| `src/ui`       | The XP-style UI kit (windows, tabs, panels)                    |
| `src/modules`  | One file per window, plus the module registry                  |
| `src/shell`    | Window manager, taskbar, Start menu, themes                    |
| `src/styles`   | CSS                                                            |
| `src/packs`    | Art packs (only `default` is committed)                        |
| `server`       | Sync server, AI proxy, background jobs and their tests         |
| `src-tauri`    | Windows and Android shells                                     |
| `tests`        | Node unit tests and Playwright browser tests (`tests/ui`)      |
| `docs`         | The architecture map                                           |
| `vendor`       | Bundled third-party code (Preact, htm, PDF.js, xterm)          |

## Art packs

Packs live in `src/packs/<name>/`. Everything except `default` is gitignored, so character art that isn't yours to
publish stays private. To make your own, copy `src/packs/default`, then build with `SOS_PACK=<name> npm run build`.
You can also load pack files, or save your current look as one, in Theme editor > Packs. Packs saved there
sync to your other devices.

## More documentation

- [`server/README.md`](server/README.md): installing, updating, pairing, HTTPS, settings and backups
- [`server/PROVIDERS.md`](server/PROVIDERS.md): AI providers, models and keys
- [`server/INGEST.md`](server/INGEST.md): feeding jobs, jots, links and events in from other programs
- [`server/MOODLE.md`](server/MOODLE.md): connecting a Moodle account
- [`docs/toybox-map.html`](docs/toybox-map.html): architecture map

## License

ISC, see [LICENSE](LICENSE). Vendored libraries keep their own licenses ([vendor/THIRD_PARTY.md](vendor/THIRD_PARTY.md)).
