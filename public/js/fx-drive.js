/* ═══════════════════════════════════════════════════════════════════════════
   DRIVE — overdrive / saturation / redux. No tab of its own: a collapsible rack
   bar at the top of the MIXER, in the same visual register as #nsRfPanel.

   The whole character — input drive, DC bias, the saturation shape and the
   bit-depth crusher — is ONE 8192-point Float32Array. Waveshaping and
   quantisation are both memoryless, so they compose into a single lookup table
   and the browser evaluates it natively: one lookup per sample, no matter how
   many stages it conceptually has.

   Sample-RATE reduction is the one thing that cannot fold in, because holding a
   sample needs state. That lives in worklets/redux.js and is spliced in async.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {

  /* ── shapes ──────────────────────────────────────────────────────────────
     bias is what buys even harmonics: offsetting the input before a symmetric
     nonlinearity makes the transfer asymmetric. It costs nothing because the DC
     it creates is removed exactly in buildCurve(), by subtraction not filtering. */
  var TYPES = [
    { n: 'WARM',  bias: 0.18, shape: function (x) { return Math.tanh(x); } },
    /* cubic soft clip: f'(±1) = 0, so it meets the hard clip with no corner */
    { n: 'DRIVE', bias: 0,    shape: function (x) { return x <= -1 ? -2 / 3 : x >= 1 ? 2 / 3 : x - x * x * x / 3; } },
    { n: 'FUZZ',  bias: 0.25, shape: function (x) { return x / (1 + (x < 0 ? -x : x)); } },
    /* wavefolder — wraps once more every time DRIVE pushes it past another π */
    { n: 'FOLD',  bias: 0,    shape: function (x) { return Math.sin(x * Math.PI / 2); } }
  ];

  var S = FX.state('drive');
  if (S.on === undefined) S.on = true;          // engaged by default; every amount starts at 0,
  if (S.type === undefined) S.type = 0;         // so turning a strip knob just works
  if (S.mode === undefined) S.mode = 'send';
  if (S.drive === undefined) S.drive = 45;
  if (S.crush === undefined) S.crush = 0;
  if (S.tone === undefined) S.tone = 100;

  var drvIn = null, shaper = null, hp = null, tone = null, redux = null, out = null, wk = null;

  /* ── parameter maps ──────────────────────────────────────────────────────── */
  function preGain() { return Math.pow(40, S.drive / 100); }          // 1x .. 40x
  function toneHz()  { return 500 * Math.pow(40, S.tone / 100); }     // 500Hz .. 20kHz
  /* CRUSH is one knob voiced to degrade both ways at once. Bit depth moves first
     and on a curve, so the useful range is spread across the travel instead of
     bunched at the top; rate reduction holds off until the last three quarters. */
  function crushQ() {
    if (S.crush <= 0) return 0;
    /* bits MUST round to an integer. A fractional bit depth makes q a non-power-of-two,
       the staircase stops landing on a 2^b grid, and the curve no longer reaches exactly
       full scale — which is precisely what the curve check caught. 12 bits at the bottom
       rather than 16: 16 is so transparent the first third of the knob does nothing. */
    var t = S.crush / 100, bits = Math.round(2 + 10 * Math.pow(1 - t, 2));
    return Math.pow(2, bits - 1);
  }
  function reduxNorm() {
    var t = S.crush / 100;
    return t < 0.25 ? 1 : Math.pow(0.02, (t - 0.25) / 0.75);
  }

  /* ── the curve ───────────────────────────────────────────────────────────
     pass 1  shape, de-bias, track peak
     pass 2  normalise (this IS the makeup gain), then quantise on a clean grid
     Order matters: quantising AFTER normalising puts the steps on exact 2^b
     boundaries. Doing it the other way round scales the staircase by 1/peak and
     the levels stop being a power of two. */
  function buildCurve() {
    var N = 8192, y = new Float32Array(N);
    var T = TYPES[S.type], sh = T.shape, bias = T.bias, pre = preGain();
    var y0 = sh(bias), peak = 0, i, v;
    for (i = 0; i < N; i++) {
      v = sh(bias + pre * ((i / (N - 1)) * 2 - 1)) - y0;
      y[i] = v; v = v < 0 ? -v : v; if (v > peak) peak = v;
    }
    var g = peak > 1e-6 ? 1 / peak : 1, q = crushQ();
    for (i = 0; i < N; i++) {
      v = y[i] * g;
      if (q) v = Math.round(v * q) / q;
      y[i] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
    return y;
  }

  /* ── bus ─────────────────────────────────────────────────────────────────
     drvIn -> shaper -> hp -> tone -> [redux] -> out -> appMaster
     Built lazily on the first fxTap(), which only ever runs from a module's play
     path — so getAC() has already run and appMaster exists. */
  function bus() {
    if (drvIn) return drvIn;
    var c = getAC();
    drvIn = c.createGain();
    shaper = c.createWaveShaper();
    /* the bias subtraction kills static DC exactly; this catches the DYNAMIC
       offset that asymmetric clipping of real signal produces */
    hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 15; hp.Q.value = 0.707;
    tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.Q.value = 0.707;
    out = c.createGain(); out.gain.value = 0;
    drvIn.connect(shaper); shaper.connect(hp); hp.connect(tone);
    tone.connect(out);                 // straight through until the worklet lands
    out.connect(FX.out());          // masterBus, i.e. ahead of the MASTER fader
    applyDsp(); loadWorklet();
    return drvIn;
  }

  /* addModule() is async, so the chain runs bypassed and the node is spliced in
     on resolve. On failure DRIVE keeps working with bit-crush alone — never silent. */
  function loadWorklet() {
    if (wk || !AC) return;
    if (!AC.audioWorklet) { wk = 'off'; return; }
    wk = 'loading';
    AC.audioWorklet.addModule('worklets/redux.js').then(function () {
      redux = new AudioWorkletNode(AC, 'redux', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        channelCount: 1, channelCountMode: 'explicit'
      });
      try { tone.disconnect(out); } catch (e) {}
      tone.connect(redux); redux.connect(out);
      wk = 'on'; applyDsp();
    }).catch(function (e) {
      wk = 'off';
      console.warn('[fx-drive] redux worklet unavailable — bit-crush only:', e && e.message);
    });
  }

  function applyDsp() {
    if (!drvIn || !AC) return;
    var t = AC.currentTime;
    shaper.curve = buildCurve();
    /* oversampling trades curve precision for alias suppression — which smears the
       quantisation staircase. When the crusher is working, its aliasing IS the sound. */
    shaper.oversample = S.crush > 0 ? 'none' : '4x';
    tone.frequency.setTargetAtTime(toneHz(), t, .02);
    if (redux) redux.parameters.get('norm').setTargetAtTime(reduxNorm(), t, .02);
    out.gain.setTargetAtTime(S.on ? 1 : 0, t, .02);
  }

  /* ── registration ────────────────────────────────────────────────────────
     SEND  parallel — dry stays up, the knob adds distorted signal alongside it
     DIRECT insert  — equal-power crossfade, the channel commits to the shaper
     When the unit is OFF, dry MUST return to 1: a channel sitting in DIRECT at
     100 has dry = 0, and bypassing without this would mute it outright. */
  FX.register({
    key: 'drive', label: 'DRV',
    busIn: function () { return bus(); },
    route: function (chKey, a) {
      if (!S.on) return { dry: 1, snd: 0 };
      return S.mode === 'direct'
        ? { dry: Math.cos(a * Math.PI / 2), snd: Math.sin(a * Math.PI / 2) }
        : { dry: 1, snd: a };
    },
    mount: buildUI
  });

  /* ── rack UI ─────────────────────────────────────────────────────────────
     Built by FX.rack, the collapsible bar shared with COMP. */
  var R = null;
  function buildUI() {
    R = FX.rack({
      key: 'drv', unit: 'drive', label: 'drive',
      chips: [
        { id: 'Type', text: TYPES[S.type].n, onclick: function (e) { window.drvCycleType(e); } },
        { id: 'Mode', text: 'SEND', cls: 'fx-rack-mode', onclick: function (e) { window.drvCycleMode(e); } }
      ],
      rows: [
        { id: 'Drive', label: 'DRIVE', min: 0, max: 100, val: S.drive, oninput: function (v) { S.drive = v; applyDsp(); } },
        { id: 'Crush', label: 'CRUSH', min: 0, max: 100, val: S.crush, oninput: function (v) { S.crush = v; applyDsp(); } },
        { id: 'Tone',  label: 'TONE',  min: 0, max: 100, val: S.tone,  oninput: function (v) { S.tone  = v; applyDsp(); } }
      ],
      onToggle: function () { window.drvToggle(); }
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

  window.drvToggle = function () { S.on = !S.on; applyDsp(); FX.applyAll(); sync(); FX.persist(); };
  window.drvCycleType = function (e) { if (e) e.stopPropagation(); S.type = (S.type + 1) % TYPES.length; applyDsp(); sync(); FX.persist(); };
  window.drvCycleMode = function (e) { if (e) e.stopPropagation(); S.mode = S.mode === 'direct' ? 'send' : 'direct'; FX.applyAll(); sync(); FX.persist(); };

  /* exposed for the headless curve check */
  window.__drvTest = { rack: function () { return R; }, TYPES: TYPES, S: S, buildCurve: buildCurve, crushQ: crushQ, preGain: preGain, reduxNorm: reduxNorm };
})();
