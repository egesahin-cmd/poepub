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
    var ln = [], pending = null, cbs = [], sws = [], i;
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
          /* slot: the scheduler reads the voice from it — events from before a bar-line
             switch come out of the same call as the new slot's, after state.slot moved */
          if (v && !l.mute && t >= from) out.push({ lane: j, step: L.idx, t: t, v: v, slot: state.slot });
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
          for (j = 0; j < sws.length; j++) sws[j](pending.slot, pending.at);
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
      onStep: function (cb) { cbs.push(cb); },
      /* cb(slot, at): a switch was taken; `at` is its bar line, ahead of the audio clock */
      onSwitch: function (cb) { sws.push(cb); }
    };
  }

  /* ── voices ─────────────────────────────────────────────────────────────
     voice(ctx, dest, snd, t, {tune, dec, tone, accent}) schedules one hit. Takes any
     BaseAudioContext, so the tests render it offline. tune = semitones (pitch, or the
     filter for the hats), dec 0..100 scales the envelope 0.25x..4x around 50, tone
     0..100 is a per-voice brightness. click / noise / sine keep the old BURST sounds:
     click ignores all three, noise and sine take only what they had (length, pitch). */
  var LVL = 0.5;                                   /* plain hit; accent = x2 (+6 dB) still peaks <= ~1 */
  var noiseBufs = typeof WeakMap === 'function' ? new WeakMap() : null;
  var hats = [];                                   /* ringing open hats: {ctx, t, end, h} */

  /* One fixed 1 s noise buffer per context: a hit allocates nothing, and every hit
     is identical, like a sample — so an accent is exactly +6 dB. */
  function noise(ctx) {
    var b = noiseBufs && noiseBufs.get(ctx);
    if (b) return b;
    var n = ctx.sampleRate, x = 22222, d;
    b = ctx.createBuffer(1, n, ctx.sampleRate); d = b.getChannelData(0);
    for (var i = 0; i < n; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; d[i] = x / 2147483648 - 1; }
    if (noiseBufs) noiseBufs.set(ctx, b);
    return b;
  }
  /* looped: an open hat at DECAY 100 rings ~1.8 s, longer than the 1 s buffer */
  function nsrc(ctx, t, dur) { var s = ctx.createBufferSource(); s.buffer = noise(ctx); s.loop = true; s.start(t); s.stop(t + dur + 0.02); return s; }
  function osc(ctx, type, f, t, dur) { var o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(t + dur + 0.02); return o; }
  function filt(ctx, type, f, q) { var b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = Math.min(f, ctx.sampleRate * 0.45); if (q) b.Q.value = q; return b; }
  function decay(ctx, t, peak, dur) { var g = ctx.createGain(); g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); return g; }
  function chain() { for (var i = 1; i < arguments.length; i++) arguments[i - 1].connect(arguments[i]); return arguments[arguments.length - 1]; }

  function voice(ctx, dest, snd, t, o) {
    o = o || {};
    var tn = Math.pow(2, (o.tune || 0) / 12);
    var ds = Math.pow(2, ((o.dec == null ? 50 : o.dec) - 50) / 25);
    var tone = (o.tone == null ? 50 : o.tone) / 100;
    var out = ctx.createGain(), g, f, d, h = null, k;
    out.gain.value = LVL * (o.accent ? 2 : 1);
    out.connect(dest);
    switch (snd) {
      case 'kick':                                 /* old BURST kick: sine 150 -> 40 Hz; tone = sweep depth */
        d = 0.25 * ds; f = 40 * tn;
        var ko = osc(ctx, 'sine', f * (2 + 3.5 * tone), t, d);
        ko.frequency.exponentialRampToValueAtTime(f, t + Math.min(d, 0.15));
        chain(ko, decay(ctx, t, 1, d), out);
        break;
      case 'snare':                                /* old BURST snare: sine 180 -> 80 + high-passed noise; tone = noise HP */
        d = 0.08 * ds;
        var so = osc(ctx, 'sine', 180 * tn, t, d);
        so.frequency.exponentialRampToValueAtTime(80 * tn, t + d);
        chain(so, decay(ctx, t, 0.6, d), out);
        chain(nsrc(ctx, t, 0.12 * ds), filt(ctx, 'highpass', 1000 * Math.pow(2, (tone - 0.5) * 4) * tn), decay(ctx, t, 0.5, 0.12 * ds), out);
        break;
      case 'ch':
      case 'oh':
        d = (snd === 'ch' ? 0.05 : 0.45) * ds;
        g = chain(nsrc(ctx, t, d), filt(ctx, 'highpass', 8000 * Math.pow(2, (tone - 0.5) * 1.5) * tn), decay(ctx, t, 0.85, d));
        hats = hats.filter(function (x) { return x.end > t || x.ctx !== ctx; });
        if (snd === 'ch') {
          g.connect(out);
          /* a closed hat chokes every open hat still ringing in this context, from any lane */
          hats.forEach(function (x) { if (x.ctx === ctx && x.t < t) x.h.choke(t); });
        } else {
          k = ctx.createGain(); chain(g, k, out);     /* separate choke gain: no cancel of a ramp in flight */
          h = { choke: function (at) { k.gain.setTargetAtTime(0, at, 0.004); } };
          hats.push({ ctx: ctx, t: t, end: t + d, h: h });
        }
        break;
      case 'clap':                                 /* three quick slaps, then the room; tone = band centre */
        g = ctx.createGain(); k = g.gain; d = 0.15 * ds;
        k.setValueAtTime(0, t);
        for (var i = 0; i < 3; i++) { k.setValueAtTime(1, t + i * 0.01); k.exponentialRampToValueAtTime(0.1, t + i * 0.01 + 0.009); }
        k.setValueAtTime(0.7, t + 0.03); k.exponentialRampToValueAtTime(0.001, t + 0.03 + d);
        k = ctx.createGain(); k.gain.value = 3;          /* the narrow band loses most of the noise's level */
        chain(nsrc(ctx, t, 0.03 + d), filt(ctx, 'bandpass', 1200 * Math.pow(2, (tone - 0.5) * 2) * tn, 1.2), g, k, out);
        break;
      case 'rim':                                  /* tone = how much of the high partial */
        d = 0.03 * ds; g = decay(ctx, t, 1, d); g.connect(out);
        k = ctx.createGain(); k.gain.value = 0.3 + 0.6 * tone; chain(osc(ctx, 'triangle', 1700 * tn, t, d), k, g);
        k = ctx.createGain(); k.gain.value = 0.6; chain(osc(ctx, 'sine', 480 * tn, t, d), k, g);
        break;
      case 'tom':                                  /* tone = pitch-drop depth */
        d = 0.4 * ds; f = 110 * tn;
        var to = osc(ctx, 'sine', f * (1 + tone), t, d);
        to.frequency.exponentialRampToValueAtTime(f, t + 0.08);
        chain(to, decay(ctx, t, 1, d), out);
        break;
      case 'cow':                                  /* two squares through a band; tone = band centre */
        d = 0.35 * ds;
        g = ctx.createGain(); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.02 + d);
        var bp = filt(ctx, 'bandpass', 2640 * Math.pow(2, (tone - 0.5) * 2) * tn, 1);
        chain(osc(ctx, 'square', 540 * tn, t, d), bp); chain(osc(ctx, 'square', 800 * tn, t, d), bp);
        chain(bp, g, out);
        break;
      case 'click': {                              /* old BURST click: a 2-sample impulse; at accent, its old level */
        var cb = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.001), ctx.sampleRate), cs = ctx.createBufferSource();
        cb.getChannelData(0)[0] = 1.696; cb.getChannelData(0)[1] = -1.696;
        cs.buffer = cb; cs.connect(out); cs.start(t);
        break;
      }
      case 'noise':                                /* old BURST noise: a raw 5 ms burst; dec = length */
        d = 0.005 * ds; g = ctx.createGain(); g.gain.setValueAtTime(1, t); g.gain.setValueAtTime(0, t + d);
        chain(nsrc(ctx, t, d), g, out);
        break;
      default:                                     /* sine: old BURST blip, one 800 Hz cycle; tune = pitch, dec = cycles */
        f = 800 * tn; k = ctx.createOscillator(); k.frequency.value = f;
        k.connect(out); k.start(t); k.stop(t + Math.max(1, Math.round(ds)) / f);
    }
    return h;
  }

  /* ── engine (browser only: nothing below runs at require time) ────────────
       voice -> run[j] -> lane[j] (vol, mute) -> FX 'tfN' -+- dry -> busIn -> bus (busVol) -> FX 'tenface' -> master
                                                          +- sends -> DRIVE/REV returns (x busVol via FX.sendScale)
     run[j] is made per play: stop() ramps it to 0 and drops it, so hits already
     queued in the look-ahead (up to 2 s when hidden) never sound. */
  var state = defaults();
  var nodes = null, run = null, clock = null, worker = null, playing = false;
  var lastT = 0, LA = 0.1, scheduled = 0;
  var queue = [], shown = [], switched = [];       /* playhead: [lane, step, t] waiting for its t ([-1, slot, t] = a switch); listeners */

  function graph() {
    if (nodes) return nodes;
    var c = getAC();
    nodes = { busIn: c.createGain(), bus: c.createGain(), lanes: [] };
    nodes.busIn.connect(nodes.bus);
    FX.tap('tenface', nodes.bus);
    for (var j = 0; j < LANES; j++) {
      nodes.lanes.push(c.createGain());
      FX.tap('tf' + (j + 1), nodes.lanes[j], nodes.busIn);
    }
    setBusVol(state.busVol); syncLanes();
    return nodes;
  }
  /* at: a slot switch's bar line — the old slot's last hits keep their gains until
     then. Without it (a UI edit), now. */
  function syncLanes(at) {
    if (!nodes) return;
    var L = state.slots[state.slot].lanes, t = at == null ? AC.currentTime : Math.max(at, AC.currentTime);
    for (var j = 0; j < LANES; j++) nodes.lanes[j].gain.setTargetAtTime(L[j].mute ? 0 : v2g(L[j].vol), t, at == null ? 0.02 : 0.005);
  }
  /* The lanes' sends leave from their taps, before the bus fader, so the bus volume
     scales them too, by the same v2g gain the dry gets: 0 -> silent, 100 -> x1, and a
     lane's wet/dry balance stays put. FX.sendScale never touches the stored amounts. */
  function setBusVol(v) {
    state.busVol = v;
    for (var j = 1; j <= LANES; j++) FX.sendScale('tf' + j, v2g(v));
    if (nodes) nodes.bus.gain.setTargetAtTime(v2g(v), AC.currentTime, 0.02);
  }

  function tick() {
    if (!playing) return;
    var now = AC.currentTime, to = now + LA;
    if (to > lastT) {
      var ev = clock.events(Math.max(lastT, now), to);  /* from >= now: after a freeze, late hits are dropped, not piled up */
      lastT = to;
      for (var i = 0; i < ev.length; i++) {
        var e = ev[i], l = state.slots[e.slot].lanes[e.lane];
        voice(AC, run[e.lane], l.snd, e.t, { tune: l.tune, dec: l.dec, tone: l.tone, accent: e.v === 2 });
        scheduled++;
        if (api._onEvent) api._onEvent(e);
      }
    }
    if (queue.length > 256) show(now);              /* hidden: rAF is not draining it */
  }
  function show(now) {
    for (var i = 0; i < queue.length; ) {
      var q = queue[i];
      if (q[2] > now) { i++; continue; }
      queue.splice(i, 1);
      if (q[0] < 0) { for (var k = 0; k < switched.length; k++) switched[k](q[1]); continue; }   /* a slot switch, heard */
      for (var c = 0; c < shown.length; c++) shown[c](q[0], q[1]);
    }
  }
  function frame() { if (!playing) return; show(AC.currentTime); requestAnimationFrame(frame); }

  function ensureWorker() {
    if (worker) return worker;
    /* page timers are throttled (or stopped) in the background; a Worker's are not */
    var src = "var iv=null;onmessage=function(e){clearInterval(iv);iv=null;if(e.data==='start')iv=setInterval(function(){postMessage(0);},25);};";
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = tick;
    /* hidden: queue ~2 s so a suspended main thread still has audio in the context */
    document.addEventListener('visibilitychange', function () { LA = document.hidden ? 2 : 0.1; tick(); });
    LA = document.hidden ? 2 : 0.1;
    return worker;
  }

  function play() {
    if (playing) return;
    var c = getAC(); graph(); syncLanes();          /* vol/mute may have been edited while stopped */
    run = nodes.lanes.map(function (lg) { var g = c.createGain(); g.connect(lg); return g; });
    clock = makeClock(state, c.currentTime + 0.05);  /* a new clock = every lane from step 0 */
    clock.onStep(function (j, s, t) { if (t >= AC.currentTime) queue.push([j, s, t]); });
    clock.onSwitch(function (s, at) { syncLanes(at); queue.push([-1, s, at]); });
    lastT = c.currentTime; playing = true;
    ensureWorker().postMessage('start');
    tick(); requestAnimationFrame(frame);
  }
  function stop() {
    if (!playing) return;
    playing = false; clock = null; queue.length = 0;
    worker.postMessage('stop');
    var r = run; run = null;
    r.forEach(function (g) { g.gain.setTargetAtTime(0, AC.currentTime, 0.008); });
    setTimeout(function () { r.forEach(function (g) { g.disconnect(); }); }, 250);
    for (var j = 0; j < LANES; j++) for (var c = 0; c < shown.length; c++) shown[c](j, -1);
  }

  /* ── module ─────────────────────────────────────────────────────────────── */

  /* The screen: a strip (play, BPM, slots), a 16-row tracker grid with one column
     per lane, lane labels + mutes under it, BUS bottom-right. Built once; render()
     repaints it from state, so anything that edits state just calls render(). */
  var NAMES = { kick: 'KICK', snare: 'SNARE', ch: 'C.HAT', oh: 'O.HAT', clap: 'CLAP', rim: 'RIM', tom: 'TOM', cow: 'COW', click: 'CLICK', noise: 'NOISE', sine: 'SINE' };
  var el = {}, panel = null, pendingSlot = -1, mounted = false;
  function h(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function lanesNow() { return state.slots[state.slot].lanes; }

  /* ── saving: one key, written 300 ms after the last edit ── */
  var saveT = null;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(function () { try { localStorage.setItem(STORE, serialize(state)); } catch (e) {} }, 300);
  }
  function load() {
    var s = null; try { s = localStorage.getItem(STORE); } catch (e) {}
    if (s) state = normalize(s);
  }
  /* fx-core holds the live send amounts; the slot (lanes) and the state (bus) own them.
     Push on load and when a switch is heard, so a slot's kit brings its sends with it. */
  function pushFx() {
    var L = lanesNow();
    ['comp', 'drive', 'verb'].forEach(function (u) {
      for (var j = 0; j < LANES; j++) FX.setAmt(u, 'tf' + (j + 1), L[j].fx[u]);
      FX.setAmt(u, 'tenface', state.busFx[u]);
    });
  }
  function setLaneFx(j, u, v) { lanesNow()[j].fx[u] = v; FX.setAmt(u, 'tf' + (j + 1), v); save(); }
  function setBusFx(u, v) { state.busFx[u] = v; FX.setAmt(u, 'tenface', v); save(); }
  function setSwing(v) { state.swing = Math.max(50, Math.min(75, Math.round(v))); save(); }
  function setBusLen(v) {
    state.busLen = Math.max(8, Math.min(ROWS, Math.round(v)));
    lanesNow().forEach(function (L) { L.len = state.busLen; });   /* then any lane may differ again */
    render();
  }

  function setBpm(v) { state.bpm = Math.max(40, Math.min(240, Math.round(v))); render(); }
  function pickSlot(i) {
    if (i === state.slot && pendingSlot < 0) return;
    if (playing) { pendingSlot = i; clock.requestSlot(i, AC.currentTime); }   /* lands on the bar line */
    else { state.slot = i; pendingSlot = -1; syncLanes(); }
    render();
  }
  function tapCell(c) {
    var j = +c.dataset.l, s = +c.dataset.s, L = lanesNow()[j];
    if (s >= L.len) return;
    L.steps[s] = cycle(L.steps[s]);
    paintCell(c, L);
  }
  function paintCell(c, L) {
    var s = +c.dataset.s;
    c.dataset.v = L.steps[s];
    c.classList.toggle('off', s >= L.len);
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    var host = document.getElementById('modBurst');

    var strip = h('div', 'tf-strip');
    el.play = h('button', 'tf-play'); el.play.id = 'tfPlay';
    el.play.onclick = function () { if (playing) stop(); else play(); render(); };
    var tempo = h('div', 'tf-tempo');
    var dn = h('button', 'tf-step', '−'); dn.id = 'tfBpmDn'; dn.onclick = function () { setBpm(state.bpm - 1); };
    var up = h('button', 'tf-step', '+'); up.id = 'tfBpmUp'; up.onclick = function () { setBpm(state.bpm + 1); };
    var bpm = h('span', 'tf-bpm vnum'); bpm.id = 'tfBpm';
    bpm.onclick = function () { tapNum('tfBpm', 40, 240, setBpm, true); };
    tempo.append(dn, bpm, h('span', 'tf-unit', 'BPM'), up);
    el.slots = h('div', 'tf-slots');
    'ABCD'.split('').forEach(function (n, i) {
      var b = h('button', 'tf-slot', n); b.dataset.i = i; b.onclick = function () { pickSlot(i); }; el.slots.appendChild(b);
    });
    strip.append(el.play, tempo, el.slots);

    el.grid = h('div', 'tf-grid');
    el.cells = [];
    for (var s = 0; s < ROWS; s++) {
      el.grid.appendChild(h('div', 'tf-idx' + (s % 4 ? '' : ' beat'), String(s + 1)));
      for (var j = 0; j < LANES; j++) {
        var c = h('div', 'tf-cell' + (s % 4 ? '' : ' beat')); c.dataset.l = j; c.dataset.s = s;
        el.grid.appendChild(c); (el.cells[j] = el.cells[j] || [])[s] = c;
      }
    }
    /* pointerdown, not click: a drum pad answers on the finger, not on its release */
    el.grid.addEventListener('pointerdown', function (e) {
      var c = e.target.closest('.tf-cell'); if (!c) return;
      e.preventDefault();
      if (panel) { openPanel(null); return; }                      /* a tap outside the sheet only closes it */
      tapCell(c); save();
    });

    var foot = h('div', 'tf-foot');
    foot.appendChild(h('div', 'tf-idx'));
    el.lbls = []; el.mutes = [];
    for (j = 0; j < LANES; j++) (function (j) {
      var col = h('div', 'tf-lane');
      var l = h('button', 'tf-lbl'); l.dataset.l = j; l.onclick = function () { openPanel(panel && panel.kind === 'lane' && panel.lane === j ? null : 'lane', j); };
      var m = h('button', 'tf-mute', 'M'); m.dataset.l = j;
      m.onclick = function () { var L = lanesNow()[j]; L.mute = !L.mute; syncLanes(); render(); };
      col.append(l, m); foot.appendChild(col); el.lbls[j] = l; el.mutes[j] = m;
    })(j);
    var bar = h('div', 'tf-busbar');
    el.bus = h('button', 'tf-bus', 'BUS'); el.bus.id = 'tfBus';
    el.bus.onclick = function () { openPanel(panel && panel.kind === 'bus' ? null : 'bus'); };
    bar.appendChild(el.bus);

    el.panel = h('div', 'tf-panel'); el.panel.id = 'tfPanel';
    host.append(strip, el.grid, foot, bar, el.panel);
    /* The strip is outside the sheet too, but its buttons keep it open: tweaking a
       lane while starting, re-tempoing or switching slots is the live use. */
    strip.addEventListener('pointerdown', function (e) { if (panel && !e.target.closest('button,.tf-bpm')) openPanel(null); });

    load(); pushFx();
    if (nodes) { setBusVol(state.busVol); syncLanes(); }

    api.onPlayhead(function (j, s) {
      var col = el.cells[j];
      for (var k = 0; k < ROWS; k++) col[k].classList.toggle('now', k === s);
    });
    switched.push(function () { pendingSlot = -1; pushFx(); if (panel) fillPanel(); render(); });
    render();
  }

  function openPanel(kind, lane) {
    panel = kind ? { kind: kind, lane: kind === 'lane' ? lane : null } : null;
    if (el.panel) {
      el.panel.className = 'tf-panel' + (panel ? ' open ' + panel.kind : '');
      el.panel.dataset.lane = panel && panel.kind === 'lane' ? panel.lane : '';
      fillPanel();
    }
    render();
  }

  /* The sheet is rebuilt whenever it opens or the slot under it changes: knobs are
     cheap, and a rebuild can never show the previous lane's or slot's values. */
  var RATE_TXT = ['½', '⅔', '1', '4/3', '2', '4'];
  function knob(host, name, cls, v, min, max, fmt, on) {
    var u = { comp: ' u-comp', drive: ' u-drive', verb: ' u-verb' }[cls] || '';   /* the FX racks' own colours */
    return FX.knob(host, { name: name, cls: 'tf-k-' + cls + u, value: v, min: min, max: max, readout: 'always', fmt: fmt, onchange: on });
  }
  function fillPanel() {
    var P = el.panel; P.textContent = '';
    if (!panel) return;
    var row = function (cls) { var r = h('div', 'tf-row' + (cls ? ' ' + cls : '')); P.appendChild(r); return r; };
    var pct = function (v) { return v + '%'; };
    if (panel.kind === 'lane') {
      var j = panel.lane, L = lanesNow()[j];
      var head = row('tf-head');
      head.appendChild(h('span', 'tf-title', 'LANE ' + (j + 1)));
      var sel = h('select', 'tf-snd');
      KIT.forEach(function (k) { var o = h('option', null, NAMES[k]); o.value = k; sel.appendChild(o); });
      sel.value = L.snd;
      sel.onchange = function () { L.snd = sel.value; render(); };
      head.appendChild(sel);
      var shape = row();
      knob(shape, 'VOL', 'vol', L.vol, 0, 100, pct, function (v) { L.vol = v; syncLanes(); save(); });
      knob(shape, 'TUNE', 'tune', L.tune, -12, 12, function (v) { return (v > 0 ? '+' : '') + v; }, function (v) { L.tune = v; save(); });
      knob(shape, 'DECAY', 'dec', L.dec, 0, 100, pct, function (v) { L.dec = v; save(); });
      knob(shape, 'TONE', 'tone', L.tone, 0, 100, pct, function (v) { L.tone = v; save(); });
      var fx = row();
      knob(fx, 'COMP', 'comp', L.fx.comp, 0, 100, pct, function (v) { setLaneFx(j, 'comp', v); });
      knob(fx, 'DRIVE', 'drive', L.fx.drive, 0, 100, pct, function (v) { setLaneFx(j, 'drive', v); });
      knob(fx, 'REV', 'verb', L.fx.verb, 0, 100, pct, function (v) { setLaneFx(j, 'verb', v); });
      var rate = row('tf-seg');
      rate.appendChild(h('span', 'tf-cap', 'RATE'));
      RATES.forEach(function (r, i) {
        var b = h('button', 'tf-rate' + (L.rate === r ? ' on' : ''), RATE_TXT[i]);
        b.onclick = function () { L.rate = r; fillPanel(); render(); };
        rate.appendChild(b);
      });
      var len = row('tf-seg');
      len.appendChild(h('span', 'tf-cap', 'LENGTH'));
      var dn = h('button', 'tf-step tf-len-dn', '−'), up = h('button', 'tf-step tf-len-up', '+'), val = h('span', 'tf-len', String(L.len));
      dn.onclick = function () { L.len = Math.max(8, L.len - 1); val.textContent = L.len; render(); };
      up.onclick = function () { L.len = Math.min(ROWS, L.len + 1); val.textContent = L.len; render(); };
      len.append(dn, val, up);
    } else {
      row('tf-head').appendChild(h('span', 'tf-title', 'DRUM BUS'));
      var a = row();
      knob(a, 'LENGTH', 'len', state.busLen, 8, ROWS, String, setBusLen);
      knob(a, 'SWING', 'swing', state.swing, 50, 75, pct, setSwing);
      var b2 = row();
      knob(b2, 'COMP', 'comp', state.busFx.comp, 0, 100, pct, function (v) { setBusFx('comp', v); });
      knob(b2, 'DRIVE', 'drive', state.busFx.drive, 0, 100, pct, function (v) { setBusFx('drive', v); });
      knob(b2, 'REV', 'verb', state.busFx.verb, 0, 100, pct, function (v) { setBusFx('verb', v); });
      var vr = row('tf-seg');
      vr.appendChild(h('span', 'tf-cap', 'VOLUME'));
      var sl = h('input', 'tf-busvol'); sl.type = 'range'; sl.min = 0; sl.max = 100; sl.value = state.busVol;
      var sv = h('span', 'tf-len', state.busVol + '%');
      sl.oninput = function () { setBusVol(+sl.value); sv.textContent = sl.value + '%'; save(); };
      vr.append(sl, sv);
    }
  }

  function render() {
    if (!mounted) return;
    var L = lanesNow();
    el.play.classList.toggle('on', playing);
    el.play.textContent = playing ? '■' : '▶';
    var b = document.getElementById('tfBpm'); if (b) b.textContent = state.bpm;
    [].forEach.call(el.slots.children, function (x, i) {
      x.classList.toggle('on', i === state.slot);
      x.classList.toggle('pending', i === pendingSlot && pendingSlot !== state.slot);
    });
    for (var j = 0; j < LANES; j++) {
      for (var s = 0; s < ROWS; s++) paintCell(el.cells[j][s], L[j]);
      el.lbls[j].textContent = NAMES[L[j].snd] || L[j].snd.toUpperCase();
      el.lbls[j].classList.toggle('muted', L[j].mute);
      el.lbls[j].classList.toggle('open', !!panel && panel.kind === 'lane' && panel.lane === j);
      el.mutes[j].classList.toggle('on', L[j].mute);
    }
    el.bus.classList.toggle('open', !!panel && panel.kind === 'bus');
    if (!playing) for (j = 0; j < LANES; j++) for (s = 0; s < ROWS; s++) el.cells[j][s].classList.remove('now');
    save();                                          /* every edit ends in a repaint */
  }

  var api = {
    mount: mount, voice: voice, play: play, stop: stop, setBusVol: setBusVol, syncLanes: function () { syncLanes(); },
    render: render, openPanel: openPanel, setBusLen: setBusLen, setSwing: setSwing, setLaneFx: setLaneFx, setBusFx: setBusFx,
    get panel() { return panel; },
    /* playhead: cb(lane, step) when that step is HEARD (rAF, audio clock); step -1 on stop */
    onPlayhead: function (cb) { shown.push(cb); },
    get playing() { return playing; },
    get state() { return state; },
    get clock() { return clock; },
    _onEvent: null,
    get _scheduledCount() { return scheduled; },
    get _la() { return LA; },
    get _horizon() { return lastT; },
    get _nodes() { return nodes; },
    _: { defaults: defaults, cycle: cycle, normalize: normalize, serialize: serialize,
         stepDur: stepDur, swingOffset: swingOffset, makeClock: makeClock,
         KIT: KIT, RATES: RATES, LANES: LANES, SLOTS: SLOTS, ROWS: ROWS, STORE: STORE }
  };
  return api;
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TF;
