# Live Audio Device Selection: Brainstorming & Options

Adding support for external audio inputs (like a USB DJ Controller, audio interface, or line-in) requires interfacing with the browser's audio hardware access. 

We want to evaluate whether we should use an existing NPM package or build it natively (from scratch) using the browser's built-in APIs.

---

## Option 1: Native Web Audio API (Vanilla JS)
The modern browser already provides a built-in API specifically for this: `navigator.mediaDevices.enumerateDevices()`. 

**How it works:** 
We write ~15 lines of JavaScript to fetch the list of connected devices and push them into an HTML `<select>` dropdown. When the user changes the dropdown, we tell the visualizer to switch audio streams.

*   **Pros:** 
    *   **Zero Dependencies:** Adds 0 bytes to our app size. Extremely lightweight.
    *   **Perfect UI Integration:** We maintain 100% control over the styling, ensuring it perfectly matches our "Museum Black & White" glassmorphism aesthetic.
    *   **Direct Control:** No middleman code to debug if audio contexts get stuck.
*   **Cons:** 
    *   We have to write the HTML `<select>` and JS event listeners manually.

## Option 2: WebRTC / Audio Abstraction Packages (e.g., `recordrtc` or `Tone.js`)
There are packages designed to make working with microphones easier, often used for WebRTC audio/video chatting or complex music generation.

*   **Pros:** 
    *   Abstracts away some of the boilerplate `getUserMedia` code.
*   **Cons:** 
    *   **Overkill / Bloat:** These packages are designed for recording, streaming over the network, or synthesizing sound. Loading a 100kb+ library just to get a device list is incredibly inefficient.
    *   **No UI Included:** These libraries provide logic, not user interfaces. We would *still* have to build the dropdown UI from scratch.

## Option 3: Pre-built UI Components / Web Components
There are a handful of obscure NPM packages that provide a pre-built `<audio-device-select>` HTML tag.

*   **Pros:** 
    *   Literally drag-and-drop into HTML.
*   **Cons:** 
    *   **Styling Clashes:** They come with their own default CSS (usually looking like standard Bootstrap or generic web components). Overriding their shadow-DOM CSS to match our highly custom glassmorphism design would take *more* effort than just building it ourselves.
    *   **Framework Lock-in:** Many of the best pre-built selectors are made exclusively for React or Vue. Our app is pure Vanilla JavaScript, so we can't use them without rewriting the app in a framework.

---

## Recommendation & Conclusion
**We should build it from scratch using the Native API (Option 1).**

Because our app is written in extremely lightweight, highly customized Vanilla JS, bringing in a package would actually cause *more* work and bloat. 

The native `enumerateDevices()` API is modern, simple, and standard across all browsers. Building it ourselves ensures:
1. The bundle size stays incredibly small for Coolify deployment.
2. The UI dropdown matches the premium dark-mode aesthetic perfectly.
3. We don't inherit any unnecessary recording/streaming bloat.
