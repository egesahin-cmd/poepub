# TENFACE → drum machine (design)


## Intent
TENFACE was just restored under "+" as a one-sound burst toy with a d10 ROLL randomiser. The user wants it to become a **simple but capable drum machine** that they play **alone, live, on one phone** (no LINK). Everything that was random becomes hand-editable, like on a drum computer/sequencer.

## Goals (the user's decisions)
- **Remove ROLL completely**: `randomizeBurst`, click-to-roll, swipe-up-to-roll, ←/→ source cycling, `initBurstRandom`, the d10 artwork (`#buBird`) and the striped background (`#buBg`, `updateBuBackground`). The old `burst*` engine goes too; TENFACE is rebuilt rather than extended.
- **5 lanes (tracks)**, the maximum. Each lane can play any sound from a kit picker.
- **Vertical tracker grid**: steps are rows running top to bottom, lanes are columns. Tapping a cell cycles **off → hit ■ → accent ◆ → off**. The playhead row is lit for each lane (lanes can be at different rows; see rate and length).
- **Lane labels below the grid**, each with an **M** (mute) button. Tapping a label opens that **lane's settings panel**.
- **Lane panel**: SOUND picker, VOLUME, TUNE, DECAY, TONE, sends for **COMP / DRIVE / REV**, **RATE** and **LENGTH (8–16)**. Each lane has its own rate and length, so polyrhythms are possible.
- **BUS button at the bottom right** opens the **drum-bus panel**: bus LENGTH (8–16), **SWING**, bus **COMP / DRIVE / REV** knobs and a bus **VOLUME** slider.
- **Top strip**: play/stop, **master BPM** (− / + and tap-to-type), pattern slots **A B C D**.
- **4 pattern slots**. Switching a slot during playback takes effect at the next bar boundary.
- The kit is **today's five sounds** (sine blip, click, noise, snare, kick) plus the **usual drum-machine voices**.

## Non-goals / anti-goals
- No LINK mirroring, no ARCHIVE capture (both can come later). No samples or file loading. No song mode or chaining beyond the 4 slots. No per-step parameter locks.
- Anti-goal: timing that drifts or flams while the user is tapping cells live. The clock must stay tight under UI load.
- Anti-goal: cluttering the main screen. All per-lane and per-bus controls stay hidden until their label or BUS is tapped.

## Screen
```
┌─────────────────────────────┐
│ ▶  120.0 BPM − +   A B C D  │  top strip
├─────┬─────┬─────┬─────┬─────┤
│ 1 ■ │     │  ◆  │     │     │
│ 2   │     │  ■  │     │     │  rows = steps (max 16)
│ …   │     │     │     │     │  playhead per lane
│ 16  │     │     │     │     │
├─────┼─────┼─────┼─────┼─────┤
│KICK │SNARE│ CH  │CLAP │SINE │  tap = open lane panel
│  M  │  M  │  M  │  M  │  M  │  mute
└─────┴─────┴─────┴─────┴─────┘
                        [BUS]
```
- The grid always shows 16 rows. Rows beyond a lane's LENGTH are dimmed and inert for that lane.
- Panels open as a sheet over the lower part of the grid (my call), so the playhead stays visible. Tapping the same label or BUS again, or tapping outside the sheet, closes it.
- Colours and type follow the app (beige `#ede7d4`, black, green `#2d6a4e`, the mono tab font). Accent cells are visibly stronger than hits. Muted lanes are greyed.

## Sound kit (synthesised live in Web Audio, no samples; my call)
KICK, SNARE, CLOSED HAT, OPEN HAT (an open hat is choked by a closed hat in any lane), CLAP, RIM, TOM, COWBELL, plus the legacy CLICK, NOISE and SINE blip.
- Each voice takes **tune** (±12 semitones), **decay** (scales the envelope) and **tone** (a filter or brightness amount, interpreted per voice), and plays at the lane's volume.
- **Accent** adds about +6 dB on that hit (my call; the builder can tune it).
- The default lanes on first open (my call): KICK, SNARE, CLOSED HAT, CLAP, OPEN HAT.

## Timing
- Master BPM range 40–240 (my call). One base step = a 16th note.
- **RATE per lane**: ½×, 1×, 2×, 4× (also ⅔× and 4/3× for triplet feel; my call). Each lane advances on its own step clock: step duration = 16th ÷ rate.
- **LENGTH per lane**: 8–16. Changing the **bus LENGTH** sets every lane to that value. A lane can then be overridden in its own panel.
- **SWING**: 50–75%, applied to the odd base-rate 16ths. Lanes at other rates swing their own odd steps proportionally (my call).
- **Bar boundary** for slot switching is defined as every 16 base 16ths (one 4/4 bar at master BPM), whatever the lane lengths. On a switch, all lanes restart at step 1.
- Use a **look-ahead scheduler** against `AC.currentTime` and drive the playhead visuals from the scheduled times, never from the timer.
- **It must keep playing with the screen locked or the app in the background (user).** The tick comes from a dedicated Worker (an inline Blob, so no new file is needed), because page `setTimeout` is throttled when the page is hidden. In the foreground it looks ~100 ms ahead. On `visibilitychange` → hidden, it widens the look-ahead to ~2 s so a suspended main thread still has audio queued. The existing `startKeepAlive` keeps the context running. **Risk:** if iOS freezes page JS entirely when the screen locks, playback still runs out after the look-ahead, so this has to be confirmed on the user's phone early. The fallback is to move the sequencer into the AudioWorklet thread.

## Audio routing
Today every module taps into `public/js/fx-core.js` via `FX.tap(chKey,node)`. Each channel there has a COMP insert and DRIVE/REV sends, and its dry signal sums into the master bus.
- **Bus**: an FX channel `tenface` that is **not added to MIXER** (user). `MIX_CH` and the MIXER layout stay untouched. Its COMP/DRIVE/REV amounts are `FX.amt/setAmt('comp'|'drive'|'verb','tenface')`, set only from the bus panel. The bus VOLUME is a gain node in front of `FX.tap('tenface', …)`.
- **Bus VOLUME silences everything TENFACE makes, including the lanes' DRIVE/REV sends** (my call). Each lane's effective send gain is multiplied by the bus volume. Stop also kills all voices.
- **Autogain**: TENFACE does **not** count in `appCountActiveModules()` (my call: drums shouldn't duck the other modules), and there's no `appAutoRecalc()` call.
- **Lanes**: five FX channels `tf1…tf5` whose **dry output goes into the `tenface` bus input** instead of the master bus. This needs a small extension to `ports()` (an optional output node for a channel). Lane sends still go to the global DRIVE/REV returns, and lane COMP is a per-lane insert. Lane channels must **not** appear in the MIXER (`FX.chKeys()` reads only `#mixerSliders`).
- Knobs reuse `FX.knob(host,{min,max,value,label,fmt,onchange})`.
- Lane voices are scheduled into a per-lane gain node: lane VOLUME → `FX.tap('tfN', laneGain)`.
## Slots and persistence
- **Each slot keeps its whole kit (user)**: the 5×16 step grid (0/1/2) plus each lane's sound, volume, tune, decay, tone, rate, length, mute and COMP/DRIVE/REV send amounts. Switching slots at the bar swaps all of it. Lane send amounts are pushed into fx-core with `FX.setAmt(unit,'tfN',v)` on switch.
- **Global** (not per slot): BPM, swing, bus length, bus volume, bus COMP/DRIVE/REV, current slot.
- One `localStorage` key `ptf_` (my call) holds all of it. Bus send amounts also persist through fx-core's own `pfx_ui`.
- An empty slot B/C/D starts as a copy of the default kit with an empty grid.

## Code placement
A new classic script `public/js/tenface.js` (plus `public/css/tenface.css`), loaded after the inline block like the other `public/js` files. The inline `#modBurst` markup becomes a thin mount. Remove the restored `burst*` code, the BURST CSS, and the burst gesture and keydown handlers from `index.html`. Keep the "+" menu entry, `switchTab('burst')` and the `TN`/`plusTabs` entries.

## Left to the builder
The exact synthesis recipe per voice, the knob ranges inside the stated bounds, the panel sheet's animation, and the exact cell sizing so 16 rows fit a phone screen under the strip and labels.

## Verification
- CDP-driven headless Chrome (per memory: never pkill Chrome, kill the captured PID; the user's nodemon serves :3000). Checks: the page loads clean; + → TENFACE renders the grid at 390×844 with every cell tappable (`elementFromPoint`); tapping cycles off/hit/accent; play advances the playheads; a lane at RATE 2× advances twice as fast; LENGTH 8 wraps at 8; mute silences the lane (gain check); a slot switch lands on the bar; state survives a reload.
- Timing: schedule 2 bars into an `OfflineAudioContext` (or log scheduled times) and assert the step times match BPM, rate and swing exactly.
- One phone-width screenshot of the grid, one of the lane panel, one of the bus panel.
- Hidden-page check: in CDP, emulate a hidden page (`Page.setWebLifecycleState` frozen/active, or `Emulation.setFocusEmulationEnabled` plus a hidden visibility state) and confirm notes keep getting scheduled.
- Final check is the user on their phone: listening, plus **a locked-screen test early in the build** (the iOS risk above).
