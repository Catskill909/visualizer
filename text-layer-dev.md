# Text Layer Feature — Brainstorm & Planning Document

> **Status:** 📋 Brainstorming / Planning Phase  
> **Date:** May 7, 2026  
> **Goal:** Design text layer system with WYSIWYG editing, Google Fonts, and reusable effects

---

## 1. Executive Summary

Text layers extend the visualizer's layer system (images, GIFs, videos) to support dynamic typography. Unlike traditional "overlay text" approaches, text layers are first-class citizens in the compositing stack — they receive the same transforms, effects, and audio reactivity as image layers.

**Key insight:** Text = Images with a special content pipeline. The same GLSL compositing, transforms, and effects apply. The innovation is in the **content generation** (Canvas 2D text rendering with WYSIWYG editing) not the **rendering** (already solved).

---

## 2. User Experience Goals

### 2.1 WYSIWYG Text Editor

**The Core Interaction:**
1. Click "Add Text Layer"
2. See a textarea with live preview
3. Type text, hit Enter for new lines, use spaces freely
4. Text appears in the visualizer immediately
5. Select Google Font from dropdown
6. Apply same transforms/effects as image layers

**What makes it powerful:**
- Carriage returns and multiple spaces preserved (unlike typical web text inputs)
- Live preview as you type
- Full styling: font, size, color, weight, letter-spacing, line-height
- Text can be positioned, rotated, scaled, mirrored just like images

### 2.2 Text as Texture Pipeline

```
User types in textarea
         ↓
Canvas 2D renders text with styling
         ↓
Canvas → WebGL texture upload
         ↓
Standard layer compositing (same as images)
```

---

## 3. UI Design

### 3.1 Layer Card Layout (Collapsible — Same Pattern as Images/Videos)

Text layers follow the **same collapsible accordion pattern** as image and video layers:

```
┌─────────────────────────────────────┐
│  ✏️ Text Layer         [collapse ▼] │
├─────────────────────────────────────┤
│  THUMBNAIL PREVIEW (live canvas)    │
├─────────────────────────────────────┤
│  Content  ────────────────────────▶ │  ◄── Collapsible section
│  ┌─────────────────────────────┐    │
│  │ DISCO
CAST                 │◄───┼── Textarea (preserves \n and spaces)
│  └─────────────────────────────┘    │
├─────────────────────────────────────┤
│  Typography  ─────────────────────▶ │  ◄── Collapsible section
│  Font: [Roboto ▼] Size: [48 ─┬─]   │
│  Weight: [Bold ▼] Color: [#FFF ▓]  │
│  Align: [Center ▼]                 │
│  Letter: [0 ─┬─] Line: [1.2 ─┬─]   │
├─────────────────────────────────────┤
│  Effects  ────────────────────────▶ │  ◄── Collapsible section
│  [✓] Shadow  [ ] Glow  [ ] Outline │
│  Shadow: Blur[4] X[2] Y[2] [#000 ▓] │
├─────────────────────────────────────┤
│  Transforms  ─────────────────────▶ │  ◄── Collapsible section
│  Scale: [───●────] Pulse: [──●──]  │  ◄── Same as images/videos
│  Spin: [────●───] Orbit: [──●──]   │
│  Mirror: [None ▼] ...              │
├─────────────────────────────────────┤
│  Audio React  ────────────────────▶ │  ◄── Collapsible section
│  Pulse: [──●────] Source: [Bass ▼] │  ◄── Same as images/videos
│  Beat Fade: [●────────]            │
└─────────────────────────────────────┘
```

**Collapsed state:**
```
┌─────────────────────────────────────┐
│  ✏️ Text Layer         [expand ▶]   │
│  [thumbnail] DISCO CAST...          │
└─────────────────────────────────────┘
```

### 3.2 Font Selector (20 Curated Bundled Fonts)

**Searchable dropdown with preview:**
```
Font: [🔍 Search fonts...          ▼]
      ├─ Display (Bold/Impact)
      │  • Oswald
      │  • Bebas Neue
      │  • Anton
      │  • Montserrat
      │  • Raleway
      ├─ Clean/Modern
      │  • Inter
      │  • Roboto
      │  • Open Sans
      │  • Lato
      │  • Source Sans Pro
      ├─ Retro/Stylistic
      │  • Press Start 2P
      │  • VT323
      │  • Special Elite
      │  • Space Mono
      │  • Share Tech Mono
      └─ Stylish/Decorative
         • Playfair Display
         • Dancing Script
         • Pacifico
         • Lobster
         • Righteous
```

**Benefits of bundled fonts:**
- ✅ Works 100% offline (no internet required)
- ✅ Guaranteed on all platforms (macOS, Windows, web)
- ✅ No CSP issues or external dependencies
- ✅ ~4-5 MB total (woff2 compressed)
- ⚠️ Future: Google Fonts CDN can be added later as enhancement

### 3.3 Add Layer Dropdown (Unified Interface)

**Space-efficient dropdown pattern:**
```
[+ Add Layer ▼]
  ├─ 📷 Image from File
  ├─ 🎬 Video from File
  └─ ✏️ Create Text
```

**Why this works:**
- Single button fits tight space in dropzone
- Clear separation: "from File" vs "Create"
- Consistent with existing image/video picker pattern
- No confusion between file import and content creation

---

## 4. Technical Architecture

### 4.1 Text Layer Data Model

```javascript
const textLayerDefaults = {
    type: 'text',           // Distinguishes from image/video
    texName: 'usertext123',
    
    // Content
    text: 'Hello\nWorld',   // Raw text with newlines
    
    // Typography (20 curated bundled fonts)
    fontFamily: 'Inter',    // One of 20 bundled fonts
    fontSize: 48,           // px
    fontWeight: 'bold',     // normal | bold | 100-900
    color: '#FFFFFF',
    letterSpacing: 0,       // px (can be negative)
    lineHeight: 1.2,        // multiplier
    textAlign: 'left',      // left | center | right
    
    // Available bundled fonts:
    // Display: Oswald, Bebas Neue, Anton, Montserrat, Raleway
    // Clean: Inter, Roboto, Open Sans, Lato, Source Sans Pro
    // Retro: Press Start 2P, VT323, Special Elite, Space Mono, Share Tech Mono
    // Stylish: Playfair Display, Dancing Script, Pacifico, Lobster, Righteous
    
    // Effects (MVP: Shadow, Glow, Outline)
    textShadow: {
        enabled: true,
        color: '#000000',
        blur: 4,
        offsetX: 2,
        offsetY: 2
    },
    textGlow: {
        enabled: false,
        color: '#00FF88',
        blur: 12
    },
    textOutline: {
        enabled: false,
        color: '#000000',
        width: 2
    },
    // Future: gradientFill, textMask, etc.
    
    // Canvas dimensions (auto-calculated)
    canvasWidth: 512,       // Auto-sized to fit text
    canvasHeight: 256,
    
    // Reuse ALL image layer transforms
    scale: 0.6,
    opacity: 1.0,
    blendMode: 'overlay',
    spinSpeed: 0.00,
    orbitRadius: 0.00,
    cx: 0.50,
    cy: 0.50,
    mirror: 'none',
    // ... all other image layer properties
}
```

### 4.2 Canvas Text Rendering Engine

**Location:** `@/src/visualizer.js` — new `_renderTextTexture()` function

```javascript
_renderTextTexture(textLayer) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // 1. Measure text to determine canvas size
    ctx.font = `${textLayer.fontWeight} ${textLayer.fontSize}px ${textLayer.fontFamily}`;
    const lines = textLayer.text.split('\n');
    const maxWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
    const totalHeight = lines.length * (textLayer.fontSize * textLayer.lineHeight);
    
    // 2. Size canvas (power-of-2 for WebGL, or use POT wrapper)
    canvas.width = Math.max(64, Math.pow(2, Math.ceil(Math.log2(maxWidth + 20))));
    canvas.height = Math.max(64, Math.pow(2, Math.ceil(Math.log2(totalHeight + 20))));
    
    // 3. Apply background if enabled
    if (textLayer.background.enabled) {
        ctx.fillStyle = textLayer.background.color;
        roundRect(ctx, 0, 0, canvas.width, canvas.height, textLayer.background.cornerRadius);
        ctx.fill();
    }
    
    // 4. Configure text rendering
    ctx.font = `${textLayer.fontWeight} ${textLayer.fontSize}px ${textLayer.fontFamily}`;
    ctx.fillStyle = textLayer.color;
    ctx.textAlign = textLayer.textAlign;
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = `${textLayer.letterSpacing}px`;
    
    // 5. Apply shadow
    if (textLayer.textShadow.enabled) {
        ctx.shadowColor = textLayer.textShadow.color;
        ctx.shadowBlur = textLayer.textShadow.blur;
        ctx.shadowOffsetX = textLayer.textShadow.offsetX;
        ctx.shadowOffsetY = textLayer.textShadow.offsetY;
    }
    
    // 6. Draw text lines
    const lineHeightPx = textLayer.fontSize * textLayer.lineHeight;
    const startY = (canvas.height - (lines.length - 1) * lineHeightPx) / 2;
    
    lines.forEach((line, i) => {
        const x = textLayer.textAlign === 'center' ? canvas.width / 2 :
                  textLayer.textAlign === 'right' ? canvas.width - 10 : 10;
        const y = startY + i * lineHeightPx;
        
        // Optional: draw outline first
        if (textLayer.textOutline.enabled) {
            ctx.strokeStyle = textLayer.textOutline.color;
            ctx.lineWidth = textLayer.textOutline.width;
            ctx.strokeText(line, x, y);
        }
        
        ctx.fillText(line, x, y);
    });
    
    // 7. Return texture data
    return {
        data: canvas.toDataURL(),  // or canvas itself for direct texture upload
        width: canvas.width,
        height: canvas.height,
        isText: true,
        needsReRender: true  // Flag to know when to regenerate
    };
}
```

### 4.3 Bundled Font Loading Strategy

**Location:** `@/src/editor/main.js` or new text-layer module

Fonts are bundled as local `.woff2` files in `src/assets/fonts/` and loaded via CSS `@font-face`:

```css
/* In bundled CSS or injected style */
@font-face {
    font-family: 'Inter';
    src: url('/fonts/inter.woff2') format('woff2');
    font-weight: 100 900;
    font-display: swap;
}
/* Repeat for all 20 fonts */
```

```javascript
// Font availability check
async function ensureFontLoaded(fontFamily) {
    // All bundled fonts are pre-loaded via CSS
    // Just wait for the specific font to be ready
    await document.fonts.load(`16px "${fontFamily}"`);
}

// Pre-load critical fonts on app start
const CRITICAL_FONTS = ['Inter', 'Roboto', 'Oswald'];
await Promise.all(CRITICAL_FONTS.map(f => document.fonts.load(`16px "${f}"`)));
```

**Font file structure:**
```
src/assets/fonts/
├── inter.woff2           (~200 KB)
├── roboto.woff2          (~150 KB)
├── oswald.woff2          (~80 KB)
├── bebas-neue.woff2      (~60 KB)
├── ... (17 more fonts)
└── fonts.css             (@font-face declarations)
```

### 4.4 Text Texture Update Strategy

**Key decision:** When to re-render the canvas?

| Trigger | Action |
|---------|--------|
| Text content changes | Immediate re-render + texture upload |
| Font/size/color changes | Immediate re-render + texture upload |
| Position/scale/opacity changes | NO re-render (GLSL handles it) |
| Effects (pulse, spin, etc.) | NO re-render (GLSL handles it) |

**Optimization:** Text layers are "static content, dynamic transform" — expensive canvas render happens once, then cheap GLSL transforms every frame.

### 4.5 Integration with Existing Layer System

**Minimal changes needed:**

1. **Inspector.js**: Add `_addTextLayer()` method, similar to `_addImageLayer()`
2. **Inspector.js**: Add text controls to `_mountLayerCard()` with `if (entry.type === 'text')` blocks
3. **Visualizer.js**: Handle `isText` in `setUserTexture()` → call `_renderTextTexture()`
4. **Shader**: No changes — text uses same `_buildImageBlock()` as images
5. **Storage**: Text content stored as string in IndexedDB (tiny, unlike video blobs)

---

## 5. Feature Parity with Image Layers

### 5.1 Inherited Features (Free)

Text layers automatically get:
- ✅ Blend modes (overlay, screen, add, multiply, etc.)
- ✅ Opacity & opacity pulse
- ✅ Scale & audio pulse
- ✅ Spin, orbit, bounce, sway, wander
- ✅ Mirror (H/V/Quad/Kaleido)
- ✅ Chromatic aberration
- ✅ Posterize
- ✅ Shake
- ✅ Solo/Mute
- ✅ Center XY pad
- ✅ All audio reactivity (pulse, beat fade, etc.)

### 5.2 Text-Specific Features (New)

- ✅ Multi-line text with \n support
- ✅ Google Fonts integration
- ✅ Text shadow & outline
- ✅ Background box with padding
- ✅ Letter spacing & line height
- ✅ Text alignment (left/center/right)

---

## 6. UI Implementation Details

### 6.1 Textarea with Preserved Whitespace

```html
<textarea 
    class="text-layer-input"
    spellcheck="false"
    placeholder="Type your text here...">Hello
World</textarea>
```

```css
.text-layer-input {
    white-space: pre;           /* Preserve spaces and tabs */
    font-family: 'Courier New', monospace; /* Monospace for accurate preview */
    resize: vertical;
    min-height: 60px;
    background: rgba(0,0,0,0.3);
    border: 1px solid rgba(255,255,255,0.2);
    color: #fff;
    padding: 8px;
    border-radius: 4px;
    width: 100%;
}
```

### 6.2 Font Dropdown with Categories

```javascript
const FONT_CATEGORIES = {
    'Popular': ['Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Inter'],
    'Display': ['Oswald', 'Bebas Neue', 'Anton', 'Playfair Display'],
    'Handwriting': ['Pacifico', 'Dancing Script', 'Caveat', 'Satisfy'],
    'Monospace': ['Fira Code', 'JetBrains Mono', 'Source Code Pro', 'Space Mono'],
    'Retro': ['Press Start 2P', 'VT323', 'IBM Plex Mono', 'Special Elite']
};
```

### 6.3 Real-Time Preview

```javascript
// In inspector.js - text input handler
textInput.addEventListener('input', debounce(() => {
    entry.text = textInput.value;
    
    // Trigger texture re-render
    const texObj = this._imageTextures[entry.texName];
    if (texObj) {
        texObj.needsReRender = true;
        this.engine.setUserTexture(entry.texName, texObj);
    }
}, 150));  // 150ms debounce for typing
```

---

## 7. Storage & Persistence

### 7.1 Text Layer in Preset Export

```json
{
    "type": "text",
    "text": "DISCO\nCAST",
    "fontFamily": "Oswald",
    "fontSize": 64,
    "fontWeight": "bold",
    "color": "#00FF88",
    "letterSpacing": 4,
    "lineHeight": 0.9,
    "textAlign": "center",
    "textShadow": {
        "enabled": true,
        "color": "#000000",
        "blur": 8,
        "offsetX": 4,
        "offsetY": 4
    },
    "scale": 0.8,
    "opacity": 1.0,
    "blendMode": "add",
    "spinSpeed": 0.02,
    "orbitRadius": 0.15,
    "mirror": "quad"
}
```

**Note:** Text content is stored as string (tiny), not rasterized pixels. Font must be available or fallback applies.

### 7.2 Font Availability Handling

**Offline scenario:** If Google Fonts can't load:
- Fall back to system font stack
- Show warning: "Font unavailable, using fallback"
- Store user's font choice — attempt to load on next online session

---

## 8. Open Questions

1. ~~Font caching~~ ✅ SOLVED — All 20 fonts bundled locally, works 100% offline
2. **Google Fonts CDN:** Add as Phase 3 enhancement with bundled fallback?
2. **Text animation:** Should we support typing animation (characters appear one by one)?
3. **Scrolling text:** Should we support horizontal/vertical scrolling (marquee)?
4. **Emoji support:** Canvas 2D supports emoji — do we need special handling?
5. **Right-to-left:** Do we need RTL text support (Arabic, Hebrew)?
6. **Text stroke:** Outline effect using Canvas 2D `strokeText()` — performance impact?
7. **Curved text:** Path-based text following curves/circles — too complex for MVP?

---

## 9. Phased Implementation

### Phase 1: Core Text (MVP)
- [ ] Basic textarea with preserved whitespace
- [ ] Canvas 2D text rendering
- [ ] WebGL texture pipeline
- [ ] 20 bundled fonts (woff2 files in src/assets/fonts/)
- [ ] Basic styling: size, color, weight, align
- [ ] Text shadow
- [ ] Full transform/effects parity with images

### Phase 2: Typography Polish
- [ ] Letter spacing, line height
- [ ] Text outline (stroke)
- [ ] Text glow
- [ ] Background box with padding
- [ ] Recently used fonts
- [ ] Google Fonts CDN integration (with fallback to bundled)

### Phase 3: Text Animations
- [ ] Typing effect (character reveal)
- [ ] Scrolling/marquee
- [ ] Text fade in/out per line

---

## 10. Related Files for Implementation

| File | Role for Text |
|------|----------------|
| `@/src/editor/inspector.js` | Text UI, `_addTextLayer()`, text controls in `_mountLayerCard()` |
| `@/src/visualizer.js` | `_renderTextTexture()`, `setUserTexture()` text handling |
| `@/src/editor/main.js` | Font loading, Google Fonts API integration |
| `@/customPresets.js` | Text layer serialization/deserialization |

---

## 11. Success Metrics

- Text layer renders at 60fps alongside video/image layers
- Text updates visible within 200ms of typing
- Font loads and applies within 2 seconds of selection
- All image layer effects work identically on text

---

*Document created for brainstorming session. Text layers bridge the gap between static visuals and dynamic typography — opening up title cards, lyrics, artist names, and visual storytelling.*
