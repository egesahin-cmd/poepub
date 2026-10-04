/* ═══════════════════════════════════════════════════════════════════════════
   LINK table — the rows: every poepub parameter the master mirrors to the room.

   One row per parameter. get() reads the global that holds INTENT; set(v) reaches
   the same state through the app's own write path, so the control's visual and the
   audio both follow, and get() === v afterwards. Parameters without a row simply do
   not mirror yet.

   Stage 1: the four play/stop transports and the app master volume.
   Loaded after link-core.js. Spec section 3 and "Stage 1 rows".
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

  /* updMix moves the mixer fader as well as the gain. Looked up by flag, not by position. */
  var MASTER_CH = MIX_CH.findIndex(function (c) { return c.master; });
  LINK.row({ id: 'app.vol', kind: 'setting',
    get: function () { return appMasterVol; },
    set: function (v) { updMix(MASTER_CH, v); } });
})();
