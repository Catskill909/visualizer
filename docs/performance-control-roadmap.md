# Performance and Input Control Roadmap

Date started: 2026-05-05
Owner: Preset Studio team
Status: Active tracking doc

## 1) Purpose

This doc tracks session-level input and performance work for Preset Studio.

Scope:
- Input signal conditioning for control stability (not audio output processing)
- Runtime performance and responsiveness for live use
- Guardrails that keep visuals reactive under load

Out of scope:
- Preset creative design details (Palette/Motion/Wave/Image content)
- Image layer effect design changes
- Timeline-specific sequencing features

## 2) Product framing

Preset Studio is an input-driven visual instrument.

Global controls should optimize:
- Signal reliability from live sources
- Beat/energy detection quality
- Frame-time consistency and control responsiveness

Global controls should not be framed as audio mastering/output effects.

## 3) Architecture contract

1. Preset controls are preset-owned and saved with preset.
2. Image controls are layer-owned and saved with preset.
3. Global controls are session-only and never saved into preset payload.
4. Global controls may influence upstream detection quality, but must not mutate preset/image settings.

## 4) Baseline metrics to capture

Track these before and after each performance change:

1. FPS average and p95 frame time
2. Main-thread long frames (> 16.7 ms and > 33.3 ms)
3. Time-to-visible-reaction from transient hit (subjective + measured)
4. CPU usage trend during 5-minute live run
5. Memory growth trend during 5-minute live run
6. Reaction stability score in quiet/noisy input environments

## 5) KPI targets (initial)

1. p95 frame time <= 16.7 ms on target dev machine
2. No sustained frame drops below 50 FPS during normal editing
3. No unbounded memory growth during 10-minute session
4. Control-to-visual response perceived as immediate in live testing
5. Global tab defaults remain neutral/bypass

## 6) Global tab roadmap

## Phase A: Introduce Global tab and migrate existing global controls

Goal:
- Remove global semantics from creative tabs

Tasks:
- Add Global tab shell
- Move session-level controls there (AGC, input sensitivity, related calibration)
- Label all controls as session-only
- Keep defaults neutral

Exit criteria:
- Motion tab is preset-only
- Image tab remains unchanged
- Build passes and no regression in editor startup

## Phase B: Input calibration controls

Goal:
- Improve reliability across venues and devices

Candidate controls:
- Input gain trim
- Signal smoothing/stability
- Band weighting calibration (bass/mid/treble)
- Dead-zone/threshold tuning
- Quick reset to neutral

Exit criteria:
- Faster setup for live inputs
- Reduced false triggering in noisy environments

## Phase C: Runtime performance controls

Goal:
- Preserve responsiveness under load

Candidate controls:
- Analyzer quality mode
- Render quality mode
- Frame pacing options
- Performance-safe mode toggle

Exit criteria:
- Stable interaction under complex presets and image layers

## 7) Backlog tracker

Use this table for future work intake.

| ID | Area | Item | Benefit | Risk | Size | Status | Notes |
|----|------|------|---------|------|------|--------|-------|
| P-001 | Global Tab | Create tab + move session controls | Clarity, separation | Low | S | **Deferred — future session** | Motion/Image separation is now settled; ready to start |
| P-002 | Input | Add gain trim and neutral reset | Faster setup | Low | S | **Deferred — Phase B** | Default gain 1.0 |
| P-003 | Input | Add smoothing control | Less jitter | Medium | M | **Deferred — Phase B** | Must not add lag feel |
| P-004 | Detection | Band weighting calibration | Better musician control | Medium | M | **Deferred — Phase B** | Session-only |
| P-005 | Runtime | Add performance-safe mode | Stability under load | Medium | M | **Deferred — Phase C** | Include UI indicator |
| P-006 | Runtime | Add metric HUD summary in Global | Faster QA | Low | M | **Deferred — Phase C** | Reuse existing dev HUD signals where possible |

## 8) Experiment log template

Record each test run here:

- Date:
- Build/commit:
- Scenario (mic/file, preset type, image layers):
- Global settings used:
- Observed FPS/frame time:
- Observed responsiveness:
- Regressions found:
- Follow-up action:

## 9) Release gate for performance-related changes

Before shipping a Global/Input/Performance change:

1. Production build passes
2. Motion preset reactivity still works
3. Image reactivity still unchanged
4. Session defaults are neutral/bypass
5. No critical frame-time regression in smoke test

## 10) Session log

### Session: 2026-05-05 — Motion/Image reactivity separation

Status: Complete

What was done:
- Audited full execution paths for Image and Motion reactivity
- Established architecture contract: Image controls = image-layer-only, Motion controls = preset/MilkDrop-only
- Removed AGC, Energy, Bass Sensitivity from Motion tab (they were global engine conditioning, not preset-local)
- Added preset-only Motion reactivity UI: Source, Curve, and six modulation sliders (Zoom, Spin, Warp, Warp Speed, Drift H, Drift V)
- Implemented _buildRuntimePreset and frame_eqs injection so modulation runs at preset-eval level, not engine gain level
- Beat Sensitivity (b1ed) kept in Motion tab — it is preset-saved and belongs there
- Image tab and image-layer reactivity left completely untouched
- Production build passes, DOM smoke check passed

What was deferred:
- AGC toggle, Energy slider, Bass Sensitivity slider have no UI home (removed from Motion, not yet placed in Global)
- Global tab (Phase A) — full session required, deferred to next dedicated session
- Phase B (input calibration) and Phase C (runtime performance) — future sessions

Next session entry point:
- Start Phase A: Global tab shell in editor.html, migrate AGC/Energy/Bass Sensitivity controls there
- Label all Global controls as session-only
- Use release gate checklist in section 9 before shipping
