#!/bin/bash

# Build and sign script for DiscoCast Visualizer
# This script builds, signs, notarizes, and packages the macOS app
#
# Prerequisites:
#   - Apple Developer account with Team ID: 3UT7698LZ6
#   - App ID created: com.discocast.visualizer
#   - Icons generated in src-tauri/icons/
#   - Rust/Cargo installed
#
# Last successful build: April 24, 2026

set -e

# App configuration
APP_NAME="DiscoCast Visualizer"
DISPLAY_NAME="DiscoCast Visualizer"
BUNDLE_ID="app.discocast.visualizer"
VERSION="1.0.$(date +%Y%m%d.%H%M)"

# Human-readable release version — bump this before each build
APP_VERSION="Beta $(date +"%b %d, %Y")"

# Load signing credentials from local file (never committed to git)
CREDS_FILE="$(dirname "$0")/.build-credentials"
if [ ! -f "$CREDS_FILE" ]; then
    echo -e "${RED}Error: .build-credentials not found.${NC}"
    echo "Copy .build-credentials.example to .build-credentials and fill in your values."
    exit 1
fi
# shellcheck source=.build-credentials
source "$CREDS_FILE"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Building ${DISPLAY_NAME}...${NC}"
echo "Bundle ID: ${BUNDLE_ID}"
echo "Team ID: ${TEAM_ID}"
echo ""

# Step 0: Check prerequisites
if [ ! -d "src-tauri/icons" ]; then
    echo -e "${YELLOW}Step 0: Generating icons from logo.png...${NC}"
    mkdir -p src-tauri/icons
    mkdir -p iconset.iconset
    sips -z 32 32 public/logo.png --out iconset.iconset/icon_32x32.png
    sips -z 64 64 public/logo.png --out iconset.iconset/icon_32x32@2x.png
    sips -z 128 128 public/logo.png --out iconset.iconset/icon_128x128.png
    sips -z 256 256 public/logo.png --out iconset.iconset/icon_128x128@2x.png
    sips -z 256 256 public/logo.png --out iconset.iconset/icon_256x256.png
    sips -z 512 512 public/logo.png --out iconset.iconset/icon_256x256@2x.png
    sips -z 512 512 public/logo.png --out iconset.iconset/icon_512x512.png
    sips -z 1024 1024 public/logo.png --out iconset.iconset/icon_512x512@2x.png
    iconutil -c icns iconset.iconset -o src-tauri/icons/icon.icns
    cp iconset.iconset/icon_32x32.png src-tauri/icons/32x32.png
    cp iconset.iconset/icon_128x128.png src-tauri/icons/128x128.png
    cp iconset.iconset/icon_128x128@2x.png src-tauri/icons/128x128@2x.png
    rm -rf iconset.iconset
    echo -e "${GREEN}Icons generated!${NC}"
fi

# Step 1: Build the web app
echo -e "${YELLOW}Step 1: Building web app with Vite...${NC}"
npm run build

# Step 2: Build the macOS app with Tauri
echo -e "${YELLOW}Step 2: Building macOS app with Tauri...${NC}"
npm run tauri-build

# Step 3: Inject NSMicrophoneUsageDescription then sign with Developer ID
echo -e "${YELLOW}Step 3: Injecting microphone permission description...${NC}"
APP_PATH="src-tauri/target/release/bundle/macos/${APP_NAME}.app"
if [ ! -d "$APP_PATH" ]; then
    echo -e "${RED}Error: App not found at ${APP_PATH}${NC}"
    exit 1
fi

PLIST="$APP_PATH/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Delete :NSMicrophoneUsageDescription" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string 'DiscoCast Visualizer needs microphone access to visualize live audio from your mic, DJ controller, or USB audio interface.'" "$PLIST"
echo -e "${GREEN}NSMicrophoneUsageDescription injected${NC}"

echo -e "${YELLOW}Step 3b: Signing app with Developer ID...${NC}"
codesign --force --deep \
    --sign "Developer ID Application: Paul Henshaw (3UT7698LZ6)" \
    --entitlements "src-tauri/entitlements.plist" \
    --options runtime \
    "$APP_PATH"
codesign -dv --verbose=4 "$APP_PATH" 2>&1 | grep -E "TeamIdentifier|Authority" || true
echo -e "${GREEN}App signed at: ${APP_PATH}${NC}"

# Step 4: Create zip for notarization
echo -e "${YELLOW}Step 4: Creating zip for notarization...${NC}"
ZIP_PATH="/tmp/${APP_NAME}.app.zip"
ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"
echo -e "${GREEN}Created: ${ZIP_PATH}${NC}"

# Step 5: Submit for notarization
echo -e "${YELLOW}Step 5: Submitting for notarization (this may take a few minutes)...${NC}"

xcrun notarytool submit "$ZIP_PATH" \
    --apple-id "$APPLE_ID" \
    --team-id "$TEAM_ID" \
    --password "$APP_PASS" \
    --wait

# Step 6: Staple the notarization ticket
echo -e "${YELLOW}Step 6: Stapling notarization ticket...${NC}"
xcrun stapler staple "$APP_PATH"

# Step 7: Verify
echo -e "${YELLOW}Step 7: Verifying notarization...${NC}"
spctl --assess --type exec --verbose "$APP_PATH" 2>&1 | head -5

# Step 8: Create drag-to-install DMG with Applications shortcut
echo -e "${YELLOW}Step 8: Creating drag-to-install DMG...${NC}"

# Detach any stale volumes from previous interrupted builds
for vol in "/Volumes/DiscoCast Visualizer" "/Volumes/discocast-visualizer" "$MOUNT_VOL"; do
    if [ -d "$vol" ]; then
        hdiutil detach "$vol" -force 2>/dev/null || true
    fi
done

# Build DMG staging folder with app + Applications symlink (no .app in project root)
DMG_STAGING="/tmp/dmg-staging"
rm -rf "$DMG_STAGING"
mkdir -p "$DMG_STAGING"
cp -R "$APP_PATH" "$DMG_STAGING/${DISPLAY_NAME}.app"
ln -s /Applications "$DMG_STAGING/Applications"

# Create a writable temp DMG first, then convert to compressed
TEMP_DMG="/tmp/${APP_NAME}-temp.dmg"
FINAL_DMG="promo/${DISPLAY_NAME}-${VERSION}.dmg"

hdiutil create \
    -volname "${DISPLAY_NAME}" \
    -srcfolder "$DMG_STAGING" \
    -fs HFS+ \
    -ov -format UDRW \
    "$TEMP_DMG"

# Mount, set window size/icon layout via AppleScript, then eject
MOUNT_VOL="/tmp/discocast-dmg-mount"
rm -rf "$MOUNT_VOL"
mkdir -p "$MOUNT_VOL"
hdiutil attach "$TEMP_DMG" -readwrite -nobrowse -mountpoint "$MOUNT_VOL"

osascript <<APPLESCRIPT || true
tell application "Finder"
    tell disk "${DISPLAY_NAME}"
        open
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set bounds of container window to {200, 120, 780, 480}
        set viewOptions to the icon view options of container window
        set arrangement of viewOptions to not arranged
        set icon size of viewOptions to 110
        set position of item "${DISPLAY_NAME}.app" of container window to {170, 170}
        set position of item "Applications" of container window to {420, 170}
        close
        open
        update without registering applications
    end tell
end tell
APPLESCRIPT

sleep 2
hdiutil detach "$MOUNT_VOL" -quiet

# Convert to compressed read-only DMG
hdiutil convert "$TEMP_DMG" -format UDZO -ov -o "$FINAL_DMG"
rm -f "$TEMP_DMG"
rm -rf "$DMG_STAGING"

# Sign the DMG
codesign --sign "Developer ID Application: Paul Henshaw (3UT7698LZ6)" "$FINAL_DMG" || true

# Notarize the DMG itself (app inside is already notarized; this covers the wrapper)
echo -e "${YELLOW}Step 8b: Notarizing DMG...${NC}"
xcrun notarytool submit "$FINAL_DMG" \
    --apple-id "$APPLE_ID" \
    --team-id "$TEAM_ID" \
    --password "$APP_PASS" \
    --wait

# Staple the notarization ticket to the DMG
echo -e "${YELLOW}Step 8c: Stapling notarization ticket to DMG...${NC}"
xcrun stapler staple "$FINAL_DMG"

# Verify the DMG is fully notarized
echo -e "${YELLOW}Step 8d: Verifying DMG notarization...${NC}"
spctl --assess --type open --context context:primary-signature -v "$FINAL_DMG" 2>&1 | head -3

xattr -c "$FINAL_DMG" 2>/dev/null || true

# Keep a stable-named copy for the download button in promo/index.html
STABLE_DMG="promo/DiscoCast-Visualizer.dmg"
cp "$FINAL_DMG" "$STABLE_DMG"
echo -e "${GREEN}Stable copy: ${STABLE_DMG}${NC}"

# Step 9: Write version.json — promo page fetches this, no HTML edits needed
echo -e "${YELLOW}Step 9: Writing promo/version.json (${APP_VERSION})...${NC}"
printf '{"version": "%s"}\n' "${APP_VERSION}" > promo/version.json
echo -e "${GREEN}promo/version.json → ${APP_VERSION}${NC}"

echo ""
echo -e "${GREEN}✅ Build complete!${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  📦 INSTALLER:  $(pwd)/${FINAL_DMG}"
echo -e "  🔏 SIGNED APP: ${APP_PATH}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  To install on this Mac:"
echo "    open \"${FINAL_DMG}\""
echo "  To share with others: send the .dmg file above"
echo ""
