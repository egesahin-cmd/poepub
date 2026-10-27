'use strict';
/* The pure half of tenface.js: state, step cycling, persistence. */
const test = require('node:test');
const assert = require('node:assert/strict');
const TF = require('../../public/js/tenface.js');
const { defaults, cycle, normalize, serialize } = TF._;

test('defaults: 4 slots x 5 lanes x 16 empty steps, the default kit', () => {
  const s = defaults();
  assert.equal(s.slots.length, 4);
  for (const sl of s.slots) {
    assert.equal(sl.lanes.length, 5);
    assert.deepEqual(sl.lanes.map((l) => l.snd), ['kick', 'snare', 'ch', 'clap', 'oh']);
    for (const l of sl.lanes) {
      assert.deepEqual(l.steps, new Array(16).fill(0));
      assert.equal(l.len, 16); assert.equal(l.rate, 1); assert.equal(l.mute, false);
    }
  }
  assert.equal(s.bpm, 120); assert.equal(s.swing, 50); assert.equal(s.busLen, 16); assert.equal(s.slot, 0);
});

test('a tap cycles off -> hit -> accent -> off', () => {
  assert.equal(cycle(0), 1); assert.equal(cycle(1), 2); assert.equal(cycle(2), 0);
});

test('serialize then normalize gives the same state back', () => {
  const s = defaults();
  s.bpm = 133; s.swing = 62; s.slot = 2; s.busVol = 40; s.busFx.verb = 25;
  s.slots[0].lanes[1].steps[4] = 2; s.slots[0].lanes[1].snd = 'cow';
  s.slots[2].lanes[4].rate = 2; s.slots[2].lanes[4].len = 12; s.slots[2].lanes[4].mute = true;
  s.slots[3].lanes[0].fx.drive = 70; s.slots[3].lanes[0].tune = -5;
  assert.deepEqual(normalize(serialize(s)), s);
});

test('corrupt or partial saved data falls back to defaults field by field', () => {
  assert.deepEqual(normalize('not json'), defaults());
  assert.deepEqual(normalize('{}'), defaults());
  assert.deepEqual(normalize('{"slots":[null]}'), defaults());
  const s = normalize('{"bpm":999,"slots":[{"lanes":[{"steps":[1,7],"snd":"nope","rate":3}]}]}');
  assert.equal(s.bpm, 240);
  const l = s.slots[0].lanes[0];
  assert.equal(l.steps[0], 1); assert.equal(l.steps[1], 0); assert.equal(l.steps.length, 16);
  assert.equal(l.snd, 'kick'); assert.equal(l.rate, 1);
  assert.equal(s.slots[0].lanes.length, 5); assert.equal(s.slots.length, 4);
});
