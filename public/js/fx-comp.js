/* ═══════════════════════════════════════════════════════════════════════════
   COMP — compressor. Five of them: one INSERT per mixer channel plus one on the
   master bus, all sharing the rack's settings, each with its own amount knob.

   The engine is the native DynamicsCompressorNode. Blink gives it a lookahead
   pre-delay, so blending its output against an untouched dry path would comb —
   hence the matched DelayNode on the dry side. That delay is MEASURED, never
   hardcoded: the W3C text defines no algorithm, no pre-delay and no latency at
   all, so the familiar "6 ms" is an implementation detail that must not be
   assumed. See measureLatency().

   The node has no makeup gain of its own, so one is computed here from threshold
   and ratio and applied on the wet path.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {

  /* knee/ratio ceiling/timing bias per character. Ratio ceilings stay inside the
     native node's 1..20, knees inside 0..40. */
  var TYPES = [
    { n: 'GLUE',  knee: 18, rmax: 4,  atk: 1.0, rel: 1.6 },
    { n: 'PUNCH', knee: 3,  rmax: 8,  atk: 1.0, rel: 1.0 },
    { n: 'PUMP',  knee: 6,  rmax: 12, atk: 1.0, rel: 2.2 },
    { n: 'LIMIT', knee: 0,  rmax: 20, atk: 0.3, rel: 1.0 }
  ];

  var S = FX.state('comp');
  if (S.on     === undefined) S.on = true;      // engaged, but every amount starts at 0,
  if (S.type   === undefined) S.type = 0;       // so a fresh mixer sounds untouched
  if (S.squash === undefined) S.squash = 45;
  if (S.speed  === undefined) S.speed = 30;
  if (S.makeup === undefined) S.makeup = 0;

  var ins = {};              // chKey -> insert nodes
  var LAT = 0, latDone = {};
  var R = null, lastGr = null;

  /* ── parameter maps ──────────────────────────────────────────────────────
     One knob moves threshold down and ratio up together, the THAT Corp / Yamaha
     one-knob idea; makeup tracks automatically so loudness stays put. */
  function T()   { return -45 * S.squash / 100; }                                  // 0 .. -45 dB
  function Rt()  { return 1 + (TYPES[S.type].rmax - 1) * S.squash / 100; }          // 1 .. rmax
  function clamp01(x) { return x < 0 ? 0 : x > 0.999 ? 0.999 : x; }
  function atk() { return clamp01(0.100 * Math.pow(0.01,   S.speed / 100) * TYPES[S.type].atk); }
  function rel() { return clamp01(0.800 * Math.pow(0.0625, S.speed / 100) * TYPES[S.type].rel); }
  /* ── auto-makeup, measured not derived ───────────────────────────────────
     The textbook makeup, -T*(1-1/R), is WRONG for this node. Blink's compressor
     does not implement the classic static curve: it carries an internal
     normalisation that boosts material below the threshold (measured: +5.7 dB on
     a -18 dBFS sine at GLUE/80) and reaches only ~30-37% of the theoretical
     reduction on peaks. Applying formula makeup on top of that double-compensates
     — it made 0 dBFS come out at +9.4 dB.

     So: render a 0 dBFS sine through the node offline at six SQUASH points and
     take the gain it actually applied. That is the makeup, by definition. Done at
     runtime rather than from a baked table because Safari's implementation differs
     from Blink's, and this app is used on a phone. */
  var CAL = [0, 20, 40, 60, 80, 100], mkTable = null, calRun = 0;
  function calibrate() {
    var type = S.type, run = ++calRun, sr = 44100, N = 8192, res = [];
    var chain = Promise.resolve();
    CAL.forEach(function (sq, i) {
      chain = chain.then(function () {
        var oc = new OfflineAudioContext(1, N, sr);
        var o = oc.createOscillator(); o.frequency.value = 220;   // amplitude 1 = 0 dBFS
        var c = oc.createDynamicsCompressor();
        c.threshold.value = -45 * sq / 100;
        c.ratio.value = 1 + (TYPES[type].rmax - 1) * sq / 100;
        c.knee.value = TYPES[type].knee; c.attack.value = 0.003; c.release.value = 0.10;
        o.connect(c); c.connect(oc.destination); o.start();
        return oc.startRendering().then(function (b) {
          var d = b.getChannelData(0), pk = 0;
          for (var j = (N * 0.6) | 0; j < N; j++) { var v = d[j] < 0 ? -d[j] : d[j]; if (v > pk) pk = v; }
          res[i] = -20 * Math.log10(pk > 1e-9 ? pk : 1e-9);       // dB needed to restore unity
        });
      });
    });
    chain.then(function () { if (run === calRun) { mkTable = res; applyDsp(); } })
         .catch(function () { mkTable = null; });
  }
  /* Uncalibrated returns 0 — no boost, which is the safe direction to be wrong in. */
  function autoDb() {
    if (!mkTable) return 0;
    var x = S.squash / 20, i = Math.floor(x), f = x - i;
    if (i >= CAL.length - 1) return mkTable[CAL.length - 1];
    return mkTable[i] + (mkTable[i + 1] - mkTable[i]) * f;
  }
  function makeupGain() { return Math.pow(10, (autoDb() + S.makeup) / 20); }

  /* ── the lookahead measurement ───────────────────────────────────────────
     Render a unit impulse through a TRANSPARENT compressor (ratio 1, threshold 0,
     knee 0) offline at the live sample rate. Whatever offset the peak comes back
     at IS the node's lookahead, for this browser, right now. Async, so inserts are
     built with delay 0 and corrected on resolve — nothing combs meanwhile because
     every amount defaults to 0. */
  function measureLatency(sr) {
    sr = sr || 44100;
    if (latDone[sr]) return; latDone[sr] = true;
    try {
      var N = 4096;
      var oc = new OfflineAudioContext(1, N, sr);
      var b = oc.createBuffer(1, N, sr); b.getChannelData(0)[0] = 1;
      var src = oc.createBufferSource(); src.buffer = b;
      var k = oc.createDynamicsCompressor();
      k.threshold.value = 0; k.knee.value = 0; k.ratio.value = 1;
      src.connect(k); k.connect(oc.destination); src.start();
      oc.startRendering().then(function (buf) {
        var d = buf.getChannelData(0), pk = 0, at = 0;
        for (var i = 0; i < N; i++) { var v = d[i] < 0 ? -d[i] : d[i]; if (v > pk) { pk = v; at = i; } }
        LAT = pk > 1e-4 ? at / sr : 0;
        for (var c in ins) ins[c].dly.delayTime.setValueAtTime(LAT, AC ? AC.currentTime : 0);
      }).catch(function (e) {
        LAT = 0;   // a browser with no lookahead needs no compensation — same answer
        console.warn('[fx-comp] lookahead measurement failed, running uncompensated:', e && e.message);
      });
    } catch (e) { LAT = 0; }
  }

  /* ── one insert ──────────────────────────────────────────────────────────
       in ─┬─ delay(L) ───────────────► dry ─┐
           └─ comp ─► makeup ─────────► wet ─┴─► out
     dry/wet is a LINEAR crossfade, not equal-power: the two paths carry nearly
     identical program, so equal-power would lift the middle of the knob ~3 dB. */
  function insert(chKey) {
    var c = getAC();
    var io = {
      in: c.createGain(), out: c.createGain(),
      dly: c.createDelay(0.05), cmp: c.createDynamicsCompressor(),
      mk: c.createGain(), dry: c.createGain(), wet: c.createGain()
    };
    io.dry.gain.value = 1; io.wet.gain.value = 0;
    io.dly.delayTime.value = LAT;
    io.in.connect(io.dly); io.dly.connect(io.dry); io.dry.connect(io.out);
    io.in.connect(io.cmp); io.cmp.connect(io.mk); io.mk.connect(io.wet); io.wet.connect(io.out);
    ins[chKey] = io;
    measureLatency(AC.sampleRate);   // re-measure at the real rate; no-ops if it matches
    if (!mkTable) calibrate();
    applyDsp();
    return io;
  }

  /* The channel's knob is this compressor's wet/dry mix. Bypassing the unit puts
     every insert fully dry — there is no silent-channel trap here because dry
     returns to 1 rather than to 0. */
  function applyAmt(chKey, a) {
    var io = ins[chKey]; if (!io || !AC) return;
    var m = S.on ? a : 0, t = AC.currentTime;
    io.dry.gain.setTargetAtTime(1 - m, t, .02);
    io.wet.gain.setTargetAtTime(m, t, .02);
  }

  function applyDsp() {
    if (!AC) return;
    var t = AC.currentTime, th = T(), rt = Rt(), kn = TYPES[S.type].knee, a = atk(), r = rel(), g = makeupGain();
    for (var c in ins) {
      var io = ins[c];
      io.cmp.threshold.setTargetAtTime(th, t, .02);
      io.cmp.ratio.setTargetAtTime(rt, t, .02);
      io.cmp.knee.setTargetAtTime(kn, t, .02);
      io.cmp.attack.setTargetAtTime(a, t, .02);
      io.cmp.release.setTargetAtTime(r, t, .02);
      io.mk.gain.setTargetAtTime(g, t, .02);
    }
  }

  /* ── gain reduction ──────────────────────────────────────────────────────
     `reduction` is a free float on the native node, so metering costs nothing.
     The rack chip carries the master's; each channel knob borrows its own label
     to show its reduction while it is working, which needs no new element. */
  function poll() {
    var mod = document.getElementById('modMixer');
    if (!mod || !mod.classList.contains('active')) return;
    for (var c in ins) {
      var kb = FX.knobOf('comp', c); if (!kb) continue;
      kb.note(live(c) ? ins[c].cmp.reduction.toFixed(1) : '');
    }
    var g = live(FX.MASTER) ? ins[FX.MASTER].cmp.reduction : 0;
    if (lastGr === null || Math.abs(g - lastGr) > 0.2) { lastGr = g; if (R) R.chip('Gr', g.toFixed(1)); }
  }
  /* Gated on the amount, not just on `reduction`. The compressor node keeps being
     FED at mix 0 — only its output is muted — so it goes on reporting reduction
     that never reaches the ear. A meter reading -17 dB while nothing is happening
     is a lie, so a channel counts as reducing only when it is audibly doing so. */
  function live(chKey) {
    if (!S.on || !ins[chKey]) return false;
    return FX.amt('comp', chKey) > 0 && ins[chKey].cmp.reduction < -0.5;
  }

  /* ── rack UI ─────────────────────────────────────────────────────────────── */
  function buildUI() {
    R = FX.rack({
      key: 'cmp', unit: 'comp', label: 'comp',
      chips: [
        { id: 'Type', text: TYPES[S.type].n, onclick: function (e) { window.cmpCycleType(e); } },
        { id: 'Gr',   text: '0.0', unit: 'dB' }        // no onclick -> renders as a recessed readout
      ],
      rows: [
        { id: 'Squash', label: 'SQUASH', min: 0,   max: 100, val: S.squash, oninput: function (v) { S.squash = v; applyDsp(); } },
        { id: 'Speed',  label: 'SPEED',  min: 0,   max: 100, val: S.speed,  oninput: function (v) { S.speed  = v; applyDsp(); } },
        { id: 'Makeup', label: 'MAKEUP', min: -12, max: 12,  val: S.makeup, fmt: function (v) { return (v > 0 ? '+' : '') + v; }, oninput: function (v) { S.makeup = v; applyDsp(); } }
      ],
      onToggle: function () { window.cmpToggle(); }
    });
    sync();
    setInterval(poll, 66);
  }
  function sync() { if (!R) return; R.setOn(!!S.on); R.chip('Type', TYPES[S.type].n); }

  window.cmpToggle = function () { S.on = !S.on; FX.applyAll(); sync(); FX.persist(); };
  window.cmpCycleType = function (e) {
    if (e) e.stopPropagation();
    S.type = (S.type + 1) % TYPES.length; calibrate(); applyDsp(); sync(); FX.persist();
  };

  FX.register({
    key: 'comp', label: 'CMP', master: true,          // the only unit on the MASTER strip
    insert: insert, applyAmt: applyAmt, mount: buildUI
  });

  /* Both measurements run at LOAD: an OfflineAudioContext needs no user gesture,
     so LAT and the makeup table are ready before any insert exists — no window in
     which a knob turn could comb against an uncompensated dry path. */
  measureLatency(44100);
  calibrate();

  /* exposed for the headless checks */
  window.__compTest = {
    rack: function () { return R; },
    TYPES: TYPES, S: S, ins: ins,
    lat: function () { return LAT; }, T: T, Rt: Rt, atk: atk, rel: rel,
    autoDb: autoDb, makeupGain: makeupGain, applyDsp: applyDsp,
    calibrate: calibrate, table: function () { return mkTable; }, CAL: CAL
  };
})();
