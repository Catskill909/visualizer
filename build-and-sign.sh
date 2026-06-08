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

# (Stale-process sweep + cache wipe are consolidated below into kill_stale and
# the hard cache wipe, once colors/credentials are set up. See Step 0b.)

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

# ── Hang-proofing: the permanent fix for the recurring Step 1 build wedge ──────
# We stopped playing whack-a-mole with individual triggers. Two layers:
#   1. kill_stale — sweep EVERY process/port left by a prior build or dev session
#                   that could hold a lock, a port, or the dep-optimizer cache and
#                   silently wedge a fresh build.
#   2. run_step   — run a build step with stdin detached (no prompt can block it)
#                   under a HARD time budget. If it overruns, the step is hung:
#                   kill it, sweep, print a loud diagnostic, and abort non-zero.
#                   This converts the old silent infinite freeze into a fast,
#                   explained failure regardless of WHAT triggered it — stdin
#                   prompt, stale lock, busy port, or a cause we haven't seen yet.
WATCHDOG_FLAG="$(mktemp -u "/tmp/discocast-build-watchdog.XXXXXX")"
trap 'rm -f "$WATCHDOG_FLAG"' EXIT

kill_stale() {
    pkill -9 -f "node.*vite"  2>/dev/null || true
    pkill -9 -f "vite build"  2>/dev/null || true
    pkill -9 -f "rolldown"    2>/dev/null || true
    pkill -9 -f "esbuild"     2>/dev/null || true
    pkill -9 -f "tauri dev"   2>/dev/null || true
    pkill -9 -f "tauri-dev"   2>/dev/null || true
    # Free the Vite dev port if a dev server is still camped on it
    local pids; pids="$(lsof -ti tcp:5173 2>/dev/null || true)"
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
    return 0
}

# run_step <budget_seconds> <label> <command...>
run_step() {
    local budget="$1" label="$2"; shift 2

    # Run the step with stdin detached so no prompt (npm notice, deprecation,
    # etc.) can ever block it on the inherited TTY.
    "$@" < /dev/null &
    local cmd_pid=$!

    # Watchdog: if the step is still alive after its budget, it is hung.
    ( sleep "$budget"
      if kill -0 "$cmd_pid" 2>/dev/null; then
          touch "$WATCHDOG_FLAG"
          kill -TERM "$cmd_pid" 2>/dev/null || true
          sleep 2
          kill -KILL "$cmd_pid" 2>/dev/null || true
          kill_stale   # nuke the orphaned node/vite/esbuild children too
      fi ) &
    local dog_pid=$!

    local rc=0
    wait "$cmd_pid" 2>/dev/null || rc=$?

    # Step finished on its own — stand down the watchdog.
    kill "$dog_pid" 2>/dev/null || true
    wait "$dog_pid" 2>/dev/null || true

    if [ -f "$WATCHDOG_FLAG" ]; then
        rm -f "$WATCHDOG_FLAG"
        echo "" >&2
        echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
        echo -e "${RED}✗ ${label} HUNG — killed after ${budget}s.${NC}" >&2
        echo -e "${RED}  This is the recurring build wedge: a stale vite/esbuild/${NC}" >&2
        echo -e "${RED}  rolldown worker, a held dep-optimizer lock, or a busy port.${NC}" >&2
        echo -e "${RED}  Those workers have just been swept clean.${NC}" >&2
        echo -e "${RED}  → Re-run ./build-and-sign.sh — it should pass now.${NC}" >&2
        echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
        exit 124
    fi

    return $rc
}

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

# Step 0b: Sweep every stale Vite/rolldown/esbuild/tauri worker (and the dev
# port) left by a prior build or dev session. Any one of them can hold a file
# lock or the dep-optimizer cache and wedge this build silently. SIGKILL (-9)
# because some rolldown workers ignore SIGTERM. Consolidated into kill_stale,
# which the watchdog also calls when a step hangs.
kill_stale
sleep 1

# Hard cache wipe. The build has hung repeatedly when Vite/rolldown trusts a
# stale dep-optimizer cache. None of these are in git; all regenerate on the
# next build.
rm -rf \
    node_modules/.vite \
    node_modules/.vite-temp \
    node_modules/.cache \
    node_modules/.tmp \
    .vite \
    .rolldown \
    dist

# Step 1: Build the web app, under the watchdog. The hard cache wipe above
# already forces Vite to re-optimize dependencies (no cache to trust). Do NOT
# add `--force` here — Vite v8's `vite build` rejects it (only `vite dev` and
# `vite optimize` accept --force).
#
# run_step detaches stdin (kills the npm-prompt hang) AND enforces a 120s budget
# (the real vite build finishes in well under a second), so this step can never
# freeze silently again — whatever the cause, it dies loud and fast.
# ⚠️ LOAD-BEARING: this Step-1 vite build is now the ONLY one. tauri.conf.json has
# `beforeBuildCommand: ""` (disabled) so Step 2 does NOT re-run vite — it just bundles
# the dist/ this step produced. Do NOT remove or skip Step 1, or Step 2 ships a stale/
# missing frontend. (Previously Tauri re-ran vite a 2nd time inside Step 2, under the
# loose 600s budget — that redundant run is what wedged for ~2min on 2026-06-08.)
echo -e "${YELLOW}Step 1: Building web app with Vite...${NC}"
run_step 120 "Step 1 (Vite web build)" npm run build

# Step 2: Bundle the macOS app with Tauri. With beforeBuildCommand disabled, Tauri no
# longer re-runs vite here — it packages the already-built dist/ from Step 1. The 600s
# budget covers a cold Rust compile while still catching a true hang via the watchdog.
echo -e "${YELLOW}Step 2: Building macOS app with Tauri...${NC}"
run_step 600 "Step 2 (Tauri macOS build)" npm run tauri-build

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

# Step 8: Create drag-to-install DMG with branded background
echo -e "${YELLOW}Step 8: Creating branded drag-to-install DMG...${NC}"

# Detach any stale volumes from previous interrupted builds
for vol in "/Volumes/DiscoCast Visualizer" "/Volumes/discocast-visualizer"; do
    if [ -d "$vol" ]; then
        hdiutil detach "$vol" -force 2>/dev/null || true
    fi
done

# Build DMG staging folder: app + Applications symlink + hidden background image
DMG_STAGING="/tmp/dmg-staging"
rm -rf "$DMG_STAGING"
mkdir -p "$DMG_STAGING/.background"
cp -R "$APP_PATH" "$DMG_STAGING/${DISPLAY_NAME}.app"
ln -s /Applications "$DMG_STAGING/Applications"
cp "$(pwd)/installer/dmg-background.png"    "$DMG_STAGING/.background/background.png"
cp "$(pwd)/installer/dmg-background@2x.png" "$DMG_STAGING/.background/background@2x.png"

# Create a writable temp DMG first, then convert to compressed
TEMP_DMG="/tmp/${APP_NAME}-temp.dmg"
FINAL_DMG="promo/${DISPLAY_NAME}-${VERSION}.dmg"

hdiutil create \
    -volname "${DISPLAY_NAME}" \
    -srcfolder "$DMG_STAGING" \
    -fs HFS+ \
    -ov -format UDRW \
    "$TEMP_DMG"

# Mount to /Volumes/ (no custom mountpoint) so Finder can find the disk by name
hdiutil detach "/Volumes/${DISPLAY_NAME}" -force 2>/dev/null || true
hdiutil attach "$TEMP_DMG" -readwrite -nobrowse

osascript <<APPLESCRIPT || true
tell application "Finder"
    tell disk "${DISPLAY_NAME}"
        open
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set bounds of container window to {200, 120, 860, 520}
        set viewOptions to the icon view options of container window
        set arrangement of viewOptions to not arranged
        set icon size of viewOptions to 100
        set background picture of viewOptions to file ".background:background.png"
        set position of item "${DISPLAY_NAME}.app" of container window to {165, 175}
        set position of item "Applications" of container window to {495, 175}
        close
        open
        update without registering applications
        delay 2
    end tell
end tell
APPLESCRIPT

sleep 2
hdiutil detach "/Volumes/${DISPLAY_NAME}" -quiet

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

# Step 9: Write version.json — promo page fetches this when served over HTTP
echo -e "${YELLOW}Step 9: Writing promo/version.json (${APP_VERSION})...${NC}"
printf '{"version": "%s"}\n' "${APP_VERSION}" > promo/version.json
echo -e "${GREEN}promo/version.json → ${APP_VERSION}${NC}"

# Step 9b: Patch the inline span fallback in promo/index.html so the version
# shows correctly even when the file is opened locally (file:// blocks fetch).
echo -e "${YELLOW}Step 9b: Patching version span in promo/index.html...${NC}"
sed -i '' "s|<span id=\"app-version\">[^<]*</span>|<span id=\"app-version\">${APP_VERSION}</span>|" promo/index.html
echo -e "${GREEN}promo/index.html span → ${APP_VERSION}${NC}"

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
