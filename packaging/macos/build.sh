#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?version}"
ARCH_IN="${2:-arm64}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ "$ARCH_IN" == "amd64" || "$ARCH_IN" == "x64" || "$ARCH_IN" == "x86_64" ]]; then
  GOARCH=amd64
  ARCH_LABEL=x64
else
  GOARCH=arm64
  ARCH_LABEL=arm64
fi

APP_NAME="Forkly"
BUNDLE_ID="app.forkly.desktop"
DIST="$ROOT/dist"
APP="$DIST/${APP_NAME}.app"
DMG="$DIST/${APP_NAME}-${VERSION}-macOS-${ARCH_LABEL}.dmg"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/git" "$APP/Contents/Resources"

# Info.plist
cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>forkly</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleName</key><string>${APP_NAME}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
EOF

echo "APPL????" > "$APP/Contents/PkgInfo"

# Ensure git runtime
bash "$ROOT/scripts/fetch-git-runtime.sh" "$GOARCH"
cp -R "$ROOT/third_party/git/"* "$APP/Contents/Resources/git/"

# Build binary
export CGO_ENABLED=1
export GOOS=darwin
export GOARCH
go build -ldflags "-X github.com/forkly-app/forkly/internal/app.Version=${VERSION}" \
  -o "$APP/Contents/MacOS/forkly" ./cmd/forkly

# Optional signing
SIGN_IDENTITY="${FORKLY_SIGN_IDENTITY:-}"
if [[ -n "$SIGN_IDENTITY" ]]; then
  echo "Signing nested binaries..."
  while IFS= read -r -d '' bin; do
    codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$bin" || true
  done < <(find "$APP/Contents/Resources/git" -type f -perm +111 -print0)
  codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP/Contents/MacOS/forkly"
  codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP"
  codesign --verify --deep --strict "$APP"
else
  echo "FORKLY_SIGN_IDENTITY not set; producing unsigned .app for local use"
fi

# DMG
rm -f "$DMG"
STAGE=$(mktemp -d)
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
rm -rf "$STAGE"

if [[ -n "$SIGN_IDENTITY" ]]; then
  codesign --force --sign "$SIGN_IDENTITY" "$DMG" || true
fi

# Notarization (optional)
if [[ -n "${FORKLY_NOTARY_PROFILE:-}" ]]; then
  if ! command -v xcrun >/dev/null || ! xcrun --find notarytool >/dev/null 2>&1; then
    echo "notarytool unavailable (install full Xcode). Skipping notarization." >&2
  else
    xcrun notarytool submit "$DMG" --keychain-profile "$FORKLY_NOTARY_PROFILE" --wait
    xcrun stapler staple "$DMG"
  fi
fi

echo "Built $DMG"
