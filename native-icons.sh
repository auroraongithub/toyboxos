#!/usr/bin/env bash
# Native app icons from the build's pack, for installers built on this PC. The repo keeps the neutral icons;
#   bash native-icons.sh apply     -> src/packs/<pack>/icon.png (1024 square) into src-tauri/icons + the Android mipmaps
#   bash native-icons.sh restore   -> back to the repo's neutral icons (run after the installer/APK build)
# Pack = SOS_PACK, else osage when this checkout has it (same choice as build.mjs).
set -e
cd "$(dirname "$0")"
PACK=${SOS_PACK:-$([ -f src/packs/osage/index.js ] && echo osage || echo default)}
RES=src-tauri/gen/android/app/src/main/res
case "$1" in
  apply)
    [ -f "src/packs/$PACK/icon.png" ] || { echo "pack $PACK has no icon.png: keeping the neutral icons"; exit 0; }
    npx tauri icon "src/packs/$PACK/icon.png" >/dev/null
    [ -f "src/packs/$PACK/icon-bg.txt" ] && sed -i "s/#[0-9A-Fa-f]\{6\}/$(cat "src/packs/$PACK/icon-bg.txt")/" "$RES/values/ic_launcher_background.xml"
    echo "icons: $PACK" ;;
  restore)
    git checkout -- src-tauri/icons "$RES"
    echo "icons: neutral" ;;
  *) echo "usage: bash native-icons.sh apply|restore"; exit 1 ;;
esac
