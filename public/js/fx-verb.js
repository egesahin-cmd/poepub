/* ═══════════════════════════════════════════════════════════════════════════
   REVERB — Dattorro plate (worklets/plate.js) on a shared send bus.

   A SEND unit, so it reuses fx-core's busIn/route exactly as DRIVE does: the
   per-channel knob is a send level and the MODE chip picks parallel (SEND) or
   equal-power insert (DIRECT). No new plumbing.

   The tank returns STEREO, which makes the master bus stereo from here on.
   Everything downstream is multichannel-safe; the recorder is 1-channel with
   channelCountMode 'explicit', so it down-mixes rather than truncating.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {

  var DREF = 29761;
  /* TYPE carries predelay, damping, modulation depth and input diffusion.
     It has to cover real ground: TONE took DAMP's row, so without spread here
     the tail's character would be a constant. */
  /* Damping is a one-pole INSIDE the feedback loop, so its pole is `damp` and the
     tail darkens a little more on every pass. Measured cutoffs at 48k:
       0.05 -> ~23kHz (open)   0.22 -> ~11.6kHz   0.40 -> ~7.0kHz   0.70 -> ~2.7kHz
     The spread is deliberately wide: TONE took DAMP's row, so these four values are
     the ONLY damping control left, and a narrower set measured barely 1.25x apart. */
  var TYPES = [
    { n: 'ROOM',  pdly: 0.008, damp: 0.40, exc: 0.5, dif: 0.95 },
    { n: 'HALL',  pdly: 0.025, damp: 0.22, exc: 1.0, dif: 1.00 },
    { n: 'PLATE', pdly: 0.000, damp: 0.05, exc: 1.0, dif: 1.12 },
    { n: 'SPACE', pdly: 0.060, damp: 0.70, exc: 1.6, dif: 1.12 }
  ];

  var S = FX.state('verb');
  if (S.on    === undefined) S.on = true;       // engaged, all sends at 0 — silent until dialled
  if (S.type  === undefined) S.type = 2;        // PLATE
  if (S.mode  === undefined) S.mode = 'send';
  if (S.size  === undefined) S.size = 52;
  if (S.decay === undefined) S.decay = 68;
  if (S.tone  === undefined) S.tone = 71;

  var vIn = null, node = null, out = null, wk = null, R = null;

  /* ── parameter maps ────────────────────────────────────────────────────── */
  function sizeV() { return 0.5 * Math.pow(4, S.size / 100); }          // 0.5x .. 2.0x
  /* Most of a reverb's useful range lives just under unity feedback, so the
     curve spends its resolution there rather than spreading it evenly. */
  function decV() {
    if (frz() > 0) return 0.9995;
    return Math.min(0.9995, 1 - 0.8 * Math.pow(1 - S.decay / 100, 1.6));
  }
  function toneHz() { return 300 * Math.pow(20000 / 300, S.tone / 100); }
  function bwV() {
    var sr = AC ? AC.sampleRate : 48000;
    return Math.min(1, 1 - Math.exp(-2 * Math.PI * toneHz() / sr));
  }
  /* FREEZE rides DECAY's top end: 98..100 fades the input into the tank to zero
     while decay pins just under unity, so the knob glides into an infinite wash
     and backing off releases it. Not exactly 1.0 — a unity loop with allpasses in
     it is only marginally stable; the in-loop damping filter is what keeps a
     frozen tank bounded rather than slowly growing. */
  function frz()  { return Math.max(0, Math.min(1, (S.decay - 98) / 2)); }
  function igV()  { return 1 - frz(); }
  function excV() { return 16 * ((AC ? AC.sampleRate : 48000) / DREF) * TYPES[S.type].exc; }

  /* ── bus ───────────────────────────────────────────────────────────────── */
  function bus() {
    if (vIn) return vIn;
    var c = getAC();
    vIn = c.createGain();
    out = c.createGain(); out.gain.value = 0;
    out.connect(FX.out());
    loadWorklet();
    return vIn;
  }

  /* Until the module resolves, vIn feeds nothing: the send path is silent but the
     graph is whole. On failure it stays that way rather than half-connected. */
  function loadWorklet() {
    if (wk || !AC) return;
    if (!AC.audioWorklet) { wk = 'off'; return; }
    wk = 'loading';
    AC.audioWorklet.addModule('worklets/plate.js').then(function () {
      node = new AudioWorkletNode(AC, 'plate', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 1, channelCountMode: 'explicit',
        processorOptions: params()      // arrives WITH the constructor; postMessage would lag a block
      });
      vIn.connect(node); node.connect(out);
      wk = 'on'; applyDsp();
    }).catch(function (e) {
      wk = 'off';
      console.warn('[fx-verb] plate worklet unavailable, reverb stays silent:', e && e.message);
    });
  }

  function params() {
    var T = TYPES[S.type];
    return { size: sizeV(), dec: decV(), bw: bwV(), damp: T.damp,
             pdly: T.pdly, exc: excV(), dif: T.dif, ig: igV() };
  }
  function applyDsp() {
    if (!AC) return;
    if (out) out.gain.setTargetAtTime(S.on ? 1 : 0, AC.currentTime, .02);
    if (node) node.port.postMessage(params());
  }

  /* ── registration ──────────────────────────────────────────────────────── */
  FX.register({
    key: 'verb', label: 'RVB',
    busIn: function () { return bus(); },
    route: function (chKey, a) {
      if (!S.on) return { dry: 1, snd: 0 };       // bypass returns dry to 1, never silence
      return S.mode === 'direct'
        ? { dry: Math.cos(a * Math.PI / 2), snd: Math.sin(a * Math.PI / 2) }
        : { dry: 1, snd: a };
    },
    mount: buildUI
  });

  /* ── rack UI ───────────────────────────────────────────────────────────── */
  function buildUI() {
    R = FX.rack({
      key: 'vrb', unit: 'verb', label: 'verb',
      chips: [
        { id: 'Type', text: TYPES[S.type].n, onclick: function (e) { window.vrbCycleType(e); } },
        { id: 'Mode', text: 'SEND', cls: 'fx-rack-mode', onclick: function (e) { window.vrbCycleMode(e); } }
      ],
      rows: [
        { id: 'Size',  label: 'SIZE',  min: 0, max: 100, val: S.size,  oninput: function (v) { S.size  = v; applyDsp(); } },
        { id: 'Decay', label: 'DECAY', min: 0, max: 100, val: S.decay, fmt: function (v) { return v > 98 ? 'FRZ' : String(v); }, oninput: function (v) { S.decay = v; applyDsp(); } },
        { id: 'Tone',  label: 'TONE',  min: 0, max: 100, val: S.tone,  oninput: function (v) { S.tone  = v; applyDsp(); } }
      ],
      onToggle: function () { window.vrbToggle(); }
    });
    sync();
  }
  function sync() {
    if (!R) return;
    R.setOn(!!S.on);
    R.chip('Type', TYPES[S.type].n);
    R.chip('Mode', S.mode === 'direct' ? 'DIRECT' : 'SEND');
    R.chipClass('Mode', 'is-direct', S.mode === 'direct');   // the two states are colour inverses
  }

  window.vrbToggle = function () { S.on = !S.on; applyDsp(); FX.applyAll(); sync(); FX.persist(); };
  window.vrbCycleType = function (e) { if (e) e.stopPropagation(); S.type = (S.type + 1) % TYPES.length; applyDsp(); sync(); FX.persist(); };
  window.vrbCycleMode = function (e) { if (e) e.stopPropagation(); S.mode = S.mode === 'direct' ? 'send' : 'direct'; FX.applyAll(); sync(); FX.persist(); };

  /* exposed for the headless checks */
  window.__verbTest = {
    rack: function () { return R; },
    TYPES: TYPES, S: S, sizeV: sizeV, decV: decV, bwV: bwV, toneHz: toneHz,
    frz: frz, igV: igV, excV: excV, applyDsp: applyDsp,
    node: function () { return node; }, wk: function () { return wk; }, params: params
  };
})();
