#!/usr/bin/env bash
# Install or update the toybox sync server on Linux or macOS, from a clone of the repo:
#     bash server/install.sh
# Needs python3 (3.9+). Builds the app first if dist/ is missing (needs node 18+). Runs as a systemd user service
# where systemd is available, otherwise in the background with nohup. Running it again updates the code and app and
# keeps your data and token. Settings: SOS_DIR (install folder, default ~/toybox-server), SOS_PORT (default 8787),
# SOS_PACK (which look to build, default "default").
# The server then updates itself from the toybox release channel (Start > Sync shows it).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${SOS_DIR:-$HOME/toybox-server}"
PORT="${SOS_PORT:-8787}"
say(){ printf '%s\n' "$*"; }
die(){ say "install: $*" >&2; exit 1; }

command -v python3 >/dev/null || die "python3 is needed (sudo apt install python3, or brew install python)"
python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))' || die "python 3.9 or newer is needed"

if [ ! -f "$SRC/dist/index.html" ]; then
  command -v node >/dev/null || die "the app isn't built yet and node isn't installed: install node 18+ and run this again"
  say "Building the app…"
  (cd "$SRC" && npm ci --ignore-scripts --no-audit --no-fund >/dev/null && SOS_PACK="${SOS_PACK:-default}" node build.mjs >/dev/null)
fi

say "Installing to $DEST"
mkdir -p "$DEST/data" "$DEST/www"
for f in "$SRC"/server/*.py; do case "$(basename "$f")" in test_*) ;; *) cp "$f" "$DEST/";; esac; done
for f in providers.json PROVIDERS.md; do [ -f "$SRC/server/$f" ] && cp "$SRC/server/$f" "$DEST/"; done
rm -rf "$DEST/www.new" && cp -R "$SRC/dist" "$DEST/www.new" && rm -rf "$DEST/www" && mv "$DEST/www.new" "$DEST/www"

ping(){ python3 - "$PORT" <<'PY'
import sys, urllib.request, urllib.error
try: urllib.request.urlopen(f"http://127.0.0.1:{sys.argv[1]}/api/ping", timeout=2)
except urllib.error.HTTPError as e: sys.exit(0 if e.code == 401 else 1)
except Exception: sys.exit(1)
PY
}

if command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/toybox-sync.service" <<EOF
[Unit]
Description=toybox sync server
After=network-online.target
[Service]
WorkingDirectory=$DEST
Environment=SOS_PORT=$PORT
ExecStart=$(command -v python3) $DEST/toybox_server.py --quiet --data $DEST
Restart=always
RestartSec=3
[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable toybox-sync >/dev/null 2>&1
  systemctl --user restart toybox-sync
  loginctl enable-linger "$USER" 2>/dev/null || say "(To keep it running after you log out: sudo loginctl enable-linger $USER)"
  HOW="systemctl --user status toybox-sync"
else
  [ -f "$DEST/data/server.pid" ] && kill "$(cat "$DEST/data/server.pid")" 2>/dev/null || true
  (cd "$DEST" && SOS_PORT="$PORT" nohup python3 toybox_server.py --quiet --data "$DEST" >> data/server.log 2>&1 & echo $! > "$DEST/data/server.pid")
  HOW="tail $DEST/data/server.log   (no systemd here: start it again after a reboot with this script)"
fi

for _ in $(seq 1 20); do ping && break; sleep 0.5; done
ping || die "the server didn't start; see $HOW"

IP="$(python3 -c 'import socket
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
try: s.connect(("10.255.255.255",1)); print(s.getsockname()[0])
except Exception: print("127.0.0.1")')"
CODE="$(cd "$DEST" && python3 server.py pair 2>/dev/null | tail -1)"
say ""
say "toybox sync server is running."
say ""
say "  Open:          http://$IP:$PORT"
say "  Pairing code:  $CODE   (works once, for 10 minutes)"
say ""
say "Open that address on the device you want to use, and enter the pairing code when Setup asks for it."
say "For another device later: Start > Sync > Pair another device, or run: python3 $DEST/server.py pair"
say "To use it away from home (and install it as an app on phones, which needs https), see server/README.md."
say "Status: $HOW"
