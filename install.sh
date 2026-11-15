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
echo
echo "Done. Open your project, start your AI, and say: start talk-to-ui"
