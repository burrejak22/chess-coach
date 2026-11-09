#!/bin/sh
# Builds the iPhone (Safari) version of Chess Coach as an Xcode project.
# Needs a Mac with Xcode. Run from anywhere: sh scripts/build-ios.sh
set -e
cd "$(dirname "$0")/.."

OUT=build/safari
rm -rf "$OUT"
mkdir -p "$OUT/extension"

# just the extension itself (no tests or dev files)
cp -R manifest.json background.js content.js sidepanel.html sidepanel.css sidepanel.js openings-ui.js \
  lib engine icons "$OUT/extension/"

xcrun safari-web-extension-converter "$OUT/extension" \
  --project-location "$OUT" \
  --app-name "Chess Coach" \
  --bundle-identifier "com.burrejak22.chesscoach" \
  --ios-only --swift --copy-resources --no-open --no-prompt --force

echo
echo "Done. Next:"
echo "  1. open \"$OUT/Chess Coach/Chess Coach.xcodeproj\""
echo "  2. In Xcode: click the project > Signing & Capabilities > Team: pick your Apple ID (for both targets)."
echo "  3. Plug in your iPhone, pick it at the top of the window, press Run (the play button)."
echo "  4. On the iPhone: Settings > Apps > Safari > Extensions > Chess Coach > turn it on, and allow lichess.org and chess.com."
