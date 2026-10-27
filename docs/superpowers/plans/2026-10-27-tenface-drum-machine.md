# TENFACE Drum Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the restored TENFACE burst toy with a 5-lane, 4-slot step sequencer drum machine. It has a vertical tracker grid, per-lane sound/shape/mix/rate/length panels, and a drum bus with swing and FX.

**Architecture:** One classic script, `public/js/tenface.js`. It holds a pure core (state, step cycling, timing math, serialisation) exported as `TF._` for Node tests, the same way `link-core.js` exports `LINK._`. Around that core are the Web Audio voices, a Worker-ticked look-ahead scheduler and the DOM. Audio goes through `fx-core.js`: five lane channels `tf1..tf5` sum into a bus channel `tenface`, which goes to the master bus. TENFACE has no MIXER column.

**Tech Stack:** Vanilla JS classic scripts, Web Audio, Web Worker (inline Blob), `node:test` for the pure core, a CDP rig (`test/link/rig.mjs`) for browser checks.

**Spec:** `docs/superpowers/specs/2026-10-27-tenface-drum-machine-design.md`

## Global Constraints
- No build step and no new dependencies. Classic scripts loaded after the inline block, next to `js/fx-*.js` (`public/index.html` ~line 6509).
- 5 lanes max, 4 slots (A–D), 16 rows always shown, LENGTH 8–16 per lane and per bus.
- BPM 40–240. A base step is a 16th. RATE ∈ {0.5, 2/3, 1, 4/3, 2, 4}. SWING 50–75%.
- Step values: 0 = off, 1 = hit, 2 = accent. Tap cycles 0→1→2→0. Accent is +6 dB.
- Kit: `kick snare ch oh clap rim tom cow click noise sine`. Default lanes: `kick snare ch clap oh`. An open hat is choked by a closed hat in any lane.
- TUNE ±12 semitones, DECAY and TONE 0–100.
- Per slot: grid plus each lane's sound/vol/tune/dec/tone/rate/len/mute/comp/drive/verb. Global: bpm, swing, busLen, busVol, bus FX, current slot.
- A slot switch while playing lands on the next 16-base-16th bar, and every lane restarts at step 1.
- Bus volume also scales the lanes' DRIVE/REV sends. TENFACE is not counted in `appCountActiveModules()`. No LINK, no ARCHIVE, no MIXER column.
- localStorage key `ptf_`. FX unit keys are `comp`, `drive`, `verb` (`FX.setAmt(unitKey, chKey, 0..100)`).
- Never touch the user's :3000 server or their Chrome. Browser checks use `rig()` on their own ports.

## Review Focus
1. **Lane LENGTH lowered below the current playhead** (e.g. playhead at 14, length set to 8). Expected: the lane wraps cleanly to step 1 on its next step, with no skipped bar and no exception. Test in Task 2.
2. **Hidden page / locked screen**: notes keep being scheduled while `document.hidden`. Test in Task 3.
3. **Corrupt or old `ptf_` in localStorage** (missing keys, wrong lengths, non-JSON). Expected: it falls back to the defaults field by field and TENFACE still opens. Test in Task 1.
4. **Rapid tapping during playback**: an edit to a step already inside the look-ahead window must not double-trigger it or crash. Expected: the edit applies from the next pass of that step. Test in Task 3.
5. **Slot switch requested twice inside one bar**: only the last request is honoured, at the bar line. Test in Task 2.

---

### Task 1: Pure core (state, cycling, persistence) and the module shell

**Files:**
- Create: `public/js/tenface.js`, `public/css/tenface.css`
- Modify: `public/index.html`. Remove the restored BURST CSS block (`/* ═══ BURST UI ═══ */`), the `#modBurst` inner markup (keep an empty `<div class="mod" id="modBurst"></div>`), the `/* ═══════ BURST ═══════ */` and `/* ═══════ BURST VISUAL ═══════ */` sections, the `modBurst` swipe branch, the click-to-roll IIFE, the ←/→ keydown listener, `initBSrc();syncBurst();` in INIT, and `initBurstRandom()` in `switchTab` (replace it with `TF.mount()`). Add `<link rel="stylesheet" href="css/tenface.css">` and `<script src="js/tenface.js"></script>` after `js/fx-verb.js`.
- Test: `test/tenface/core.test.js`. Add `"test:tf": "node --test test/tenface/*.test.js"` to `package.json`.

**Interfaces:**
- Produces: global `TF` with `TF.mount()`, `TF._.{defaults, cycle, normalize, serialize, KIT, RATES}`. `module.exports = TF` under the same guard as `link-core.js`.
- State shape: `{bpm, swing, busLen, busVol, busFx:{comp,drive,verb}, slot, slots:[{lanes:[{snd,vol,tune,dec,tone,rate,len,mute,fx:{comp,drive,verb},steps:[16]}×5]}×4]}`.

- [ ] **Step 1: Write the failing tests** in `test/tenface/core.test.js`:
  - `defaults()` has 4 slots × 5 lanes × 16 zero steps. Lane sounds are `['kick','snare','ch','clap','oh']`. `bpm` is 120, `swing` 50, `busLen` 16, `len` 16 and `rate` 1 on every lane.
  - `cycle(0)===1`, `cycle(1)===2`, `cycle(2)===0`.
  - `normalize(serialize(s))` deep-equals `s` for a state edited in several fields.
  - `normalize('not json')`, `normalize('{}')` and `normalize('{"bpm":999,"slots":[{"lanes":[{"steps":[1,7]}]}]}')` each return a full valid state. bpm is clamped to 240, a bad step becomes 0, and missing lanes/slots come from the defaults.
- [ ] **Step 2:** Run `npm run test:tf`. Expected: it FAILS because the module can't be found.
- [ ] **Step 3:** Implement the pure core and an empty `TF.mount()`. The top-level code must not touch `document`/`window` when it's `require`d from Node.
- [ ] **Step 4:** Run `npm run test:tf`. Expected: PASS. Also open + → TENFACE in the app: an empty page, and no console errors.
- [ ] **Step 5:** Commit: `feat(tenface): pure core, strip the ROLL toy`

### Task 2: Timing math (rate, length, swing, bar, slot switch)

**Files:** Modify `public/js/tenface.js`. Test `test/tenface/timing.test.js`.

**Interfaces:**
- Produces `TF._.stepDur(bpm, rate) -> seconds` (= 60/bpm/4/rate).
- Produces `TF._.swingOffset(stepIdx, bpm, rate, swing) -> seconds`: 0 for even steps; odd steps are pushed by `(swing-50)/50 * stepDur`.
- Produces `TF._.makeClock(state, t0) -> clock` with `clock.events(fromT, toT) -> [{lane, step, t, v}]`. It covers non-zero, non-muted steps only, in time order, and stays correct when it's called in consecutive windows.
- Produces `clock.requestSlot(i)`. The switch applies at the first bar line `t0 + k*16*stepDur(bpm,1)` that is ≥ the request time, and lanes restart at step 0 there.
- Produces `clock.onStep(cb(lane, step, t))` for the playhead. It fires for every step, including empty ones.

- [ ] **Step 1: Write the failing tests:**
  - At 120 BPM, rate 1, a lane with steps on 0 and 4 → events at `t0` and `t0+0.5`.
  - A rate-2 lane gives twice as many events per second as a rate-1 lane with the same pattern.
  - A lane with len 8 repeats every `8*stepDur`.
  - Swing 75 shifts step 1 by `0.5*stepDur` and leaves step 2 alone.
  - Splitting a window into 10 ms chunks gives the same events as one large window: no duplicates, no gaps.
  - **(Review 1)** Setting len from 16 to 8 while the lane is at step 13: the next event for that lane is step 0, and no exception is thrown.
  - **(Review 5)** `requestSlot(1)` then `requestSlot(2)` inside the same bar: events after the bar line come from slot 2's grid, every lane restarts at step 0, and nothing from slot 1 plays.
  - A muted lane emits no events but still calls `onStep`.
- [ ] **Step 2:** Run `npm run test:tf`. Expected: FAIL.
- [ ] **Step 3:** Implement it. Each lane keeps `{next step index, next step time}`. Lane state lives in the clock, never in the DOM.
- [ ] **Step 4:** Run `npm run test:tf`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(tenface): sequencer clock`

### Task 3: Voices, routing and the Worker-ticked scheduler

**Files:**
- Modify `public/js/tenface.js`.
- Modify `public/js/fx-core.js`: `ports(chKey, outNode)` and `tap(chKey, node, outNode)`. When `outNode` is given on the first `ports()` call, `s.dry` connects to it instead of `out()`. Without it, behaviour is unchanged.
- Test: `test/tenface/audio.mjs` (CDP via `rig({port:3081, debugPort:9395})` from `../link/rig.mjs`). Add it to a `"test:tf:browser"` script.

**Interfaces:**
- Consumes `TF._.makeClock` (Task 2) and `FX.tap/setAmt/amt` (fx-core).
- Produces `TF.voice(ctx, dest, snd, t, {tune,dec,tone,accent})`. It schedules one hit into `dest` and, for `oh`, returns a handle with `.choke(t)`.
- Produces `TF.play()`, `TF.stop()`, `TF.playing` (boolean) and `TF.state` (the live state object).
- Produces `TF.setBusVol(0..100)`. It sets the bus gain and re-scales every lane's DRIVE/REV send through `FX.applyCh`. My suggestion: multiply the lane's own stored amount by the bus volume before `FX.setAmt`, without persisting the product.
- Graph: per lane, `laneGain(vol via v2g, ×0 when muted)` → `FX.tap('tfN', laneGain, busIn)`. Then `busIn` → `busGain(busVol)` → `FX.tap('tenface', busGain)`.
- Scheduler: an inline-Blob Worker posts `tick` every 25 ms. On each tick, call `clock.events(lastT, AC.currentTime + LA)` with `LA` = 0.1 s, or 2.0 s while `document.hidden`. Visual playhead updates are queued with their `t` and applied in rAF when `AC.currentTime >= t`.

- [ ] **Step 1: Write the failing browser checks** in `test/tenface/audio.mjs`:
  - Every `TF._.KIT` voice rendered into an `OfflineAudioContext` (1 s, 48 kHz) has a peak between 0.05 and 1.0. An accent's peak is ≥1.8× the plain hit's (+6 dB ≈ 2×, within tolerance).
  - `tune:+12` on `tom` roughly doubles the zero-crossing rate compared with `tune:0` (ratio 1.8–2.2).
  - `oh` followed by `ch` 50 ms later: the RMS between 100 and 300 ms is <10% of the same window without the `ch`.
  - After `TF.play()`, `FX._chans.tf1` exists and `FX._chans.tenface` exists. tf1's dry output is connected into the bus, not to `out()`. Check this by setting bus volume 0 and confirming the lane analyser is non-zero while the master analyser is ~0 (put an `AnalyserNode` on `appMaster` for the check).
  - `setBusVol(0)` with lane 1 REV at 100: the reverb return input stays silent (an analyser on `FX.unit('verb').busIn()`).
  - **(Review 2)** Emulate a hidden page (`Emulation.setFocusEmulationEnabled` + `Page.setWebLifecycleState({state:'active'})` and dispatch `visibilitychange` with `document.hidden` overridden to true). Over 3 s of playback, `TF._scheduledCount` keeps rising.
  - **(Review 4)** During playback, toggle a step inside the current look-ahead window 20 times in 100 ms. There are no exceptions, and that step is scheduled at most once per pass.
- [ ] **Step 2:** Run `node test/tenface/audio.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement the voices, the fx-core extension, the graph, the Worker and the scheduler, and export `TF._scheduledCount` for the check. Recipes are left to you within these bounds: kick and snare start from the old `playBurstOnce` recipes; `click`, `noise` and `sine` keep their old character.
- [ ] **Step 4:** Run `node test/tenface/audio.mjs` and `npm run test:tf`. Expected: all PASS. Also run `npm run test:link`; nothing must change for the existing channels.
- [ ] **Step 5:** Commit: `feat(tenface): voices, lane->bus routing, background-safe scheduler`
- [ ] **Step 6: Add a temporary PLAY button** to `#modBurst` (it gets replaced in Task 4) with a hard-coded kick-on-every-4th pattern. **Ask the user for a locked-screen test on their phone now.** If audio stops within ~2 s of locking, stop and raise the AudioWorklet fallback from the spec before going on.

### Task 4: Main screen (top strip, grid, labels, mute, BUS button)

**Files:** Modify `public/js/tenface.js` and `public/css/tenface.css`. Test `test/tenface/ui.mjs`.

**Interfaces:**
- Consumes `TF.play/stop/state`, `TF._.cycle`, `clock.onStep`, `clock.requestSlot`.
- Produces DOM IDs used by Task 5 and the tests: `#tfPlay`, `#tfBpm` (tap → `tapNum`, as in `index.html`), `#tfBpmDn`/`#tfBpmUp`, `.tf-slot[data-i]`, `.tf-cell[data-l][data-s]` with a `data-v` of 0/1/2, `.tf-lbl[data-l]`, `.tf-mute[data-l]`, `#tfBus`.
- Produces `TF.openPanel(kind, lane)`, where kind is `'lane'|'bus'|null`. Task 5 fills in the panel itself.

- [ ] **Step 1: Write the failing checks** at 390×844 with the coarse-pointer rig:
  - 80 cells. Every cell's centre passes `elementFromPoint` back to that cell. The whole grid, the labels and `#tfBus` lie inside the viewport with no scroll.
  - Three trusted taps on a cell (`Input.dispatchTouchEvent`) give `data-v` 1, 2, then 0, and the state matches.
  - With lane 3 len 8, rows 9–16 of column 3 carry `.off` and a tap there changes nothing.
  - Mute toggles `.muted` on the label and silences the lane (lane gain 0).
  - BPM `+` from 120 gives 121. The value is clamped at 240.
  - Tapping slot B while playing changes the grid to B's steps at the bar line.
  - `#tfBus` is in the bottom-right quadrant.
- [ ] **Step 2:** Run `node test/tenface/ui.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement the layout from the spec's sketch: the strip, a 16×5 CSS grid, lane labels with `M` under them, and `#tfBus` at the bottom right. Use the app's palette tokens (`#ede7d4`, black, `#2d6a4e`). The playhead row is lit per lane.
- [ ] **Step 4:** Run the checks. Expected: PASS. Take one screenshot at 390×844 for the user.
- [ ] **Step 5:** Commit: `feat(tenface): tracker grid and transport`

### Task 5: Lane and bus panels, and persistence wiring

**Files:** Modify `public/js/tenface.js` and `public/css/tenface.css`. Test: extend `test/tenface/ui.mjs`.

**Interfaces:**
- Consumes `FX.knob(host,{min,max,value,label,fmt,onchange})`, `FX.setAmt`, `TF.setBusVol`, `TF.openPanel`, `TF._.serialize/normalize`.
- The lane panel (`#tfPanel.lane`) has a SOUND `<select>` over `KIT`, knobs VOL/TUNE/DECAY/TONE/COMP/DRIVE/REV, a RATE segmented control over `RATES`, and LENGTH 8–16.
- The bus panel (`#tfPanel.bus`) has knobs LENGTH/SWING/COMP/DRIVE/REV and a VOLUME slider. Changing bus LENGTH sets every lane's `len` in the current slot.
- The panel is a sheet over the lower grid. Tapping the same label or BUS again, or tapping outside, closes it.
- Saving: write `ptf_` debounced (300 ms) on every change, read it in `TF.mount()`, and push the slot's lane FX amounts with `FX.setAmt` on load and on a slot switch.

- [ ] **Step 1: Write the failing checks:**
  - Tapping lane 2's label opens a panel whose SOUND shows `snare`. Choosing `cow` changes the label text and the next scheduled voice.
  - Bus LENGTH 12 sets all 5 lanes' `len` to 12. A lane panel can then set lane 1 to 16 without changing the others.
  - Knob VOL 0 on lane 1 → lane gain 0.
  - **Persistence:** after an edit in slot A (steps, sound, lane REV 40) and slot C (one step), plus BPM 133 and swing 60, reload the page. Everything comes back, and `FX.amt('verb','tf1')===40` after it loads.
  - **(Review 3)** Seed `ptf_` with `'{"slots":[null]}'` and reload. TENFACE opens with defaults and there are no exceptions.
  - Switching to slot C swaps lane sounds when slot C's kit differs.
- [ ] **Step 2:** Run the checks. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run `npm run test:tf`, `node test/tenface/audio.mjs` and `node test/tenface/ui.mjs`. Expected: all PASS. Take screenshots of the lane panel and the bus panel at 390×844.
- [ ] **Step 5:** Commit: `feat(tenface): lane and bus panels, slots persist`

### Task 6: Hand-off

- [ ] Write a memory note `tenface-drum-machine.md` (plus its `MEMORY.md` line) with the non-obvious parts: the lane→bus `outNode` in fx-core, bus volume scaling the sends, the Worker clock, and the result of the locked-screen test.
- [ ] Hand the user the three screenshots and ask for the listening pass on their phone.
