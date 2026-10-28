'use strict';
/* The pure half of tenface.js: state, step cycling, persistence. */
const test = require('node:test');
const assert = require('node:assert/strict');
const TF = require('../../public/js/tenface.js');
const { defaults, cycle, normalize, serialize } = TF._;

test('defaults: 4 slots x 5 lanes x 64 empty steps (16 in use), the default kit', () => {
  const s = defaults();
  assert.equal(s.slots.length, 4);
  for (const sl of s.slots) {
    assert.equal(sl.lanes.length, 5);
    assert.deepEqual(sl.lanes.map((l) => l.snd), ['kick', 'snare', 'ch', 'clap', 'oh']);
    for (const l of sl.lanes) {
      assert.deepEqual(l.steps, new Array(64).fill(0));
      assert.deepEqual(l.notes, new Array(64).fill(0));
      assert.equal(l.mod, null); assert.deepEqual(l.env, { a: 10, d: 200, s: 70, r: 300 });
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
  s.slots[1].lanes[2].mod = 'birdbox'; s.slots[1].lanes[2].notes[3] = 5; s.slots[1].lanes[2].notes[40] = 16;
  s.slots[1].lanes[2].env = { a: 0, d: 2000, s: 0, r: 4000 }; s.slots[1].lanes[2].len = 64; s.busLen = 48;
  assert.deepEqual(normalize(serialize(s)), s);
});

test('corrupt or partial saved data falls back to defaults field by field', () => {
  assert.deepEqual(normalize('not json'), defaults());
  assert.deepEqual(normalize('{}'), defaults());
  assert.deepEqual(normalize('{"slots":[null]}'), defaults());
  const s = normalize('{"bpm":999,"slots":[{"lanes":[{"steps":[1,7],"snd":"nope","rate":3}]}]}');
  assert.equal(s.bpm, 240);
  const l = s.slots[0].lanes[0];
  assert.equal(l.steps[0], 1); assert.equal(l.steps[1], 0); assert.equal(l.steps.length, 64);
  assert.equal(l.snd, 'kick'); assert.equal(l.rate, 1);
  assert.equal(s.slots[0].lanes.length, 5); assert.equal(s.slots.length, 4);
});

const { placeNote, noteAt, deleteNote, MODS } = TF._;

test('an old 16-step save keeps its steps and is padded to 64; LENGTH runs 8..64', () => {
  const old = '{"busLen":16,"slots":[{"lanes":[{"steps":[1,0,2,0,0,0,0,0,0,0,0,0,0,0,0,1],"len":16}]}]}';
  const l = normalize(old).slots[0].lanes[0];
  assert.equal(l.steps.length, 64); assert.equal(l.steps[2], 2); assert.equal(l.steps[15], 1); assert.equal(l.steps[16], 0);
  assert.equal(normalize('{"slots":[{"lanes":[{"len":99}]}]}').slots[0].lanes[0].len, 64);
  assert.equal(normalize('{"busLen":40}').busLen, 40);
  assert.equal(normalize('{"busLen":70}').busLen, 64);
});

test('saved notes: bad lengths dropped, overlaps dropped, the tail clipped at 64', () => {
  const n = new Array(64).fill(0); n[0] = 4; n[2] = 3; n[10] = 99; n[11] = 2.5; n[20] = 16; n[62] = 9;
  const l = normalize(JSON.stringify({ slots: [{ lanes: [{ mod: 'noise', notes: n }] }] })).slots[0].lanes[0];
  assert.equal(l.mod, 'noise');
  assert.equal(l.notes[0], 4); assert.equal(l.notes[2], 0);       /* inside the first note */
  assert.equal(l.notes[10], 0); assert.equal(l.notes[11], 0);     /* > 16, not an integer */
  assert.equal(l.notes[20], 16); assert.equal(l.notes[62], 2);
});

test('saved modules: unknown ones dropped, a module used twice in a slot stays on the first lane only', () => {
  const s = normalize(JSON.stringify({ slots: [{ lanes: [{ mod: 'multi' }, { mod: 'nope' }, { mod: 'multi' }, { mod: 'riser' }] }, { lanes: [{ mod: 'multi' }] }] }));
  assert.deepEqual(s.slots[0].lanes.map((l) => l.mod), ['multi', null, null, 'riser', null]);
  assert.equal(s.slots[1].lanes[0].mod, 'multi');
  assert.deepEqual(MODS, ['voice', 'multi', 'birdbox', 'noise', 'riser']);
  const e = normalize('{"slots":[{"lanes":[{"env":{"a":-5,"d":9999,"s":50,"r":"x"}}]}]}').slots[0].lanes[0].env;
  assert.deepEqual(e, { a: 0, d: 2000, s: 50, r: 300 });
});

test('placeNote clamps to 16 rows, the next note and the lane length; noteAt / deleteNote', () => {
  const n = new Array(64).fill(0);
  assert.equal(placeNote(n, 0, 20, 64), 16); assert.equal(n[0], 16);
  n[0] = 0; n[10] = 2;
  assert.equal(placeNote(n, 6, 8, 64), 4);                        /* stops at the note at 10 */
  assert.equal(placeNote(n, 14, 8, 16), 2);                       /* stops at the lane end */
  assert.equal(placeNote(n, 11, 1, 64), 0);                       /* inside the note at 10: refused */
  assert.equal(noteAt(n, 11), 10); assert.equal(noteAt(n, 12), -1); assert.equal(noteAt(n, 6), 6);
  assert.equal(placeNote(n, 6, 2, 64), 2); assert.equal(n[6], 2);  /* re-placing resizes */
  deleteNote(n, 11); assert.equal(n[10], 0); assert.equal(noteAt(n, 10), -1);
});

test('packSlot gives LINK nested arrays only, and unpackSlot gives the same slot back', () => {
  const { packSlot, unpackSlot } = TF._;
  const s = defaults().slots[1];
  s.lanes[0].steps[40] = 2; s.lanes[3].mod = 'noise'; s.lanes[3].notes[5] = 7; s.lanes[3].env = { a: 1, d: 2, s: 3, r: 4 };
  s.lanes[2].fx.verb = 30; s.lanes[1].mute = true; s.lanes[4].rate = 2 / 3; s.lanes[4].snd = 'cow';
  const p = packSlot(s);
  const flat = (v) => Array.isArray(v) ? v.every(flat) : (v === null || typeof v !== 'object');
  assert.ok(Array.isArray(p) && flat(p));
  assert.deepEqual(unpackSlot(p), s);
  assert.deepEqual(unpackSlot('junk'), defaults().slots[0]);
});
