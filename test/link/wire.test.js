'use strict';
/* The adapter and the routes, against a real server. This starts its OWN throwaway server on port
   3078 and stops it by process handle. The dev server on :3000 is never touched. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { connect } = require('./sio');

const PORT = 3078, BASE = 'http://127.0.0.1:' + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const link = () => connect(BASE, '/link');
let server;

test.before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, PORT: String(PORT), LINK_KEY: 'test' }, stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/')).ok) return; } catch (_) {} await sleep(100); }
  throw new Error('test server did not start');
});
test.after(() => { server.kill(); });

test('both addresses serve the app, and a trailing slash is sent back without it', async () => {
  for (const p of ['/masterctrl', '/slaves', '/slaves?room=pesaro']) {
    const r = await fetch(BASE + p);
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /<title>PoePub<\/title>/);
  }
  const r = await fetch(BASE + '/slaves/?room=pesaro', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/slaves?room=pesaro');
  assert.equal((await fetch(BASE + '/masterctrl/', { redirect: 'manual' })).headers.get('location'), '/masterctrl');
  assert.equal((await fetch(BASE + '/nowhere')).status, 404);
});

test('a slave gets the room in one reply, then follows the master', async () => {
  const m = await link(), s = await link();
  const got = []; s.on('d', (x) => got.push(x)); s.on('st', (x) => got.push(x));
  assert.deepEqual(await m.ask('claim', { v: 1, room: 'Wire One', key: 'test' }), { ok: 1, e: 0, r: 0, st: null, n: 0 });
  const put = await m.ask('put', { st: { 'ns.on': 0, 'app.vol': 80 } });
  assert.equal(put.r, 0);
  const f = await s.ask('follow', { v: 1, room: 'wire-one' });
  assert.deepEqual(f, { ok: 1, on: true, e: put.e, r: 0, st: { 'ns.on': 0, 'app.vol': 80 }, n: 1 });
  m.emit('d', { d: { 'ns.on': 1 } });
  await sleep(150);
  assert.deepEqual(got, [{ e: put.e, r: 1, d: { 'ns.on': 1 } }]);
  s.emit('d', { d: { 'ns.on': 0 } });                                // a slave cannot write
  await sleep(150);
  assert.deepEqual((await s.ask('sync')).st, { 'ns.on': 1, 'app.vol': 80 });
  assert.equal(typeof (await s.ask('t', 0)), 'number');
  m.close(); s.close();
});

test('the room is told who is there', async () => {
  const m = await link(), s = await link();
  let last = null; m.on('hb', (x) => { last = x; });
  await m.ask('claim', { v: 1, room: 'wire-two', key: 'test' });
  await s.ask('follow', { v: 1, room: 'wire-two' });
  await sleep(500);                                                  // the beat is debounced by 250 ms
  assert.deepEqual({ on: last.on, n: last.n }, { on: true, n: 1 });
  s.close(); await sleep(500);
  assert.equal(last.n, 0);
  m.close();
});

test('a second master replaces the first, which is told so', async () => {
  const a = await link(), b = await link();
  let bye = null; a.on('bye', (x) => { bye = x; });
  await a.ask('claim', { v: 1, room: 'wire-three', key: 'test' });
  await b.ask('claim', { v: 1, room: 'wire-three', key: 'test' });
  await sleep(150);
  assert.deepEqual(bye, { why: 'replaced' });
  a.close(); b.close();
});

test('three wrong keys and the socket is dropped', async () => {
  const x = await link();
  for (let i = 0; i < 3; i++) { assert.deepEqual(await x.ask('claim', { v: 1, room: 'wire-four', key: 'nope' }), { ok: 0, err: 'key' }); await sleep(400); }
  await x.closed;
  assert.equal(x.open, false);
});

test('a flood of deltas is capped', async () => {
  const m = await link(), s = await link();
  let n = 0; s.on('d', () => { n++; });
  await m.ask('claim', { v: 1, room: 'wire-five', key: 'test' });
  await m.ask('put', { st: { 'app.vol': 0 } });
  await s.ask('follow', { v: 1, room: 'wire-five' });
  for (let i = 1; i <= 300; i++) m.emit('d', { d: { 'app.vol': i % 100 } });
  await sleep(600);
  assert.ok(n >= 1 && n <= 80, 'at most 40 a second got through, got ' + n);
  m.close(); s.close();
});
