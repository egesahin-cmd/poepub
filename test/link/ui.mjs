// LINK look and touch: the join sheets, the lock, the buttons — with real (trusted) touches.
//   node test/link/ui.mjs [folder-for-screenshots]
// The lock deliberately ignores synthetic events, so these go through Chrome's input pipeline.
import { rig, sleep } from './rig.mjs';
import path from 'node:path';

const { startServer, openBrowser, page, ok, until, finish } = rig({ port: 3076, debugPort: 9392 });
const shots = process.argv[2];
const text = (sel) => `document.querySelector(${JSON.stringify(sel)}).textContent`;

try {
  await startServer(); await openBrowser();

  const plain = await page('/');
  ok('at the plain address LINK is inert', (await plain.ev(`!document.getElementById('lkBar') && !document.querySelector('.lk-sheet') && LINK.info().role === null && !!document.getElementById('lpQR')`)) === true);

  // ── review focus: an empty room is named on the sheet and nothing connects ──
  const e = await page('/slaves');
  await e.tap('#lkGo');
  ok('an empty room is named on the sheet', (await e.ev(`${text('#lkMsg')} === 'ENTER A ROOM NAME' && LINK.info().role === null && !document.getElementById('lkBar')`)) === true);
  // ── review focus: JOIN twice is one session and one set of buttons ──
  await e.ev(`document.getElementById('lkRoom').value = 'twice'; var b = document.getElementById('lkGo'); b.click(); b.click(); 1`);
  await until('JOIN twice still joins', e, `LINK.info().joined === true`);
  await sleep(1500);
  ok('and builds one set of buttons', (await e.ev(`document.querySelectorAll('#lkBar').length === 1 && document.querySelectorAll('#lkVeil').length === 1 && document.querySelectorAll('#lkRing').length === 1 && document.querySelectorAll('#lkExit').length === 1`)) === true);

  // ── slave joins by the sheet ──
  const s = await page('/slaves?room=UI%20Room');
  ok('the room from the link is filled in', (await s.ev(`document.getElementById('lkRoom').value`)) === 'UI Room');
  ok('the slave sheet offers JOIN and no key field', (await s.ev(`${text('#lkGo')} === 'JOIN' && !document.getElementById('lkKey')`)) === true);
  if (shots) await s.shot(path.join(shots, 'sheet-slave.png'));
  await s.tap('#lkGo');
  await until('JOIN enters slave mode', s, `LINK.info().joined && !!document.querySelector('#lkBar.slave') && !!document.getElementById('lkVeil') && !!document.querySelector('#bbFrame > #lkRing') && document.getElementById('landingOverlay').classList.contains('hidden')`);
  ok('the join tap started audio', (await s.ev(`AC ? AC.state : 'none'`)) === 'running', await s.ev(`AC ? AC.state : 'none'`));
  ok('pull-to-refresh is off on a slave', (await s.ev(`document.documentElement.style.overscrollBehavior`)) === 'none', await s.ev(`document.documentElement.style.overscrollBehavior`));
  await until('with no master yet the slave button reads WAIT', s, `document.getElementById('lkBadge').className === 'wait' && ${text('#lkBadge .lk-lbl')} === 'WAIT'`);

  // ── master: a wrong key, then the right one ──
  const m = await page('/masterctrl');
  if (shots) await m.shot(path.join(shots, 'sheet-master.png'));
  await m.ev(`document.getElementById('lkRoom').value = 'ui room'; document.getElementById('lkKey').value = 'nope'`);
  await m.tap('#lkGo');
  await until('a wrong key is named on the sheet', m, `${text('#lkMsg')} === 'WRONG KEY' && !document.getElementById('lkBar')`);
  /* The app measures the tab bar once at boot, which can be before the web font arrives. */
  await m.ev(`document.documentElement.style.setProperty('--tab-h', '5px'); document.getElementById('lkKey').value = 'test'`);
  await m.tap('#lkGo');
  await until('TAKE CONTROL enters master mode', m, `LINK.info().joined && document.getElementById('lkBadge').className === 'master'`);
  ok('the button is placed from a fresh measure of the tab bar', (await m.ev(`getComputedStyle(document.documentElement).getPropertyValue('--tab-h').trim() === document.querySelector('.tabs').offsetHeight + 'px'`)) === true, await m.ev(`getComputedStyle(document.documentElement).getPropertyValue('--tab-h')`));
  await until('the master button shows the slave count', m, `${text('#lkBadge .lk-n')} === '1'`);
  await until('the slave button now reads SLAVE', s, `document.getElementById('lkBadge').className === 'slave' && ${text('#lkBadge .lk-lbl')} === 'SLAVE'`);
  ok('pull-to-refresh is off on the master', (await m.ev(`document.documentElement.style.overscrollBehavior`)) === 'none');
  ok('the QR tab hands out this room', /\/slaves\?room=ui-room$/.test(await m.ev(`document.getElementById('appQR').title`)), await m.ev(`document.getElementById('appQR').title`));

  // ── the master plays by touch; the slave follows ──
  await m.tap('.tab[data-tab="noise"]');
  await m.tap('#nsPlayBtn');
  await until('a real tap on the master reaches the slave', s, `nOn === true`);
  if (shots) await m.shot(path.join(shots, 'master-noise.png'));

  // ── the slave is locked, except tabs, the mouth and exit ──
  await s.tap('.tab[data-tab="noise"]');
  await until('tabs stay live on a slave', s, `document.querySelector('.tab.active').dataset.tab === 'noise'`);
  if (shots) await s.shot(path.join(shots, 'slave-noise.png'));
  await s.tap('#nsPlayBtn');
  ok('locked: tapping NOISE play does nothing', (await s.ev(`nOn`)) === true);
  await s.tap('.tab[data-tab="multi"]');
  await s.tap('#mathsPowerBtn');
  ok('locked: tapping MATHS SOUND does nothing', (await s.ev(`multiPlaying`)) === false);
  await s.tap('.tab[data-tab="birdbox"]');
  if (shots) await s.shot(path.join(shots, 'slave-birdbox.png'));
  await s.tap('#bbPlayBtn');
  ok('locked: tapping the bird does nothing', (await s.ev(`swpPlaying`)) === false);
  await s.tap('.tab[data-tab="voice"]');
  await s.ev(`window.__touches = 0; document.getElementById('vtTractCanvas').addEventListener('touchstart', function(){ window.__touches++; }); 1`);
  await s.tap('#vtTractCanvas');
  ok('the VOICE mouth canvas is live', (await s.ev(`window.__touches`)) === 1);
  const oto = await s.ev(`VT.getOtotune()`);
  await s.tap('#vtOtotuneBtn');
  ok('locked: the VOICE buttons', (await s.ev(`VT.getOtotune()`)) === oto);
  if (shots) await s.shot(path.join(shots, 'slave-voice.png'));
  ok('a slave leaves no trace in its storage', (await s.ev(`localStorage.setItem('lk_probe', '1'); localStorage.getItem('lk_probe')`)) === null);

  // ── review focus: audio that is not running (blocked, or after a phone call) ──
  await s.ev(`AC.suspend(); 1`);
  await until('audio stopped: the slave button reads TAP', s, `${text('#lkBadge .lk-lbl')} === 'TAP'`);
  await s.tap('.tab[data-tab="noise"]');
  await s.tap('#nsPlayBtn');
  await until('any touch resumes it, even on a locked control', s, `AC.state === 'running' && ${text('#lkBadge .lk-lbl')} === 'SLAVE'`);
  ok('and that touch still changed nothing', (await s.ev(`nOn`)) === true);

  /* iPhones report 'interrupted', not 'suspended', after a call. Chrome has no such state, so it is staged. */
  await s.ev(`window.__resumed = 0; AC.__resume = AC.resume; AC.resume = function(){ window.__resumed++; return AC.__resume.call(AC); };
    Object.defineProperty(AC, 'state', { configurable: true, get: function(){ return 'interrupted'; } }); 1`);
  await s.tap('#nsPlayBtn');
  ok('an interrupted context is resumed by a touch too', (await s.ev(`window.__resumed`)) >= 1, await s.ev(`window.__resumed`));
  await s.ev(`delete AC.state; AC.resume = AC.__resume; 1`);

  // ── a slave whose screen goes dark fades out, and comes back at its level ──
  const hide = (v) => `Object.defineProperty(document, 'hidden', { configurable: true, get: function(){ return ${v}; } }); document.dispatchEvent(new Event('visibilitychange')); 1`;
  await s.ev(hide(true));
  await until('a hidden slave fades to silence', s, `appMaster.gain.value < 0.01`);
  await s.ev(hide(false));
  await until('and returns to its level when shown again', s, `Math.abs(appMaster.gain.value - v2g(appMasterVol)) < 0.01`);

  // ── HOLD by touch ──
  await m.tap('#lkBadge');
  await until('tapping the master button holds', m, `LINK.info().held && document.getElementById('lkBadge').className === 'hold' && ${text('#lkBadge .lk-lbl')} === 'HOLD'`);
  if (shots) await m.shot(path.join(shots, 'master-hold.png'));
  await m.tap('#nsPlayBtn');
  await sleep(500);
  ok('held: the master stopped NOISE, the slave did not', (await m.ev(`nOn`)) === false && (await s.ev(`nOn`)) === true);
  await m.tap('#lkBadge');
  await until('released: the slave stops too', s, `nOn === false`);
  ok('the master button is live again', (await m.ev(`document.getElementById('lkBadge').className`)) === 'master');

  // ── master lost ──
  await m.ev(`LINK.stop()`);
  await until('master gone: the slave button reads WAIT', s, `document.getElementById('lkBadge').className === 'wait' && ${text('#lkBadge .lk-lbl')} === 'WAIT'`);
  ok('and the slave is still locked', (await s.ev(`!!document.getElementById('lkVeil') && LINK.info().role === 'slave'`)) === true);

  // ── exit ──
  await s.tap('#lkExit', 150);
  ok('a short tap on EXIT does not exit', (await s.ev(`LINK.info().role`)) === 'slave');
  await s.tap('#lkExit', 1300);
  await until('holding EXIT leaves slave mode', s, `LINK.info().role === null && !document.getElementById('lkBar') && !document.getElementById('lkVeil') && !document.getElementById('lkRing') && !document.getElementById('app').classList.contains('lk-slave')`);
  ok('the address is the plain one again', (await s.ev(`location.pathname + location.search`)) === '/');
  ok('and pull-to-refresh is back to the browser default', (await s.ev(`document.documentElement.style.overscrollBehavior`)) === '');
  ok('storage works again', (await s.ev(`localStorage.setItem('lk_probe', '1'); var v = localStorage.getItem('lk_probe'); localStorage.removeItem('lk_probe'); v`)) === '1');
  await s.tap('.tab[data-tab="voice"]');
  await s.tap('#vtOtotuneBtn');
  ok('controls answer again', (await s.ev(`VT.getOtotune()`)) !== oto);

  // ── a reloaded master can resume ──
  await m.load();
  ok('after a reload the sheet offers to resume, room and key kept', (await m.ev(`${text('#lkGo')} === 'RESUME AS MASTER' && document.getElementById('lkRoom').value === 'ui-room' && document.getElementById('lkKey').value === 'test'`)) === true);

  // ── review focus: a second phone takes control ──
  await m.tap('#lkGo');
  await until('RESUME AS MASTER takes the room back', m, `LINK.info().joined && document.getElementById('lkBadge').className === 'master'`);
  const m2 = await page('/masterctrl');
  await m2.ev(`document.getElementById('lkRoom').value = 'UI ROOM'; document.getElementById('lkKey').value = 'test'`);
  await m2.tap('#lkGo');
  await until('a second phone can take control', m2, `LINK.info().joined === true`);
  await until('the first is a normal poepub again and has forgotten the key', m, `LINK.info().role === null && !document.getElementById('lkBar') && sessionStorage.getItem('link_master') === null`);
  const s4 = await page('/slaves'); await s4.ev(`LINK.start('slave', 'ui-room')`);
  await until('a slave in the room follows the new master', s4, `LINK.info().online === true`);
  await m2.ev(`toggleRiser()`);
  await until('and plays what it plays', s4, `rsPlaying === true`);

  finish();
} catch (e) { console.log('FAIL', e.stack || e.message); finish(1); }
