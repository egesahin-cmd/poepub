# TENFACE v2: 64-step pages + module lanes (design)

## Context
TENFACE is a 5-lane, 4-slot drum machine (`public/js/tenface.js`, `public/css/tenface.css`, branch `tenface-drums`). The user wants two things:
1. **Patterns up to 64 steps**, shown as 4 pages of 16 that follow the playhead.
2. **Lanes that play the app's own modules** (VOICE, MATHS, BIRDBOX, NOISE, TONE GEN) as sound sources. On those lanes a step is not a hit. It is a **note with a length** that switches the module on, shapes it with an envelope, and switches it off.

## Part 1: pages (length 8–64)
- Lane LENGTH and bus LENGTH go from **8 to 64** (bus knob 8–64; lane −/+ buttons 8–64). `steps` arrays grow to 64. `normalize()` pads old 16-step saves with zeros, so nothing saved is lost.
- The grid still shows 16 rows. A page is rows `p*16 … p*16+15`. The row index column shows the real step number (1–64).
- **Page buttons `1 2 3 4` sit bottom-left in the busbar**, across from BUS, styled like the A–D slot buttons:
  - the page on screen is shown black (`.on`);
  - the page the playhead is on gets the green highlight (`.now`);
  - pages past the longest lane's length are greyed and inert.
- **Auto-follow:** while playing, the view flips to the page the playhead is on. The playhead that counts is the **lead lane: the longest lane, or the leftmost one on a tie** (my call: lanes can differ in length and rate).
- **Tapping a page** (user): shows that page and **stops following**, so you can edit it while the music plays elsewhere. Tapping the page the playhead is on again resumes following. Play always starts in follow mode.
- Slot switches still land on the next 16-step bar line, as today.

## Part 2: module lanes
**Picking one:** the lane panel's head gets a second picker next to the SOUND select: **MODULE** (none, VOICE, MATHS, BIRDBOX, NOISE, TONE GEN).
- It is a small custom dropdown, not a `<select>`, because iOS ignores option colours. Each entry is colour-coded with its module's colour:
  - VOICE `#d9a0d5`
  - MATHS `#9c342a`
  - BIRDBOX `#2d6a4e`
  - NOISE `#000`
  - TONE GEN `#a0ad95`
- Picking a module turns the lane into a module lane. Picking a SOUND turns it back.
- A lane keeps both its drum `steps` and its module `notes`, so switching back and forth loses nothing.
- A module already used by another lane in the same slot is disabled in the list: one lane per module.
- The lane label shows the module name in its colour, and the lane's notes are drawn in that colour.

**Notes on the grid** (unit = 1 row, user):
- A **tap on an empty cell** makes a 1-row note. **Tap and drag down** draws it longer, 1–16 rows.
- **Dragging an existing note** resizes it from its end. A **tap on a note without dragging** deletes it.
- A note is clamped so it never overlaps the next note and never passes the lane's length.
- Dragging below the last row of the page flips to the next page and keeps extending (my call). Without this, a note could not cross a page edge.
- A note is drawn as one coloured bar across its rows, with a grip on its last row.

**Module lane panel:**
- No VOL/TUNE/DECAY/TONE/sends.
- Instead, an **envelope**: a small drawn ADSR shape plus four knobs:
  - ATTACK 0–2000 ms
  - DECAY 0–2000 ms
  - SUSTAIN 0–100%
  - RELEASE 0–4000 ms
- RATE and LENGTH stay (my call): they are about the pattern, not the sound.
- The envelope is per lane and per slot, like every other lane setting. M (mute) works as on drum lanes.

**What a note does** (the mechanism):
- A per-module **gate** gain is the only thing TENFACE automates; the modules' own gains are left alone.
  - For VOICE, MATHS, BIRDBOX and NOISE, the gate is `FX.ports(chKey).inp.gain` (`voice`, `multi`, `birdbox`, `noise`). No module code writes it, so it defaults to 1. The audit confirmed this in `public/js/fx-core.js:85`.
  - TONE GEN never goes through FX (`rsMGn → appMaster`, `index.html:4165`). It gets a one-time persistent `rsGate` gain between `rsMGn` and `appMaster`. That is the only change inside a module.
- **When a note is scheduled** (inside the look-ahead), at time t with an off time tOff = t + length × the lane's step time:
  1. If the module is off, set the gate to 0 now and switch the module on through **its own toggle**, exactly as its button does. That gives the same button state and autogain.
     - TONE GEN: `toggleRiser()`
     - BIRDBOX: `toggleSweep()`
     - NOISE: `toggleNoise()`, with the `nsInitialized`/`randomizeNoise()` guard copied from `public/js/link-table.js:28`
     - MATHS: `multiToggle()`
     - **VOICE has no on/off**, so "on" = `vtInit` if needed plus `vtToggleAlwaysVoice()` on, and "off" = always-voice off.
  2. Schedule the envelope on the gate: 0 at t, a linear rise to 1 at t+A, a fall to S by t+A+D, and from tOff a release to 0 over R. A note shorter than A+D releases from wherever it got to.
  3. Arm an off-timer for tOff+R that switches the module back off (through the same toggle) and puts the gate back to 1. A later note scheduled before the timer fires cancels it, so back-to-back notes don't stutter the module.
- **Hand wins** (user): if the module is already on and TENFACE didn't turn it on, the lane's notes are ignored until you switch it off by hand.
- **Stop:** ramps every gate TENFACE holds down to 0, switches off the modules TENFACE turned on, and puts the gates back to 1.
- **Lock screen:** the gate envelope is scheduled in audio time, so notes keep their timing. Only the bookkeeping switch-off waits on a page timer, and the gate is already at 0 by then.
- **Routing** (user): the module keeps its own path, volume, FX and MIXER column. TENFACE's BUS settings don't touch it. TENFACE still doesn't count in `appCountActiveModules()`, but the modules it switches on do, as they would by hand.

## Data (saved under `ptf_`, per slot, per lane)
Added to the lane object:
- `mod`: `null` or one of `'voice' | 'multi' | 'birdbox' | 'noise' | 'riser'`
- `notes`: 64 entries, each 0 or a length 1–16 at the note's start step, with the covered steps implied
- `env`: `{a, d, s, r}`, defaulting to 10 ms, 200 ms, 70%, 300 ms

`normalize()` validates these field by field like the rest, and also drops overlapping notes and a duplicated module within a slot.

## Files
- `public/js/tenface.js`
  - pure part: ROWS → 64 for data, PAGE = 16 for view; `normLane` additions; note helpers `placeNote/resizeNote/deleteNote` (pure, clamped); `noteOff(t, len, bpm, rate)`
  - clock: emits module-note events (`kind: 'note', len`) from `notes`
  - engine: `MODS` table (`isOn`, `on`, `off`, `gate()`, `color`, `name`), gate scheduling, off-timers, stop cleanup
  - UI: pages and follow, the module picker, note drawing/drag, the envelope panel
- `public/css/tenface.css`: page buttons, note bars and grips, the module dropdown, the envelope drawing
- `public/index.html`: `rsGate` in `toggleRiser` (create once, `rsMGn.connect(rsGate)`), plus a `rsGateNode()` accessor
- Tests:
  - `test/tenface/core.test.js`: 64-step normalize, migration from 16, note helpers, the clock's note events
  - `test/tenface/audio.mjs`: gate envelope values at t/t+A/t+A+D/tOff+R, module toggled on and off, hand-wins skip, stop restores the gates to 1
  - `test/tenface/ui.mjs`: page buttons, follow and unfollow, tap/drag note, envelope panel, module colours, the disabled duplicate

## Verification
- `npm run test:tf` and `npm run test:tf:browser` (own ports 3081/3082; never pkill Chrome or node, kill only captured PIDs; leave the user's :3000 nodemon alone).
- `npm run test:link`, since TONE GEN's output path changes.
- Phone-width screenshots: a 64-step pattern on page 3 with the page buttons, a module lane with notes, and the envelope panel.
- The user listens on :3000, and the iOS locked-screen test is still owed after deploy.
