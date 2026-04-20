# Controls Styling Specification
## Modern Black & White Museum Aesthetic

### Design Philosophy
- **Minimalist Approach**: Clean, uncluttered interface with maximum contrast
- **Museum-like Feel**: Timeless elegance, focus on content over decoration
- **High Contrast**: Pure black backgrounds with crisp white elements
- **Subtle Interactions**: Minimal hover states that maintain the monochromatic theme

### Color Palette
- **Background**: `#000000` (Pure Black)
- **Primary Elements**: `#FFFFFF` (Pure White)
- **Secondary/Disabled**: `#666666` (Medium Gray - 40% opacity)
- **Hover State**: `#FFFFFF` with subtle `rgba(255,255,255,0.1)` overlay
- **Active State**: `#FFFFFF` with subtle `rgba(255,255,255,0.2)` overlay

### Typography
- **Font Family**: System UI, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto
- **Font Weight**: 300 (Light) for body, 500 (Medium) for controls
- **Text Color**: `#FFFFFF` (Pure White)
- **Disabled Text**: `#666666` (Medium Gray)

---

## Component Specifications

### 1. Playback Controls
#### Play/Pause Button
- **Background**: Solid black `#000000`
- **Icon**: White SVG, stroke width 1.5px
- **Size**: 48px × 48px
- **Border**: None (clean edge)
- **Hover**: Subtle white glow `rgba(255,255,255,0.1)`
- **Active**: Slightly more intense glow `rgba(255,255,255,0.2)`

#### Control Buttons (Previous, Next, Shuffle, etc.)
- **Background**: Transparent
- **Icon**: White SVG, stroke width 1px
- **Size**: 32px × 32px
- **Padding**: 8px
- **Hover**: Icon becomes `#FFFFFF` with subtle glow
- **Active**: Icon scale 1.05 with glow

### 2. Progress Bar
#### Track Progress
- **Background**: Black `#000000`
- **Progress Fill**: White `#FFFFFF`
- **Scrubber**: White circle, 12px diameter
- **Height**: 4px
- **Hover**: Scrubber grows to 16px
- **Border**: None

### 3. Time Display
#### Current/Total Time
- **Background**: Transparent
- **Text**: White `#FFFFFF`
- **Font Size**: 14px
- **Font Weight**: 300 (Light)
- **Format**: "MM:SS / MM:SS"

### 4. Tracklist/Queue
#### Track Items
- **Background**: Black `#000000`
- **Current Track**: Subtle white border-left, 3px width
- **Text**: White `#FFFFFF`
- **Font Size**: 14px
- **Padding**: 12px 16px
- **Hover**: Background `rgba(255,255,255,0.05)`
- **Active**: Background `rgba(255,255,255,0.1)`

#### Track Name
- **Font Weight**: 500 (Medium)
- **Color**: `#FFFFFF`

#### Artist Name
- **Font Weight**: 300 (Light)
- **Color**: `#CCCCCC` (80% white)

### 5. Sidebar Elements
#### Track Info
- **Background**: Black `#000000`
- **Text**: White `#FFFFFF`
- **Icons**: White SVG
- **Font Size**: 14px

#### Logo/Image
- **Background**: Black
- **Border**: 1px solid `#333333` (20% white)
- **Padding**: 12px

---

## Icon Specifications

### Icon Style Guidelines
- **Stroke Weight**: 1.5px for primary icons, 1px for secondary
- **Line Caps**: Round for softer, modern feel
- **Fill**: None (stroke-only for cleaner look)
- **Size Consistency**: Maintain consistent visual weight across all icons

### Required Icons
1. **Play**: Triangle pointing right
2. **Pause**: Two vertical bars
3. **Previous**: Triangle pointing left with vertical bar
4. **Next**: Triangle pointing right with vertical bar
5. **Shuffle**: Crisscross arrows
6. **Repeat**: Circular arrow
7. **Microphone**: Classic mic shape
8. **File**: Document outline
9. **List**: Horizontal lines
10. **Fullscreen**: Expand arrows
11. **Music Note**: Single note shape

---

## Interaction States

### Hover Effects
- **Buttons**: Subtle white glow `rgba(255,255,255,0.1)`
- **Icons**: Scale 1.05 with glow
- **Track Items**: Background overlay `rgba(255,255,255,0.05)`

### Active/Pressed States
- **Buttons**: More intense glow `rgba(255,255,255,0.2)`
- **Icons**: Scale 0.95 then back to 1.0
- **Track Items**: Background overlay `rgba(255,255,255,0.1)`

### Disabled States
- **Icons/Text**: `#666666` (40% opacity)
- **Buttons**: No hover effect
- **Interactions**: Disabled

---

## Layout & Spacing

### Control Panel
- **Height**: 80px
- **Padding**: 16px 24px
- **Gap**: 16px between elements

### Tracklist
- **Item Height**: 48px
- **Padding**: 12px 16px
- **Gap**: 1px between items

### Sidebar
- **Width**: 240px
- **Padding**: 16px
- **Gap**: 16px between elements

---

## Implementation Notes

### CSS Variables
```css
:root {
  --bg-primary: #000000;
  --text-primary: #FFFFFF;
  --text-secondary: #CCCCCC;
  --text-disabled: #666666;
  --hover-subtle: rgba(255,255,255,0.05);
  --hover-medium: rgba(255,255,255,0.1);
  --hover-strong: rgba(255,255,255,0.2);
  --border-subtle: #333333;
}
```

### Accessibility
- **Contrast Ratio**: All text meets WCAG AAA standards (21:1)
- **Focus States**: White outline, 2px width
- **Keyboard Navigation**: All controls accessible via tab
- **Screen Readers**: Proper ARIA labels for all controls

### Performance
- **SVG Icons**: Use inline SVGs for crisp rendering
- **CSS Transitions**: Smooth 200ms transitions for hover states
- **GPU Acceleration**: Use transform for scale animations
- **Minimal JavaScript**: Rely on CSS for most interactions

---

## Next Steps
1. Create SVG icon library in white
2. Implement CSS variables and base styles
3. Update each component with new styling
4. Test contrast and accessibility
5. Refine hover states and transitions

---

## Updates — 2026-04-19 Session

### Switch Component (replaces checkboxes)
All boolean toggles in the Cycle and Audio Tuning popovers now use a custom Material-style switch rather than native `<input type="checkbox">` defaults.

**Markup:**
```html
<label class="switch">
  <input type="checkbox" id="..." />
  <span class="switch-track"></span>
</label>
```

**Spec:**
- Track: 40×22 pill, `rgba(255,255,255,0.12)` off / `var(--text-primary)` on.
- Thumb: 14px off-state → 16px on-state, slides 18px, flips to `var(--bg-primary)` for contrast on the active track.
- Hover: 6px soft halo around the thumb.
- Focus: 2px outline in `var(--accent-glow)`.
- Disabled: 0.4 opacity, `not-allowed` cursor.

**Row layout (`.switch-row`):**
Label left, switch right, `space-between`. Adjacent rows are separated by a `border-top` in `--border-subtle` for a settings-list feel.

### Engaged-State Auto-Hide
The control bar's 3-second fade now pauses while the user is "engaged":
- Hovering over `#control-bar` (tracked via `mouseenter`/`mouseleave`).
- Any popover open: cycle, audio tuning, preset drawer, keyboard guide.

When the user dismisses a popover (click outside or close), the 3s timer restarts. A `pointerdown` listener on `document` closes an open cycle or tuning popover when the click lands outside the popover and its trigger button.

### Active-Button Treatment
`.ctrl-btn.accent` (used for the active cycle button and the active audio source) no longer renders a white border or drop-shadow glow. The active state is now a subtle `rgba(255,255,255,0.08)` background tint only — keeping the bar visually quiet during live performance.

### Removed Controls
- **MAX BOOST** button in the Audio Tuning popover — redundant with the `Shift` key, which is preferable because it fires silently without revealing the UI.
- **Next Preset Now** button in the Cycle popover — redundant with the transport arrows and the `→` key.
