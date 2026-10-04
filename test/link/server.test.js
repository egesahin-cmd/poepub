'use strict';
/* The Hub is pure: no sockets, no timers. Socket ids are just strings here. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Hub, normRoom, keyOk, MAX_FOLLOWERS } = require('../../link-server');

const hub = (over) => new Hub(Object.assign({ key: 'k' }, over));
const claim = (h, sid, room, key) => h.claim(sid, { v: 1, room, key: key === undefined ? 'k' : key });
const follow = (h, sid, room) => h.follow(sid, { v: 1, room });

test('normRoom folds case, Turkish letters, spaces and punctuation', () => {
  assert.equal(normRoom('  Pesaro  '), 'pesaro');
  assert.equal(normRoom('IŞIK Oda 2'), 'isik-oda-2');
  assert.equal(normRoom('ıİ'), 'ii');
  assert.equal(normRoom('çğöşü'), 'cgosu');
  assert.equal(normRoom('---'), '');
  assert.equal(normRoom(null), '');
  assert.equal(normRoom('a'.repeat(31) + ' b'), 'a'.repeat(31));   // cut at 32, no trailing dash
});

test('keyOk refuses when no key is configured', () => {
  assert.equal(keyOk('x', ''), false);
  assert.equal(keyOk('x', undefined), false);
  assert.equal(keyOk('x', 'y'), false);
  assert.equal(keyOk('y', 'y'), true);
  assert.equal(keyOk(undefined, 'y'), false);
});

test('claim: version, missing key, wrong key three times, empty room', () => {
  assert.equal(hub().claim('m', { v: 2, room: 'a', key: 'k' }).ack.err, 'version');
  assert.equal(claim(hub({ key: '' }), 'm', 'a').ack.err, 'nokey');
  const h = hub();
  assert.deepEqual(claim(h, 'm', 'a', 'no'), { ack: { ok: 0, err: 'key' }, kick: false });
  assert.equal(claim(h, 'm', 'a', 'no').kick, false);
  assert.equal(claim(h, 'm', 'a', 'no').kick, true);
  assert.equal(claim(h, 'm', '  ').ack.err, 'room');
  assert.equal(h.rooms.size, 0);
});

test('slaves may wait in a room before the master arrives', () => {
  const h = hub();
  const f = follow(h, 's1', 'Room A');
  assert.deepEqual(f.ack, { ok: 1, on: false, e: 0, r: 0, st: null, n: 1 });
  assert.equal(f.room, 'room-a');
  const c = claim(h, 'm', 'room a');
  assert.deepEqual(c.ack, { ok: 1, e: 0, r: 0, st: null, n: 1 });
  assert.equal(h.beat('room-a').on, true);
});

test('put replaces the cache with a new epoch; delta merges and counts only reliable batches', () => {
  let t = 1000; const h = hub({ now: () => t });
  claim(h, 'm', 'a'); follow(h, 's', 'a');
  assert.equal(h.delta('m', { d: { 'ns.on': 1 } }), null, 'no state yet, nothing to merge into');
  const p = h.put('m', { st: { 'ns.on': 0, 'app.vol': 80 } });
  assert.deepEqual(p.ack, { e: 1000, r: 0 });
  assert.deepEqual({ ...p.cast.st }, { 'ns.on': 0, 'app.vol': 80 });
  const d1 = h.delta('m', { d: { 'ns.on': 1 } });
  assert.equal(d1.volatile, false);
  assert.deepEqual({ e: d1.cast.e, r: d1.cast.r, d: { ...d1.cast.d } }, { e: 1000, r: 1, d: { 'ns.on': 1 } });
  const d2 = h.delta('m', { d: { 'app.vol': 41 }, c: 1 });
  assert.equal(d2.volatile, true);
  assert.equal(d2.cast.c, 1);
  assert.equal(d2.cast.r, 1, 'a moving batch does not advance the revision');
  assert.deepEqual({ ...h.sync('s').st }, { 'ns.on': 1, 'app.vol': 41 });
  const p2 = h.put('m', { st: { 'ns.on': 0 } });
  assert.equal(p2.ack.e, 1001, 'epoch always moves forward, even inside one millisecond');
  assert.equal(p2.ack.r, 0);
});

test('only the master may write, and only clean rows are accepted', () => {
  const h = hub(); claim(h, 'm', 'a'); follow(h, 's', 'a');
  h.put('m', { st: { 'ns.on': 0 } });
  assert.equal(h.delta('s', { d: { 'ns.on': 1 } }), null);
  assert.equal(h.put('s', { st: { 'ns.on': 1 } }), null);
  assert.equal(h.delta('m', { d: { 'BAD ID': 1 } }), null);
  assert.equal(h.delta('m', { d: [1, 2] }), null);
  assert.equal(h.put('m', { st: null }), null);
  const big = {}; for (let i = 0; i < 257; i++) big['r' + i] = i;
  assert.equal(h.put('m', { st: big }), null);
  assert.equal(h.delta('m', { d: JSON.parse('{"__proto__":1}') }), null, 'as it would arrive off the wire');
  assert.equal(h.delta('m', { d: {} }), null, 'an empty batch is not relayed');
  assert.deepEqual({ ...h.sync('s').st }, { 'ns.on': 0 });
});

test('the last valid claim wins and the old master is put out of the room', () => {
  const h = hub(); claim(h, 'm1', 'a'); follow(h, 's', 'a');
  const c = claim(h, 'm2', 'a');
  assert.equal(c.bye, 'm1');
  assert.equal(h.where.has('m1'), false);
  assert.equal(h.put('m1', { st: { x: 1 } }), null);
  assert.equal(c.ack.n, 1);
});

test('a room lives while anyone is in it, and keeps its cache without a master', () => {
  const h = hub(); claim(h, 'm', 'a'); follow(h, 's', 'a'); h.put('m', { st: { 'ns.on': 1 } });
  assert.deepEqual(h.leave('m'), { room: 'a', gone: false });
  assert.equal(h.beat('a').on, false);
  const again = claim(h, 'm-new', 'a');
  assert.deepEqual({ ...again.ack.st }, { 'ns.on': 1 }, 'a returning master is handed the room as it is');
  assert.equal(again.ack.n, 1);
  h.leave('m-new');
  assert.deepEqual(h.leave('s'), { room: 'a', gone: true });
  assert.equal(h.rooms.size, 0);
  assert.equal(h.leave('nobody'), null);
});

test('a socket is in one room at a time', () => {
  const h = hub(); follow(h, 's', 'a');
  const f = follow(h, 's', 'b');
  assert.equal(f.left, 'a');
  assert.equal(h.rooms.has('a'), false);
  assert.equal(h.where.get('s'), 'b');
});

test('a room is full at MAX_FOLLOWERS, and the master does not count', () => {
  const h = hub(); claim(h, 'm', 'a');
  for (let i = 0; i < MAX_FOLLOWERS; i++) assert.equal(follow(h, 's' + i, 'a').ack.ok, 1);
  assert.equal(follow(h, 'extra', 'a').ack.err, 'full');
  assert.equal(follow(h, 's0', 'a').ack.ok, 1, 'someone already inside may ask again');
  assert.equal(h.beat('a').n, MAX_FOLLOWERS);
});
