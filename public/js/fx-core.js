/* ═══════════════════════════════════════════════════════════════════════════
   FX CORE — the mixer's effect layer.

   Owns four things and nothing else:
     1. the rotary KNOB primitive (this app's first; everything else is a fader)
     2. per-channel ROUTING — an insert chain, then a tap feeding a dry path plus
        one send per registered unit — and the MASTER BUS everything sums into
     3. a REGISTRY, so DRIVE / COMP / REVERB are data rather than layout
     4. the collapsible RACK BAR shared by every unit

   Loaded as a CLASSIC script AFTER index.html's inline block, so `AC`, `appMaster`,
   `getAC` and `MIX_CH` are already out of their temporal dead zone. Mounting happens
   on DOMContentLoaded, which fires after every body script — so this file and
   fx-*.js can load in any order.
   ═══════════════════════════════════════════════════════════════════════════ */
var FX = (function () {
  var units = [];        // registered units, in strip render order
  var chans = {};        // chKey -> {inp, tap, dry, ins:{}, snd:{}}
  var amt = {};          // unitKey -> {chKey: 0..100}
  var knobs = {};        // unitKey -> {chKey: knob handle}
  var store = {};        // unitKey -> persisted unit state (units read/write freely)
  var MASTER = 'master';

  /* ── persistence ─────────────────────────────────────────────────────────
     Same shape and lifecycle as pbb_ui / pvt_ui / posc_ui: whole blob, write on
     drag-end, tolerate absent or corrupt values. */
  /* MERGE into the existing objects — never reassign `store` or `amt`.
     Each unit captures its own settings object once, at script-load time
     (`var S = FX.state('comp')`), which happens long before mount() runs load().
     Replacing the container leaves every unit holding an orphan: the restored
     values sit in the new `store` while the unit reads and writes the old one, so
     rack settings silently fail to come back AND stop being saved. Same reasoning
     for `amt`, whose per-unit maps register() creates before load() is called. */
  function load() {
    try {
      var o = JSON.parse(localStorage.getItem('pfx_ui')) || {}, k, q;
      if (o.amt) for (k in o.amt) { if (!amt[k]) amt[k] = {}; for (q in o.amt[k]) amt[k][q] = o.amt[k][q]; }
      if (o.units) for (k in o.units) { var dst = state(k), src = o.units[k]; for (q in src) dst[q] = src[q]; }
    } catch (e) {}
  }
  function persist() {
    try { localStorage.setItem('pfx_ui', JSON.stringify({ amt: amt, units: store })); } catch (e) {}
  }

  /* ── registry ────────────────────────────────────────────────────────────
     A unit declares:
       key, label       strip knob identity ('drive' / 'DRV')
       inert            render dimmed and unresponsive (REVERB until built)
       master           also render a knob on the MASTER strip (COMP does)
       busIn()          SEND unit: lazily build + return its bus input node
       route(ch,a)      SEND unit: -> {dry, snd} gains for amount a (0..1)
       insert(ch)       INSERT unit: build + return {in, out} spliced before the tap
       applyAmt(ch,a)   INSERT unit: write its own wet/dry for amount a

     Registration MUST finish before the first ports() call, because the insert
     chain is wired once at build time and never re-ordered. That holds: every
     fx-*.js loads before DOMContentLoaded, and no audio node exists until a user
     gesture starts the AudioContext. */
  function register(def) { units.push(def); if (!amt[def.key]) amt[def.key] = {}; knobs[def.key] = {}; }
  function unit(k) { for (var i = 0; i < units.length; i++) if (units[i].key === k) return units[i]; return null; }
  function state(k) { return store[k] || (store[k] = {}); }

  /* ── routing ─────────────────────────────────────────────────────────────
       xMGain -> inp -> [inserts] -> tap -+- dry -----------------> masterBus
                                          +- snd.drive -> drvIn --> masterBus
       masterBus -> inp -> [inserts] -> tap -> dry -> appMaster (THE FADER)

     MASTER is the same structure minus sends, so there is one code path rather
     than two. Its dry goes to appMaster directly — routing it through out() would
     be a loop — and everything upstream of appMaster.gain is pre-fader by
     construction, which is what "compressor on master, pre-fader" means.

     `tap` exists so re-tapping a re-created source node (TONE GEN rebuilds rsMGn
     on every start) touches exactly one connection and never disturbs the sends. */
  function ports(chKey) {
    var s = chans[chKey];
    if (s) return s;
    var c = getAC();
    s = chans[chKey] = { inp: c.createGain(), tap: c.createGain(), dry: c.createGain(), ins: {}, snd: {} };
    s.dry.gain.value = 1;
    var last = s.inp;
    for (var i = 0; i < units.length; i++) {
      var u = units[i]; if (!u.insert) continue;
      var io = u.insert(chKey); if (!io) continue;
      last.connect(io.in); last = io.out; s.ins[u.key] = io;
    }
    last.connect(s.tap);
    s.tap.connect(s.dry);
    s.dry.connect(chKey === MASTER ? appMaster : out());
    if (chKey !== MASTER) ensureSends(s);
    applyCh(chKey);
    return s;
  }

  /* The node every channel and every FX return sums into. Master inserts sit
     between it and the fader. */
  function out() { return ports(MASTER).inp; }

  /* Idempotent: safe to call repeatedly, and it is what lets a unit registered
     after a channel was already tapped still get its send. MASTER never gets one
     — a send from the master bus would feed masterBus -> drvIn -> drvOut ->
     masterBus, a feedback loop. */
  function ensureSends(s) {
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (s.snd[u.key] || !u.busIn) continue;
      var bus = u.busIn(); if (!bus) continue;
      var g = getAC().createGain(); g.gain.value = 0;
      s.tap.connect(g); g.connect(bus);
      s.snd[u.key] = g;
    }
  }

  /* Called from index.html in place of `node.connect(appMaster)`. */
  function tap(chKey, node) {
    var s = ports(chKey);
    try { node.disconnect(appMaster); } catch (e) {}
    node.connect(s.inp);
    applyCh(chKey);
    return s;
  }

  /* Push every unit's stored amount into a channel. Runs on first tap too, so a
     knob turned before that module ever played takes effect the moment it does. */
  function applyCh(chKey) {
    var s = chans[chKey]; if (!s || !AC) return;
    var dry = 1;
    for (var i = 0; i < units.length; i++) {
      var u = units[i], a = (amt[u.key][chKey] || 0) / 100;
      if (u.applyAmt) { u.applyAmt(chKey, a); continue; }        // insert unit: owns its own gains
      if (!u.route) continue;
      var r = u.route(chKey, a);                                  // -> {dry, snd}
      if (r.dry !== null && r.dry !== undefined) dry = Math.min(dry, r.dry);
      var g = s.snd[u.key];
      if (g) g.gain.setTargetAtTime(r.snd, AC.currentTime, .02);
    }
    s.dry.gain.setTargetAtTime(dry, AC.currentTime, .02);
  }
  function applyAll() { for (var k in chans) applyCh(k); }

  function getAmt(uKey, chKey) { var m = amt[uKey]; return m && m[chKey] != null ? m[chKey] : 0; }
  function setAmt(uKey, chKey, v) {
    v = Math.max(0, Math.min(100, Math.round(v)));
    amt[uKey][chKey] = v;
    var kb = knobs[uKey] && knobs[uKey][chKey]; if (kb) kb.set(v);
    applyCh(chKey);
  }
  function knobOf(uKey, chKey) { return knobs[uKey] && knobs[uKey][chKey]; }
  function chKeys() { var a = []; document.querySelectorAll('#mixerSliders .mix-fx').forEach(function (h) { if (h.dataset.key) a.push(h.dataset.key); }); return a; }

  /* ── knob ────────────────────────────────────────────────────────────────
     Vertical drag over 160px of travel, pointer-capture so the finger may leave
     the dial — the initBBPause() pattern, not initMixer's older mouse/touch pair.

     Two shapes from one primitive:
       channel send  label at rest, value while dragging, 0..100
       rack param    name above the dial, value always below, arbitrary min/max

     o = {label|name, value, min, max, bipolar, fmt, readout, inert, cls, onchange} */
  function knob(host, o) {
    var min = o.min === undefined ? 0 : o.min,
        max = o.max === undefined ? 100 : o.max,
        span = (max - min) || 1,
        bip = !!o.bipolar,
        always = o.readout === 'always';

    var el = document.createElement('div');
    el.className = 'fxk' + (o.inert ? ' fxk-inert' : '') + (always ? ' fxk-rack' : '') + (o.cls ? ' ' + o.cls : '');
    if (o.name) { var t = document.createElement('div'); t.className = 'fxk-top'; t.textContent = o.name; el.appendChild(t); }
    var dial = document.createElement('div'); dial.className = 'fxk-dial';
    dial.appendChild(document.createElement('i'));
    var lbl = document.createElement('div'); lbl.className = 'fxk-lbl';
    el.appendChild(dial); el.appendChild(lbl); host.appendChild(el);

    var v = o.value === undefined ? min : o.value, drag = false, y0 = 0, v0 = 0, note = '';
    function fmt() { return o.fmt ? o.fmt(v) : String(v); }
    function text() { lbl.textContent = (always || drag) ? fmt() : (note || o.label || ''); }
    function paint() {
      var p = (v - min) / span;
      dial.style.setProperty('--a', (-135 + 270 * p).toFixed(1) + 'deg');
      /* The arc is a fill between --p0 and --p1 over a fixed track, so a BIPOLAR
         param fills outward from its zero instead of showing a half-full dial at
         its neutral value. COMP's MAKEUP (-12..+12) is the one that needs it. */
      var z = bip ? (0 - min) / span : 0;
      dial.style.setProperty('--p0', Math.min(z, p).toFixed(4));
      dial.style.setProperty('--p1', Math.max(z, p).toFixed(4));
      el.classList.toggle('fxk-live', Math.abs(p - z) > 0.001);
    }
    function set(nv) { v = Math.max(min, Math.min(max, Math.round(nv))); paint(); text(); }
    set(v);

    if (!o.inert) {
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault(); e.stopPropagation();
        drag = true; y0 = e.clientY; v0 = v; el.classList.add('fxk-drag'); text();
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
      });
      el.addEventListener('pointermove', function (e) {
        if (!drag) return; e.preventDefault();
        set(v0 + (y0 - e.clientY) * (span / 160));
        if (o.onchange) o.onchange(v);
      });
      function end(e) {
        if (!drag) return;
        drag = false; el.classList.remove('fxk-drag'); text();
        try { el.releasePointerCapture(e.pointerId); } catch (_) {}
        persist();
      }
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
    return {
      el: el, set: set, get: function () { return v; },
      note: function (t) { if (t === note) return; note = t || ''; text(); }
    };
  }

  /* ── rack bar ────────────────────────────────────────────────────────────
     Three zones on one flex row, always open — there is nothing to expand:

       [ on/off key ]   [ name/knob/value x3 ]   [ type chip  ]
        centre-left        horizontal              mode-or-dB ]  stacked

     The accordion that used to live here is gone with the collapsing. It existed
     because three OPEN slider racks were ~438px against a ~700px mixer; one row
     of knobs is short enough that all three fit permanently.

       o = {key, unit, label, chips:[{id,text,onclick}],
            rows:[{id,label,min,max,val,fmt,oninput}], onToggle}
     Returns {panel, chip(id,text), setOn(bool), row(id) -> knob handle} */
  function rack(o) {
    var mod = document.getElementById('modMixer'), wrap = document.getElementById('mixerSliders');
    if (!mod || !wrap) return null;
    var host = document.getElementById('fxRacks');
    if (!host) { host = document.createElement('div'); host.id = 'fxRacks'; mod.insertBefore(host, wrap); }

    var p = document.createElement('div');
    p.className = 'fx-rack u-' + o.unit; p.id = o.key + 'Panel';
    var bar = document.createElement('div'); bar.className = 'fx-rack-bar';

    var key = document.createElement('button');
    key.className = 'pulse-lbl pkey fx-rack-key'; key.id = o.key + 'LabelBtn';
    key.setAttribute('role', 'switch'); key.setAttribute('aria-label', o.label + ' on/off');
    key.textContent = o.label;
    key.onclick = function () { if (o.onToggle) o.onToggle(); };

    var mid = document.createElement('div'); mid.className = 'fx-rack-knobs';
    var chips = document.createElement('div'); chips.className = 'fx-rack-chips';
    bar.appendChild(key); bar.appendChild(mid); bar.appendChild(chips);
    p.appendChild(bar); host.appendChild(p);

    var kn = {}, cb = {};
    (o.rows || []).forEach(function (r) {
      cb[r.id] = r.oninput;
      kn[r.id] = knob(mid, {
        name: r.label, readout: 'always', min: r.min, max: r.max,
        bipolar: r.min < 0 && r.max > 0, value: r.val, fmt: r.fmt,
        onchange: function (val) { r.oninput(val); }
      });
      r.oninput(kn[r.id].get());          // push the restored value into the DSP
    });
    /* A chip is a BUTTON or a READOUT and must not look like the other, so the
       class is decided here from whether it has a handler. `unit` renders the
       app's small .pnum-u suffix, which is what marks a value display. */
    (o.chips || []).forEach(function (c) {
      var sp = document.createElement('span');
      sp.className = 'pulse-num fx-rack-chip ' + (c.onclick ? 'fx-rack-btn' : 'fx-rack-ro') +
        (c.cls ? ' ' + c.cls : '');
      sp.id = o.key + c.id + 'Btn';
      sp.innerHTML = '<span class="pnum-v" id="' + o.key + c.id + 'V">' + c.text + '</span>' +
        (c.unit ? '<span class="pnum-u">' + c.unit + '</span>' : '');
      if (c.onclick) sp.onclick = c.onclick;
      chips.appendChild(sp);
    });

    return {
      panel: p,
      chip: function (id, t) { var e = document.getElementById(o.key + id + 'V'); if (e) e.textContent = t; },
      chipClass: function (id, name, on) {
        var e = document.getElementById(o.key + id + 'Btn'); if (e) e.classList.toggle(name, !!on);
      },
      setOn: function (on) {
        p.classList.toggle('rack-on', !!on);
        key.classList.toggle('on', !!on); key.setAttribute('aria-checked', on ? 'true' : 'false');
      },
      row: function (id) { return kn[id]; },
      /* set a parameter as if it had been dialled: moves the knob AND drives the DSP.
         `row(id).set()` alone only repaints, since onchange fires from the drag. */
      setRow: function (id, v) { var k = kn[id]; if (!k) return; k.set(v); if (cb[id]) cb[id](k.get()); }
    };
  }

  /* ── mount ───────────────────────────────────────────────────────────────
     Fills the empty .mix-fx containers initMixer() left behind. The MASTER column
     has one too and takes only units flagged master:true — so it renders exactly
     one knob (COMP) while still spacing the fader top level with the channels. */
  function mount() {
    load();
    document.querySelectorAll('#mixerSliders .mix-fx').forEach(function (host) {
      var chKey = host.dataset.key; if (!chKey) return;
      units.forEach(function (u) {
        if (chKey === MASTER && !u.master) return;
        knobs[u.key][chKey] = knob(host, {
          label: u.label, inert: !!u.inert, value: getAmt(u.key, chKey),
          cls: 'u-' + u.key,                 // carries that unit's colour onto its send knobs
          onchange: function (val) { amt[u.key][chKey] = val; applyCh(chKey); }
        });
      });
    });
    units.forEach(function (u) { if (u.mount) u.mount(); });
  }
  document.addEventListener('DOMContentLoaded', mount);

  return {
    register: register, unit: unit, state: state, persist: persist,
    tap: tap, ports: ports, out: out, applyCh: applyCh, applyAll: applyAll,
    amt: getAmt, setAmt: setAmt, knob: knob, knobOf: knobOf, chKeys: chKeys,
    rack: rack, mount: mount, MASTER: MASTER,
    _chans: chans, _units: units
  };
})();

/* Global alias — index.html's module graphs call this in place of connect(appMaster). */
function fxTap(chKey, node) { return FX.tap(chKey, node); }
