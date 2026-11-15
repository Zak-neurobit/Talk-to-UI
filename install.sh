#!/usr/bin/env bash
# Talk-to-UI installer: copies the skill into Claude Code and/or Codex.
#
#   curl -fsSL https://raw.githubusercontent.com/Zak-neurobit/Talk-to-UI/main/install.sh | bash
#   ./install.sh --name my-talk-to-ui     # from a local clone, under a different skill name
set -euo pipefail

NAME="talk-to-ui"
REPO="https://github.com/Zak-neurobit/Talk-to-UI"

while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="${2:-}"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
if ! [[ "$NAME" =~ ^[A-Za-z0-9-]+$ ]]; then
  echo "Skill name may only use letters, numbers and dashes." >&2; exit 2
fi
command -v node >/dev/null || { echo "Talk-to-UI needs Node.js 18 or newer: https://nodejs.org" >&2; exit 1; }

# Source: the clone this script sits in, or a fresh shallow clone when piped from curl.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || true)"
if [ -n "$HERE" ] && [ -f "$HERE/skills/talk-to-ui/SKILL.md" ]; then
  ROOT="$HERE"
else
  command -v git >/dev/null || { echo "git is needed to download Talk-to-UI." >&2; exit 1; }
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  git clone --depth 1 --quiet "$REPO" "$TMP/repo" || { echo "Could not download $REPO" >&2; exit 1; }
  ROOT="$TMP/repo"
fi

installed=0
for tool in "$HOME/.claude" "$HOME/.codex"; do
  [ -d "$tool" ] || continue                 # that AI tool isn't installed
  dest="$tool/skills/$NAME"
  mkdir -p "$tool/skills"
  rm -rf "$dest"
  cp -R "$ROOT/skills/talk-to-ui" "$dest"
  cp "$ROOT/LICENSE.md" "$ROOT/THIRD-PARTY-NOTICES.md" "$dest/"
  sed -i.bak "s/^name: talk-to-ui$/name: $NAME/" "$dest/SKILL.md" && rm -f "$dest/SKILL.md.bak"
  echo "Installed $NAME -> $dest"
  installed=$((installed + 1))
done

if [ "$installed" -eq 0 ]; then
  echo "Found neither ~/.claude (Claude Code) nor ~/.codex (Codex). Install one of them first." >&2
  exit 1
fi

# Always-on: a small background launcher that puts the toolbar on any localhost
# project (through the browser extension) and runs the AI without a terminal.
APP="$HOME/.talk-to-ui/app"
rm -rf "$APP"
mkdir -p "$HOME/.talk-to-ui"
cp -R "$ROOT/skills/talk-to-ui" "$APP"
NODE_BIN="$(command -v node)"
LOG="$HOME/.talk-to-ui/launcher.log"
if [ "$(uname)" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.talk-to-ui.launcher.plist"
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.talk-to-ui.launcher</string>
  <key>ProgramArguments</key>
  <array><string>$NODE_BIN</string><string>$APP/scripts/launcher.mjs</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$PATH</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST_EOF
  launchctl bootout "gui/$(id -u)/com.talk-to-ui.launcher" 2>/dev/null || true
  # The old copy can take a moment to shut down; retry until it is gone.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null && break
    sleep 0.5
  done
  launchctl print "gui/$(id -u)/com.talk-to-ui.launcher" >/dev/null 2>&1 \
    || { echo "Could not start the always-on launcher. Run: launchctl bootstrap gui/$(id -u) $PLIST" >&2; exit 1; }
  echo "Always-on launcher running (starts at login)."
elif command -v systemctl >/dev/null; then
  UNIT="$HOME/.config/systemd/user/talk-to-ui.service"
  mkdir -p "$(dirname "$UNIT")"
  printf '[Unit]\nDescription=Talk-to-UI launcher\n\n[Service]\nExecStart=%s %s\nEnvironment=PATH=%s\nRestart=always\n\n[Install]\nWantedBy=default.target\n' \
    "$NODE_BIN" "$APP/scripts/launcher.mjs" "$PATH" > "$UNIT"
  systemctl --user daemon-reload && systemctl --user enable --now talk-to-ui.service
  echo "Always-on launcher running (systemd user service)."
else
  echo "Start the always-on launcher yourself: node $APP/scripts/launcher.mjs"
fi

echo
echo "One last step, once: add the browser extension."
echo "  1. Open chrome://extensions (Comet, Chrome, Arc, Edge and Brave all work)"
echo "  2. Turn on Developer mode, click 'Load unpacked', choose: $APP/extension"
echo
echo "Then open any localhost page of a project on this computer: the lime mark appears at the bottom."
