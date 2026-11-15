#!/usr/bin/env bash
# Zip the extension for the Chrome Web Store: ./store/package.sh
set -euo pipefail
cd "$(dirname "$0")/../skills/talk-to-ui/extension"
VERSION="$(node -p "require('./manifest.json').version")"
OUT="../../../store/talk-to-ui-extension-$VERSION.zip"
rm -f "$OUT"
zip -q -X "$OUT" manifest.json content.js icon16.png icon32.png icon48.png icon128.png
echo "store/talk-to-ui-extension-$VERSION.zip"
