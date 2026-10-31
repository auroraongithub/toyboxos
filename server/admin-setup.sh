#!/usr/bin/env bash
# Install the toybox.os admin service (terminal/files/services) on the home server as systemd --user unit sos-admin.
# Run from ~/sean-os-server after copying admin.py there:   bash admin-setup.sh
# Tailnet only: binds 127.0.0.1:8790 and is published with `tailscale serve` on :8443. NEVER use funnel for it.
set -e
cd "$(dirname "$0")"
DIR=$(pwd)
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/sos-admin.service <<EOF
[Unit]
Description=toybox.os admin service (tailnet only)
After=network-online.target
[Service]
ExecStart=/usr/bin/python3 $DIR/admin.py
WorkingDirectory=$DIR
Restart=always
RestartSec=3
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now sos-admin
sleep 1
systemctl --user is-active sos-admin
[ -f admin_token.txt ] && chmod 600 admin_token.txt
tailscale serve --bg --https=8443 http://127.0.0.1:8790
tailscale serve status
echo "admin token is in $DIR/admin_token.txt (do not paste it anywhere public)"
