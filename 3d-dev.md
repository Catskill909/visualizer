# 3D Object Layer Integration (Three.js)

## Core Concept
The goal is to allow a single 3D object to be uploaded and manipulated as a layer in the Preset Studio. By rendering this 3D object to an offscreen canvas using Three.js, we can feed it directly into our existing 2D WebGL compositing pipeline. 

This means the 3D object instantly inherits all of our existing VJ effects (Chromatic Aberration, Hue Spin, Luma Key, Blur, Scanlines, etc.) for "free" on the GPU, without having to write custom 3D shaders.

**Two modes, one layer.** A 3D layer renders either a **single object** or a **volumetric grid** — an X×Y×Z lattice of stacked cells, each holding a flat image/GIF plane or a mesh (see [Volumetric Grid](#volumetric-grid-stacked-layout)). Both use the *same* offscreen-canvas-as-texture integration; the grid is just what the Three.js scene happens to contain. It still counts as **one** 3D layer regardless of how many cells it draws.

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

## Volumetric Grid (Stacked Layout)

A 3D layer can arrange its content as a **stacked grid** — an X×Y×Z lattice of cells, the 3D analogue of 2D Grid mode (`tile-custom.md` §5). Picture a Rubik's cube: 4×4×4 cells stacked in real space, lit and occluding, so the volume reads as a solid object.

This is the feature that makes the 3D layer worth building. A flat 2D image stack **cannot** do it — flat cards have no depth, so a "stack" of them just hides the back rows behind the front. (This is exactly why the 2.5D parallax attempt — `tile-custom.md` §10.5 — was built and reverted.) Real perspective + lighting + a camera that can tilt is what makes a stack read as a stack.

### What a cell can hold

| Cell content | In the Three.js scene |
|---|---|
| Image / GIF | a flat **textured plane** at the cell's lattice position |
| `.glb` / `.gltf` mesh | the **real mesh**, instanced into every cell |
| Built-in primitive (cube, …) | a primitive mesh — the literal Rubik's-cube look, no upload needed |

A textured plane is just a flat mesh, so Three.js draws image cells and mesh cells with the *same* scene, camera, and light. **One renderer for every cell type** — which is *why* image-cell stacking must live here and not in the 2D tile shader (the 2D shader has no Z axis and cannot draw a `.glb` at all).

### v1 scope — one source, tiled

The grid tiles **one** uploaded image (or one mesh / primitive) across every cell — exactly as 2D Grid mode tiles one image. Per-cell *different* content (cell 5 = logo A, cell 8 = logo B) is **out of scope**: that is the hand-authored compositional editor already cut for 2D (`tile-custom.md` §5.8), and the same reasoning holds. Variety comes from procedural per-cell variance, not hand-authoring.

### Controls (in the 3D layer card)

- **Grid X / Y / Z** — integer steppers; the lattice size. Z is the new axis vs 2D's Cols×Rows.
- **Spacing** — gap between cells (per-axis or uniform).
- **Per-cell variance** — Size / Rotation / Opacity variance + **Seed + Lock**.
- **Cell content** — image / GIF / uploaded mesh / built-in primitive.

### Carries over from the 2D tile work — do not redesign

The per-cell vocabulary from 2D Phases 1–2 ports directly (`tile-custom.md` §10.2): variance sliders, Seed semantics, the `Cols × Rows` stepper UX → `X × Y × Z`. Rotation variance simply gains the extra two axes. Recursive subdivision (2D Phase 4) *could* extend to 3D later — note only, not v1.

### Performance

`InstancedMesh` — one geometry, N instances, **one draw call**. A 4×4×4 = 64-cell grid is trivial; 8×8×8 = 512 is still fine. The real cost ceiling is the uploaded mesh's polycount × instance count — keep the 5 MB model limit and spot-check dense grids before 1.0.

## Entry Point & UI Placement

The 3D layer is **just another layer** — added from the **Layers tab via a button**, the same way text layers are added today (the `✏️ Text` button → a sibling `🧊 3D` button). It then appears as a card in the layer stack alongside images / GIFs / videos / text, with solo / mute / reorder / rename like any layer.

- **No dedicated tab.** A 5th tab was considered and rejected: tabs are *scene-level* (Palette, Layers, Motion, Wave); a 3D object is *per-layer*, so its controls belong in its layer card — consistent with every other layer type.
- **Its own card layout.** The 3D card shows only 3D-relevant controls (rotation X/Y/Z, material, grid X/Y/Z, per-cell variance, camera). It is *not* the 2D image card with rows hidden — 2D-only controls (2D tile mode, skew / perspective, the 2D per-tile mirror) never appear.
- **Max one 3D layer per preset** still holds — a volumetric grid is internal to that one layer, not N layers.

### Camera — constrained (cross-ref `tile-custom.md` §10.1)

The camera is **pan + small tilt only — never a free orbit.** The slight tilt is what reveals the grid's volumetric depth. Keep two things distinct:

- **Object / grid spin** — *free* and audio-reactive (Beat Spin X/Y/Z, below). The object itself rotates; this is a creative feature.
- **Camera** — *constrained*. The viewpoint only nudges; the user never flies behind the stack.

Constraining the camera is also the performance win (`tile-custom.md` §10.1): a roughly stable viewpoint keeps depth-sort and culling predictable.

## Recommended Libraries & Ecosystem Upgrades

To make the 3D integration as polished as possible, we should consider these lightweight libraries:

- **GSAP (GreenSock)**: Used for "easing" and interpolation. When audio spikes, instead of the 3D object jittering wildly, GSAP smoothly interpolates the scale/rotation (e.g., `gsap.to(mesh.scale, {x: audio, duration: 0.1})`), turning a glitchy pulse into a buttery-smooth, heavy breathing effect.
- ~~**Meyda (Advanced Audio Analysis)**~~ — **evaluated and not adopted.** Meyda's headline feature, Spectral Flux transient detection, already shipped DIY as the **Flux** audio source in the Preset Studio — and it is already available to every reactive control (2D layers, shapes, GIFs, and the 3D layer alike). Do **not** add the Meyda dependency; the win is already banked. (See the v1 scope notes in `tile-custom.md` / README.)
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
  - Add the 3D layer entry point — a `🧊 3D` button in the Layers tab, next to `✏️ Text`.
  - Give the 3D layer its own card layout (3D-only controls — see [Entry Point & UI](#entry-point--ui-placement)).
  - Add X/Y/Z continuous rotation sliders.
  - Add a dropdown for "Material Style" (Original, Wireframe, Normal Map).
  - Plumb the audio-reactive data into the Three.js mesh transforms.

- [ ] **Phase 5: Volumetric Grid**
  - X/Y/Z lattice via `InstancedMesh`; one source tiled across all cells.
  - Per-cell variance (Size / Rotation / Opacity + Seed) ported from 2D Phases 1–2.
  - Image-plane cells and mesh cells; optional built-in primitives (cube first).
  - Constrained camera (pan + small tilt) so the stacked depth reads.

## Open Questions for Prototyping
1. **Camera Setup**: Use a **Perspective** camera — Orthographic would flatten the volumetric grid and kill the depth read. The camera is **constrained** to pan + small tilt, never a free orbit (`tile-custom.md` §10.1).
2. **Lighting**: Do we bake a simple HDRI / ambient light into the scene, or just stick to unlit materials to save GPU cycles? (Wireframe and Normal materials don't require lighting, which makes them very cheap — but a *grid* needs real lighting for the stack to read as solid; unlit cells look flat.)
3. **Grid primitives**: Which built-in primitives ship for grid cells? Cube is the minimum (the Rubik's-cube look with no upload); sphere / plane likely follow.
4. **Grid spacing**: Per-axis spacing (independent X/Y/Z gaps) or a single uniform gap? Uniform is simpler; per-axis enables flatter "wall" vs deep "tunnel" stacks.
5. **Grid source**: How is the single tiled source chosen — reuse the existing image-upload UX for image cells, plus a primitive picker for mesh cells?
