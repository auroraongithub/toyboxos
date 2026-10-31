#!/usr/bin/env bash
# Run once on the Linux laptop:  bash setup.sh
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR/data" "$DIR/www" "$HOME/.config/systemd/user"
command -v python3 >/dev/null || { echo "python3 is needed"; exit 1; }
if [ ! -f "$DIR/token.txt" ]; then python3 -c "import secrets;print(secrets.token_urlsafe(32))" > "$DIR/token.txt"; chmod 600 "$DIR/token.txt"; fi
cat > "$HOME/.config/systemd/user/sos-sync.service" <<EOF
[Unit]
Description=toybox.os sync server
After=network-online.target
[Service]
ExecStart=$(command -v python3) $DIR/server.py
Restart=always
RestartSec=3
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now sos-sync
loginctl enable-linger "$USER" 2>/dev/null || sudo loginctl enable-linger "$USER" || echo "(run: sudo loginctl enable-linger $USER   so it keeps running when you're logged out)"
sleep 1
curl -fsS "http://127.0.0.1:8787/api/ping" -H "Authorization: Bearer $(cat "$DIR/token.txt")" >/dev/null && echo "server is up on :8787"
echo
echo "Next: expose it publicly with Tailscale Funnel:"
echo "    sudo tailscale funnel --bg 8787"
echo "(first time it prints a link to enable Funnel for your tailnet; open it once, then run the command again)"
echo
echo "Your sync token (paste it into the app's sync window):"
cat "$DIR/token.txt"
