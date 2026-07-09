# Score Tab & Overlay Panel — Design

**Date:** 2026-07-10
**Status:** Approved, ready for implementation planning
**Touches:** `public/index.html` only (single-file app, no build step)

## Summary

Replace the SCORES tab's `SHOW OVERLAY` switch — which today toggles a full-area, click-through HUD — with a draggable 20×50 ghost tab docked to the edge of the app column. Tapping the tab opens a frosted, touch-capturing panel showing the score currently selected in SCORES, at that score's saved text size. A ✕ at the panel's top right closes it back to the tab.

## Current behaviour (what we are replacing)

- `#scorePanelWrap` → `.score-panel` → `#scoreOverlayText` is `position:fixed`, `pointer-events:none`, spanning `top:56px left:12px right:12px bottom:16px`, capped at `max-width:448px`.
- Visibility is gated by `#app.score-open`, flipped by `scoreToggleOverlay()` from the `SHOW OVERLAY` switch (`#scoreOverlayToggle`) on the SCORES page.
- `posc_ui` holds `{activeId, overlayOn}`.
- There is no handle, no close affordance, and no drag.

`scoreRefreshOverlay()` — which writes the active score's text and font size into `#scoreOverlayText` on every keystroke, score load, and size change — already implements the "sync with the SCORES tab" requirement and is kept unchanged.

## Design decisions

| Decision | Choice |
|---|---|
| Drag axis | Free drag; on release, snap to nearest side edge, keep the drop height |
| Panel pointer events | Captures touches (scrollable, selectable) |
| What the toggle controls | Tab visibility only — the panel opens only by tapping the tab |
| Panel extent | Module area only; tab bar stays live above it |
| On the SCORES page | Tab and panel are both suppressed |
| Tab look | Ghost: translucent, sage hairline, four text-rules glyph |
| Panel look | Frosted (today's material), with a softened border |
| Code shape | Two elements, flat `scoreTab*()` functions, `posc_ui` for state |

## Elements

Both are absolutely-positioned children of `#app` (already `position:relative`), so they dock to the 480px app column, not the viewport.

### `#scoreTab` — the collapsed ghost

- 20×50, `background:rgba(248,244,235,.35)`, `border:1px solid #c2ccb6` with the docked side's border removed, `border-radius:0 3px 3px 0` (mirrored when docked right).
- Glyph: four stacked 1px `#a0ad95` rules, 9/9/9/6 px wide — a miniature of lines of text.
- Touch target: `::before{content:'';position:absolute;inset:-13px -12px}` yields 44×76 of hit area with no visual change.
- `touch-action:none`, `z-index:140`.
- Hidden (`opacity:0; pointer-events:none`) while the panel is open, with a 0.18s fade.

### `.score-panel` — the opened panel

- Converted from `position:fixed` to `position:absolute`; same insets (`top:56px left:12px right:12px bottom:16px`, `max-width:448px`, `margin:0 auto`) so the geometry is unchanged. Auto margins still centre it because `left` and `right` are both set and `max-width` resolves the width.
- `pointer-events:auto` (was `none`).
- Material: keeps `background:rgba(255,255,255,.72)` and `backdrop-filter:blur(2px)`. Border softens from `rgba(0,0,0,.3)` to `rgba(0,0,0,.18)`; radius goes 4px → 6px.
- `z-index:150`. Opens with a 0.14s `opacity 0→1, scale .985→1`.
- `#scoreOverlayText` becomes the scroll container: `height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch; touch-action:pan-y; -webkit-user-select:text; user-select:text`.

### `.score-close` — the ✕

- 30×30, absolute at `top:6px right:6px`, `border-radius:50%`, `background:rgba(255,255,255,.85)`, `border:1px solid rgba(0,0,0,.12)`, glyph `✕` 13px in `#7a8c6e`, `z-index:2`.
- The cream halo keeps score text legible where it scrolls underneath.
- The ✕ is the only dismiss target. The 12px gutter around the panel does not close it.

### Visibility classes on `#app`

| Class | Meaning |
|---|---|
| `score-tab-on` | Ghost tab is showing |
| `score-open` | Panel is showing (tab hidden) |
| `on-scores` | Tab suppressed (set by `switchTab` when `t==='scores'`) |

`#scorePanelWrap` remains the `display:none` / `display:block` gate for the panel, driven by `score-open`.

**Navigating to SCORES closes the panel** — `switchTab('scores')` clears `score-open` outright rather than merely hiding it. Returning to a module therefore shows the ghost tab, not a panel that reappears over an instrument you didn't ask it to cover. `on-scores` then only has to suppress the tab.

The tab additionally requires an active score to exist: when `scoreActiveId == null`, it stays hidden even if `score-tab-on` is set, because there would be nothing to open. An active-but-empty score still shows the tab; the panel then reads `(empty score)`, as today.

## State

All state rides in the existing `posc_ui` localStorage key:

```js
{ activeId, tabOn: bool, side: 'l' | 'r', tabY: 0..1 }
```

- `tabOn`, `side`, and `tabY` persist across reloads.
- `tabY` is stored as a **fraction of the available vertical travel**, not as pixels, so it survives rotation and resize.
- The panel always starts **closed** on load. Restoring an open panel over a module the performer hasn't touched yet would be a surprise.

### Migration

Existing installs have `{activeId, overlayOn}`. On first read in `renderScores()`: if `tabOn` is `undefined` and `overlayOn` is present, set `tabOn = !!overlayOn`, delete `overlayOn`, and write back. Anyone who had the overlay switched on gets the tab switched on.

## SCORES page changes

- `#scoreOverlayToggle` → `#scoreTabToggle`, label `SHOW OVERLAY` → `SHOW SCORE TAB`.
- `scoreToggleOverlay()` → `scoreToggleTab()`: flips `#app.score-tab-on`, mirrors the switch's `.on` class, persists `tabOn`.
- `renderScores()` restores `tabOn`, `side`, `tabY` and runs the migration above.
- `scoreDelete()` must re-evaluate tab visibility: deleting the last score leaves `scoreActiveId == null`, which hides the tab.

## Drag mechanics

Pointer events with `setPointerCapture`, following the existing precedent at `public/index.html:1846` (`#bbTempoWheel`).

1. **`pointerdown`** — capture the pointer, record origin `(x, y)`, clear a `dragged` flag, drop the snap transition.
2. **`pointermove`** — once the pointer has travelled more than **6px** from the origin, set `dragged = true`. While dragging, `left` tracks the finger freely; `top` is clamped between the measured bottom of `.tabs` (`offsetHeight`, not a hardcoded 56 — the `env(safe-area-inset-top)` padding makes it vary by device) and the bottom of `#app`, each with an 8px margin.
3. **`pointerup`** — if `dragged`, choose `side` by which half of the column holds the tab's centre, re-apply a 0.18s transition, dock to that edge, and persist `side` + `tabY`. If not `dragged`, this was a tap: open the panel.

The `dragged` flag is what separates "hold and drag" from "click to open"; a 6px slop absorbs the finger tremor in a tap without swallowing a deliberate drag.

## Stacking fix (found while reading the code)

`.plus-menu` sits at `z-index:10`. The panel sits at `z-index:150`. Today the two never collide because the overlay is click-through; once the panel captures touches, opening the **+** menu while a score is open would drop the menu behind the panel.

Fix: `.tabs{position:relative; z-index:200}`. The bar and its dropdown then always float above the panel. In scope, one line, and it would otherwise ship as a mystery bug.

## Verification

jsdom harness, per the pattern already used in this project (Web Audio stubs, manual `requestAnimationFrame` flush, real `localStorage`; simulate reload by dumping `localStorage` from one JSDOM and pre-seeding a second). Assertions:

1. With `tabOn` true and a score present, `#scoreTab` is visible on a module page.
2. `switchTab('scores')` adds `on-scores` and clears `score-open`; neither tab nor panel renders. Returning to a module restores the tab, with the panel closed.
3. `tabOn` true but zero scores → tab hidden.
4. A `pointerdown` → `pointermove` of 3px → `pointerup` opens the panel (`#app.score-open`).
5. A `pointerdown` → `pointermove` of 12px → `pointerup` does **not** open the panel; it docks and persists `side`.
6. Dragging past the column midpoint sets `side:'r'`; releasing left of it sets `side:'l'`.
7. `tabY` clamps within `[tabsHeight+8, appHeight-50-8]` and round-trips through a simulated reload as a fraction.
8. Legacy `posc_ui = {activeId, overlayOn:true}` migrates to `tabOn:true` with `overlayOn` removed.
9. The panel is closed after a reload even when it was open before.
10. Panel text and `font-size` track the score selected in SCORES, live across `scoreOnInput()` and `scoreSetSize()`.
11. `.score-close` click clears `score-open` and restores the tab.
12. `scoreDelete()` of the last score hides the tab.

## Out of scope

- Tap-outside-to-dismiss (the ✕ is the only close affordance).
- Animating the tab into the panel as one morphing element.
- Any change to score storage (`posc_` records), the editor, or the size slider.
