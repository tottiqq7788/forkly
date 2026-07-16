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
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>Markdown Document</string>
      <key>CFBundleTypeRole</key><string>Editor</string>
      <key>LSHandlerRank</key><string>Alternate</string>
      <key>LSItemContentTypes</key>
      <array>
        <string>net.daringfireball.markdown</string>
      </array>
      <key>CFBundleTypeExtensions</key>
      <array>
        <string>md</string>
        <string>markdown</string>
        <string>mdown</string>
        <string>mkdn</string>
        <string>mkd</string>
        <string>mdwn</string>
        <string>mdtxt</string>
        <string>mdtext</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
EOF

plutil -lint "$APP/Contents/Info.plist" >/dev/null

# Semantic assertions: keep Markdown association capable even if XML stays valid.
assert_plist() {
  local key="$1"
  local want="$2"
  local got
  got="$(/usr/libexec/PlistBuddy -c "Print ${key}" "$APP/Contents/Info.plist" 2>/dev/null || true)"
  if [[ "$got" != "$want" ]]; then
    echo "Info.plist assertion failed for ${key}: got '${got}' want '${want}'" >&2
    exit 1
  fi
}
assert_plist ":CFBundleDocumentTypes:0:CFBundleTypeRole" "Editor"
assert_plist ":CFBundleDocumentTypes:0:LSHandlerRank" "Alternate"
assert_plist ":CFBundleDocumentTypes:0:LSItemContentTypes:0" "net.daringfireball.markdown"
assert_plist ":CFBundleDocumentTypes:0:CFBundleTypeExtensions:0" "md"

echo "APPL????" > "$APP/Contents/PkgInfo"

ICON_SRC="$ROOT/packaging/macos/AppIcon.icns"
if [[ ! -f "$ICON_SRC" ]]; then
  echo "missing app icon: $ICON_SRC" >&2
  exit 1
fi
cp "$ICON_SRC" "$APP/Contents/Resources/AppIcon.icns"

# Ensure git runtime
bash "$ROOT/scripts/fetch-git-runtime.sh" "$GOARCH"
cp -R "$ROOT/third_party/git/"* "$APP/Contents/Resources/git/"

# Build binary
export CGO_ENABLED=1
export GOOS=darwin
export GOARCH
go build -ldflags "-X github.com/forkly-app/forkly/internal/app.Version=${VERSION} -X github.com/forkly-app/forkly/internal/github.ClientID=${FORKLY_GITHUB_CLIENT_ID:-} -X github.com/forkly-app/forkly/internal/github.ClientSecret=${FORKLY_GITHUB_CLIENT_SECRET:-}" \
  -o "$APP/Contents/MacOS/forkly" ./cmd/forkly
go build -o "$APP/Contents/MacOS/forkly-askpass" ./cmd/forkly-askpass
CGO_ENABLED=0 go build -ldflags "-X github.com/forkly-app/forkly/internal/cli.Version=${VERSION}" \
  -o "$APP/Contents/MacOS/forklyctl" ./cmd/forklyctl

# Optional signing
SIGN_IDENTITY="${FORKLY_SIGN_IDENTITY:-}"
if [[ -n "$SIGN_IDENTITY" ]]; then
  echo "Signing nested binaries..."
  while IFS= read -r -d '' bin; do
    codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$bin" || true
  done < <(find "$APP/Contents/Resources/git" -type f -perm +111 -print0)
  codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP/Contents/MacOS/forkly"
  codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP/Contents/MacOS/forklyctl"
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
