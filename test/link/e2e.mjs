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
  await x.ev(`window.__why = null; LINK.on(function(e, d){ if (e === 'refused') window.__why = d; }); LINK.start('master','e2e-room','nope')`);
  await until('a wrong key is refused', x, `window.__why === 'key' && LINK.info().role === null`);
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
