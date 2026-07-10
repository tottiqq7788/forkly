#!/usr/bin/env bash
set -euo pipefail

ARCH="${1:-arm64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/tools/git-runtime/manifest.json"
OUT="$ROOT/third_party/git"

KEY="darwin-arm64"
if [[ "$ARCH" == "amd64" || "$ARCH" == "x64" || "$ARCH" == "x86_64" ]]; then
  KEY="darwin-amd64"
  ARCH="amd64"
else
  ARCH="arm64"
fi

URL=$(python3 -c "import json;print(json.load(open('$MANIFEST'))['artifacts']['$KEY']['url'])")
SHA=$(python3 -c "import json;print(json.load(open('$MANIFEST'))['artifacts']['$KEY']['sha256'])")
FILE=$(python3 -c "import json;print(json.load(open('$MANIFEST'))['artifacts']['$KEY']['filename'])")

mkdir -p "$ROOT/tools/git-runtime/cache" "$OUT"
CACHE="$ROOT/tools/git-runtime/cache/$FILE"

if [[ ! -f "$CACHE" ]]; then
  echo "Downloading $URL"
  curl -L --fail -o "$CACHE" "$URL"
fi

ACTUAL=$(shasum -a 256 "$CACHE" | awk '{print $1}')
if [[ "$ACTUAL" != "$SHA" ]]; then
  echo "SHA256 mismatch: expected $SHA got $ACTUAL" >&2
  exit 1
fi

TMP=$(mktemp -d)
tar -xzf "$CACHE" -C "$TMP"
rm -rf "$OUT"
mkdir -p "$OUT"
# dugite layout: bin/git, libexec/git-core, share/...
if [[ -d "$TMP/bin" ]]; then
  cp -R "$TMP"/* "$OUT/"
else
  # sometimes nested
  INNER=$(find "$TMP" -type d -name bin | head -1)
  cp -R "$(dirname "$INNER")"/* "$OUT/"
fi

# License notice
mkdir -p "$OUT/licenses"
cat > "$OUT/licenses/NOTICE.txt" <<EOF
This application bundles Git from desktop/dugite-native ($KEY).
Git is licensed under GPL-2.0.
Source: https://github.com/git/git
Bundled via: https://github.com/desktop/dugite-native
See tools/git-runtime/manifest.json for exact version and checksums.
EOF

echo "Git runtime ready at $OUT (arch=$ARCH)"
