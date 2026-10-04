/* ═══════════════════════════════════════════════════════════════════════════
   LINK table — the rows: every poepub parameter the master mirrors to the room.

   One row per parameter. get() reads the global that holds INTENT; set(v) reaches
   the same state through the app's own write path, so the control's visual and the
   audio both follow, and get() === v afterwards. Parameters without a row simply do
   not mirror yet.

   Loaded after link-core.js. Spec section 3; the row tables are in
   docs/superpowers/plans/ (stage 1, and stages 2-5).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  /* The app's play buttons are flips. Applied as "flip only if different", they become idempotent
     and still run the whole handler (audio graph, button state, app autogain). */
  function flipTo(isOn, toggle) { return function (v) { if (!!isOn() !== !!v) toggle(); }; }

  LINK.row({ id: 'rs.on', kind: 'transport',
    get: function () { return rsPlaying ? 1 : 0; },
    set: flipTo(function () { return rsPlaying; }, function () { toggleRiser(); }) });

  LINK.row({ id: 'bb.on', kind: 'transport',
    get: function () { return swpPlaying ? 1 : 0; },
    set: flipTo(function () { return swpPlaying; }, function () { toggleSweep(); }) });

  /* NOISE's roll resumes only if a first roll exists, and a phone that never opened the NOISE tab
     has none (switchTab does it on first open). Without this the slave would play a frozen spectrum. */
  LINK.row({ id: 'ns.on', kind: 'transport',
    get: function () { return nOn ? 1 : 0; },
    set: flipTo(function () { return nOn; }, function () {
      if (!nOn && !nsInitialized) { nsInitialized = true; randomizeNoise(); }
      toggleNoise();
    }) });

  LINK.row({ id: 'mu.on', kind: 'transport',
    get: function () { return multiPlaying ? 1 : 0; },
    set: flipTo(function () { return multiPlaying; }, function () { multiToggle(); }) });

  /* ── helpers ──────────────────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  /* "By hand" = inside a real gesture. A trusted event alone is not enough: `visibilitychange` is
     trusted (the app stops SPEAK in it), and so is the WebSocket `message` in which a master takes
     a room over (the NOISE row's first roll runs in it). */
  var GESTURE = { click: 1, touchstart: 1, touchend: 1, pointerdown: 1, pointerup: 1, mousedown: 1, mouseup: 1, keydown: 1, keyup: 1, change: 1, input: 1 };
  function byHand() { var e = window.event; return !!(e && e.isTrusted && GESTURE[e.type]); }
  function setting(id, get, set, extra) {
    var r = { id: id, kind: 'setting', get: get, set: set };
    if (extra) for (var k in extra) r[k] = extra[k];
    LINK.row(r);
  }
  /* An on/off the app only offers as a flip. */
  function flag(id, isOn, toggle) { setting(id, function () { return isOn() ? 1 : 0; }, flipTo(isOn, toggle)); }
  /* View state whose only home is a class: a panel a locked slave could never open for itself. */
  function panel(id, elId, cls, toggle) { flag(id, function () { var e = $(elId); return !!e && e.classList.contains(cls); }, toggle); }
  /* A manual re-roll is not state — each phone rolls its own dice. The master counts the rolls it
     makes by hand (inside a real gesture; the engine's own self-chain runs from an animation frame
     and has no event) and a slave rolls once per count. `seen` stays null until the first value after
     joining, so a join never rolls. */
  function trigger(id, fnName, onSlave) {
    var real = window[fnName], n = 0, seen = null;
    window[fnName] = function () {
      if (LINK.info().role === 'master' && byHand()) n++;
      return real.apply(this, arguments);
    };
    LINK.on(function (evt) { if (evt === 'joined') seen = null; });
    /* On a slave the row reads back the count it was given, so the two tables still compare equal. */
    /* A master taking over a room carries the room's count on: starting again from 0 would look
       like a roll, and every slave would re-roll because its master reloaded. */
    setting(id, function () { return LINK.info().role === 'slave' && seen !== null ? seen : n; },
      function (v) { if (LINK.info().role !== 'slave') n = v; if (seen !== null && v !== seen) (onSlave || real)(); seen = v; }, { heal: false });
  }
  /* A start time, in this phone's performance.now(). link-core.js carries it in shared-clock time. */
  function anchor(id, get, set) { LINK.row({ id: id, kind: 'anchor', get: get, set: set }); }
  /* A native range whose inline handler does everything: set it and fire `input`, as a drag does. */
  function slide(elId, v) { var e = $(elId); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }

  /* ── MIXER ────────────────────────────────────────────────────────────────── */
  /* updMix moves the mixer fader, the module's own slider and the gain. Channels are looked up by
     key, not by position. For MATHS it is also the path that never retargets to a selected operator. */
  function channel(id, key, get) {
    var i = MIX_CH.findIndex(function (c) { return key === 'master' ? c.master : c.key === key; });
    setting(id, get, function (v) { updMix(i, v); });
  }
  channel('app.vol', 'master', function () { return appMasterVol; });
  channel('mx.voice', 'voice', function () { return vtVol; });
  channel('mx.multi', 'multi', function () { return multiMVol; });
  channel('mx.birdbox', 'birdbox', function () { return swpMVol; });
  channel('mx.noise', 'noise', function () { return Math.round(nMixPost * 100); });
  flag('app.auto', function () { return appAutoOn; }, function () { toggleAppAuto(); });
  flag('app.lim', function () { return appLimOn; }, function () { toggleAppLim(); });

  /* ── NOISE ────────────────────────────────────────────────────────────────── */
  /* Not rows: nSl[], nVol, nAPre, nTrans*, nsProgress — the roll's own output, rewritten every frame. */
  setting('ns.spd', function () { return nsSpdPos; }, function (v) { nsSetSpeed(v); });
  setting('ns.vr', function () { return [nsVolLo, nsVolHi]; }, function (v) { nsVolLo = v[0]; nsVolHi = v[1]; nsVolRangeSync(); });
  flag('ns.vr.on', function () { return nsVolRangeOn; }, function () { nsVolRangeToggle(); });
  trigger('ns.roll', 'randomizeNoise');

  /* ratio filter */
  flag('ns.rf.on', function () { return nsRfEnabled; }, function () { nsRfToggle(); });
  /* Q is assigned, not sent through its slider: the slider's curve rounds, and a value that has
     been through it twice need not come back the same. */
  setting('ns.rf.q', function () { return nsRfQ; }, function (v) { nsRfQ = v; $('nsRfQR').value = expSI(v, 1, 200); nsRfSyncQ(); nsRfSchedule(); });
  setting('ns.rf.mix', function () { return Math.round(nsRfMix * 100); }, function (v) { $('nsRfMixR').value = v; nsRfSetMix(v); });
  setting('ns.rf.tilt', function () { return Math.round(nsRfTilt * 100); }, function (v) { $('nsRfTiltR').value = v; nsRfSetTilt(v); });
  setting('ns.rf.spr', function () { return Math.round(nsRfSpread * 500); }, function (v) { $('nsRfSprR').value = v; nsRfSetSpread(v); });
  setting('ns.rf.oct', function () { return nsRfOct; }, function (v) { nsRfSetOct(v); });
  setting('ns.rf.bands', function () { return [nsRfLo, nsRfHi]; }, function (v) { nsRfLo = v[0]; nsRfHi = v[1]; nsRfSyncBands(); nsRfMarkLive(); nsRfSchedule(); });
  panel('ns.rf.open', 'nsRfPanel', 'rf-open', function () { nsRfTogglePanel(); });

  /* pulse */
  flag('ns.vs.on', function () { return nsVsOn; }, function () { nsVsToggle(); });
  flag('ns.vs.auto', function () { return nsVsAuto; }, function () { nsVsToggleAuto(); });
  /* The number boxes are spans that tapNum REPLACES on every edit: look them up each time. */
  setting('ns.vs.a', function () { return nsVsA; }, function (v) { nsVsA = v; $('nsVsAV').textContent = Math.round(v * 1000); nsVsRefreshFader(); });
  setting('ns.vs.b', function () { return nsVsB; }, function (v) { nsVsB = v; $('nsVsBV').textContent = Math.round(v * 1000); nsVsRefreshFader(); });
  setting('ns.vs.dur', function () { return nsVsDur; }, function (v) { nsVsDur = v; $('nsVsDurV').textContent = v.toFixed(2); });
  setting('ns.vs.dir', function () { return nsVsDir; }, function (v) { nsVsDir = v; nsVsRenderDir(); });
  setting('ns.vs.fader', function () { return Math.round(nsVsFader * 1000); }, function (v) { nsVsFader = v / 1000; $('nsVsFaderR').value = sliderFlip(v, 1000); nsVsRefreshFader(); });
  /* Attack/decay: every rebuild allocates a 12 s buffer, so use the control's own throttle while
     values stream in, and a trailing unthrottled pass so the last one is always built. */
  function envelope(id, get, assign, ctl) {
    var late = 0;
    setting(id, get, function (v) {
      assign(v); ctl().sync(); ctl().apply(true);
      clearTimeout(late); late = setTimeout(function () { ctl().apply(false); }, 160);
    });
  }
  envelope('ns.vs.env', function () { return [nsVsAtk, nsVsDec]; }, function (v) { nsVsAtk = v[0]; nsVsDec = v[1]; }, function () { return nsVsEnv; });
  panel('ns.vs.open', 'nsVsPanel', 'vs-open', function () { nsVsTogglePanel(); });
  anchor('ns.vs.t0', function () { return nsVsAutoStart; }, function (v) { nsVsAutoStart = v; });   // the period sweep, not the beat

  /* ── TONE GEN ─────────────────────────────────────────────────────────────── */
  setting('rs.wv', function () { return rsWv; }, function (v) { var b = document.querySelector('#rsWaves .wbtn[data-wv="' + v + '"]'); if (b) b.click(); });
  setting('rs.freq', function () { return rsFreq; }, function (v) { rsSetFreqDirect(v); });
  setting('rs.fqb', function () { return rsFqB; }, function (v) { rsSetFqB(v); });
  setting('rs.vol', function () { return rsMVol; }, function (v) { slide('rsMVolR', v); });
  /* Durations are assigned, then the slider and its label are placed as syncRiserUI places them:
     the slider's own curve rounds, so a value sent through it need not come back the same. */
  function duration(id, get, assign, sliderId, labelId) {
    setting(id, get, function (v) { assign(v); var r = $(sliderId); r.value = Math.round(rsDurToSlider(v)); updateSliderVal(labelId, r, v.toFixed(1) + ' s'); });
  }
  flag('rs.sw.on', function () { return rsSweepOn; }, function () { rsToggleSweep(); });
  duration('rs.sw.dur', function () { return rsPitchDur; }, function (v) { rsPitchDur = v; }, 'rsPitchDurSL', 'rsPitchDurVal');
  setting('rs.sw.type', function () { return rsPitchType; }, function (v) { rsPitchType = v; setSwpTypeSel('rsPitchTypeSel', v); });
  setting('rs.sw.dir', function () { return rsPitchDir; }, function (v) { rsPitchDir = v; rsPitchRenderDir(); });
  flag('rs.vp.on', function () { return rsVolSweepOn; }, function () { rsToggleVolSweep(); });
  duration('rs.vp.dur', function () { return rsVolDur; }, function (v) { rsVolDur = v; }, 'rsVolDurSL', 'rsVolDurVal');
  setting('rs.vp.type', function () { return rsVolType; }, function (v) { rsVolType = v; setSwpTypeSel('rsVolTypeSel', v); });
  setting('rs.vp.dir', function () { return rsVolDir; }, function (v) { rsVolDir = v; rsVolRenderDir(); });
  /* Its phases are a pure function of now minus start, so equal starts are equal phases. Anchors
     apply last in a batch, after the toggles that restamp them. */
  anchor('rs.sw.t0', function () { return rsPitchStart; }, function (v) { rsPitchStart = v; });
  anchor('rs.vp.t0', function () { return rsVolStart; }, function (v) { rsVolStart = v; });

  /* ── BIRDBOX ──────────────────────────────────────────────────────────────── */
  /* Not rows: swpFqMin, swpFqMax, swpFqDur, swpFqStart and the phase machine — each phone's own
     dice and its own cycle lengths. */
  /* Speed: the drag re-rolls and restarts the phase at every 2% step, or a long sweep leaves the
     module apparently dead for a minute. The same gate here, with its own "tempo at the last roll". */
  var bbRolledAt = bbTempo;
  setting('bb.tempo', function () { return bbTempoPos; }, function (v) {
    bbSetTempo(v);
    if (Math.abs(Math.log(bbTempo / bbRolledAt)) > 0.02) { bbRolledAt = bbTempo; bbSpeedRoll(); }
  });
  setting('bb.range', function () { return [bbRangeLo, bbRangeHi]; }, function (v) { bbRangeLo = v[0]; bbRangeHi = v[1]; bbSyncRange(); recomputeHarmonicPools(); updateBBBackground(); });
  setting('bb.filt', function () { return [bbFiltLo, bbFiltHi]; }, function (v) { bbFiltLo = v[0]; bbFiltHi = v[1]; bbFiltSync(); bbFiltApply(); });
  setting('bb.pause', function () { return [bbPauseLo, bbPauseHi]; }, function (v) { bbPauseLo = v[0]; bbPauseHi = v[1]; bbPauseSync(); });
  flag('bb.durh', function () { return bbDurHarmonic; }, function () { toggleBbDurMode(); });
  setting('bb.fqr', function () { return bbFqRatio; }, function (v) { bbFqRatio = v; $('bbFqRatioV').textContent = v.toFixed(2); recomputeHarmonicPools(); });
  /* A full roll: randomizeBirdbox's own body, with the master's shape and this phone's own
     frequency and duration draw. */
  function bbRollOwn(type, dir) {
    swpFqMin = bbRand(bbFreqPool); swpFqMax = bbRand(bbFreqPool);
    swpFqDur = bbRand(bbDurHarmonic ? bbDurPool : bbDurPoolPool);
    swpFqType = type; swpFqDir = dir;
    syncSweepUI();
    if (swpPlaying) {
      setPB('swp', true);
      swpFqFwd = parsDir(swpFqDir).base !== 'left';
      swpBloopReturn = false; swpRepCount = 0; swpFqStart = performance.now(); swpPausing = false;
      if (swpSigGn && AC) swpSigGn.gain.setTargetAtTime(1, AC.currentTime, .01);
    }
    updateBBBackground(); updateBBBird();
  }
  /* The counter comes first: a roll that happens to draw the same shape again must still roll. */
  trigger('bb.roll', 'randomizeBirdbox', function () { bbRollOwn(swpFqType, swpFqDir); });
  setting('bb.shape', function () { return [swpFqType, swpFqDir]; }, function (v) { if (swpFqType !== v[0] || swpFqDir !== v[1]) bbRollOwn(v[0], v[1]); });

  /* ── MATHS ────────────────────────────────────────────────────────────────── */
  /* Not rows: each operator's level (o.vol, vFrom, vTo, vProg, vJit) — every phone's own wander —
     except the level of the operator the master is holding, which travels in mu.hold. */
  /* The fundamental is committed only when its glide lands, so the INTENT is the glide's target.
     No glide is started here: pitch travels per operator in mu.ops. */
  setting('mu.fund', function () { return multiHarmonicSweep ? multiFundTo : multiFundamental; }, function (v) {
    multiFundamental = multiFundFrom = multiFundTo = v; multiHarmonicSweep = false;
    $('multiFundV').textContent = v.toFixed(2);
    recomputeHarmonicPools(v);
  });
  /* The UNWRAPPED wave setter: multiSetWave itself retargets to a selected operator (maths-fm.js). */
  setting('mu.wv', function () { return multiWv; }, function (v) { fmBaseSetWave(v); fmSyncSelUI(); });
  /* Not multiSetHarmonic: that rolls new ratios with this phone's dice. The master's arrive in mu.ops. */
  setting('mu.hi', function () { return multiHarmonicIdx; }, function (v) {
    multiHarmonicIdx = v;
    var t = $('mselHarmText'); if (t && HARMONIC_LISTS[v]) t.textContent = HARMONIC_LISTS[v].name.toUpperCase();
    Array.prototype.forEach.call(document.querySelectorAll('#mselHarmOpts .msel-opt'), function (o) { o.classList.toggle('active', +o.dataset.val === v); });
    recomputeHarmonicPools();
  });
  setting('mu.dur', function () { return multiDur; }, function (v) { multiDur = v; var r = $('multiDurR'); r.value = expSI(v, 0.10, 30); updateSliderVal('msDurVal', r, v.toFixed(2)); });
  setting('mu.vrate', function () { return muVolDur; }, function (v) { muVolDur = v; var r = $('multiVolRateR'); r.value = sliderFlip(expSI(v, 0.05, 60), 10000); updateSliderVal('msVolRateVal', r, v.toFixed(2)); });
  setting('mu.vr', function () { return [multiVolMin, multiVolMax]; }, function (v) { multiVolMin = v[0]; multiVolMax = v[1]; syncDualRange(); });
  flag('mu.vco', function () { return muVolCarriersOnly; }, function () { mathsToggleVolScope(); });
  flag('mu.auto', function () { return multiAutoOn; }, function () { toggleMultiAuto(); });
  setting('mu.fmd', function () { return multiFmDepth; }, function (v) { mathsSetFmDepth(v); });
  setting('mu.filt', function () { return [multiFiltLo, multiFiltHi]; }, function (v) { multiFiltLo = v[0]; multiFiltHi = v[1]; syncFiltRange(); multiFiltApply(); });
  flag('mu.filt.on', function () { return muFiltOn; }, function () { muFiltToggle(); });
  flag('mu.set.open', function () { return mathsSettingsOn; }, function () { toggleMathsSettings(); });

  /* pulse — NOISE's, on the muVs names */
  flag('mu.vs.on', function () { return muVsOn; }, function () { muVsToggle(); });
  flag('mu.vs.perosc', function () { return muVsPerOsc; }, function () { muVsTogglePerOsc(); });
  /* Assigned, not flipped: muVsToggleAuto refuses while per-osc is on, but the flag can still be
     set from before per-osc was switched on, and a slave has to be able to reach that state. */
  setting('mu.vs.auto', function () { return muVsAuto ? 1 : 0; }, function (v) {
    if (!!muVsAuto === !!v) return;
    muVsAuto = !!v;
    var b = $('muVsAutoBtn'); if (b) b.classList.toggle('on', muVsAuto);
    muVsPerOscUpd();
    if (muVsAuto) muVsAutoStart = performance.now();
  });
  setting('mu.vs.a', function () { return muVsA; }, function (v) { muVsA = v; $('muVsAV').textContent = Math.round(v * 1000); muVsRefreshFader(); });
  setting('mu.vs.b', function () { return muVsB; }, function (v) { muVsB = v; $('muVsBV').textContent = Math.round(v * 1000); muVsRefreshFader(); });
  setting('mu.vs.dur', function () { return muVsDur; }, function (v) { muVsDur = v; $('muVsDurV').textContent = v.toFixed(2); });
  setting('mu.vs.dir', function () { return muVsDir; }, function (v) { muVsDir = v; muVsRenderDir(); });
  setting('mu.vs.fader', function () { return Math.round(muVsFader * 1000); }, function (v) { muVsFader = v / 1000; $('muVsFaderR').value = sliderFlip(v, 1000); muVsRefreshFader(); });
  envelope('mu.vs.env', function () { return [muVsAtk, muVsDec]; }, function (v) { muVsAtk = v[0]; muVsDec = v[1]; }, function () { return muVsEnv; });
  panel('mu.vs.open', 'muVsPanel', 'vs-open', function () { muVsTogglePanel(); });
  anchor('mu.vs.t0', function () { return muVsAutoStart; }, function (v) { muVsAutoStart = v; });

  /* The operator list. Wire form: [[k, cell, ratio, wave, muted, targetHz], …] in the master's array
     order, k being the MASTER's operator id. A slave keeps its own operators (and so its own
     oscillators and its own level wander) and remembers which master id each one stands for. */
  var muK = new WeakMap();
  function muKey(o) { return muK.has(o) ? muK.get(o) : o.id; }
  function muTarget(o) { return multiSweepActive ? o.fTo : o.freq; }
  /* Turn this phone's operator list into the master's without rebuilding an oscillator that can be
     kept. A swap matched by cell would be two ratio changes and two slow glides; matched by id it
     is two pads changing places. */
  function muReconcile(list) {
    var want = list.map(function (e) { return { k: e[0], p: e[1], ratio: e[2], wv: e[3], muted: !!e[4], hz: e[5], op: null }; });
    var free = multiOscs.slice(), sel = muSelIdx >= 0 ? multiOscs[muSelIdx] : null, changed = false;
    function take(w, test) { for (var i = 0; i < free.length; i++) if (test(free[i])) { w.op = free[i]; free.splice(i, 1); return; } }
    /* 1. by the master's id; then whatever is left by likeness — a join, a master reload and an
          archive load all mint new ids, and this still reuses the oscillators */
    want.forEach(function (w) { take(w, function (o) { return muK.has(o) && muK.get(o) === w.k; }); });
    [function (w, o) { return o.p === w.p && o.ratio === w.ratio; }, function (w, o) { return o.ratio === w.ratio; },
     function (w, o) { return o.p === w.p; }, function () { return true; }].forEach(function (like) {
      want.forEach(function (w) { if (!w.op) take(w, function (o) { return like(w, o); }); });
    });
    /* 2. what this phone has and the master does not (multiOpRemove's body, minus its rebuild) */
    free.forEach(function (o) { multiRouteEpoch++; multiDisposeOp(o); if (sel === o) sel = null; changed = true; });
    /* 3. what the master has and this phone does not. Not multiOpAdd: that draws a random ratio. */
    want.forEach(function (w) {
      if (w.op) return;
      w.op = multiMakeOp(w.ratio, w.p, w.muted); changed = true;
      if (AC && multiMGain) { multiEnsureOpNodes(w.op, AC); w.op.gain.gain.setTargetAtTime(multiPlaying && !w.muted ? v2g(w.op.vol) : 0, AC.currentTime, .02); }
    });
    /* 4. each pair, field by field */
    want.forEach(function (w) {
      var o = w.op; muK.set(o, w.k);
      if (o.p !== w.p) { o.p = w.p; changed = true; }
      if (o.ratio !== w.ratio) { o.ratio = w.ratio; changed = true; }
      if (o.wv !== w.wv) { o.wv = w.wv; if (o.osc) o.osc.type = WF[o.wv >= 0 ? o.wv : multiWv]; changed = true; }
      if (!!o.muted !== w.muted) {                                   // multiMuteToggle's body, minus its render
        o.muted = w.muted; o._gLast = null; changed = true;
        if (o.gain && AC) o.gain.gain.setTargetAtTime(o.muted || !multiPlaying ? 0 : v2g(o.vol), AC.currentTime, .02);
      }
    });
    /* 5. the master's order is THE order: indices number the pads and address the selection */
    var order = want.map(function (w) { return w.op; });
    if (order.length !== multiOscs.length || order.some(function (o, i) { return multiOscs[i] !== o; })) { multiOscs = order; changed = true; }
    muSelIdx = sel ? multiOscs.indexOf(sel) : -1;
    /* 6. pitch: one glide, as the master's own edits are; when silent, simply land */
    var moving = want.some(function (w) { return muTarget(w.op) !== w.hz; });
    if (moving) {
      multiHarmonicSweep = false;
      if (multiPlaying) multiStartFreqSweep(want.map(function (w) { return w.hz; }));
      else want.forEach(function (w) { var o = w.op; o.freq = o.fFrom = o.fTo = w.hz; if (o.osc && AC) o.osc.frequency.setValueAtTime(w.hz, AC.currentTime); });
    }
    /* 7. finish once */
    if (!changed && !moving) return;
    if (changed) { multiFixCells(); muVsApplyTrem(); multiRebuildRouting(); }
    multiOscs.forEach(function (o) { multiApplyFmDepth(o, !multiPlaying); });
    fmSyncSelUI(); renderMulti(); multiAutoLast = null; multiAutoRecalc();
  }
  LINK.row({ id: 'mu.ops', kind: 'struct',
    get: function () { return multiOscs.map(function (o) { return [muKey(o), o.p, o.ratio, o.wv, o.muted ? 1 : 0, muTarget(o)]; }); },
    set: muReconcile });
  /* The operator the master is holding, and the level it was given. The level sweeper skips the
     selected operator, so on a slave the selection is also what makes the level stick. After mu.ops
     in the same batch, so the cell exists. */
  LINK.row({ id: 'mu.hold', kind: 'struct',
    get: function () { var o = muSelIdx >= 0 ? multiOscs[muSelIdx] : null; return o ? [o.p, o.vol] : null; },
    set: function (v) {
      if (!v) { if (muSelIdx >= 0) mathsSetSel(-1); return; }
      var i = multiOscs.findIndex(function (o) { return o.p === v[0]; }); if (i < 0) return;
      if (muSelIdx !== i) mathsSetSel(i);
      if (multiOscs[i].vol !== v[1]) { $('multiMVolR').value = Math.round(v[1]); mathsVolInput(v[1]); }
    } });
  /* Leaving the MATHS tab clears the selection (switchTab), which on a slave would drop the held
     operator back into the sweeper. A slave's selection is the master's to clear. */
  var realClearSel = mathsClearSel;
  mathsClearSel = function () { if (LINK.info().role === 'slave') return; return realClearSel.apply(this, arguments); };

  /* ── FX rack ──────────────────────────────────────────────────────────────── */
  /* Not a row: COMP's gain-reduction readout — engine output. */
  /* One send per unit per mixer strip, generated from the registry, so a unit added later gets its
     rows without this file changing. Only COMP has a knob on the master strip. */
  FX._units.forEach(function (u) {
    if (u.inert) return;
    MIX_CH.forEach(function (ch) {
      if (ch.master && !u.master) return;
      setting('fx.' + u.key + '.' + ch.key, function () { return FX.amt(u.key, ch.key); }, function (v) { FX.setAmt(u.key, ch.key, v); });
    });
  });
  /* A unit's rack. `fns` are its window-level handlers; `params` maps a row name to the rack's
     knob id. The settings object is captured once: FX.load() merges into it and never replaces it. */
  function fxUnit(key, fns, params) {
    var S = FX.state(key);
    flag('fx.' + key + '.on', function () { return S.on; }, function () { window[fns.toggle](); });
    /* The only type setter is "next", so step until it reads right; bounded, in case the master
       runs a build with a type this one does not have. */
    setting('fx.' + key + '.type', function () { return S.type; }, function (v) { for (var n = 0; S.type !== v && n < 8; n++) window[fns.type](); });
    if (fns.mode) setting('fx.' + key + '.mode', function () { return S.mode; }, function (v) { if (S.mode !== v) window[fns.mode](); });
    Object.keys(params).forEach(function (name) {
      /* setRow moves the knob AND drives the DSP; before the rack is mounted the unit reads S itself. */
      setting('fx.' + key + '.' + name, function () { return S[name]; }, function (v) { var R = FX.rackOf(key); if (R) R.setRow(params[name], v); else S[name] = v; });
    });
  }
  fxUnit('drive', { toggle: 'drvToggle', type: 'drvCycleType', mode: 'drvCycleMode' }, { drive: 'Drive', crush: 'Crush', tone: 'Tone' });
  fxUnit('comp', { toggle: 'cmpToggle', type: 'cmpCycleType' }, { squash: 'Squash', speed: 'Speed', makeup: 'Makeup' });
  fxUnit('verb', { toggle: 'vrbToggle', type: 'vrbCycleType', mode: 'vrbCycleMode' }, { size: 'Size', decay: 'Decay', tone: 'Tone' });

  /* ── VOICE ────────────────────────────────────────────────────────────────── */
  /* Never a row: the mouth canvas and its pitch strip. They are each phone's own (spec section 8). */

  /* The four switches live inside the engine, and a phone starts that engine only when its owner
     opens VOICE or the master speaks: it renders audio on the main thread and never stops. Before
     then VT.setOtotune / setFree would draw on canvases that do not exist (restoreState guards them
     the same way). So a switch set early is remembered and shown, and handed over when it starts. */
  var vtWant = {};
  function voiceSwitch(id, name, btn) {
    setting(id, function () { return (vtInitialized ? VT['get' + name]() : vtWant[name]) ? 1 : 0; }, function (v) {
      v = !!v;
      if (!vtInitialized) vtWant[name] = v;
      else if (!!VT['get' + name]() !== v) VT['set' + name](v);
      $(btn).classList.toggle('on', v);
    });
  }
  voiceSwitch('vt.oto', 'Ototune', 'vtOtotuneBtn');
  voiceSwitch('vt.free', 'Free', 'vtFreeBtn');
  voiceSwitch('vt.wob', 'AutoWobble', 'vtAutoWobbleBtn');
  voiceSwitch('vt.av', 'AlwaysVoice', 'vtAlwaysVoiceBtn');
  var realVtInit = vtInit;
  vtInit = function () {
    var out = realVtInit.apply(this, arguments);
    for (var name in vtWant) if (!!VT['get' + name]() !== vtWant[name]) VT['set' + name](vtWant[name]);
    vtWant = {};
    return out;
  };

  /* SPEAK's text is held back while the master is typing: every keystroke would send the whole text
     to every phone. Nothing needs it before SPEAK starts, and a start fixes it (below) in the same
     pass, settings being applied before transport. While something is speaking the row IS that
     utterance's text: what the master types next must not reach a latecomer as a half-typed phrase
     to loop. 2000 characters is the archive's own limit. */
  var spkText = null;
  function spkCut(t) { return (t || '').slice(0, 2000); }
  setting('vt.spk.text', function () {
    if (spkText === null || (!vtSpkPlaying && document.activeElement !== $('vtSpeakText'))) spkText = spkCut(vtSpkText);
    return spkText;
  }, function (v) { vtSpkText = spkText = v; $('vtSpeakText').value = v; });   // vtSpkStart reads the box, not the global
  setting('vt.spk.lang', function () { return vtSpkLang; }, function (v) {
    if (vtSpkLang !== v) vtSpkSetLang(v);
    /* Fetched now, not at the first word: a phone still downloading its dictionary starts late, and
       one whose download fails reads the same text with other phonemes. The first snapshot applies
       every row, so this is also the fetch at join. */
    var p = vtSpkLangCur().prepare(); if (p && p.catch) p.catch(function () {});
  });
  setting('vt.spk.rate', function () { return vtSpkRate; }, function (v) { vtSpkRate = v; $('vtSpeakRateR').value = vtSpkRateSlider(v); });
  flag('vt.spk.loop', function () { return vtSpkLoop; }, function () { vtSpkToggleLoop(); });

  /* SPEAK ends by itself, on every phone separately, so "speaking" cannot travel as a switch: the
     master's own ending would reach a slave a network delay before that slave's last syllable and
     cut it. The row is [speaking, starts, cuts]. A slave starts when `starts` moves, stops when
     `cuts` moves, and lets its own utterance run out when only the flag drops. */
  var spk = { starts: 0, cuts: 0, seen: null, quiet: false, away: false };
  var realSpkStart = vtSpkStart, realSpkStop = vtSpkStop;
  vtSpkStart = function () {
    var was = vtSpkPlaying, out = realSpkStart.apply(this, arguments);
    if (!was && vtSpkPlaying) {
      spkText = spkCut($('vtSpeakText').value);                 // this utterance's text, for as long as it runs
      if (!spk.quiet) spk.starts++;
    }
    return out;
  };
  /* A stop counts only when made by hand: the button, a language change, an ARCHIVE load. The
     natural end arrives from a timer (VT's spkOnEnd); the app's own stop after the screen was away
     arrives in `visibilitychange`. Neither may stop the room. */
  vtSpkStop = function () {
    if (!spk.quiet && vtSpkPlaying && byHand()) spk.cuts++;
    return realSpkStop.apply(this, arguments);
  };
  function spkSay() {
    if (!vtInitialized) { vtInitialized = true; vtInit(); }   // switchTab's own first-open step; not mounted, the tab is not showing
    if (vtSpkPlaying) vtSpkStop();
    vtSpkStart();
  }
  /* Starts and stops that say nothing new to the room: a slave obeying it, or a phone falling in again. */
  function quietly(fn) { spk.quiet = true; try { fn(); } finally { spk.quiet = false; } }
  LINK.on(function (evt) { if (evt === 'joined') spk.seen = null; });
  LINK.row({ id: 'vt.spk', kind: 'transport',
    get: function () { return LINK.info().role === 'slave' && spk.seen ? spk.seen : [vtSpkPlaying ? 1 : 0, spk.starts, spk.cuts]; },
    set: function (v) {
      var was = spk.seen; spk.seen = v;
      /* A master taking over a room carries the room's counts on, so its claim says nothing new. */
      if (LINK.info().role !== 'slave') { spk.starts = v[1]; spk.cuts = v[2]; }
      quietly(function () {
        /* Joining: fall in with a looping voice, but never replay a single phrase already under way. */
        if (!was) { if (v[0] && vtSpkLoop && !vtSpkPlaying) spkSay(); }
        else {
          if (v[2] !== was[2] && vtSpkPlaying) vtSpkStop();
          if (v[1] !== was[1] && v[0]) spkSay();
        }
      });
    },
    /* The self-check must never re-apply an event. One state is safe to restore: a looping voice
       this phone has fallen out of — its screen was away (the app stops SPEAK after 2 s), or the
       loop was switched on after its own phrase had ended. A loop has no ending to cut short. */
    heal: function (v) { if (v[0] && vtSpkLoop && !vtSpkPlaying) quietly(spkSay); } });
  /* The master's own phone drops out of its loop the same way. It falls in again at once — this
     listener runs after the app's — so the room's flag never drops and nothing is counted. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { spk.away = vtSpkPlaying && vtSpkLoop; return; }
    if (spk.away && LINK.info().role === 'master' && vtSpkLoop && !vtSpkPlaying) quietly(spkSay);
    spk.away = false;
  });
})();
