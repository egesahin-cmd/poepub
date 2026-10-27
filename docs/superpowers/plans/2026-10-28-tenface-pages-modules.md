# TENFACE pages + module lanes Implementation Plan

> Executed natively (executing-plans). Steps are RED → GREEN → commit.

**Goal:** 64-step patterns over 4 auto-following pages, and lanes that gate VOICE / MATHS / BIRDBOX / NOISE / TONE GEN with ADSR notes.

**Spec:** `docs/superpowers/specs/2026-10-28-tenface-pages-modules-design.md`

## Global Constraints
- Data length MAX = 64; the view is PAGE = 16 rows; the bar line stays 16 rate-1 steps.
- Lane and bus LENGTH run 8–64; the defaults stay 16.
- Notes are 1–16 rows long, never overlap, and never pass the lane length.
- ENV ranges: A 0–2000 ms, D 0–2000 ms, S 0–100 %, R 0–4000 ms. Default 10 / 200 / 70 / 300.
- Module colours:
  - voice `#d9a0d5`
  - multi `#9c342a`
  - birdbox `#2d6a4e`
  - noise `#000`
  - riser `#a0ad95`
- Never pkill Chrome or node, and leave the user's :3000 alone.

## Review Focus
1. An old 16-step save loads with its steps intact and is padded to 64.
2. A note that runs past a lowered LENGTH is clamped or dropped, and never plays past the loop.
3. A module switched on by hand is never switched off by TENFACE, including on stop.
4. A stop mid-note leaves no gate stuck at 0, so the module still sounds when switched on by hand later.
5. Back-to-back notes do not stutter the module (its off-timer is cancelled).

### Task 1: data + clock (pure)
Files: `public/js/tenface.js`, `test/tenface/core.test.js`, `test/tenface/timing.test.js`.
- Lane fields:
  - `mod` (null or one of MODS)
  - `notes` (64 entries: 0 or a length)
  - `env {a,d,s,r}`
  - `steps` grows to 64
  - `len` clamped 8–64
  - `busLen` clamped 8–64
- `normalize()` pads old saves, drops overlapping or too-long notes, and drops a module that is duplicated within a slot (the later lane loses it).
- Pure helpers `placeNote(notes, s, len, laneLen)`, `noteAt(notes, s)` (returns the start index or -1) and `deleteNote(notes, s)`, all clamped.
- Clock: a module lane emits `{lane, step, t, slot, len, kind:'note'}` at a note's start (`v` = len). Its `steps` are ignored while `mod` is set.
- Tests:
  - defaults have 64 steps;
  - a 16-step save is padded;
  - overlap and duplicate handling;
  - placeNote clamps to the next note, to 16 and to len;
  - the clock emits a note event at the note start, and a len-32 lane wraps at 32.

### Task 2: pages
Files: `tenface.js`, `tenface.css`, `test/tenface/ui.mjs`.
- `.tf-page[data-p]` 1–4 in the busbar, on the left.
- `view` = the page index; `follow` = true on play.
- The lead lane is the longest lane, or the leftmost on a tie. When its playhead changes page and `follow` is on, the view moves to that page.
- Tapping a page sets view = p and follow = (p === lead page while playing).
- Pages from `ceil(maxLen/16)` on are `.dis`.
- Cells keep `data-s` = the row (0–15) and add the step via `view*16 + row`. The index column shows the real step number.
- UI tests:
  - 4 page buttons bottom-left;
  - LENGTH 40 enables pages 1–3;
  - a tap on page 2 shows steps 17–32 and writes to `steps[16+row]`;
  - while playing with len 32, the view follows to page 2;
  - after a tap on page 1 it stays there.

### Task 3: module engine
Files: `tenface.js`, `public/index.html` (`rsGate`), `test/tenface/audio.mjs`.
- `MODS` table with these keys:
  - `isOn()`
  - `on()`
  - `off()`
  - `gate()` returns an AudioParam: `FX.ports(k).inp.gain`, or `rsGateNode().gain`
- `noteOn(lane, e)`:
  1. Hand wins: skip if `isOn()` and not owned.
  2. If not owned: set the gate to 0 now, call `on()`, mark it owned.
  3. ADSR on the gate.
  4. Re-arm the off-timer to fire at tOff+R.
- `stop()`: ramp owned gates to 0, then (after ~60 ms) `off()` and gate = 1.
- Audio tests:
  - gate values at t+A, mid-sustain and after the release;
  - the module is on during a note and off after it;
  - a module switched on by hand is left alone by notes and by stop;
  - after stop the gate is 1 and the module is off.

### Task 4: note grid + module picker + envelope panel
Files: `tenface.js`, `tenface.css`, `test/tenface/ui.mjs`.
- Lane panel head: SOUND select + `.tf-mod` custom dropdown (`.tf-mod-opt[data-m]`, colour-coded; `.dis` when another lane has that module).
- Module lane panel: `.tf-env` SVG plus knobs `.tf-k-a/d/s/r`, then RATE and LENGTH.
- Grid on a module lane:
  - pointerdown on an empty cell places a len-1 note and starts a drag;
  - pointerdown on a note starts a resize from its start;
  - pointermove resizes it (dragging below the grid flips the page);
  - a pointerup with no move on a note that existed before deletes it.
- Cells get `.n`, `.n0` (start) and `.n1` (end) with `--tf-mc`. The label is coloured. The grid uses `touch-action:none`.
- UI tests:
  - the picker lists 5 colour-coded modules;
  - picking BIRDBOX colours the label;
  - another lane shows BIRDBOX disabled;
  - a tap makes a len-1 note;
  - a 3-row drag makes len 3;
  - a tap on the note deletes it;
  - the envelope panel has 4 knobs and no VOL;
  - a screenshot.
