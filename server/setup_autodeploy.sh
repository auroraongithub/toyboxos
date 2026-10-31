#!/usr/bin/env bash
# Install the pull deployer on the home server (run once, as its user):  bash setup_autodeploy.sh <owner/repo>
# Makes a read-only deploy key for the private GitHub repo, a systemd --user timer (every 3 min) running
# ~/sean-os-server/autodeploy.sh, and marks the current main as already deployed (no restart on install).
set -e
REPO_NAME=${1:-$(cat "$HOME/sean-os-server/autodeploy/remote" 2>/dev/null | sed -n "s/^git@github-toyboxos://;s/\.git$//p")}
[ -n "$REPO_NAME" ] || { echo "usage: bash setup_autodeploy.sh <owner/repo>"; exit 1; }
SRV="$HOME/sean-os-server"; KEY="$HOME/.ssh/toyboxos_deploy"
src="$(cd "$(dirname "$0")" && pwd)/autodeploy.sh"; [ "$src" -ef "$SRV/autodeploy.sh" ] || cp "$src" "$SRV/autodeploy.sh"; chmod 700 "$SRV/autodeploy.sh"
[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N "" -C "$(hostname) toyboxos deploy (read-only)" -f "$KEY"
grep -q "Host github-toyboxos" "$HOME/.ssh/config" 2>/dev/null || cat >>"$HOME/.ssh/config" <<EOF

Host github-toyboxos
  HostName github.com
  User git
  IdentityFile $KEY
  IdentitiesOnly yes
EOF
chmod 600 "$HOME/.ssh/config"
ssh-keygen -F github.com >/dev/null || ssh-keyscan -t ed25519 github.com >>"$HOME/.ssh/known_hosts" 2>/dev/null

U="$HOME/.config/systemd/user"; mkdir -p "$U"
cat >"$U/sos-autodeploy.service" <<EOF
[Unit]
Description=toybox.os: deploy GitHub main when it moves
[Service]
Type=oneshot
ExecStart=/usr/bin/bash $SRV/autodeploy.sh
TimeoutStartSec=900
EOF
cat >"$U/sos-autodeploy.timer" <<EOF
[Unit]
Description=toybox.os: check GitHub for merged changes every 3 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=3min
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl --user daemon-reload
echo "Deploy key (add it at github.com/$REPO_NAME > Settings > Deploy keys, leave write access OFF):"
cat "$KEY.pub"
mkdir -p "$SRV/autodeploy"; echo "git@github-toyboxos:$REPO_NAME.git" >"$SRV/autodeploy/remote"
if git ls-remote "git@github-toyboxos:$REPO_NAME.git" main >/dev/null 2>&1; then
  mkdir -p "$SRV/autodeploy"
  [ -f "$SRV/autodeploy/deployed" ] || [ -z "${SEED:-}" ] || echo "$SEED" >"$SRV/autodeploy/deployed"
  systemctl --user enable --now sos-autodeploy.timer && echo "timer on"
else
  echo "GitHub doesn't accept the key yet: add it, then run this again."
fi
