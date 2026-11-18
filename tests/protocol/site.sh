#!/bin/bash
# Builds a local copy of gitguy268.github.io for the hand-off tests: .scratch/site/<repo>/...
# PLAYERS = a folder holding the player repos under their GitHub names; without it, the checkouts
# next to this repo (its parent folder) are used.
set -euo pipefail
SITE=$(cd "$(dirname "$0")/../.." && pwd)/.scratch/site
P=$(cd "$(dirname "$0")/../../.." && pwd)
src() {
  if [ -n "${PLAYERS:-}" ]; then echo "$PLAYERS/$1"; return; fi
  case $1 in
    realistic-vinyl-player) echo "$P/vinyl-player-realistic-map/realistic-vinyl-player-claude-html-1" ;;
    8-bit-vinyl-player) echo "$P/vinyl-player-realistic-map/8-bit-vinyl-player" ;;
    ultra-realistic-vinyl-player) echo "$P/vinyl-player-realistic-map/ultra-realistic-vinyl-player-claude" ;;
    *) echo "$P/$1" ;;
  esac
}
mkdir -p "$SITE"
copy() { local from; from=$(src "$1"); rm -rf "$SITE/$1"; mkdir -p "$SITE/$1"; cp "$from"/*.html "$SITE/$1/"; cp "$from"/*.png "$from"/*.ico "$SITE/$1/" 2>/dev/null || true; }
for r in realistic-vinyl-player 8-bit-vinyl-player Vinyl-Player 8bit-player; do copy $r; done
if [ "${SKIP_ULTRA:-}" != 1 ]; then
  (cd "$(src ultra-realistic-vinyl-player)" && { [ -d node_modules ] || npm ci --no-audit --no-fund >/dev/null; } && npx vite build --base=/ultra-realistic-vinyl-player/ --outDir "$SITE/ultra-realistic-vinyl-player" --emptyOutDir >/dev/null 2>&1)
fi
mkdir -p "$SITE/vinyl-shelf/tests/protocol"
cp "$(dirname "$0")/stub.html" "$SITE/vinyl-shelf/tests/protocol/"
find "$SITE" -name "._*" -delete
echo "site ready: $SITE"
