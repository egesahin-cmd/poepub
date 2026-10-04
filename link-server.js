'use strict';
/* LINK — one master phone conducts a room of slave phones.
   This file is the server half: a pure Hub that owns the rooms (unit-tested without a network),
   and attach(), a thin adapter that wires the Hub to a Socket.IO namespace and two page routes.
   Spec: docs/superpowers/specs/2026-10-04-link-master-slave-design.md, section 1. */
const crypto = require('crypto');
const path = require('path');

const V = 1;                       // protocol version
const MAX_FOLLOWERS = 150;
const ID_RE = /^[a-z0-9.]{1,24}$/;

/* Audience phones type room names with Turkish keyboards and autocapitalise, so "IŞIK Oda 2" and
   "isik-oda-2" must be the same room. */
function normRoom(s) {
  return String(s == null ? '' : s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32).replace(/^-+|-+$/g, '');
}

/* Constant-time. An unset key refuses everyone. */
function keyOk(given, expected) {
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(String(given == null ? '' : given)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

/* A state or delta is a flat object of row id -> JSON value. Returns a prototype-free copy,
   or null if anything about it is off. Values are opaque to the server. */
function cleanState(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const keys = Object.keys(o);
  if (keys.length > 256) return null;
  const out = Object.create(null);
  for (const k of keys) { if (!ID_RE.test(k)) return null; out[k] = o[k]; }
  return out;
}

class Hub {
  constructor(opts) {
    this.key = (opts && opts.key) || '';
    this.now = (opts && opts.now) || Date.now;
    this.rooms = new Map();        // name -> {master, st, e, r, members:Set<sid>}
    this.where = new Map();        // sid -> room name
    this.bad = new Map();          // sid -> failed claims
  }
  _room(name) {
    let r = this.rooms.get(name);
    if (!r) { r = { master: null, st: null, e: 0, r: 0, members: new Set() }; this.rooms.set(name, r); }
    return r;
  }
  _n(r) { return r.members.size - (r.master && r.members.has(r.master) ? 1 : 0); }
  _mine(sid) { const name = this.where.get(sid); const r = name && this.rooms.get(name); return r && r.master === sid ? r : null; }
  /* A socket lives in one room. Joining another leaves the first; returns the name it left. */
  _leaveOther(sid, name) {
    const cur = this.where.get(sid);
    if (!cur || cur === name) return null;
    this.leave(sid);
    return cur;
  }

  claim(sid, m) {
    if (!m || m.v !== V) return { ack: { ok: 0, err: 'version' } };
    if (!this.key) return { ack: { ok: 0, err: 'nokey' } };
    if (!keyOk(m.key, this.key)) {
      const c = (this.bad.get(sid) || 0) + 1; this.bad.set(sid, c);
      return { ack: { ok: 0, err: 'key' }, kick: c >= 3 };
    }
    const name = normRoom(m.room);
    if (!name) return { ack: { ok: 0, err: 'room' } };
    const left = this._leaveOther(sid, name);
    const r = this._room(name);
    let bye = null;
    if (r.master && r.master !== sid) { bye = r.master; r.members.delete(bye); this.where.delete(bye); }
    r.master = sid; r.members.add(sid); this.where.set(sid, name);
    return { ack: { ok: 1, e: r.e, r: r.r, st: r.st, n: this._n(r) }, room: name, left, bye };
  }

  follow(sid, m) {
    if (!m || m.v !== V) return { ack: { ok: 0, err: 'version' } };
    const name = normRoom(m.room);
    if (!name) return { ack: { ok: 0, err: 'room' } };
    const had = this.rooms.get(name);
    if (had && !had.members.has(sid) && this._n(had) >= MAX_FOLLOWERS) return { ack: { ok: 0, err: 'full' } };
    const left = this._leaveOther(sid, name);
    const r = this._room(name);
    if (r.master === sid) r.master = null;
    r.members.add(sid); this.where.set(sid, name);
    return { ack: { ok: 1, on: !!r.master, e: r.e, r: r.r, st: r.st, n: this._n(r) }, room: name, left };
  }

  /* Master replaces the cache. A new epoch tells slaves the revision counter restarted. */
  put(sid, m) {
    const r = this._mine(sid); if (!r) return null;
    const st = cleanState(m && m.st); if (!st) return null;
    r.st = st; r.e = Math.max(this.now(), r.e + 1); r.r = 0;
    return { ack: { e: r.e, r: r.r }, room: this.where.get(sid), cast: { e: r.e, r: r.r, st: r.st } };
  }

  /* Master sends changed rows. c:1 = every row in the batch is still moving: relayed volatile,
     and the revision does not advance (a dropped one is covered by the reliable final value). */
  delta(sid, m) {
    const r = this._mine(sid); if (!r || !r.st) return null;
    const d = cleanState(m && m.d); if (!d || !Object.keys(d).length) return null;
    const moving = m.c === 1;
    Object.assign(r.st, d);
    if (!moving) r.r++;
    const cast = { e: r.e, r: r.r, d };
    if (moving) cast.c = 1;
    return { room: this.where.get(sid), volatile: moving, cast };
  }

  sync(sid) {
    const name = this.where.get(sid); const r = name && this.rooms.get(name);
    return r ? { e: r.e, r: r.r, st: r.st } : { e: 0, r: 0, st: null };
  }

  /* A room lives while it has a member. Slaves waiting without a master keep its cache alive,
     which is what lets a reloading master take the room over as it is. */
  leave(sid) {
    this.bad.delete(sid);
    const name = this.where.get(sid); if (!name) return null;
    this.where.delete(sid);
    const r = this.rooms.get(name); if (!r) return null;
    r.members.delete(sid);
    if (r.master === sid) r.master = null;
    if (!r.members.size) { this.rooms.delete(name); return { room: name, gone: true }; }
    return { room: name, gone: false };
  }

  beat(name) { const r = this.rooms.get(name); return r ? { e: r.e, r: r.r, on: !!r.master, n: this._n(r) } : null; }
}

function limiter(perSecond) {
  let sec = 0, n = 0;
  return () => { const s = Math.floor(Date.now() / 1000); if (s !== sec) { sec = s; n = 0; } return ++n <= perSecond; };
}

function attach(io, app, opts) {
  const hub = new Hub({ key: opts && opts.key != null ? opts.key : process.env.LINK_KEY });
  if (!hub.key) console.log('LINK: LINK_KEY is not set, so every /masterctrl claim will be refused');

  /* Same page at two more addresses. Every asset URL in the page is relative, so a trailing
     slash would resolve them under /slaves/ and 404 — send that form back to the slashless one. */
  const page = path.join(__dirname, 'public', 'index.html');
  ['/masterctrl', '/slaves'].forEach((p) => {
    app.get(p, (req, res) => {
      if (req.path !== p) { const q = req.originalUrl.indexOf('?'); return res.redirect(302, p + (q < 0 ? '' : req.originalUrl.slice(q))); }
      res.sendFile(page);
    });
  });

  const nsp = io.of('/link');
  const due = new Set();
  function beat(room) {                       // debounced: 100 phones joining at once is one message, not 100
    if (!room || due.has(room)) return;
    due.add(room);
    setTimeout(() => { due.delete(room); const b = hub.beat(room); if (b) nsp.to(room).emit('hb', b); }, 250).unref();
  }
  setInterval(() => { for (const name of hub.rooms.keys()) nsp.to(name).emit('hb', hub.beat(name)); }, 3000).unref();

  nsp.on('connection', (socket) => {
    const okD = limiter(40), okT = limiter(10), okJ = limiter(3);
    const fn = (cb) => (typeof cb === 'function' ? cb : () => {});
    const move = (res) => { if (res.left) { socket.leave(res.left); beat(res.left); } socket.join(res.room); beat(res.room); };

    socket.on('claim', (m, cb) => {
      cb = fn(cb); if (!okJ()) return;
      const res = hub.claim(socket.id, m);
      if (res.ack.ok) {
        move(res);
        const old = res.bye && nsp.sockets.get(res.bye);
        if (old) { old.leave(res.room); old.emit('bye', { why: 'replaced' }); }
      }
      cb(res.ack);
      if (res.kick) socket.disconnect(true);
    });
    socket.on('follow', (m, cb) => {
      cb = fn(cb); if (!okJ()) return;
      const res = hub.follow(socket.id, m);
      if (res.ack.ok) move(res);
      cb(res.ack);
    });
    socket.on('put', (m, cb) => {
      cb = fn(cb);
      const res = hub.put(socket.id, m); if (!res) return;
      socket.to(res.room).emit('st', res.cast);
      cb(res.ack);
    });
    socket.on('d', (m) => {
      if (!okD()) return;
      const res = hub.delta(socket.id, m); if (!res) return;
      (res.volatile ? socket.to(res.room).volatile : socket.to(res.room)).emit('d', res.cast);
    });
    socket.on('sync', (cb) => { cb = fn(cb); if (okJ()) cb(hub.sync(socket.id)); });
    socket.on('t', (c0, cb) => { if (typeof cb === 'function' && okT()) cb(performance.now()); });
    socket.on('disconnect', () => { const res = hub.leave(socket.id); if (res && !res.gone) beat(res.room); });
  });
  return hub;
}

module.exports = { attach, Hub, normRoom, keyOk, V, MAX_FOLLOWERS };
