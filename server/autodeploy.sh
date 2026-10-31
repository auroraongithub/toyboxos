#!/usr/bin/env bash
# Pull-based deploy on the home server: when GitHub's main moves (a merged PR), build it here and activate it exactly like
# deploy.sh does from the PC. Merging a PR on GitHub is the deploy.
# Run by the sos-autodeploy.timer (every 3 min); installed by setup_autodeploy.sh. Log: data/autodeploy.log
#   bash autodeploy.sh          deploy if main moved
#   bash autodeploy.sh --force  rebuild and deploy the current main even if it was already deployed
set -uo pipefail
SRV="$HOME/sean-os-server"; WORK="$SRV/autodeploy"; REPO="$WORK/repo"; LOG="$SRV/data/autodeploy.log"
REMOTE=${SOS_DEPLOY_REMOTE:-$(cat "$WORK/remote" 2>/dev/null)}   # written by setup_autodeploy.sh
[ -n "$REMOTE" ] || [ -d "$REPO/.git" ] || { echo "no repository: run setup_autodeploy.sh <owner/repo>" >&2; exit 1; }
NPM_VER=10.9.2
mkdir -p "$WORK" "$SRV/data"
exec 9>"$WORK/lock"; flock -n 9 || exit 0          # one run at a time
log(){ echo "$(date -u +%FT%TZ) $*" >>"$LOG"; }
# what the app's update light shows (GET /api/deploy): step, commit, its subject, when the run started
STARTED=$(date -u +%FT%TZ)
status(){ python3 -c 'import json,sys,time;s,c,m,t=sys.argv[1:5];json.dump({"state":s,"commit":c[:7],"subject":m[:120],"started":t,"at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())},open(sys.argv[5]+".tmp","w"))' "$1" "${new:-}" "${subject:-}" "$STARTED" "$SRV/data/deploy.json" && mv "$SRV/data/deploy.json.tmp" "$SRV/data/deploy.json"; }
# a failure shows up in the app's Inbox (once per commit), not only in a log nobody reads
fail(){ log "FAIL ${new:-?} $1"; status failed; if [ "$(cat "$WORK/failed" 2>/dev/null)" != "${new:-}" ]; then echo "${new:-}" >"$WORK/failed"
  printf '%s' "[\"Deploy of ${new:0:7} failed: $1 (see data/autodeploy.log on the server)\"]" | python3 "$SRV/ingest.py" jots - >/dev/null 2>&1; fi; exit 1; }

if [ ! -d "$REPO/.git" ]; then git clone -q --branch main "$REMOTE" "$REPO" || { log "clone failed"; exit 1; }; fi
cd "$REPO" || exit 1
git fetch -q origin main || { log "fetch failed"; exit 1; }
new=$(git rev-parse origin/main); old=$(cat "$WORK/deployed" 2>/dev/null || true)
[ "$new" = "$old" ] && [ "${1:-}" != "--force" ] && exit 0
[ "$(cat "$WORK/failed" 2>/dev/null)" = "$new" ] && [ "${1:-}" != "--force" ] && exit 0   # same broken commit: wait for a new one
subject=$(git log -1 --format=%s "$new" 2>/dev/null)
log "deploying $new (was ${old:-none})"
status building
git checkout -q --force "$new" && git clean -qfdx -e node_modules -e .npm-tool || fail "checkout"

# Osage may have published app changes (Apply) that GitHub's main doesn't have yet; deploying would revert them.
git fetch -q "$SRV/app-changes/source" HEAD:refs/remotes/nijika/live 2>/dev/null || fail "couldn't read Osage's source"
missing=0
for c in $(git log --format=%H --author=osage@toybox.local --grep='^Osage: ' --grep='^Revert "Osage: ' refs/remotes/nijika/live); do
  git merge-base --is-ancestor "$c" HEAD 2>/dev/null && continue
  [ -n "$(git log -1 --format=%H --grep="cherry picked from commit $c" HEAD)" ] && continue
  missing=$((missing+1))
done
[ "$missing" -gt 0 ] && fail "Osage published $missing change(s) that main doesn't have; run 'bash deploy.sh pull' on the PC, push, merge"

# build deps: only esbuild + marked come from npm (the rest is vendored); install scripts never run
if [ ! -f "$WORK/.npm-tool/bin/npm-cli.js" ]; then
  mkdir -p "$WORK/.npm-tool" && curl -fsSL "https://registry.npmjs.org/npm/-/npm-$NPM_VER.tgz" | tar xz -C "$WORK/.npm-tool" --strip-components=1 || fail "npm download"
fi
lock=$(sha256sum package-lock.json | cut -c1-16)
if [ "$(cat "$WORK/lockhash" 2>/dev/null)" != "$lock" ] || [ ! -d node_modules/esbuild ]; then
  node "$WORK/.npm-tool/bin/npm-cli.js" ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error >>"$LOG" 2>&1 || fail "npm ci"
  echo "$lock" >"$WORK/lockhash"
fi
# private character packs (not in the repo): ~/sean-os-server/private/packs/<name> -> src/packs/<name>
for p in "$SRV"/private/packs/*/; do [ -d "$p" ] && cp -r "$p" src/packs/; done
node build.mjs >>"$LOG" 2>&1 || fail "build"
status activating
python3 package_changes.py >>"$LOG" 2>&1 || fail "package"
mkdir -p "$SRV/staging" && cp .osage-stage/frontend.tar.gz .osage-stage/history.bundle "$SRV/staging/" || fail "stage"
cp server/app_changes.py server/setup_changes.py "$SRV/" || fail "copy setup"
( cd "$SRV" && python3 setup_changes.py staging/frontend.tar.gz staging/history.bundle --refresh ) >>"$LOG" 2>&1 || fail "activate release"

# server code: copy what changed and restart only its own services (never the machine's other ones)
changed=$( [ -n "$old" ] && git diff --name-only "$old" "$new" -- server/ 2>/dev/null || echo all)
sync_files="server.py caps.py ai.py aiconf.py host.py updates.py providers.json ai_messages.py agent.py moodle.py moodle_setup.py MOODLE.md ingest.py INGEST.md pull_jobs.py pull_fx.py pull_calendar.py jobs_profile.md app_changes.py setup_changes.py"
if [ "$changed" = all ] || grep -qE "^server/($(echo $sync_files | tr ' ' '|' | sed 's/\./\\./g'))$" <<<"$changed"; then
  for f in $sync_files; do cp "server/$f" "$SRV/"; done
  systemctl --user restart sos-sync && log "restarted sos-sync"
fi
if [ "$changed" = all ] || grep -q "^server/admin.py$" <<<"$changed"; then
  cp server/admin.py "$SRV/" && systemctl --user restart sos-admin && log "restarted sos-admin"
fi
# publish it on the release channel self-updating servers read (/releases/latest.json); a failure here doesn't undo the deploy
python3 server/release.py "$SRV/data/releases" >>"$LOG" 2>&1 || log "release packing failed"
# the deployer updates itself for the next run: through a rename, never in place (bash is still reading this file;
# overwriting it mid-run made the rest of the run read the new file at the old offset and die before "deployed")
cp server/autodeploy.sh "$SRV/autodeploy.sh.new" && mv -f "$SRV/autodeploy.sh.new" "$SRV/autodeploy.sh"
echo "$new" >"$WORK/deployed"; rm -f "$WORK/failed"
status deployed
log "deployed $new build $(python3 -c "import json;print(json.load(open('dist/version.json'))['build'])" 2>/dev/null)"
