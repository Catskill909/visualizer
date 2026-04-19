# Future Dev Features: Silent Disco Integration

Since DiscoCast (MilkScreen) is going to be bundled as a bonus software feature within a broader Silent Disco application suite, we have a unique opportunity to tailor the visualizer directly to the silent disco experience. 

Here is a brainstorming list of high-value features we could develop next:

## 1. 🎧 Multi-Channel Color Syncing
Silent discos famously use up to 3 channels (Red, Green, Blue) to represent different DJs or genres.
- **Channel Tinting:** Add a feature to force the visualizer's global color palette to tint towards Red, Green, or Blue to match the DJ currently playing the loudest or the "featured" DJ.
- **Channel Hotkeys:** Press `1` (Red), `2` (Green), or `3` (Blue) to instantly tint the screen or switch to a preset that heavily features that color.

## 2. 📡 Remote DJ Control (WebSockets)
The visualizer machine is often plugged into a projector away from the DJ booth.
- **Remote App:** Build a tiny companion web app (or integrate into your main app) that connects to the visualizer via WebSockets.
- **Trigger Effects:** Allow the DJ to remotely change presets, trigger the "favorites" list, or hit a "Strobe" button from their phone/laptop during beat drops.

## 3. 💬 Live Scrolling Message Overlay
A great utility for event organizers.
- **Marquee Text:** A UI feature to type a message (e.g., *"Switch to the Blue Channel!"*, *"Last call at the bar!"*, *"Happy Birthday Sarah!"*) and have it scroll across the top or bottom of the visualizer canvas.
- **Customization:** Configurable font, size, speed, and neon glow.

## 4. 🎭 Brand Watermarking & Sponsor Overlays
Silent disco companies often run private or corporate events.
- **Floating Logos:** Allow event organizers to upload a corporate logo or sponsor logo.
- **Modes:** Choose between a static corner watermark or a floating "DVD screensaver" style bounce that reacts to the music's bass.

## 5. ⚡ "Hype" Moment Overrides
Visuals should match the energy of the crowd.
- **Strobe Override:** Holding a spacebar or a specific key flashes the screen pure white to the beat of the music.
- **Blackout:** Instantly cut to black for dramatic build-ups, releasing back into intense visuals on the drop.
- **Intensity Slider:** A master control slider that forces Butterchurn to multiply the motion and warp speeds by 2x for high-energy tracks.

## 6. 🗂️ Genre-Based Preset Playlists
Not all presets fit all music. A slow acoustic set shouldn't have hyper-flashing visuals.
- **Playlists:** Expand the "Favorites" system into multiple custom lists (e.g., "EDM Bangers", "Chill House", "Hip Hop").
- **Auto-BPM Detection:** (Advanced) Analyze the incoming live audio to guess the BPM and automatically filter out presets that are moving too fast or too slow for the current track.

## 7. 📸 Photo Booth / Screenshot Mode
- Add a "Snap" button or shortcut that takes a high-res screenshot of the current visual frame and saves it to the local machine, perfect for social media marketing of the event.
