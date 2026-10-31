#!/usr/bin/env bash
# Build the web app and publish it to your home server as a new versioned release. Installed apps pick it up by themselves.
# Usage: bash deploy.sh          web app (also refreshes Osage's private source copy on the home server)
#        bash deploy.sh server   also server.py/ai.py/ingest.py and restart the service
#        bash deploy.sh pull     bring changes Osage published on the home server (Apply / Roll back) into this checkout
set -e
cd "$(dirname "$0")"
# your server goes in deploy.local.sh (gitignored): SOS_HOST_SSH=user@host
[ -f deploy.local.sh ] && . ./deploy.local.sh
HOST=${SOS_HOST_SSH:?set SOS_HOST_SSH=user@host in deploy.local.sh}

# Osage can publish commits on the home server. A deploy overlays this checkout onto that source, so any of them
# missing here would be silently reverted. They come in as cherry-picks (-x keeps the original id).
git fetch -q "$HOST:sean-os-server/app-changes/source" HEAD:refs/remotes/nijika/live || { echo "couldn't fetch the home server's app source"; exit 1; }
missing=()
for c in $(git log --reverse --format=%H --author=osage@toybox.local --grep='^Osage: ' --grep='^Revert "Osage: ' refs/remotes/nijika/live); do
  git merge-base --is-ancestor "$c" HEAD 2>/dev/null && continue
  [ -n "$(git log -1 --format=%H --grep="cherry picked from commit $c" HEAD)" ] && continue
  missing+=("$c")
done

if [ "${1:-}" = "pull" ]; then
  [ -z "$(git status --porcelain)" ] || { echo "commit or stash local work first"; exit 1; }
  for c in "${missing[@]}"; do git cherry-pick -x "$c"; done
  echo "pulled ${#missing[@]} Osage change(s)"; exit 0
fi
if [ ${#missing[@]} -gt 0 ]; then
  echo "Osage published ${#missing[@]} change(s) on the home server that this checkout doesn't have:"
  for c in "${missing[@]}"; do git log -1 --format='  %h %s' "$c" refs/remotes/nijika/live; done
  echo "run: bash deploy.sh pull   (then test, then deploy again)"; exit 1
fi
# Only committed work goes live (a half-finished edit in this folder must never ship).
if [ -n "$(git status --porcelain)" ] && [ -z "${DEPLOY_DIRTY:-}" ]; then
  echo "uncommitted changes here; commit them first (or DEPLOY_DIRTY=1 bash deploy.sh to override)"; git status --short | head; exit 1
fi

PY=$(command -v python3 || command -v python)
node build.mjs
"$PY" package_changes.py
ssh "$HOST" 'mkdir -p ~/sean-os-server/staging'
scp -q .osage-stage/frontend.tar.gz .osage-stage/history.bundle "$HOST":~/sean-os-server/staging/
scp -q server/app_changes.py server/setup_changes.py server/autodeploy.sh "$HOST":~/sean-os-server/
# private character packs (gitignored) live on the home server for autodeploy builds
for p in src/packs/*/; do n=$(basename "$p"); [ "$n" = default ] && continue; ssh "$HOST" "mkdir -p ~/sean-os-server/private/packs" && scp -q -r "$p" "$HOST":~/sean-os-server/private/packs/; done
ssh "$HOST" 'cd ~/sean-os-server && python3 setup_changes.py staging/frontend.tar.gz staging/history.bundle --refresh'
if [ "${1:-}" = "server" ]; then
  scp -q server/server.py server/caps.py server/ai.py server/aiconf.py server/host.py server/updates.py server/providers.json server/ai_messages.py server/pull_jobs.py server/agent.py server/moodle.py server/moodle_setup.py server/MOODLE.md server/ingest.py server/INGEST.md "$HOST":~/sean-os-server/
  ssh "$HOST" 'systemctl --user restart sos-sync && sleep 1 && systemctl --user is-active sos-sync'
fi
# the release channel self-updating servers read (<server>/releases/latest.json)
"$PY" server/release.py .osage-stage/release >/dev/null
B=$("$PY" -c "import json;print(json.load(open('.osage-stage/release/latest.json'))['build'])")   # the neutral-pack release build
ssh "$HOST" 'mkdir -p ~/sean-os-server/data/releases/.incoming'
scp -q .osage-stage/release/latest.json ".osage-stage/release/toybox-$B.zip" "$HOST":~/sean-os-server/data/releases/.incoming/
ssh "$HOST" 'cd ~/sean-os-server/data/releases && mv .incoming/toybox-*.zip . && mv .incoming/latest.json . && ls -t toybox-*.zip | tail -n +4 | xargs -r rm -f'
echo "deployed build $("$PY" -c "import json;print(json.load(open('dist/version.json'))['build'])" 2>/dev/null || cat dist/version.json)"
