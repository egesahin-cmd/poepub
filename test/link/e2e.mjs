// LINK end to end: the real app in real (headless) Chrome pages, against a real server.
//   node test/link/e2e.mjs
// Drives LINK through its API (LINK.start, LINK.hold) so it covers the core, the rows and the
// server without depending on the look. The look and the touches are checked in ui.mjs.
import { rig, sleep } from './rig.mjs';

const { startServer, stopServer, openBrowser, page, ok, until, finish } = rig({ port: 3077, debugPort: 9391 });

try {
  await startServer(); await openBrowser();
  const VOL = `MIX_CH.findIndex(function(c){return c.master})`;
  const m = await page('/masterctrl'), s = await page('/slaves');
  ok('pages are visible, so animation frames run', (await s.ev('document.hidden')) === false && (await m.ev('document.hidden')) === false);

  await s.ev(`LINK.start('slave','E2E Room')`);
  await until('a slave may wait before the master arrives', s, `LINK.info().joined && !LINK.info().online`);
  await m.ev(`LINK.start('master','e2e room','test')`);
  await until('master joins and counts one slave', m, `LINK.info().joined && LINK.info().count === 1`);
  await until('slave sees the master', s, `LINK.info().online === true`);

  await m.ev(`toggleNoise()`);
  await until('play: NOISE starts on the slave', s, `nOn === true`);
  await m.ev(`updMix(${VOL}, 37)`);
  await until('setting: master volume reaches the slave', s, `appMasterVol === 37`);
  ok('the slave\'s mixer fader moved with it', (await s.ev(`document.getElementById('mxT'+${VOL}).style.top`)) === '63%');

  await m.ev(`LINK.hold(true); multiToggle()`);
  await sleep(600);
  ok('HOLD: nothing leaves the master', (await s.ev(`multiPlaying`)) === false && (await m.ev(`multiPlaying`)) === true);
  const s2 = await page('/slaves'); await s2.ev(`LINK.start('slave','e2e-room')`);
  await until('a latecomer gets the last RELEASED state while the master holds', s2, `nOn === true && appMasterVol === 37 && multiPlaying === false`);
  await m.ev(`LINK.hold(false)`);
  await until('release: MATHS starts on the slave', s, `multiPlaying === true`);
  await until('release reaches the latecomer too', s2, `multiPlaying === true`);

  const x = await page('/masterctrl');
  ok('and the real master is still the master', (await m.ev(`LINK.info().role === 'master' && LINK.info().joined`)) === true);

  await s.ev(`toggleNoise()`);                                         // the slave drifts off the mirror
  await until('self-check puts a drifted slave back', s, `nOn === true`, 4000);

  await m.load();                                                      // the master's phone reloads mid-show
  ok('a reloaded master boots silent', (await m.ev(`nOn === false && multiPlaying === false`)) === true);
  await m.ev(`LINK.start('master','e2e-room','test')`);
  await until('it adopts the room instead of resetting it', m, `LINK.info().joined && nOn === true && multiPlaying === true && appMasterVol === 37`);
  await sleep(400);
  ok('the slaves never noticed', (await s.ev(`nOn === true && multiPlaying === true && appMasterVol === 37`)) === true);

  await m.ev(`toggleNoise()`);
  await until('stop: NOISE stops on the slave', s, `nOn === false`);

  /* TRACKER: each slave runs its own hidden TRACKER on the master's patterns and start time,
     so it plays the drums and the module envelopes itself. Joined by a real tap, as on a phone:
     its audio must run. */
  const t = await page('/slaves?room=e2e-room');
  await t.tap('#lkGo');
  await until('a tapped-in slave joins with running audio', t, `LINK.info().joined && AC && AC.state === 'running'`);
  await m.ev(`switchTab('burst'); 1`);                                 /* first: opening TRACKER loads its saved patterns */
  await m.ev(`var L = TF.state.slots[TF.state.slot].lanes; TF.state.bpm = 133;
              L[0].steps.fill(0); L[0].steps[0] = 1; L[0].steps[8] = 2;
              L[2].mod = 'birdbox'; L[2].env = { a: 10, d: 10, s: 100, r: 50 }; L[2].notes.fill(0); L[2].notes[0] = 4;
              TF.render(); 1`);
  await m.tap('#tfPlay');                                              /* a real tap: the reloaded page's audio is still locked */
  ok('on a master, TRACKER\'s PLAY is clear of the LINK badge', (await m.ev(`TF.playing`)) === true);
  await until('the slave\'s TRACKER plays when the master\'s does', t, `TF.playing === true`, 3000);
  await until('with the master\'s patterns and BPM', t, `TF.state.bpm === 133 && TF.state.slots[0].lanes[0].steps[8] === 2 && TF.state.slots[0].lanes[2].mod === 'birdbox'`, 3000);
  await until('the slave\'s own TRACKER switches BIRDBOX on, with its envelope', t, `TF.owns('birdbox') && swpPlaying === true`, 3000);
  await until('and off after the note', t, `!TF.owns('birdbox') && swpPlaying === false`, 3000);
  ok('the hits are scheduled on the slave', (await t.ev(`TF._scheduledCount`)) > 0);
  ok('a module TRACKER switches is not mirrored as a plain on/off', (await m.ev(`LINK.info().role`)) === 'master' && (await s.ev(`swpPlaying`)) === false);
  await sleep(2500);                                                   /* one self-check pass */
  const start = async (p) => p.ev(`TF.startPerf + LINK.clock().off`);
  const dt = Math.abs((await start(m)) - (await start(t)));
  ok('both start from the same moment (shared clock, within 30 ms)', dt < 30, dt);
  await m.ev(`TF.state.slots[0].lanes[1].steps[3] = 2; TF.render(); 1`);
  await until('an edit on the master while playing reaches the slave', t, `TF.state.slots[0].lanes[1].steps[3] === 2`, 2000);
  await m.tap('.tf-slot[data-i="1"]');
  await until('a slot switch on the master is taken on the slave too', t, `TF.state.slot === 1`, 4000);
  await m.tap('#tfPlay');
  await until('stopping the master stops the slave\'s TRACKER', t, `TF.playing === false && swpPlaying === false`, 3000);
  await m.tap('.tf-slot[data-i="0"]');
  await t.ev(`LINK.stop(); 1`);

  /* Review focus: a row the slave does not know, and a row whose setter throws. */
  await m.ev(`window.__a = 0; window.__b = 0;
    LINK.row({ id: 'zz.new', kind: 'setting', get: function(){ return window.__a; }, set: function(v){ window.__a = v; } });
    LINK.row({ id: 'zz.bad', kind: 'setting', get: function(){ return window.__b; }, set: function(v){ window.__b = v; } })`);
  await s.ev(`LINK.row({ id: 'zz.bad', kind: 'setting', heal: false, get: function(){ return 0; }, set: function(){ throw new Error('boom'); } })`);
  await m.ev(`window.__a = 5; window.__b = 7; toggleRiser()`);
  await until('an unknown row and a throwing setter do not stop the rest of the batch', s, `rsPlaying === true`);
  await m.ev(`toggleRiser()`);
  await until('and the slave keeps following afterwards', s, `rsPlaying === false`);

  await m.ev(`LINK.hold(true); updMix(${VOL}, 12)`);                  // a private change, held
  await stopServer(); await sleep(400); await startServer();          // a deploy restarts the server
  await until('master reconnects and re-claims', m, `LINK.info().connected && LINK.info().joined`, 12000);
  await until('slave reconnects and sees the master', s, `LINK.info().connected && LINK.info().online`, 12000);
  ok('nobody changed across the restart', (await s.ev(`multiPlaying === true && nOn === false && appMasterVol === 37`)) === true);
  const s3 = await page('/slaves'); await s3.ev(`LINK.start('slave','e2e-room')`);
  await until('the cache was rebuilt from the master: a new slave gets the room', s3, `multiPlaying === true && nOn === false && appMasterVol === 37`);
  await sleep(600);
  ok('and what the master was holding stayed private through the restart', (await s.ev(`appMasterVol`)) === 37 && (await s3.ev(`appMasterVol`)) === 37 && (await m.ev(`appMasterVol`)) === 12);
  await m.ev(`LINK.hold(false)`);
  await until('until it was released', s3, `appMasterVol === 12`);

  await s.ev(`LINK.stop()`);
  ok('exit keeps the current sound', (await s.ev(`multiPlaying === true && appMasterVol === 12 && LINK.info().role === null`)) === true);
  await m.ev(`multiToggle()`); await sleep(600);
  ok('and an exited phone no longer follows', (await s.ev(`multiPlaying`)) === true);
  await until('the master counts the two that remain', m, `LINK.info().count === 2`);
  ok('the shared clock is running', (await m.ev(`typeof LINK.clock().off === 'number' && LINK.clock().n >= 1 && LINK.clock().rtt < 500`)) === true);

  finish();
} catch (e) { console.log('FAIL', e.stack || e.message); finish(1); }
