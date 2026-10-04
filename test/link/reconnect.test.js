'use strict';
/* The master's reconnect logic, with a fake socket so a lost packet can be staged exactly.
   A real network cannot be made to drop one message on cue. */
const test = require('node:test');
const assert = require('node:assert/strict');
const LINK = require('../../public/js/link-core.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = { a: 1 };
LINK.row({ id: 'x.a', kind: 'setting', get: () => state.a, set: (v) => { state.a = v; } });

/* Stands in for socket.io's client: records what is emitted, lets the test fire events and
   answer acks. timeout().emit answers as socket.io does: callback(err, ack). */
function fakeNet() {
  const handlers = {}, sent = [];
  const sock = {
    connected: false,
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    off() { for (const k of Object.keys(handlers)) delete handlers[k]; },
    disconnect() { sock.connected = false; },
    emit(ev, ...args) { sent.push({ ev, args }); },
    timeout() { return { emit(ev, ...args) { sent.push({ ev, args }); } }; },
    volatile: { emit(ev, ...args) { sent.push({ ev, args }); } },
  };
  return {
    sock, sent,
    fire(ev, ...a) { (handlers[ev] || []).slice().forEach((fn) => fn(...a)); },
    answer(ev, ...a) { const m = sent.filter((x) => x.ev === ev && !x.done).pop(); m.done = true; m.args[m.args.length - 1](...a); },
    deltas() { return sent.filter((x) => x.ev === 'd').map((x) => x.args[0].d); },
  };
}
function master() {
  const net = fakeNet();
  globalThis.io = () => net.sock;
  LINK.start('master', 'room', 'k');
  net.sock.connected = true; net.fire('connect');
  net.answer('claim', null, { ok: 1, e: 0, r: 0, st: null, n: 0 });
  net.answer('put', { e: 5, r: 0 });
  return net;
}

test('a reconnecting master re-sends what the room never got', async () => {
  state.a = 1;
  const net = master();
  state.a = 2;
  await sleep(130);
  assert.deepEqual(net.deltas(), [{ 'x.a': 2 }], 'sent once — into a connection that was already dying');
  /* The server never got it: its cache, returned by the next claim, still says 1. */
  net.fire('disconnect'); net.fire('connect');
  net.answer('claim', null, { ok: 1, e: 5, r: 0, st: { 'x.a': 1 }, n: 1 });
  await sleep(130);
  assert.deepEqual(net.deltas(), [{ 'x.a': 2 }, { 'x.a': 2 }], 'sent again after the reconnect');
  LINK.stop();
});

test('a reconnect while holding still publishes nothing until release', async () => {
  state.a = 1;
  const net = master();
  LINK.hold(true);
  state.a = 3;                                                    // private
  await sleep(130);
  net.fire('disconnect'); net.fire('connect');
  net.answer('claim', null, { ok: 1, e: 5, r: 0, st: { 'x.a': 1 }, n: 1 });
  await sleep(130);
  assert.deepEqual(net.deltas(), [], 'held: nothing left the phone');
  assert.equal(net.sent.filter((x) => x.ev === 'put').length, 1, 'and the room was not re-published');
  LINK.hold(false);
  await sleep(130);
  assert.deepEqual(net.deltas(), [{ 'x.a': 3 }], 'released');
  LINK.stop();
});
