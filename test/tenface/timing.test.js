'use strict';
/* The sequencer clock: step durations, swing, per-lane rate/length, slot switch. */
const test = require('node:test');
const assert = require('node:assert/strict');
const TF = require('../../public/js/tenface.js');
const { defaults, stepDur, swingOffset, makeClock } = TF._;

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' != ' + b);
const kick = (s) => s.slots[s.slot].lanes[0];
const ofLane = (evs, n) => evs.filter((e) => e.lane === n);

test('stepDur is a 16th at bpm divided by rate; swingOffset only moves odd steps', () => {
  near(stepDur(120, 1), 0.125); near(stepDur(120, 2), 0.0625); near(stepDur(60, 0.5), 0.5);
  assert.equal(swingOffset(2, 120, 1, 75), 0);
  assert.equal(swingOffset(1, 120, 1, 50), 0);
  near(swingOffset(1, 120, 1, 75), 0.0625);
  near(swingOffset(3, 120, 2, 75), 0.03125);
});

test('steps 0 and 4 at 120 bpm land at t0 and t0+0.5', () => {
  const s = defaults(); kick(s).steps[0] = 1; kick(s).steps[4] = 2;
  const ev = ofLane(makeClock(s, 10).events(10, 10.6), 0);
  assert.equal(ev.length, 2);
  near(ev[0].t, 10); near(ev[1].t, 10.5);
  assert.equal(ev[0].v, 1); assert.equal(ev[1].v, 2); assert.equal(ev[1].step, 4);
});

test('a rate-2 lane gives twice the events of a rate-1 lane', () => {
  const s = defaults(); kick(s).steps.fill(1); s.slots[0].lanes[1].steps.fill(1); s.slots[0].lanes[1].rate = 2;
  const ev = makeClock(s, 0).events(0, 2);
  assert.equal(ofLane(ev, 0).length, 16); assert.equal(ofLane(ev, 1).length, 32);
});

test('len 8 repeats every 8 steps', () => {
  const s = defaults(); kick(s).steps[0] = 1; kick(s).len = 8;
  const ev = ofLane(makeClock(s, 0).events(0, 2.1), 0);
  assert.equal(ev.length, 3);
  near(ev[1].t - ev[0].t, 8 * 0.125); near(ev[2].t - ev[1].t, 8 * 0.125);
});

test('swing 75 pushes step 1 by half a step and leaves step 2', () => {
  const s = defaults(); s.swing = 75; kick(s).steps[1] = 1; kick(s).steps[2] = 1;
  const ev = ofLane(makeClock(s, 0).events(0, 0.4), 0);
  near(ev[0].t, 0.125 + 0.0625); near(ev[1].t, 0.25);
});

test('10 ms chunks give the same events as one window', () => {
  const s = defaults(); s.swing = 66;
  s.slots[0].lanes.forEach((l, i) => { l.rate = [1, 2, 4 / 3, 0.5, 2 / 3][i]; l.steps.fill(1); });
  const whole = makeClock(s, 5).events(5, 9);
  const c = makeClock(s, 5); let parts = [];
  for (let t = 5; t < 9; t += 0.01) parts = parts.concat(c.events(t, Math.min(t + 0.01, 9)));
  const key = (e) => e.lane + ':' + e.step + ':' + e.t.toFixed(9);
  assert.deepEqual(parts.map(key).sort(), whole.map(key).sort());
  assert.equal(new Set(parts.map(key)).size, parts.length);
});

test('lowering len mid-pattern wraps to step 0 without throwing', () => {
  const s = defaults(); kick(s).steps.fill(1);
  const c = makeClock(s, 0);
  c.events(0, 13 * 0.125 + 0.01);            // steps 0..13 emitted, next is 14
  kick(s).len = 8;
  const ev = ofLane(c.events(13 * 0.125 + 0.01, 2), 0);
  assert.equal(ev[0].step, 0); near(ev[0].t, 14 * 0.125);
});

test('two slot requests in one bar: the later wins, lanes restart at the bar line', () => {
  const s = defaults(); const bar = 16 * 0.125;
  s.slots[0].lanes[0].steps.fill(1);
  s.slots[1].lanes[0].steps[5] = 1;
  s.slots[2].lanes[0].steps[3] = 1; s.slots[2].lanes[1].steps[0] = 1;
  const c = makeClock(s, 0);
  c.events(0, 0.3);
  c.requestSlot(1, 0.3); c.requestSlot(2, 0.5);
  const ev = c.events(0.3, bar + 1);
  assert.equal(s.slot, 2);
  assert.ok(ev.filter((e) => e.t < bar - 1e-9).every((e) => e.lane === 0 && e.v === 1));
  const after = ev.filter((e) => e.t >= bar - 1e-9);
  const k = ofLane(after, 0);
  assert.equal(k.length, 1); assert.equal(k[0].step, 3); near(k[0].t, bar + 3 * 0.125);
  const sn = ofLane(after, 1);
  assert.equal(sn.length, 1); assert.equal(sn[0].step, 0); near(sn[0].t, bar);
});

test('a muted lane emits nothing but still calls onStep; empty steps too', () => {
  const s = defaults(); kick(s).steps.fill(1); kick(s).mute = true;
  const c = makeClock(s, 0); const seen = [];
  c.onStep((l, st, t) => seen.push([l, st, t]));
  const ev = c.events(0, 0.3);
  assert.equal(ofLane(ev, 0).length, 0);
  assert.equal(ev.length, 0);
  assert.equal(seen.filter((x) => x[0] === 0).length, 3);
  assert.equal(seen.filter((x) => x[0] === 4).length, 3);
});

test('a request landing in an already-emitted bar waits for the next bar line', () => {
  const s = defaults(); s.slots[0].lanes[0].steps.fill(1); s.slots[1].lanes[0].steps[0] = 1;
  const c = makeClock(s, 0);
  const a = c.events(0, 2.05);
  assert.ok(a.some((e) => Math.abs(e.t - 2) < 1e-9));          // slot 0's kick at 2.0 already sent
  c.requestSlot(1, 1.96);
  c.events(2.05, 3);
  assert.equal(s.slot, 0);                                    // not switched at the stale 2.0
  const b = c.events(3, 4.5);
  assert.equal(b.filter((e) => e.step === 0 && e.t < 4 - 1e-9).length, 0);   // no restart at 2.0
  const at4 = b.filter((e) => e.t >= 4 - 1e-9);
  assert.equal(at4.length, 1); near(at4[0].t, 4); assert.equal(at4[0].step, 0); assert.equal(s.slot, 1);
  assert.ok(b.filter((e) => e.t < 4 - 1e-9).every((e) => e.v === 1 && e.step > 0));
});

test('the bar line follows BPM changes (accumulated, not t0 + k*bar)', () => {
  const s = defaults(); s.slots[1].lanes[0].steps[0] = 1;
  const c = makeClock(s, 0);
  c.events(0, 1);                       // bar 1 at 2.0 (120 bpm)
  s.bpm = 100;
  c.events(1, 2.5);                     // passes 2.0; next bar = 2.0 + 16*0.15 = 4.4
  c.requestSlot(1, 3);
  const ev = c.events(2.5, 5);
  const k = ofLane(ev, 0).filter((e) => e.t >= 4);
  assert.equal(k.length, 1); near(k[0].t, 4.4);
});

test('NaN bpm or undefined rate cannot hang events()', () => {
  const s = defaults(); s.bpm = NaN;
  assert.deepEqual(makeClock(s, 0).events(0, 1), []);
  const r = defaults(); r.slots[0].lanes[2].rate = undefined; r.slots[0].lanes[0].steps[0] = 1;
  const ev = makeClock(r, 0).events(0, 1);
  assert.equal(ofLane(ev, 0).length, 1);
});

test('no old-slot event is emitted at or after the bar line, even when swung past it', () => {
  const s = defaults(); s.swing = 75;
  s.slots[0].lanes[0].rate = 4 / 3; s.slots[0].lanes[0].steps.fill(1);
  s.slots[1].lanes[1].steps[0] = 1;
  const c = makeClock(s, 0);
  c.requestSlot(1, 0.1);
  const ev = c.events(0, 3);
  assert.ok(ofLane(ev, 0).every((e) => e.t < 2 - 1e-9));
  assert.equal(ofLane(ev, 1).length, 1);
});

test('onSwitch reports the slot and the bar-line time of a switch, once', () => {
  const s = defaults(), got = [];
  const c = makeClock(s, 0);
  c.onSwitch((slot, at) => got.push([slot, at]));
  c.events(0, 1.9); c.requestSlot(1, 1.85);
  c.events(1.9, 2.1); c.events(2.1, 4.5);
  assert.equal(got.length, 1);
  assert.equal(got[0][0], 1); near(got[0][1], 2);
});
