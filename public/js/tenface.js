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

  /* ── timing: the clock reads `state` live, so UI edits land on a step's next pass ── */

  function stepDur(bpm, rate) { return 60 / bpm / 4 / rate; }
  function swingOffset(i, bpm, rate, swing) { return i % 2 ? (swing - 50) / 50 * stepDur(bpm, rate) : 0; }

  /* Per lane: {idx, g} = next step and its UNSWUNG time. Accumulating g (not
     t0 + n*dur) lets BPM/rate edits take effect on the next step without
     rewriting times already handed out. */
  function makeClock(state, t0) {
    var ln = [], pending = null, cbs = [], i;
    /* barAt = the first bar line not yet behind the emitted horizon. Accumulated
       with the bpm in effect, like the lanes' g, so BPM edits move later bars. */
    var barAt = t0;
    function barDur() { return ROWS * stepDur(state.bpm, 1); }
    for (i = 0; i < LANES; i++) ln.push({ idx: 0, g: t0 });
    function lanes() { return state.slots[state.slot].lanes; }
    function advance(j, out, from, stop, byGrid) {
      var L = ln[j], l = lanes()[j], t, d;
      for (;;) {
        l = lanes()[j];
        if (L.idx >= l.len) L.idx = 0;               /* len was lowered under us */
        t = L.g + swingOffset(L.idx, state.bpm, l.rate, state.swing);
        d = stepDur(state.bpm, l.rate);
        if (!(d > 0 && d < Infinity)) return;       /* NaN/0 duration would spin forever */
        if (!(L.g < stop) || !(byGrid || t < stop)) return;
        if (!byGrid || t < stop) {                  /* swung past the bar line: old slot stays silent */
          for (var c = 0; c < cbs.length; c++) cbs[c](j, L.idx, t);
          var v = l.steps[L.idx];
          if (v && !l.mute && t >= from) out.push({ lane: j, step: L.idx, t: t, v: v });
        }
        L.g += d;
        L.idx++;
      }
    }
    return {
      events: function (fromT, toT) {
        var out = [], j;
        if (pending && pending.at < toT) {
          for (j = 0; j < LANES; j++) advance(j, out, fromT, pending.at, true);
          state.slot = pending.slot;
          for (j = 0; j < LANES; j++) { ln[j].idx = 0; ln[j].g = pending.at; }
          pending = null;
        }
        for (j = 0; j < LANES; j++) advance(j, out, fromT, toT, false);
        var bd = barDur();
        if (bd > 0 && bd < Infinity) while (barAt < toT) barAt += bd;
        return out.sort(function (a, b) { return a.t - b.t || a.lane - b.lane; });
      },
      requestSlot: function (slotIdx, t) {
        var bd = barDur(), at = barAt;
        if (bd > 0 && bd < Infinity) while (at < t - 1e-9) at += bd;
        pending = { slot: slotIdx, at: at };
      },
      onStep: function (cb) { cbs.push(cb); }
    };
  }

  /* ── module ─────────────────────────────────────────────────────────────── */

  var mounted = false;
  function mount() {
    if (mounted) return;
    mounted = true;
  }

  return {
    mount: mount,
    _: { defaults: defaults, cycle: cycle, normalize: normalize, serialize: serialize,
         stepDur: stepDur, swingOffset: swingOffset, makeClock: makeClock,
         KIT: KIT, RATES: RATES, LANES: LANES, SLOTS: SLOTS, ROWS: ROWS, STORE: STORE }
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TF;
