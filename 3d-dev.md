# 3D Object Layer Integration (Three.js)

## Core Concept
The goal is to allow a single 3D object to be uploaded and manipulated as a layer in the Preset Studio. By rendering this 3D object to an offscreen canvas using Three.js, we can feed it directly into our existing 2D WebGL compositing pipeline. 

This means the 3D object instantly inherits all of our existing VJ effects (Chromatic Aberration, Hue Spin, Luma Key, Blur, Scanlines, etc.) for "free" on the GPU, without having to write custom 3D shaders.

## The Pipeline

1. **Upload & Validation**: 
   - Accept `.glb` and `.gltf` formats only. 
   - Enforce a strict `5MB` size limit to protect VRAM and load times.
   - Restrict to maximum **1** 3D layer per preset to protect Butterchurn's performance.

2. **The Three.js Engine**: 
   - Initialize a single, hidden `<canvas>` dedicated to Three.js.
   - Use Three.js `GLTFLoader` to parse the uploaded model.
   - Set up a basic scene: Orthographic or Perspective camera, and a directional light.

3. **Render Sync**: 
   - The Three.js scene renders the model to its canvas every frame.
   - In `visualizer.js` (or the compositing step), we treat the Three.js canvas exactly like a video or image layer. We pass the canvas as a texture into the GLSL shader.

## Three.js VJ Features (The "Wow" Factor)

Three.js gives us access to incredible built-in features that are perfect for audio visualization. We can add a "3D Controls" section to the layer when a `.glb` is uploaded:

- **Material Overrides**:
  - **Standard**: Use the model's embedded textures/colors.
  - **Wireframe**: Instantly convert any model into a glowing geometric wireframe (`material.wireframe = true`). Massive VJ aesthetic.
  - **Normal**: Assign `MeshNormalMaterial` to strip textures and render the object with psychedelic rainbow colors based on its surface angles.
  - **Basic / Flat**: Unlit colors for a sleek, graphic look.

- **Audio-Reactive 3D Transforms & Animations**:
  - **True 3D Expansion (Beat Scale)**: Unlike a 2D image which just gets wider/taller, changing the `scale.x/y/z` of a 3D mesh makes it physically inflate in 3D space. It pushes toward the camera, creating a genuine illusion of depth and physical mass reacting to the kick drum.
  - **Beat Spin (X/Y/Z)**: Map our audio reactivity (`_r` / Bass / Mid / Treble) to the physical rotation of the object. A logo flipping on its Y-axis on every snare hit.
  - **Audio-Driven Skeletal Animations**: Many `.glb` files contain built-in animations (e.g., a character running or a mechanical gear turning). Instead of playing them at a constant speed, we can tie the *animation playback speed* to the audio volume! When the beat drops, the character runs fast. In silence, they freeze. This connects the audio to the 3D object in an incredibly creative way.
  - **Audio-Reactive Lighting**: We could put a virtual spotlight inside the Three.js scene that only turns on when the kick drum hits. The object sits in darkness and flashes into full 3D lighting to the beat.

## Why This Works So Well

1. **Performance**: We only calculate 3D geometry once per frame on a separate canvas. The heavy compositing (aberration, distortion, blending over MilkDrop) happens in 2D space, which is what our engine is already optimized for.
2. **Ecosystem**: Three.js has massive community support. If we want to add particle emitters (to explode the 3D model) or simple physics later, the libraries already exist.
3. **Consistency**: The user experience remains the same. The 3D object behaves like an image layer that just happens to have real depth and lighting.

## Recommended Libraries & Ecosystem Upgrades

To make the 3D integration as polished as possible, we should consider these lightweight libraries:

- **GSAP (GreenSock)**: Used for "easing" and interpolation. When audio spikes, instead of the 3D object jittering wildly, GSAP smoothly interpolates the scale/rotation (e.g., `gsap.to(mesh.scale, {x: audio, duration: 0.1})`), turning a glitchy pulse into a buttery-smooth, heavy breathing effect.
- **Meyda (Advanced Audio Analysis)**: Right now, the app uses raw FFT (Fast Fourier Transform) data for Bass/Mid/Treble. Meyda extracts advanced acoustic features like **Spectral Flux** (which is vastly superior for detecting sharp snare/clap hits) and **Perceptual Spread**. 
  - *Note:* Meyda wouldn't just be for 3D! If we integrate it, we could expose Spectral Flux to the entire Preset Studio, allowing 2D image layers, shapes, and GIF playbacks to react to much tighter, more accurate beat detection.
- **Procedural Shader Materials**: Instead of loading heavy image textures for 3D objects, we can ship 4-5 built-in procedural materials (e.g., melting rainbow glass, digital matrix wireframe). These are generated entirely by math on the GPU, meaning they take up virtually 0 KB of storage and look incredibly premium.

## Implementation Steps (Roadmap)

- [ ] **Phase 1: Dependency & Setup**
  - Install Three.js (`npm install three`).
  - Create a `ThreeEngine` helper class to manage the hidden scene, camera, and renderer.

- [ ] **Phase 2: Upload & Storage**
  - Update `customPresets.js` to accept `.glb` files and store them as Blobs in IndexedDB (just like images/videos).
  - Add validation for the 5MB limit.

- [ ] **Phase 3: The Render Hook**
  - Hook the Three.js `render()` call into our main animation loop.
  - Ensure the Three.js canvas texture is passed to the WebGL compositor.

- [ ] **Phase 4: Controls & UI**
  - Add X/Y/Z continuous rotation sliders.
  - Add a dropdown for "Material Style" (Original, Wireframe, Normal Map).
  - Plumb the audio-reactive data into the Three.js mesh transforms.

## Open Questions for Prototyping
1. **Camera Setup**: Should we use an Orthographic camera (flat, 2D-style projection) or Perspective (true depth)? Perspective probably looks better for spinning objects.
2. **Lighting**: Do we bake a simple HDRI / ambient light into the scene, or just stick to unlit materials to save GPU cycles? (Wireframe and Normal materials don't require lighting, which makes them very cheap).
