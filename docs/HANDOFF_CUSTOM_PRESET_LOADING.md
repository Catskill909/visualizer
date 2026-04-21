# Handoff: Custom Preset Loading in Main App

**Status:** Custom presets load into the preset registry and their names appear correctly in the drawer — but the visualizer does not change when one is clicked. No JS errors are thrown.

---

## What the app is

- Vite MPA: `index.html` (main app) + `editor.html` (Preset Studio)
- `src/visualizer.js` — `VisualizerEngine` wraps butterchurn
- `src/controls.js` — `ControlPanel` manages UI, preset drawer
- `src/customPresets.js` — CRUD: localStorage for preset JSON, IndexedDB for image blobs
- `src/editor/inspector.js` — editor panel, GLSL builder, saves presets
- butterchurn at `node_modules/butterchurn/lib/butterchurn.js` (minified bundle, no source maps)

---

## How custom presets work

### Storage
- Preset JSON saved to `localStorage["milkscreen_custom_presets"]` as `{ [id]: presetRecord }`
- Registry key format: `` `custom:${id}:${name}` ``
- Image blobs stored separately in IndexedDB `milkscreen_images`, keyed by `imageId`
- Preset's `images` array holds `[{ imageId, texName }]` — references, not blobs

### Preset record shape (what butterchurn needs)
```json
{
  "id": "mo8pe1v7",
  "name": "MyFirstPreset",
  "baseVals": { "zoom": 1.13, "rot": -0.07, "warp": 0.8, ... },
  "shapes": [],
  "waves": [],
  "warp": "",
  "comp": "uniform sampler2D sampler_userimgmo8pe1v7;\n shader_body {\n  vec2 uv_m = uv;\n  vec3 col = ...\n }",
  "init_eqs_str": "",
  "frame_eqs_str": "",
  "pixel_eqs_str": "",
  "images": [{ "imageId": "mo8pe1v7abc", "texName": "userimgmo8pe1v7" }]
}
```

### How butterchurn uses the preset
1. `butterchurn.loadPreset(preset, blendTime)` — sets internal state, compiles GLSL
2. Reads `preset.comp` → calls `getShaderParts(comp)` → splits at `shader_body {`
   - Everything before `shader_body` = `fragShaderHeaderText` (uniform declarations)
   - Everything inside `{ }` = `fragShaderText` (injected into `main()`)
3. Reads `preset.init_eqs_str`, `frame_eqs_str`, `pixel_eqs_str` → wraps in `new Function('a', str + " return a;")`
4. For user images: reads `fragShaderHeaderText` with regex `/uniform sampler2D sampler_(.+?);/g` → builds `userTextures` array → at render time calls `this.image.getTexture(userTexture.sampler)`
5. `loadExtraImages({ [samplerName]: { data: dataURL, width, height } })` populates `this.image.samplers[samplerName]` (the Image loads async via `onload`)

**Critical:** butterchurn never calls `gl.getShaderInfoLog()` — GLSL compile errors are 100% silent, no console output whatsoever.

---

## Current symptom

Clicking a custom preset in "My Presets" tab:
- Name updates in the title bar ✓
- Toast shows the preset name ✓
- Visualizer continues showing whatever was playing before ✗
- No errors in console ✗
- `[MilkScreen] Image bound: …` log does NOT appear (meaning `_bindCustomPresetImages` is not confirming a successful bind)

---

## Console output that was captured (pre-fix attempt)

The comp shader logged just before load looks valid:
```glsl
uniform sampler2D sampler_userimgmo8pe1v7;
 shader_body {
  vec2 uv_m = uv;
  vec3 col = texture(sampler_main, uv_m).xyz * 2.0;
  {
    float _spinAng = time * 0.8500;
    vec2 _u = uv_m - vec2(0.8958, (0.0615) - bass * 0.0200);
    ...
    vec2 _dx = dFdx(_u); vec2 _dy = dFdy(_u);
    _u = fract(_u + 0.5);
    vec4 _t = textureGrad(sampler_userimgmo8pe1v7, _u, _dx, _dy);
    vec3 _src = _t.xyz;
    float _op = _t.w * _gapMask * clamp(1.0000 + bass * 0.0000, 0.0, 1.0);
    col = mix(col, _src, _op);
  }
  ret = col;
 }
```

The `warp` field is `""` (empty string — valid, butterchurn uses a default warp when empty).

---

## What has been tried and ruled out

| Attempt | Outcome |
|---|---|
| `init_eqs_str` / `_str` field names fix | Fixed JS SyntaxError ("Unexpected token 'return'") — no longer errors |
| `try-catch` + `JSON.parse(JSON.stringify(preset))` deep-clone | No exception thrown — confirmed |
| `_bindCustomPresetImages` called after load | Images may not be in butterchurn's texture registry when first frame renders |
| `loadPreset` made `async`, images bound BEFORE butterchurn.loadPreset | Latest attempt — `Image bound:` log not appearing in latest session |
| `blendTime` forced to `0` for custom presets | Latest attempt — avoids 2s fade that made preset appear unchanged |

---

## Current code state (as of this handoff)

### `src/visualizer.js` — `loadPreset`
```js
async loadPreset(name, blendTime = 2.0) {
  const preset = this.presets[name];
  if (!preset) return false;

  this.currentPresetIndex = this.presetNames.indexOf(name);

  if (name.startsWith(CUSTOM_PREFIX)) {
    await this._bindCustomPresetImages(preset);  // binds images BEFORE load
    blendTime = 0;  // instant switch
  }

  try {
    this.visualizer.loadPreset(JSON.parse(JSON.stringify(preset)), blendTime);
  } catch (e) {
    console.warn('[MilkScreen] loadPreset failed:', e.message, e);
    return false;
  }
  return true;
}
```

### `src/visualizer.js` — `_bindCustomPresetImages`
```js
async _bindCustomPresetImages(presetRecord) {
  const images = presetRecord.images || [];
  if (images.length === 0) return;
  for (const img of images) {
    if (!img.imageId || !img.texName) continue;
    try {
      const blob = await getImage(img.imageId);
      if (!blob) {
        console.warn('[MilkScreen] Image not found in IndexedDB:', img.imageId, '(texName:', img.texName + ')');
        continue;
      }
      const dataURL = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = (e) => res(e.target.result);
        reader.onerror = rej;
        reader.readAsDataURL(blob);
      });
      const imgEl = await new Promise((res, rej) => {
        const el = new Image();
        el.onload = () => res(el);
        el.onerror = rej;
        el.src = dataURL;
      });
      this.setUserTexture(img.texName, { data: dataURL, width: imgEl.naturalWidth, height: imgEl.naturalHeight });
      console.log('[MilkScreen] Image bound:', img.texName, imgEl.naturalWidth + 'x' + imgEl.naturalHeight);
    } catch (e) {
      console.warn('[MilkScreen] Failed to bind image for', img.texName, e.message);
    }
  }
}
```

### `src/visualizer.js` — `setUserTexture`
```js
setUserTexture(name, texObj) {
  if (!this.visualizer) return;
  try {
    if (typeof this.visualizer.loadExtraImages === 'function') {
      this.visualizer.loadExtraImages({ [name]: texObj });
    }
  } catch (e) {
    console.warn('[MilkScreen] setUserTexture failed:', e.message);
  }
}
```

### `src/customPresets.js` — `createCustomPreset`
Saves the correct field names that butterchurn reads:
```js
export function createCustomPreset({
  name, baseVals = {}, shapes = [], waves = [],
  warp = '', comp = '',
  init_eqs_str = '', frame_eqs_str = '', pixel_eqs_str = '',
  images = [], parentPresetName = null,
}) { ... }
```

### `src/controls.js` — preset click handler
```js
li.addEventListener('click', async () => {
  await engine.loadPreset(name, 2.0);
  this.updatePresetName(name);
  this.showToast('🎨 ' + this.truncate(engine.displayName(name), 50));
  els.presetList.querySelectorAll('li.active').forEach(el => el.classList.remove('active'));
  li.classList.add('active');
});
```

---

## Leading hypotheses for what is still broken

### Hypothesis 1 — GLSL silent compile error (most likely)
butterchurn injects `fragShaderText` into this template:
```glsl
void main(void) {
  vec3 ret;
  vec2 uv = vUv;           // ← 'uv' already declared here
  vec2 uv_orig = vUv;
  uv.y = 1.0 - uv.y;
  uv_orig.y = 1.0 - uv_orig.y;
  float rad = length(uv - 0.5);
  float ang = atan(uv.x - 0.5, uv.y - 0.5);
  vec3 hue_shader = vColor.rgb;

  /* ← our fragShaderText goes here */

  fragColor = vec4(ret, vColor.a);
}
```

Our injected code declares `vec2 uv_m = uv;` inside the same `main()` scope — this is a NEW variable so there is no redeclaration conflict. However, `uv_m` uses `uv` which exists in the outer scope. This **should** work in GLSL ES 3.00.

**To verify:** Use WebGL's `gl.getShaderInfoLog(fragShader)` right after `gl.compileShader(fragShader)` in butterchurn. The easiest way without modifying butterchurn is to intercept `WebGL2RenderingContext.prototype.compileShader` from outside:

```js
// Paste in DevTools console BEFORE loading the preset:
const origCompile = WebGL2RenderingContext.prototype.compileShader;
WebGL2RenderingContext.prototype.compileShader = function(shader) {
  origCompile.call(this, shader);
  const log = this.getShaderInfoLog(shader);
  if (log && log.trim()) console.error('[GL SHADER ERROR]', log);
};
```

Then click the custom preset. If any GLSL error appears, that's the root cause.

### Hypothesis 2 — `blendTime=0` causes division by zero in butterchurn
In `Renderer.loadPreset`: `this.blendDuration = blendTime` then `blendProgress = (time - blendStartTime) / blendDuration`. When `blendDuration=0`, this is `0/0 = NaN` or `x/0 = Infinity` depending on the elapsed time.

Butterchurn checks `if (blendProgress > 1.0) this.blending = false`. `NaN > 1.0` is **false**, so blending never turns off → the renderer stays in permanent blend state → `prevCompShader.renderQuadTexture(false, ...)` keeps rendering the old preset at full opacity.

**To fix:** Pass `blendTime = 0.001` instead of `0`, or skip butterchurn's `loadPreset` entirely and call `this.visualizer.renderer.compShader.updateShader(preset.comp)` directly.

### Hypothesis 3 — `loadExtraImages` image loads async, then butterchurn.loadPreset resets texture slots
Even though we await `_bindCustomPresetImages` before calling `butterchurn.loadPreset`, butterchurn's internal `loadPreset` calls `this.warpShader.updateShader(warpText)` and `this.compShader.updateShader(compText)`, which calls `createShader()`, which calls `getUserSamplers()` and rebuilds `this.userTextures`. The old `samplers` dict in `this.image` is preserved (not wiped), so textures bound by `loadExtraImages` should still be there. **However**, there's a timing issue: `loadExtraImages` does `image.onload = () => { samplers[name] = ... }` — the Image `onload` fires asynchronously. Our `await` on `imgEl` only awaits the `img.src` load; `loadExtraImages` creates its OWN `new Image()` internally and that `onload` might fire AFTER `butterchurn.loadPreset` runs.

**To fix:** Bypass `loadExtraImages` and write directly to `this.visualizer.renderer.image.samplers[texName]` by pre-creating the WebGL texture yourself, or check if there's a synchronous path.

---

## Recommended debugging order

1. **First:** Run the WebGL shader log interceptor in DevTools console (Hypothesis 1). If you see a GLSL error, fix the GLSL.
2. **If no GLSL errors:** Try `blendTime = 0.001` instead of `0` (Hypothesis 2). Watch if the visualizer changes after ~1ms.
3. **If still nothing:** Add `console.log(this.visualizer.renderer?.image?.samplers)` right after `_bindCustomPresetImages` returns to see if the texture key exists. (Hypothesis 3)

---

## Editor vs. main app difference (why editor works)

The editor (`src/editor/inspector.js`) calls `_applyToEngine()`:
```js
_applyToEngine() {
  this._buildCompShader();
  this.engine.loadPresetObject(this.currentState, 0);  // blendTime=0 used here too
  for (const [name, texObj] of Object.entries(this._imageTextures)) {
    this.engine.setUserTexture(name, texObj);  // ← called AFTER loadPresetObject
  }
}
```
The editor keeps `this._imageTextures` in memory as `{ [texName]: { data: dataURL, width, height } }` populated when the user drags an image in. It calls `setUserTexture` after `loadPresetObject` and it works. This means either:
- The timing in the editor's `setUserTexture`-after-load pattern happens to work because the render loop doesn't run synchronously between those two lines
- OR the key difference is something else entirely

**Key test:** In the main app, try calling `engine.setUserTexture(texName, texObj)` AFTER `butterchurn.loadPreset` (i.e. same order as the editor) and see if that makes a difference vs. calling it before.

---

## File locations
- `src/visualizer.js` — VisualizerEngine class
- `src/customPresets.js` — storage layer
- `src/controls.js` — UI / preset drawer
- `src/editor/inspector.js` — EditorInspector class (reference: working texture binding)
- `node_modules/butterchurn/lib/butterchurn.js` — unminified butterchurn (no source maps but human-readable)
  - Line ~1237: `loadExtraImages` (image texture manager)
  - Line ~2379: `Renderer.loadPreset` (preset loading + shader compilation)
  - Line ~4117: `getShaderParts` (splits shader_body)
  - Line ~4298: `CompShader.createShader` (GLSL compilation — no error logging here)
  - Line ~6640: equation compilation via `new Function`
