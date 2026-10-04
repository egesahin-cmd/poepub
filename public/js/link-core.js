/* ═══════════════════════════════════════════════════════════════════════════
   LINK core — one master phone conducts a room of slave phones.

   Owns: the role, the socket, the shared clock, the master's send loop and the
   slave's apply loop. It knows nothing about poepub's parameters (those are rows,
   registered by link-table.js) and nothing about the look (link-ui.js listens).

   Loaded as a CLASSIC script after index.html's inline block, like fx-core.js.
   Spec: docs/superpowers/specs/2026-10-04-link-master-slave-design.md, sections 2-5.
   ═══════════════════════════════════════════════════════════════════════════ */
var LINK = (function () {
  'use strict';
  var V = 1;               // protocol version, must match link-server.js
  var POLL_MS = 50;        // master reads its own state 20 times a second
  var MOVING_MS = 150;     // a row that changed this recently is "still moving"
  var HEAL_MS = 2000;      // slave re-checks itself against the mirror
  var PING_MS = 10000;     // clock upkeep

  /* ── pure helpers (unit-tested in Node, see test/link/core.test.js) ───────── */

  /* Must stay identical to normRoom() in link-server.js. */
  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32).replace(/^-+|-+$/g, '');
  }
  function eq(a, b) {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
    return true;
  }
  function clone(v) { return Array.isArray(v) ? v.map(clone) : v; }
  function cloneState(st) { var o = {}; for (var id in st) o[id] = clone(st[id]); return o; }

  /* One pass of the master's loop. S = {sent, lastT, owe}. Returns the rows to send reliably (rel)
     and the rows to send as a droppable "still moving" batch (vol).
     A row's first change goes out reliably. Further changes inside MOVING_MS are a stream and go
     out droppable; once the row has been still for MOVING_MS its final value is sent reliably, so
     a dropped packet can never leave a slave on a stale value. */
  function step(cur, S, now) {
    var rel = null, vol = null;
    for (var id in cur) {
      if (!eq(cur[id], S.sent[id])) {
        var streaming = S.lastT[id] != null && now - S.lastT[id] < MOVING_MS;
        S.sent[id] = clone(cur[id]); S.lastT[id] = now;
        if (streaming) { (vol = vol || {})[id] = cur[id]; S.owe[id] = true; }
        else { (rel = rel || {})[id] = cur[id]; S.owe[id] = false; }
      } else if (S.owe[id] && now - S.lastT[id] >= MOVING_MS) {
        (rel = rel || {})[id] = cur[id]; S.owe[id] = false;
      }
    }
    return { rel: rel, vol: vol };
  }

  /* Order inside one batch: stops, settings, structure, starts, anchors. Anchors go last because
     the play toggles restamp them. */
  function phase(row, v) {
    return row.kind === 'transport' ? (v ? 3 : 0) : row.kind === 'anchor' ? 4 : row.kind === 'struct' ? 2 : 1;
  }

  /* Anchors: a start time. The app keeps it in local performance.now() time; the wire carries
     shared-clock time. off = shared - local.
     Out: cached per row, so a still anchor does not look changed while the offset slews; converted
     again when the local value changes or the offset has moved by more than ANCHOR_SLOP. */
  var ANCHOR_SLOP = 5;     // ms
  function anchorOut(cache, id, local, off) {
    var a = cache[id];
    if (a && a.local === local && Math.abs(off - a.off) <= ANCHOR_SLOP) return a.shared;
    cache[id] = a = { local: local, shared: local + off, off: off };
    return a.shared;
  }
  function anchorIn(cache, id, shared, off) {
    var local = shared - off;
    cache[id] = { local: local, shared: shared, off: off };
    return local;
  }

  /* Clock: the sample with the shortest round trip is the least distorted. */
  function pick(samples) { var b = null; for (var i = 0; i < samples.length; i++) if (!b || samples[i].rtt < b.rtt) b = samples[i]; return b; }
  function settle(cur, target) { return cur == null || Math.abs(target - cur) > 50 ? target : cur + (target - cur) * 0.25; }

  /* ── the table ────────────────────────────────────────────────────────────── */
  var rows = [], byId = Object.create(null);
  /* row: {id, kind:'setting'|'transport'|'anchor'|'struct', get(), set(v), heal?}
     get reads the globals that hold INTENT (never the DOM, never an in-flight value);
     set is idempotent, makes no click, updates the control's visual, and get() === v afterwards. */
  function row(r) { rows.push(r); byId[r.id] = r; }
  /* Anchors are left out while the clock has no estimate: nothing sensible could be sent. */
  function readAll() {
    var o = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.kind !== 'anchor') o[r.id] = r.get();
      else if (off !== null) o[r.id] = anchorOut(anchors, r.id, r.get(), off);
    }
    return o;
  }

  /* ── state ────────────────────────────────────────────────────────────────── */
  var role = null, room = '', key = '', sock = null;
  var joined = false, online = false, count = 0, held = false, fresh = true;
  var epoch = 0, rev = 0;
  var S = null;            // master: {sent, lastT, owe}; sent = the state as last RELEASED to the room
  var mirror = null;       // slave: the last state received from the master
  var pend = null, raf = 0;
  var off = null, samples = [];
  var anchors = Object.create(null);   // row id -> {local, shared, off}: the last conversion, see anchorOut
  var stale = Object.create(null);     // slave: anchors not to self-check until the server confirms them
  var timers = [], subs = [];

  function on(fn) { subs.push(fn); }
  function tell(evt, data) { for (var i = 0; i < subs.length; i++) { try { subs[i](evt, data); } catch (_) {} } }
  function info() {
    return { role: role, room: room, joined: joined, online: online, count: count, held: held,
             connected: !!(sock && sock.connected) };
  }

  /* ── slave: apply ─────────────────────────────────────────────────────────── */
  function applyBatch(d) {
    var list = [];
    for (var id in d) if (byId[id]) list.push([byId[id], d[id]]);       // unknown ids are ignored
    list.sort(function (a, b) { return phase(a[0], a[1]) - phase(b[0], b[1]); });
    for (var i = 0; i < list.length; i++) {
      var r = list[i][0], v = list[i][1];
      if (r.kind === 'anchor') {
        if (off === null) continue;                              // no clock yet: the self-check applies it later
        v = anchorIn(anchors, r.id, v, off);
      }
      try { r.set(v); }
      catch (e) { if (typeof console !== 'undefined') console.warn('LINK row ' + r.id, e); }
    }
  }
  /* Rows are collected and applied once per frame, so a burst of packets costs one pass. */
  function queue(d) {
    pend = pend || {};
    for (var id in d) { pend[id] = d[id]; mirror[id] = clone(d[id]); delete stale[id]; }
    if (!raf) raf = requestAnimationFrame(flush);
  }
  function flush() { raf = 0; var d = pend; pend = null; if (d && role === 'slave') applyBatch(d); }
  /* The first snapshot applies every row, because a phone's boot state is arbitrary (MATHS and
     BIRDBOX randomise at boot). Later ones apply only what differs, so a resync is inaudible. */
  function takeState(st) {
    var first = !mirror, d = {}, any = false;
    if (first) mirror = {};
    for (var id in st) {
      delete stale[id];                                          // the server has it, on its current clock
      if (first || !eq(st[id], mirror[id])) { d[id] = st[id]; any = true; }
    }
    if (any) queue(d);
  }
  function heal() {
    if (role !== 'slave' || !mirror || pend || document.hidden) return;
    var d = null;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.heal === false || !(r.id in mirror)) continue;
      /* A row whose value is an event cannot be healed by re-applying it, but may know a state it
         can safely restore: it is handed what the room has. */
      if (typeof r.heal === 'function') {
        try { r.heal(mirror[r.id]); } catch (e) { if (typeof console !== 'undefined') console.warn('LINK row ' + r.id, e); }
        continue;
      }
      if (r.kind === 'anchor') {
        /* One rule covers a wake (the app shifts its start times by the hidden time) and a clock
           that has moved: put the start back where the master's is, in this phone's time. */
        if (off !== null && !stale[r.id] && Math.abs(r.get() - (mirror[r.id] - off)) > ANCHOR_SLOP) (d = d || {})[r.id] = mirror[r.id];
        continue;
      }
      if (!eq(r.get(), mirror[r.id])) (d = d || {})[r.id] = mirror[r.id];
    }
    if (d) applyBatch(d);
  }
  function resync() {
    if (role !== 'slave' || !sock || !sock.connected) return;
    sock.timeout(5000).emit('sync', function (err, a) {
      if (err || !a || role !== 'slave') return;
      epoch = a.e; rev = a.r;
      if (a.st) takeState(a.st);
    });
  }

  /* ── master: send ─────────────────────────────────────────────────────────── */
  /* Nothing is read while disconnected or held, so S.sent stays on what the room last got and the
     next pass sends every difference at once. Emitting while disconnected would be buffered and
     replayed by socket.io, which is exactly what HOLD must not do. */
  function poll() {
    if (role !== 'master' || !joined || held || !sock || !sock.connected) return;
    var out = step(readAll(), S, performance.now());
    if (out.rel) sock.emit('d', { d: out.rel });
    if (out.vol) sock.volatile.emit('d', { d: out.vol, c: 1 });
  }
  function hold(v) {
    if (role !== 'master') return;
    held = !!v; tell('state');
    if (!held) setTimeout(poll, 0);
  }
  function put() { sock.emit('put', { st: S.sent }, function (a) { if (a) { epoch = a.e; rev = a.r; } }); }

  /* ── joining ──────────────────────────────────────────────────────────────── */
  function refuse(a) { var why = (a && a.err) || 'error'; stop(); tell('refused', why); tell('state'); }
  function again() { setTimeout(hello, 1000); }
  /* Runs on every (re)connect. */
  function hello() {
    if (!sock || !sock.connected || !role) return;
    /* A (re)connect may be to a restarted server, whose clock starts again. The master converts its
       anchors afresh; a slave leaves its anchors alone until a state from the server confirms them. */
    anchors = Object.create(null);
    for (var i = 0; i < rows.length; i++) if (rows[i].kind === 'anchor') stale[rows[i].id] = true;
    burst();
    if (role === 'master') {
      sock.timeout(5000).emit('claim', { v: V, room: room, key: key }, function (err, a) {
        if (role !== 'master') return;
        if (err) return again();
        if (!a || !a.ok) return refuse(a);
        epoch = a.e; rev = a.r; count = a.n; online = true;
        if (fresh && a.st && a.n > 0) {
          /* Slaves are already in the room: take it over as it is rather than reset them. */
          applyBatch(a.st);
          S = { sent: cloneState(a.st), lastT: {}, owe: {} };
        } else if (fresh) {
          S = { sent: readAll(), lastT: {}, owe: {} };
          put();
        } else if (a.st) {
          /* A reconnect. What the room HAS is the truth about what was released: a batch written
             into a dying connection is thrown away by socket.io, not replayed. Diffing against the
             room's state makes the next pass send exactly what it is missing — and while holding,
             nothing, since no pass runs. */
          S = { sent: cloneState(a.st), lastT: {}, owe: {} };
        } else {
          /* A reconnect to a server that lost its cache: publish S.sent, the last RELEASED state,
             never the live one. Safe while holding. */
          put();
        }
        fresh = false;
        if (!joined) { joined = true; tell('joined'); }
        tell('state');
      });
    } else {
      sock.timeout(5000).emit('follow', { v: V, room: room }, function (err, a) {
        if (role !== 'slave') return;
        if (err) return again();
        if (!a || !a.ok) return refuse(a);
        online = !!a.on; count = a.n; epoch = a.e; rev = a.r;
        if (a.st) takeState(a.st);
        if (!joined) { joined = true; tell('joined'); }
        tell('state');
      });
    }
  }
  function connect() {
    sock = io('/link', { transports: ['websocket'] });
    sock.on('connect', hello);
    sock.on('disconnect', function () { if (role === 'slave') online = false; tell('state'); });
    sock.on('d', function (m) {
      if (role !== 'slave' || !mirror || !m || !m.d) return;       // nothing is applied before a snapshot
      epoch = m.e; if (!m.c) rev = m.r;
      queue(m.d);
    });
    sock.on('st', function (m) {
      if (role !== 'slave' || !m || !m.st) return;
      epoch = m.e; rev = m.r; takeState(m.st);
    });
    sock.on('hb', function (m) {
      if (!m) return;
      count = m.n; online = role === 'master' ? true : !!m.on;
      if (role === 'slave' && (m.e !== epoch || m.r !== rev)) resync();
      tell('state');
    });
    sock.on('bye', function () { stop(); tell('bye'); tell('state'); });
  }

  /* ── clock ────────────────────────────────────────────────────────────────── */
  function ping(then) {
    if (!sock || !sock.connected) return;
    var t0 = performance.now();
    sock.timeout(2000).emit('t', t0, function (err, s) {
      if (!err && typeof s === 'number') {
        var t1 = performance.now();
        samples.push({ rtt: t1 - t0, off: s + (t1 - t0) / 2 - t1 });
        if (samples.length > 12) samples.shift();
        off = settle(off, pick(samples).off);
      }
      if (typeof then === 'function') then();
    });
  }
  /* Eight quick pings; the server's clock restarts with the server, so start from nothing. */
  function burst() {
    samples = []; off = null;
    var n = 0;
    (function next() { if (n++ < 8) ping(function () { setTimeout(next, 150); }); })();
  }
  function wake() { if (!role) return; burst(); resync(); }

  /* ── lifecycle ────────────────────────────────────────────────────────────── */
  function start(r, rm, k) {
    stop();
    role = r; room = norm(rm); key = k || ''; fresh = true;
    connect();
    timers.push(setInterval(r === 'master' ? poll : heal, r === 'master' ? POLL_MS : HEAL_MS));
    timers.push(setInterval(ping, PING_MS));
    tell('state');
  }
  function stop() {
    for (var i = 0; i < timers.length; i++) clearInterval(timers[i]);
    timers = [];
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    pend = null;
    if (sock) { sock.off(); sock.disconnect(); sock = null; }
    role = null; joined = false; online = false; held = false; count = 0; mirror = null; S = null;
  }

  /* A finished gesture triggers one extra read at once, so play/stop is not delayed by a poll. */
  if (typeof window !== 'undefined' && window.addEventListener) {
    ['pointerup', 'touchend', 'click', 'keyup', 'change', 'focusout'].forEach(function (t) {
      window.addEventListener(t, function (e) { if (role === 'master' && e.isTrusted) setTimeout(poll, 0); }, true);
    });
  }

  return {
    V: V, row: row, start: start, stop: stop, hold: hold, on: on, info: info, wake: wake, norm: norm,
    now: function () { return performance.now() + (off || 0); },                 // shared time, ms
    clock: function () { var b = pick(samples); return { off: off, rtt: b ? b.rtt : null, n: samples.length }; },
    _: { eq: eq, clone: clone, step: step, phase: phase, pick: pick, settle: settle, MOVING_MS: MOVING_MS,
         rows: rows, read: readAll, anchorOut: anchorOut, anchorIn: anchorIn, ANCHOR_SLOP: ANCHOR_SLOP }                                   // the table itself, for the row checks
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LINK;
