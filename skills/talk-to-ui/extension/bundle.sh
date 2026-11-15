#!/usr/bin/env bash
# Copy the toolbar into an extension folder, so the extension runs only code
# from its own package: ./bundle.sh <extension folder>
# The toolbar's one source stays in ../scripts; the installer and the store
# packager both call this.
set -euo pipefail
SCRIPTS="$(cd "$(dirname "$0")/../scripts" && pwd)"
DEST="$1"
cp "$SCRIPTS/live-browser-session.js" "$SCRIPTS/live-browser.js" "$DEST/"
cp "$SCRIPTS/modern-screenshot.umd.js" "$DEST/modern-screenshot.js"
