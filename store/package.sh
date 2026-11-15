#!/usr/bin/env bash
# Zip the extension for the Chrome Web Store: ./store/package.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/skills/talk-to-ui/extension"
VERSION="$(node -p "require('$EXT/manifest.json').version")"
OUT="$ROOT/store/talk-to-ui-extension-$VERSION.zip"
STAGE="$(mktemp -d)"
trap 'rm -r "$STAGE"' EXIT
cp "$EXT"/manifest.json "$EXT"/content.js "$EXT"/boot.js "$EXT"/icon*.png "$STAGE/"
bash "$EXT/bundle.sh" "$STAGE"
rm -f "$OUT"
(cd "$STAGE" && zip -q -X "$OUT" ./*)
echo "store/talk-to-ui-extension-$VERSION.zip"
