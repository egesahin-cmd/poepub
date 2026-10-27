/* ═══════════════════════════════════════════════════════════════════════════
   TENFACE — a 5-lane, 4-slot step sequencer drum machine (under "+").

   Owns: the drum machine's state, its clock, its voices and its screen. Audio
   leaves through fx-core.js: lanes tf1..tf5 sum into the `tenface` bus, which
   sums into the master bus. No MIXER column, no LINK, no ARCHIVE.

   Loaded as a CLASSIC script after index.html's inline block, like fx-core.js.
   The pure half (TF._) is unit-tested in Node, see test/tenface/.
   Spec: docs/superpowers/specs/2026-10-27-tenface-drum-machine-design.md
   ═══════════════════════════════════════════════════════════════════════════ */
var TF = (function () {
  'use strict';
  var LANES = 5, SLOTS = 4, ROWS = 16;
  var KIT = ['kick', 'snare', 'ch', 'oh', 'clap', 'rim', 'tom', 'cow', 'click', 'noise', 'sine'];
  var DEF_KIT = ['kick', 'snare', 'ch', 'clap', 'oh'];
  var RATES = [0.5, 2 / 3, 1, 4 / 3, 2, 4];
  var STORE = 'ptf_';

  /* ── pure helpers (unit-tested in Node, see test/tenface/core.test.js) ───── */

  function lane(snd) {
    return { snd: snd, vol: 80, tune: 0, dec: 50, tone: 50, rate: 1, len: ROWS, mute: false,
             fx: { comp: 0, drive: 0, verb: 0 }, steps: new Array(ROWS).fill(0) };
  }
  function slot() { return { lanes: DEF_KIT.map(lane) }; }
  function defaults() {
    var s = { bpm: 120, swing: 50, busLen: ROWS, busVol: 80, busFx: { comp: 0, drive: 0, verb: 0 }, slot: 0, slots: [] };
    for (var i = 0; i < SLOTS; i++) s.slots.push(slot());
    return s;
  }

  function cycle(v) { return (v + 1) % 3; }

  /* Saved data is untrusted: every field falls back to its default on its own,
     so one bad value never costs the user the rest of their patterns. */
  function num(v, lo, hi, d) { return typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; }
  function int(v, lo, hi, d) { return Math.round(num(v, lo, hi, d)); }
  function obj(v) { return v && typeof v === 'object' ? v : {}; }
  function fxOf(o, d) { o = obj(o); return { comp: num(o.comp, 0, 100, d.comp), drive: num(o.drive, 0, 100, d.drive), verb: num(o.verb, 0, 100, d.verb) }; }
  function normLane(o, d) {
    o = obj(o);
    var steps = Array.isArray(o.steps) ? o.steps : [];
    return {
      snd: KIT.indexOf(o.snd) >= 0 ? o.snd : d.snd,
      vol: num(o.vol, 0, 100, d.vol), tune: num(o.tune, -12, 12, d.tune),
      dec: num(o.dec, 0, 100, d.dec), tone: num(o.tone, 0, 100, d.tone),
      rate: RATES.indexOf(o.rate) >= 0 ? o.rate : d.rate,
      len: int(o.len, 8, ROWS, d.len), mute: typeof o.mute === 'boolean' ? o.mute : d.mute,
      fx: fxOf(o.fx, d.fx),
      steps: d.steps.map(function (z, i) { var v = steps[i]; return v === 1 || v === 2 ? v : 0; })
    };
  }
  function normalize(str) {
    var o;
    try { o = JSON.parse(str); } catch (e) { o = null; }
    o = obj(o);
    var d = defaults(), slots = Array.isArray(o.slots) ? o.slots : [];
    return {
      bpm: num(o.bpm, 40, 240, d.bpm), swing: num(o.swing, 50, 75, d.swing),
      busLen: int(o.busLen, 8, ROWS, d.busLen), busVol: num(o.busVol, 0, 100, d.busVol),
      busFx: fxOf(o.busFx, d.busFx), slot: int(o.slot, 0, SLOTS - 1, d.slot),
      slots: d.slots.map(function (ds, i) {
        var lanes = obj(slots[i]).lanes;
        lanes = Array.isArray(lanes) ? lanes : [];
        return { lanes: ds.lanes.map(function (dl, j) { return normLane(lanes[j], dl); }) };
      })
    };
  }
  function serialize(s) { return JSON.stringify(s); }

  /* ── module ─────────────────────────────────────────────────────────────── */

  var mounted = false;
  function mount() {
    if (mounted) return;
    mounted = true;
  }

  return {
    mount: mount,
    _: { defaults: defaults, cycle: cycle, normalize: normalize, serialize: serialize,
         KIT: KIT, RATES: RATES, LANES: LANES, SLOTS: SLOTS, ROWS: ROWS, STORE: STORE }
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TF;
