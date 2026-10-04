'use strict';
/* The pure half of link-core.js. The file is a browser script; in Node it exports LINK and its
   top-level code touches nothing that is missing here. */
const test = require('node:test');
const assert = require('node:assert/strict');
const LINK = require('../../public/js/link-core.js');
const { normRoom } = require('../../link-server');
const { eq, step, phase, pick, settle, MOVING_MS } = LINK._;

const fresh = (sent) => ({ sent: sent || {}, lastT: {}, owe: {} });

test('client and server agree on what a room is called', () => {
  for (const s of ['  Pesaro  ', 'IŞIK Oda 2', 'ıİ', 'çğöşü', '---', '', 'a'.repeat(31) + ' b', 'Sala 3 / B', null])
    assert.equal(LINK.norm(s), normRoom(s), JSON.stringify(s));
});

test('eq compares numbers, strings and nested arrays by value', () => {
  assert.ok(eq(1, 1)); assert.ok(eq('a', 'a')); assert.ok(eq([1, [2, 3]], [1, [2, 3]]));
  assert.ok(!eq(1, true)); assert.ok(!eq([1, 2], [1, 2, 3])); assert.ok(!eq([1, [2]], [1, [3]])); assert.ok(!eq(1, undefined));
});

test('a single change is sent reliably, once', () => {
  const S = fresh({ 'ns.on': 0 });
  assert.deepEqual(step({ 'ns.on': 1 }, S, 1000), { rel: { 'ns.on': 1 }, vol: null });
  assert.deepEqual(step({ 'ns.on': 1 }, S, 1050), { rel: null, vol: null });
  assert.deepEqual(step({ 'ns.on': 1 }, S, 5000), { rel: null, vol: null });
});

test('a drag streams as droppable batches, then lands reliably', () => {
  const S = fresh({ 'app.vol': 50 });
  assert.deepEqual(step({ 'app.vol': 51 }, S, 1000), { rel: { 'app.vol': 51 }, vol: null }, 'first move is reliable');
  assert.deepEqual(step({ 'app.vol': 52 }, S, 1050), { rel: null, vol: { 'app.vol': 52 } });
  assert.deepEqual(step({ 'app.vol': 53 }, S, 1100), { rel: null, vol: { 'app.vol': 53 } });
  assert.deepEqual(step({ 'app.vol': 53 }, S, 1150), { rel: null, vol: null }, 'still inside the moving window');
  assert.deepEqual(step({ 'app.vol': 53 }, S, 1100 + MOVING_MS), { rel: { 'app.vol': 53 }, vol: null }, 'final value, reliably');
  assert.deepEqual(step({ 'app.vol': 53 }, S, 9000), { rel: null, vol: null });
});

test('a still row and a moving row go out as two batches in one pass', () => {
  const S = fresh({ 'app.vol': 50, 'ns.on': 0 });
  step({ 'app.vol': 51, 'ns.on': 0 }, S, 1000);
  assert.deepEqual(step({ 'app.vol': 52, 'ns.on': 1 }, S, 1050), { rel: { 'ns.on': 1 }, vol: { 'app.vol': 52 } });
});

test('HOLD: passes that never ran are released as one reliable batch', () => {
  const S = fresh({ 'app.vol': 50, 'ns.on': 0, 'mu.on': 0 });
  /* while held, poll() does not call step at all; many things change; then one pass runs */
  assert.deepEqual(step({ 'app.vol': 20, 'ns.on': 1, 'mu.on': 0 }, S, 60000), { rel: { 'app.vol': 20, 'ns.on': 1 }, vol: null });
});

test('rows the room has never had are sent, and array values are copied', () => {
  const S = fresh({});
  const ops = [[1, 2], [3, 4]];
  assert.deepEqual(step({ 'mu.ops': ops }, S, 1000).rel, { 'mu.ops': [[1, 2], [3, 4]] });
  ops[0][1] = 9;                                               // the getter's array changes later
  assert.deepEqual(S.sent['mu.ops'], [[1, 2], [3, 4]], 'sent keeps its own copy');
  assert.deepEqual(step({ 'mu.ops': ops }, S, 5000).rel, { 'mu.ops': [[1, 9], [3, 4]] });
});

test('a batch is applied as: stops, settings, structure, starts, anchors', () => {
  const rows = [
    [{ id: 'a', kind: 'anchor' }, 5], [{ id: 'on', kind: 'transport' }, 1], [{ id: 'set', kind: 'setting' }, 3],
    [{ id: 'ops', kind: 'struct' }, []], [{ id: 'off', kind: 'transport' }, 0],
  ];
  rows.sort((x, y) => phase(x[0], x[1]) - phase(y[0], y[1]));
  assert.deepEqual(rows.map((r) => r[0].id), ['off', 'set', 'ops', 'on', 'a']);
});

test('the clock trusts the shortest round trip, steps when far off and slews when close', () => {
  assert.deepEqual(pick([{ rtt: 80, off: 10 }, { rtt: 30, off: 14 }, { rtt: 55, off: 12 }]), { rtt: 30, off: 14 });
  assert.equal(pick([]), null);
  assert.equal(settle(null, 1234), 1234);
  assert.equal(settle(1000, 1100), 1100);
  assert.equal(settle(1000, 1020), 1005);
});

test('the table can be read whole, for the row checks', () => {
  LINK.row({ id: 't.x', kind: 'setting', get: () => 7, set() {} });
  assert.equal(LINK._.read()['t.x'], 7);
  assert.ok(LINK._.rows.some((r) => r.id === 't.x'));
});

test('an anchor goes out in shared time and comes back in local time', () => {
  const { anchorOut, anchorIn } = LINK._;
  const master = {}, slave = {};
  const shared = anchorOut(master, 'rs.t0', 1000, 250);          // master: local 1000, its clock is 250 behind shared
  assert.equal(shared, 1250);
  assert.equal(anchorIn(slave, 'rs.t0', shared, -400), 1650);    // slave: its clock is 400 ahead
  assert.equal(anchorOut(slave, 'rs.t0', 1650, -400), 1250, 'and the slave reads back exactly what it was given');
});

test('a still anchor does not look changed while the clock offset slews', () => {
  const { anchorOut, ANCHOR_SLOP } = LINK._;
  const cache = {};
  assert.equal(anchorOut(cache, 'a', 1000, 250), 1250);
  assert.equal(anchorOut(cache, 'a', 1000, 250 + ANCHOR_SLOP), 1250, 'a small slew: the cached value stands');
  const moved = 250 + ANCHOR_SLOP + 1.5;
  assert.equal(anchorOut(cache, 'a', 1000, moved), 1000 + moved, 'a real move of the clock: converted again');
  assert.equal(anchorOut(cache, 'a', 2000, moved), 2000 + moved, 'a new start time: converted again');
});
