# macOS Video Import Bug - Deep Audit & Fix Log

## Problem Statement
**Status:** ✅ **FIXED** - May 9, 2026  
**Symptom:** Video layer card is created, toast shows success, but video does not display  
**Browser:** Works fine (Chrome, Safari)  
**macOS App:** ✅ Now working (WKWebView)  
**First Reported:** May 9, 2026  
**Root Cause:** Non-transcoded path revoked blob URL while video element still referenced it  

---

## Video Layer Architecture Overview

### Data Flow
```
User selects video file
    ↓
_addVideoLayer() in inspector.js
    ↓
Check dimensions → Transcode if needed (FFmpeg.wasm)
    ↓
Create video element → Append to DOM → Set src
    ↓
Wait for loadedmetadata
    ↓
Create texObj { isVideo, videoElement, width, height }
    ↓
_mountLayerCard() → setUserTexture() → _loadVideoTexture()
    ↓
Video element → uploadCanvas → texSubImage2D → WebGL texture
    ↓
_tickVideoAnimations() (every frame)
```

### Key Files
- `src/editor/inspector.js` - `_addVideoLayer()`, `_mountLayerCard()`
- `src/visualizer.js` - `setUserTexture()`, `_loadVideoTexture()`, `_tickVideoAnimations()`
- `src/videoTranscoder.js` - `transcodeTo720p()` (FFmpeg.wasm)

---

## WKWebView-Specific Requirements (Critical)

From Apple documentation and empirical testing:

1. **Video must be in DOM before setting src** - Creating element and setting src before append causes load failures
2. **playsInline = true** - Required for inline playback (not full screen)
3. **muted = true** - Required for autoplay without user gesture
4. **preload = 'auto'** - For continuous playback after metadata load
5. **loop = true** - Required for continuous playback
6. **Moving element in DOM resets playback** - Double-append can pause/reset video
7. **Cross-origin video restrictions** - WKWebView stricter than desktop browsers

---

## Fix Attempts Log

### Attempt 1: Initial WKWebView DOM Fix
**Date:** May 9, 2026  
**Changes:**
- Added `video.style.position = 'fixed'` etc + `document.body.appendChild(video)` in `_addVideoLayer`
- Added same in `_loadVideoTexture`
- Added same in `_bindCustomPresetImages`

**Result:** ❌ Still broken  
**Why Failed:** Double-append issue - video appended twice, second append resets element

---

### Attempt 2: ReadyState Check + Debug Logging
**Date:** May 9, 2026  
**Changes:**
- Added `if (videoElement.readyState < 2) continue` in `_tickVideoAnimations`
- Added debug logging throughout pipeline

**Result:** ❌ Still broken (user rejected debug logs)  
**Why Failed:** Didn't address root cause, added noise

---

### Attempt 3: Deep Audit - ROOT CAUSE FOUND
**Date:** May 9, 2026  

**ROOT CAUSE IDENTIFIED:**
In the non-transcoded path (videos under 720p), line 2361 revokes the blob URL:
```javascript
URL.revokeObjectURL(videoUrl);  // BUG: video.src still points to this URL!
```

Then `finalVideo = video` assigns the video element with a revoked blob URL to be used for playback. The video element has no valid source! This explains why:
- Toast shows success (metadata check passed)
- Layer card is created (all the entry data is correct)
- Video doesn't appear (element has revoked blob URL)

**WHY BROWSER WORKS:** Desktop browsers are more forgiving with revoked blob URLs - they may cache the data. WKWebView strictly enforces blob URL lifecycle.

**Fix Applied (May 9, 2026 11:15am):**
- **inspector.js:2361-2364** - Removed `URL.revokeObjectURL(videoUrl)` from non-transcoded path
- **inspector.js:2310** - Added `video.loop = true` for continuous playback (non-transcoded videos were missing this)

**✅ VERIFIED:** Both paths work in macOS build (v1.0.20260509.1118)
- Non-transcoded (<720p): ✅ Fixed
- Transcoded (>720p): ✅ Works

**Resolution:** Fixed in commit with inspector.js changes (lines 2310, 2361-2364)

---

## Current Suspected Root Causes (Ranked)

### Hypothesis 1: Blob URL Scope Issue
**Evidence:**
- WKWebView has stricter blob URL lifecycle than desktop browsers
- Blob URL created in one context might not be valid in another
- Video loads metadata but doesn't render

**Test:** Check if `URL.createObjectURL()` needs special handling in WKWebView

### Hypothesis 2: FFmpeg Transcoding Corruption
**Evidence:**
- FFmpeg.wasm was recently added for transcoding
- Videos over 720p get transcoded
- Issue may have started after transcoding feature added

**Test:** 
1. Try importing video under 720p (no transcoding)
2. Try importing video over 720p (with transcoding)
3. Compare behavior

### Hypothesis 3: Video Element Reuse/Reset
**Evidence:**
- Transcoded path creates NEW video element
- Original path uses SAME video element from metadata check
- Different initialization paths may cause inconsistent state

**Test:** Check if transcoded vs non-transcoded videos behave differently

### Hypothesis 4: Tauri/WKWebView Security Policy
**Evidence:**
- Tauri apps have CSP (Content Security Policy) restrictions
- Blob URLs may be blocked by default
- WKWebView may require specific permissions for media

**Test:** Check Tauri configuration for media/blob URL permissions

### Hypothesis 5: WebGL Texture Upload Failure
**Evidence:**
- Video element loads but doesn't appear visually
- `_tickVideoAnimations` runs but draws black
- Canvas drawImage may fail silently

**Test:** Add error handling around `uploadCtx.drawImage()`

---

## Working Reference: Git History

### When Video Support Was Added
```bash
# Video layer support added
9c90523 feat: add video layer support to Preset Studio editor with playback controls and 720p upload limit

# FFmpeg transcoding added (likely when bug introduced)
# videoTranscoder.js created
# @ffmpeg/ffmpeg and @ffmpeg/util added to package.json
```

### Recent Changes to Video Code
```bash
# Recent inspector.js changes
git log --oneline -- src/editor/inspector.js
# Recent visualizer.js changes  
git log --oneline -- src/visualizer.js
```

---

## Working Browser vs Broken macOS Comparison

| Aspect | Browser (Works) | macOS App (Broken) |
|--------|-----------------|-------------------|
| Video element creation | Same code | Same code |
| DOM append | Works | ? |
| Blob URL | Works | ? |
| playsInline | Not strictly required | Required |
| muted for autoplay | Not strictly required | Required |
| preload='auto' | Optional | Required |
| FFmpeg transcoding | Works | ? |

---

## Next Diagnostic Steps

### Step 1: Isolate Transcoding Variable
**Action:** Test with video UNDER 720p (no transcoding) vs OVER 720p (transcoding)  
**Expected:** If under 720p works, FFmpeg is the issue

### Step 2: Check Tauri CSP Configuration
**Action:** Review `src-tauri/tauri.conf.json` for CSP settings  
**Look for:** `dangerousUseHTTPScheme`, `csp` policy, `protocol` configuration

### Step 3: Test Blob URL Directly
**Action:** Create minimal test page that loads video from blob URL in WKWebView  
**Expected:** Confirm blob URLs work at all in Tauri WKWebView

### Step 4: Video Element State Inspection
**Action:** Add minimal logging to check:
- `videoElement.readyState`
- `videoElement.videoWidth/videoHeight`
- `videoElement.currentTime`
- `videoElement.paused`
- `videoElement.error`

### Step 5: WebGL Texture Debug
**Action:** Check if `_tickVideoAnimations` is:
- Being called
- Successfully drawing to uploadCanvas
- Successfully uploading to WebGL

---

## Questions to Answer

1. **Did video import EVER work in macOS build?** If yes, what commit broke it?
2. **Does transcoding happen for all videos or just large ones?**
3. **Is the video element actually playing?** (check `currentTime` advancing)
4. **Is the blob URL valid?** (try opening in new tab)
5. **Are there any console errors?** (check Tauri console)
6. **Does the uploadCanvas have valid dimensions?**
7. **Is the WebGL texture being updated?**

---

## Potential Fixes to Try

### Fix A: Disable Transcoding Test
Comment out transcoding logic, force all videos through non-transcoded path.

### Fix B: Tauri CSP Update
Update `tauri.conf.json` to allow blob URLs:
```json
"security": {
  "csp": "default-src 'self' blob: data:; media-src 'self' blob: data:;"
}
```

### Fix C: Video Element Cloning
Instead of reusing metadata-check video element, always create fresh one for playback.

### Fix D: FFmpeg Output Format
Check if FFmpeg output format is compatible with WKWebView (may need specific codec flags).

### Fix E: Fallback to Image
If video fails to load in WKWebView, extract first frame as image and display that.

---

## Notes

- Do NOT add excessive debug logging
- Make ONE change at a time
- Test both transcoded and non-transcoded paths
- Document results in this file
- When fixed, document root cause here for future reference
