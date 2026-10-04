/* ═══════════════════════════════════════════════════════════════════════════
   LINK UI — the join sheets, the master button, the slave pair, the fade, the lock.

   Only /masterctrl and /slaves wake it. At the plain address nothing here runs,
   no socket is opened and poepub is exactly as before.

   Loaded last, after link-core.js and link-table.js. Spec sections 6, 7 and 9.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var where = location.pathname.toLowerCase().replace(/\/+$/, '');
  var want = where === '/masterctrl' ? 'master' : where === '/slaves' ? 'slave' : null;
  if (!want) return;

  var SS_KEY = 'link_master';          // room + key, this tab only, so a reload can resume
  var SIGNAL = '<svg viewBox="0 0 16 10" width="19.8" height="12.375" aria-hidden="true">' +
    '<circle cx="8" cy="5" r="1.7" fill="currentColor"/>' +
    '<path class="lk-arc" d="M5.3 2.3a3.9 3.9 0 0 0 0 5.4M10.7 2.3a3.9 3.9 0 0 1 0 5.4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
    '<path class="lk-arc lk-arc2" d="M3 .7a6.4 6.4 0 0 0 0 8.6M13 .7a6.4 6.4 0 0 1 0 8.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

  var app = null, bar = null, badge = null, exitBtn = null, veil = null, ring = null;
  var locked = false, keyUsed = '', sig = '', wakeLock = null, heard = false;

  function el(tag, id, cls, html) {
    var e = document.createElement(tag);
    if (id) e.id = id; if (cls) e.className = cls; if (html != null) e.innerHTML = html;
    return e;
  }
  function say(t) { var x = document.getElementById('lkMsg'); if (x) x.textContent = t; }

  /* ── audio and screen ─────────────────────────────────────────────────────── */
  /* Must run inside a real tap: browsers start audio only from a gesture. 'playback' is what keeps
     the iPhone silent switch from muting the app. */
  function wakeAudio() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}
    try { getAC(); } catch (_) {}
    if (typeof AC === 'undefined' || !AC) return;
    /* getAC resumes only 'suspended'. iPhones report 'interrupted' after a call, and that needs a
       resume from a touch just the same. */
    if (AC.state !== 'running' && AC.state !== 'closed') { try { AC.resume().catch(function () {}); } catch (_) {} }
    if (!heard) { heard = true; AC.addEventListener('statechange', paint); }
  }
  function screenOn() {
    if (!navigator.wakeLock || wakeLock) return;
    navigator.wakeLock.request('screen').then(function (l) {
      wakeLock = l; l.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () {});
  }
  function screenOff() { if (wakeLock) { try { wakeLock.release(); } catch (_) {} wakeLock = null; } }

  /* ── a slave leaves no trace in its own storage ───────────────────────────── */
  var realSet = Storage.prototype.setItem, realRemove = Storage.prototype.removeItem;
  function guard(on) {
    Storage.prototype.setItem = on ? function (k, v) { if (this !== window.localStorage) return realSet.call(this, k, v); } : realSet;
    Storage.prototype.removeItem = on ? function (k) { if (this !== window.localStorage) return realRemove.call(this, k); } : realRemove;
  }

  /* ── the lock ─────────────────────────────────────────────────────────────── */
  /* Starts, moves, clicks and keys are stopped before any handler sees them. Releases are let
     through: they can only end a gesture, and VOICE listens for mouseup on the window. Nothing is
     preventDefault-ed, so pages still scroll. Synthetic events pass: setters dispatch `input`.
     CSS alone cannot do this — pointer-events:auto is set in ~15 places and the swipe-to-roll
     listeners sit on the document. */
  var PASS = '.tabs,#vtCanvasWrap,#lkExit,#scoreTab,#scorePanelWrap';
  ['pointerdown', 'pointermove', 'mousedown', 'mousemove', 'click', 'dblclick', 'contextmenu',
   'touchstart', 'touchmove', 'keydown', 'keyup', 'input', 'change'].forEach(function (t) {
    window.addEventListener(t, function (e) {
      if (!locked || !e.isTrusted) return;
      if (t === 'pointerdown' || t === 'touchstart') wakeAudio();   // after a phone call only a touch can resume audio
      var n = e.target && e.target.nodeType === 1 ? e.target : null;
      if (n && n.closest(PASS)) return;
      e.stopImmediatePropagation();
    }, true);
  });

  /* ── paint ────────────────────────────────────────────────────────────────── */
  /* Only touches the DOM when what is shown changes, so the blink is not restarted by heartbeats. */
  function paint() {
    if (!badge) return;
    var i = LINK.info(), cls, html;
    if (i.role === 'master') {
      var lost = !i.connected;
      cls = i.held || lost ? 'hold' : 'master';
      html = i.held ? '<span class="lk-lbl">HOLD</span>' : lost ? '<span class="lk-lbl">WAIT</span>' : '<span class="lk-n">' + i.count + '</span>';
    } else if (i.role === 'slave') {
      var tap = typeof AC !== 'undefined' && AC && AC.state !== 'running';
      var wait = !i.connected || !i.online;
      cls = tap || wait ? 'wait' : 'slave';
      html = '<span class="lk-lbl">' + (tap ? 'TAP' : wait ? 'WAIT' : 'SLAVE') + '</span>';
    } else return;
    if (cls + html === sig) return;
    sig = cls + html; badge.className = cls; badge.innerHTML = SIGNAL + html;
  }

  /* ── entering and leaving ─────────────────────────────────────────────────── */
  function enter() {
    if (bar) return;                                                  // JOIN tapped twice
    var i = LINK.info();
    dismissLanding();
    /* The app measures the tab bar once at boot, which on a first visit is before the web font
       arrives. The master button and the fade both hang off --tab-h, so measure again now. */
    if (typeof measureTabH === 'function') measureTabH();
    bar = app.appendChild(el('div', 'lkBar', i.role === 'slave' ? 'slave' : ''));
    badge = bar.appendChild(el('div', 'lkBadge'));
    if (i.role === 'master') {
      try { sessionStorage.setItem(SS_KEY, JSON.stringify({ room: i.room, key: keyUsed })); } catch (_) {}
      badge.addEventListener('click', function (e) { e.stopPropagation(); LINK.hold(!LINK.info().held); });
      badge.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      qr(i.room);
    } else {
      app.classList.add('lk-slave');
      veil = app.appendChild(el('div', 'lkVeil'));
      ring = document.getElementById('bbFrame').appendChild(el('div', 'lkRing'));
      exitBtn = bar.appendChild(el('div', 'lkExit', '', '<span>EXIT</span><span>SLAVE</span><span>MODE</span>'));
      bindExit();
      locked = true; guard(true);
    }
    /* No pull-to-refresh mid-show, on either side: the lock leaves scrolling alive, so a slave
       dragging down at the top of a page would otherwise reload it. */
    document.documentElement.style.overscrollBehavior = 'none';
    screenOn(); paint();
  }
  /* Everything keeps playing; the phone is a normal poepub again. */
  function leave() {
    LINK.stop();
    locked = false; guard(false); screenOff();
    app.classList.remove('lk-slave');
    [bar, veil, ring].forEach(function (x) { if (x && x.parentNode) x.parentNode.removeChild(x); });
    bar = badge = exitBtn = veil = ring = null; sig = '';
    document.documentElement.style.overscrollBehavior = '';
    try { history.replaceState(null, '', '/'); } catch (_) {}
  }
  function bindExit() {
    var timer = 0;
    function up() { clearTimeout(timer); if (exitBtn) exitBtn.classList.remove('down'); }
    exitBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault(); exitBtn.classList.add('down');
      timer = setTimeout(leave, 900);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { exitBtn.addEventListener(t, up); });
    /* Android raises its context menu at ~500ms and cancels the pointer with it. */
    exitBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  /* While master, the QR tab hands out this room instead of the plain address. */
  function qr(room) {
    var q = document.getElementById('appQR');
    if (!q || typeof QRCode === 'undefined') return;
    q.innerHTML = '';
    new QRCode(q, { text: location.origin + '/slaves?room=' + encodeURIComponent(room), width: 200, height: 200,
      colorDark: '#000000', colorLight: '#ede7d4', correctLevel: QRCode.CorrectLevel.H });
  }

  /* ── the join sheet: the landing card, re-lettered ────────────────────────── */
  function sheet() {
    var ov = document.getElementById('landingOverlay'), card = ov.querySelector('.lp-card'), m = want === 'master';
    var saved = null;
    if (m) { try { saved = JSON.parse(sessionStorage.getItem(SS_KEY)); } catch (_) {} }
    ov.classList.add('lk-sheet');
    card.innerHTML =
      '<div class="lk-sheet-tag ' + want + '">' + SIGNAL + (m ? 'MASTER' : 'SLAVE') + '</div>' +
      '<div class="lk-field"><label for="lkRoom">ROOM</label><input class="call-input" id="lkRoom" placeholder="room name" maxlength="40" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false"></div>' +
      (m ? '<div class="lk-field"><label for="lkKey">KEY</label><input class="call-input" id="lkKey" type="password" placeholder="key" autocomplete="off"></div>'
         : '<div class="lp-instr">YOUR PHONE WILL BE PLAYED<br>BY THE MASTER<br>PUT ON MAX VOLUME<br>KEEP THIS SCREEN OPEN</div>') +
      '<button class="lp-enter" id="lkGo">' + (m ? (saved ? 'RESUME AS MASTER' : 'TAKE CONTROL') : 'JOIN') + '</button>' +
      '<div class="lk-msg" id="lkMsg"></div>' +
      (m ? '' : '<div class="lk-small">your controls lock while you are in the room.<br>leave any time with EXIT SLAVE MODE.</div>');
    var roomEl = document.getElementById('lkRoom'), keyEl = document.getElementById('lkKey');
    /* values go in as properties, never through the HTML above */
    roomEl.value = (saved && saved.room) || new URLSearchParams(location.search).get('room') || '';
    if (keyEl && saved) keyEl.value = saved.key || '';
    document.getElementById('lkGo').onclick = function () {
      var room = LINK.norm(roomEl.value);
      if (!room) return say('ENTER A ROOM NAME');
      if (m && !keyEl.value) return say('ENTER THE KEY');
      keyUsed = m ? keyEl.value : '';
      say('CONNECTING…');
      wakeAudio();
      LINK.start(want, room, keyUsed);
      setTimeout(function () { if (LINK.info().role && !LINK.info().joined) say('STILL TRYING…'); }, 6000);
    };
  }

  var WHY = { key: 'WRONG KEY', nokey: 'THE SERVER HAS NO KEY SET', room: 'ENTER A ROOM NAME', full: 'THE ROOM IS FULL', version: 'RELOAD THE PAGE' };
  LINK.on(function (evt, data) {
    if (evt === 'joined') return enter();
    if (evt === 'refused') { if (bar) leave(); return say(WHY[data] || 'COULD NOT JOIN'); }
    if (evt === 'bye') { try { sessionStorage.removeItem(SS_KEY); } catch (_) {} return leave(); }
    if (evt === 'state') paint();
  });

  /* Hidden slave: its animation-frame engines freeze while oscillators would keep sounding, so it
     fades out, and catches up when it comes back. */
  document.addEventListener('visibilitychange', function () {
    var i = LINK.info(); if (!i.role || !bar) return;
    var fade = i.role === 'slave' && typeof AC !== 'undefined' && AC && appMaster;
    if (document.hidden) { if (fade) appMaster.gain.setTargetAtTime(0, AC.currentTime, 0.05); return; }
    if (fade) appMaster.gain.setTargetAtTime(v2g(appMasterVol), AC.currentTime, 0.05);
    screenOn(); LINK.wake(); paint();
  });

  document.addEventListener('DOMContentLoaded', function () { app = document.getElementById('app'); sheet(); });
})();
