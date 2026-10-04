// LINK rows: every row round-trips, and every module mirrors from a master to a slave.
//   node test/link/rows.mjs
// See "How the tests work" in docs/superpowers/plans/2026-10-04-link-stages-2-5.md.
import { rig, sleep } from './rig.mjs';
import { PROBES, EXEMPT } from './probes.mjs';

const { startServer, openBrowser, page, ok, until, finish } = rig({ port: 3075, debugPort: 9393 });
const read = (p) => p.ev(`JSON.stringify(LINK._.read())`);
/* Set a native range as a drag would: the inline oninput handler runs. */
const slide = (p, id, v) => p.ev(`(function(){var e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(String(v))};e.dispatchEvent(new Event('input',{bubbles:true}));})(); 1`);
const click = (p, id) => p.ev(`document.getElementById(${JSON.stringify(id)}).click(); 1`);
/* Type into one of the app's tap-to-edit number boxes and commit with Enter. */
const typeNum = (p, id, v) => p.ev(`(function(){document.getElementById(${JSON.stringify(id)}).click();var i=document.querySelector('input.vedit');i.value=${JSON.stringify(String(v))};i.onkeydown({key:'Enter'});})(); 1`);

try {
  await startServer(); await openBrowser();

  // ── round trip: set(p) then get() === p, for every row ──
  const one = await page('/');
  const roundTrip = (p, only) => p.ev(`(function(P, EX, only){
    var out = [], rows = {};
    LINK._.rows.forEach(function(r){ rows[r.id] = r; });
    Object.keys(P).forEach(function(id){
      if (only && id.indexOf(only) !== 0) return;
      var r = rows[id]; if (!r) { out.push(id + ': no such row'); return; }
      P[id].forEach(function(v){
        try { r.set(v); var g = r.get(); if (!LINK._.eq(g, v)) out.push(id + ': set ' + JSON.stringify(v) + ' -> get ' + JSON.stringify(g)); }
        catch (e) { out.push(id + ': ' + e.message); }
      });
    });
    LINK._.rows.forEach(function(r){ if (!P[r.id] && EX.indexOf(r.id) < 0) out.push(r.id + ': no probes'); });
    return out;
  })(${JSON.stringify(PROBES)}, ${JSON.stringify(EXEMPT)}, ${JSON.stringify(only || '')})`);
  const fails = await roundTrip(one);
  ok('every row round-trips: set(p) then get() === p', Array.isArray(fails) && fails.length === 0, fails);
  /* VOICE's four switches live in an engine this phone has not started. Set early, they are
     remembered and shown, and handed over when the engine starts. */
  await one.ev(`(function(){ var R = {}; LINK._.rows.forEach(function(r){ R[r.id] = r; }); R['vt.oto'].set(1); R['vt.av'].set(1); R['vt.free'].set(0); })(); 1`);
  ok('a VOICE switch set early does not start the engine', (await one.ev(`vtInitialized`)) === false);
  ok('…and shows on its button', (await one.ev(`document.getElementById('vtOtotuneBtn').classList.contains('on') && document.getElementById('vtAlwaysVoiceBtn').classList.contains('on') && !document.getElementById('vtFreeBtn').classList.contains('on')`)) === true);
  await one.ev(`switchTab('voice')`);
  ok('…and reaches the engine when it starts', (await one.ev(`vtInitialized && VT.getOtotune() === true && VT.getAlwaysVoice() === true && VT.getFree() === false`)) === true, await one.ev(`[vtInitialized, VT.getOtotune(), VT.getAlwaysVoice(), VT.getFree()]`));
  const fails2 = await roundTrip(one, 'vt.');
  ok('VOICE rows round-trip with the engine running too', Array.isArray(fails2) && fails2.length === 0, fails2);
  ok('no uncaught errors while probing', one.errors.length === 0, one.errors);

  /* An existing MATHS bug the fundamental row depends on: a roll or a ratio pick during a
     fundamental glide used to drop the new fundamental. */
  const g = await page('/');
  await g.ev(`multiDur = 0.25; multiSetFundamental(100); multiRoll(); 1`);
  await sleep(900);
  ok('a ROLL FQ during a fundamental glide keeps the new fundamental', (await g.ev(`multiFundamental === 100 && multiOscs.every(function(o){ return o.freq === multiOpFreq(o); })`)) === true, await g.ev(`[multiFundamental, multiOscs[0].freq, multiOscs[0].ratio]`));
  await g.ev(`multiSetFundamental(60); multiSetOscRatio(0, multiOscs[1].ratio); 1`);
  await sleep(900);
  ok('so does a ratio pick', (await g.ev(`multiFundamental === 60 && multiOscs.every(function(o){ return o.freq === multiOpFreq(o); })`)) === true, await g.ev(`[multiFundamental, multiOscs[0].freq, multiOscs[0].ratio]`));

  /* The same glide, two more ways in. A list change recomputes NOISE's filter bank, BIRDBOX's
     notes and the ototune scale from the fundamental: they must get the new one, as MATHS does. */
  const pools = `(function(){ var was = JSON.stringify([bbFreqPool, rsFreqPoolA]); recomputeHarmonicPools(); return was === JSON.stringify([bbFreqPool, rsFreqPoolA]); })()`;
  await g.ev(`multiSetFundamental(140); multiSetHarmonic(2); 1`);
  await sleep(900);
  ok('a list change during a fundamental glide keeps the new fundamental', (await g.ev(`multiFundamental === 140 && multiOscs.every(function(o){ return o.freq === multiOpFreq(o); })`)) === true, await g.ev(`[multiFundamental, multiOscs[0].freq, multiOscs[0].ratio]`));
  ok('…and the other modules\' note pools are on it too', (await g.ev(pools)) === true);
  await g.ev(`multiToggle(); multiSetFundamental(80); multiToggle(); multiToggle(); 1`);      // play, new fundamental, stop and play inside the glide
  await sleep(900);
  ok('stop and play during a fundamental glide keeps the new fundamental', (await g.ev(`multiFundamental === 80 && multiOscs.every(function(o){ return o.freq === multiOpFreq(o); })`)) === true, await g.ev(`[multiFundamental, multiOscs[0].freq, multiOscs[0].ratio, document.getElementById('multiFundV').textContent]`));
  await g.ev(`multiToggle(); 1`);

  // ── mirror: a master and a slave, the slave on another tab throughout ──
  const m = await page('/masterctrl'), s = await page('/slaves');
  await s.ev(`LINK.start('slave', 'rows'); switchTab('voice')`);
  await m.ev(`LINK.start('master', 'rows', 'test')`);
  await until('master and slave are in the room', m, `LINK.info().joined && LINK.info().count === 1`);
  /* Both phones' audio must be RUNNING, as it is after the join tap on a real phone. On a suspended
     context no AudioParam ramp ever progresses, and a gain check would read the initial value. */
  await m.tap('.tab[data-tab="birdbox"]'); await s.tap('.tab[data-tab="voice"]');
  await m.ev(`getAC().resume(); 1`); await s.ev(`getAC().resume(); 1`);
  await until('audio is running on the master', m, `AC.state === 'running'`);
  await until('audio is running on the slave', s, `AC.state === 'running'`);
  /* Wait until both tables are equal; on failure name the rows that differ. */
  async function mirrors(label, other = s) {
    const end = Date.now() + 6000; let a, b;
    do { a = await read(m); b = await read(other); if (a === b) return ok(label, true); await sleep(100); } while (Date.now() < end);
    const A = JSON.parse(a), B = JSON.parse(b);
    ok(label, false, Object.keys(A).filter((k) => JSON.stringify(A[k]) !== JSON.stringify(B[k])).map((k) => `${k}: master ${JSON.stringify(A[k])} slave ${JSON.stringify(B[k])}`));
  }
  /* The master's own table must have moved, or equal tables prove nothing. */
  async function moved(label, expected) {
    const t = JSON.parse(await read(m));
    const off = Object.keys(expected).filter((k) => JSON.stringify(t[k]) !== JSON.stringify(expected[k])).map((k) => `${k}: ${JSON.stringify(t[k])}, expected ${JSON.stringify(expected[k])}`);
    ok(label, off.length === 0, off);
  }

  /* Several facts about what a page shows; on failure, name the ones that are not so. */
  async function shows(label, p, facts) {
    const no = [];
    for (const [name, expr] of Object.entries(facts)) { const v = await p.ev(expr); if (v !== true) no.push(`${name}: ${JSON.stringify(v)}`); }
    ok(label, no.length === 0, no);
  }

  // stage 1 rows
  await m.ev(`toggleRiser(); toggleSweep(); toggleNoise(); multiToggle(); updMix(MIX_CH.findIndex(function(c){return c.master}), 61)`);
  await moved('stage 1: the master\'s table moved', { 'rs.on': 1, 'bb.on': 1, 'ns.on': 1, 'mu.on': 1, 'app.vol': 61 });
  await mirrors('stage 1 rows mirror');

  // ── stage 2: MIXER ──
  const ch = (k) => m.ev(`MIX_CH.findIndex(function(c){return c.key===${JSON.stringify(k)}})`);
  const [iVoice, iMulti, iBird, iNoise] = [await ch('voice'), await ch('multi'), await ch('birdbox'), await ch('noise')];
  await m.ev(`switchTab('mixer')`);
  await m.drag('#mxT' + iBird, 0, 60);                                   // a real touch drag on a fader
  await m.ev(`updMix(${iVoice}, 80); updMix(${iMulti}, 70)`);
  await click(m, 'appAutoBtn'); await click(m, 'appLimBtn');
  const bird = JSON.parse(await read(m))['mx.birdbox'];
  ok('the touch drag moved the BIRDBOX fader', typeof bird === 'number' && bird < 100 && bird > 0, bird);
  await moved('MIXER: the master\'s table moved', { 'mx.voice': 80, 'mx.multi': 70, 'app.auto': 0, 'app.lim': 0 });
  await mirrors('MIXER rows mirror');
  ok('the slave\'s faders and module sliders moved', (await s.ev(`document.getElementById('mxT${iVoice}').style.top === '20%' && document.getElementById('vtVolR').value === '80' && document.getElementById('mxT${iBird}').style.top === '${100 - bird}%' && !document.getElementById('appLimBtn').classList.contains('on')`)) === true);

  // ── stage 2: NOISE ──
  await m.ev(`switchTab('noise')`);
  await slide(m, 'nsSpeedR', 2500); await slide(m, 'nsVolR2', 42);
  await click(m, 'nsRfLabelBtn'); await click(m, 'nsRfOctNum'); await click(m, 'nsRfPanelBtn');
  await slide(m, 'nsRfQR', 7000); await slide(m, 'nsRfMixR', 61); await slide(m, 'nsRfTiltR', -20);
  for (let v = -100; v <= 30; v += 10) await slide(m, 'nsRfSprR', v);    // a stream: each step rebuilds 32 filters
  await m.drag('#nsRfBL', 60, 0);                                        // the band window, by touch
  const q = await m.ev(`expS(7000, 1, 200)`), lo = JSON.parse(await read(m))['ns.rf.bands'];
  ok('the touch drag moved the lower band', Array.isArray(lo) && lo[0] > 1 && lo[1] === 32, lo);
  await moved('NOISE ratio filter: the master\'s table moved', { 'ns.spd': 2500, 'mx.noise': 42, 'ns.rf.on': 1, 'ns.rf.oct': 1, 'ns.rf.open': 1, 'ns.rf.q': q, 'ns.rf.mix': 61, 'ns.rf.tilt': -20, 'ns.rf.spr': 30 });
  await mirrors('NOISE ratio filter rows mirror');
  ok('the slave\'s ratio filter shows it', (await s.ev(`document.getElementById('nsSpeedR').value === '2500' && document.getElementById('nsVolR2').value === '42' && document.getElementById('mxT${iNoise}').style.top === '58%' && document.getElementById('nsRfMixV').textContent === '61' && document.getElementById('nsRfSprR').value === '30' && document.getElementById('nsRfPanel').classList.contains('rf-on') && document.getElementById('nsRfPanel').classList.contains('rf-open') && document.getElementById('nsRfBandsV').textContent === '${lo[0]}-32'`)) === true);

  await click(m, 'nsVsPanelBtn');                                        // opening PULSE closes the ratio filter panel
  await click(m, 'nsVsLabelBtn'); await click(m, 'nsVsAutoBtn'); await click(m, 'nsVsDirCycle');
  await typeNum(m, 'nsVsAV', 250); await typeNum(m, 'nsVsBV', 4000); await typeNum(m, 'nsVsDurV', 3.5);
  await slide(m, 'nsVsFaderR', 250);
  await m.drag('#nsVsEnvL', -40, 0, 24);                                 // pulse attack by touch: a stream of buffer rebuilds
  await click(m, 'nsVolRangeBtn'); await m.drag('#nsVolLoT', -50, 0);
  const t2 = JSON.parse(await read(m));
  ok('the touch drags moved the attack and the volume band', t2['ns.vs.env'][0] !== 0.002 && t2['ns.vr'][0] < 66, [t2['ns.vs.env'], t2['ns.vr']]);
  await moved('NOISE pulse: the master\'s table moved', { 'ns.rf.open': 0, 'ns.vs.open': 1, 'ns.vs.on': 1, 'ns.vs.auto': 1, 'ns.vs.dir': 'rev', 'ns.vs.a': 0.25, 'ns.vs.b': 4, 'ns.vs.dur': 3.5, 'ns.vs.fader': 750, 'ns.vr.on': 1 });
  await mirrors('NOISE pulse, speed and volume rows mirror');
  ok('the slave\'s pulse panel shows it', (await s.ev(`document.getElementById('nsVsAV').textContent === '250' && document.getElementById('nsVsBV').textContent === '4000' && document.getElementById('nsVsDurV').textContent === '3.50' && document.getElementById('nsVsFaderR').value === '250' && document.getElementById('nsVsPanel').classList.contains('vs-open') && !document.getElementById('nsRfPanel').classList.contains('rf-open') && document.getElementById('nsVsLabelBtn').classList.contains('on') && document.getElementById('nsVolRangeBtn').classList.contains('on')`)) === true);

  /* A manual roll is not state: the slave must roll its OWN dice. Slow the roll right down first, so
     the engine's own self-chain cannot be what moves the slave. */
  await slide(m, 'nsSpeedR', 0);
  await mirrors('the slow speed reached the slave');
  await sleep(400);
  const rolled = await s.ev(`nTransStart`);
  await sleep(900);
  ok('at that speed the slave does not re-roll by itself', (await s.ev(`nTransStart`)) === rolled);
  await m.drag('#nsStage', 0, -140);                                     // swipe up on the stage = roll
  await until('a manual roll on the master makes the slave roll too', s, `nTransStart !== ${rolled}`);
  await mirrors('and the tables still agree after a roll');

  // ── stage 3: TONE GEN ──
  const pick = (p, sel) => p.ev(`document.querySelector(${JSON.stringify(sel)}).click(); 1`);
  await m.ev(`switchTab('riser')`);
  await pick(m, '#rsWaves .wbtn[data-wv="2"]');
  await slide(m, 'rsFreqSL', 300); await typeNum(m, 'rsFreqV', 523.25);
  await click(m, 'rsBLabelBtn'); await typeNum(m, 'rsFqBV', 1200); await slide(m, 'rsFqBSL', 700);
  await click(m, 'rsBDirSw'); await pick(m, '#rsPitchTypeSel .msel-opt[data-val="wobble"]'); await slide(m, 'rsPitchDurSL', 300);
  await click(m, 'rsVolLabelBtn'); await click(m, 'rsVolDirSw'); await click(m, 'rsVolDirSw');
  await pick(m, '#rsVolTypeSel .msel-opt[data-val="surge"]'); await slide(m, 'rsVolDurSL', 800);
  await slide(m, 'rsMVolR', 55);
  await moved('TONE GEN: the master\'s table moved', { 'rs.wv': 2, 'rs.freq': 523.25, 'rs.fqb': await m.ev(`rsMapSliderToFreq(700)`), 'rs.vol': 55,
    'rs.sw.on': 1, 'rs.sw.dir': 'rev', 'rs.sw.type': 'wobble', 'rs.sw.dur': await m.ev(`rsMapSliderToDur(300)`),
    'rs.vp.on': 1, 'rs.vp.dir': 'pp', 'rs.vp.type': 'surge', 'rs.vp.dur': await m.ev(`rsMapSliderToDur(800)`) });
  await mirrors('TONE GEN rows mirror');
  /* Sliders sit where the app itself puts them for that state: its curves round, so a duration of
     0.7 s is drawn at 304, not at the 300 the master's thumb was dragged to. */
  ok('the slave\'s TONE GEN shows it', (await s.ev(`document.getElementById('rsFreqV').textContent === '523.25' && +document.getElementById('rsFqBSL').value === Math.round(rsFreqToSlider(rsFqB)) && +document.getElementById('rsPitchDurSL').value === Math.round(rsDurToSlider(rsPitchDur)) && +document.getElementById('rsVolDurSL').value === Math.round(rsDurToSlider(rsVolDur)) && document.getElementById('rsPitchDurVal').textContent === rsPitchDur.toFixed(1) + ' s' && document.getElementById('rsPitchTypeText').textContent === 'WOBBLE' && document.getElementById('rsVolTypeText').textContent === 'SURGE' && document.getElementById('rsBLabelBtn').classList.contains('on') && document.getElementById('rsMVolR').value === '55' && document.querySelector('#rsWaves .wbtn.on').dataset.wv === '2'`)) === true);

  /* Anchors: the sweep must have STARTED at the same moment on both phones. Each page has its own
     performance.now() zero, so compare in wall-clock time, which both share on this machine. */
  const wall = (p, v) => p.ev(`performance.timeOrigin + ${v}`);
  for (const v of ['rsPitchStart', 'rsVolStart']) {
    const a = await wall(m, v), b = await wall(s, v);
    ok(`${v} is the same moment on both phones (within 15 ms)`, Math.abs(a - b) < 15, Math.round((b - a) * 10) / 10 + ' ms apart');
  }
  const zeros = Math.abs((await m.ev(`rsPitchStart`)) - (await s.ev(`rsPitchStart`)));
  ok('and the two pages really do count time from different zeros', zeros > 50, zeros);

  // ── stage 3: BIRDBOX ──
  await m.ev(`switchTab('birdbox')`);
  await m.drag('#bbSpeedT', 0, 90, 12);                                  // the speed strip, by touch: re-rolls at each 2% step
  /* The LOWER range thumb: at the top-right corner the pause thumb's touch area sits over the upper one. */
  await m.drag('#bbRangeLoT', 0, -110); await m.drag('#bbFiltLoT', 60, 0); await m.drag('#bbPauseHiT', -80, 0);
  await click(m, 'mathsRatioBtn'); await typeNum(m, 'bbFqRatioV', 2.5);
  const t3 = JSON.parse(await read(m));
  ok('the touch drags moved the BIRDBOX strips', t3['bb.tempo'] !== 2140 && t3['bb.range'][0] > 1 && t3['bb.filt'][0] > 0 && t3['bb.pause'][1] < 100, [t3['bb.tempo'], t3['bb.range'], t3['bb.filt'], t3['bb.pause']]);
  await moved('BIRDBOX: the master\'s table moved', { 'bb.durh': 1, 'bb.fqr': 2.5 });
  await mirrors('BIRDBOX rows mirror');
  await shows('the slave\'s BIRDBOX strips show it', s, {
    'range low label': `document.getElementById('bbRangeLoV').textContent === '${t3['bb.range'][0]}'`,
    'speed thumb': `Math.abs(parseFloat(document.getElementById('bbSpeedT').style.top) - ${t3['bb.tempo'] / 100}) < 0.01`,
    'filter low label': `document.getElementById('bbFiltLoV').textContent === String(fmtFilterHz(${t3['bb.filt'][0]}))`,
    'ratio number': `document.getElementById('bbFqRatioV').textContent === '2.50'`,
    'duration-mode button': `document.getElementById('mathsRatioBtn').classList.contains('on')`,
  });
  /* A manual full roll. Stop BIRDBOX first: while it plays, every cycle re-rolls by itself. */
  await m.tap('#bbPlayBtn');
  await until('BIRDBOX stopped on the slave', s, `swpPlaying === false`);
  const dice = await s.ev(`[swpFqMin, swpFqMax, swpFqDur].join()`);
  await m.drag('#bbPlayBtn', 0, -140);                                   // swipe up = full roll
  await until('a manual roll on the master makes the slave roll its own dice', s, `[swpFqMin, swpFqMax, swpFqDur].join() !== ${JSON.stringify(dice)}`);
  await mirrors('and the rolled shape is the master\'s');
  ok('though the frequencies are each phone\'s own', (await m.ev(`[swpFqMin, swpFqMax, swpFqDur].join()`)) !== (await s.ev(`[swpFqMin, swpFqMax, swpFqDur].join()`)));

  // ── stage 4: MATHS ──
  await m.ev(`switchTab('multi')`);
  await typeNum(m, 'multiFundV', 110);
  await pick(m, '#mselWaveOpts .msel-opt[data-val="1"]');
  await pick(m, '#mselHarmOpts .msel-opt[data-val="3"]');              // a new list: the master rolls new ratios
  await moved('MATHS basics: the master\'s table moved', { 'mu.fund': 110, 'mu.wv': 1, 'mu.hi': 3 });
  await mirrors('MATHS fundamental, wave, list and the rolled ratios mirror');
  await shows('the slave\'s MATHS shows them', s, {
    'fundamental readout': `document.getElementById('multiFundV').textContent === '110.00'`,
    'wave dropdown': `document.getElementById('mselWaveText').textContent === WN[1]`,
    'list dropdown': `document.getElementById('mselHarmText').textContent === HARMONIC_LISTS[3].name.toUpperCase()`,
    'one pad per operator': `document.querySelectorAll('#mathsGrid .maths-cell').length === multiOscs.length`,
    'pads sit in the master\'s cells': `multiOscs.every(function(o){ var c = document.getElementById('mcell' + o.id); return c && +c.style.getPropertyValue('--c') === o.p % 4 && +c.style.getPropertyValue('--r') === ((o.p / 4) | 0); })`,
  });

  /* The operator list changes without rebuilding oscillators: the same nodes before and after. */
  await s.ev(`window.__osc = multiOscs.map(function(o){ return o.osc; }); 1`);
  ok('the slave\'s MATHS oscillators exist', (await s.ev(`window.__osc.length > 0 && window.__osc.every(Boolean)`)) === true);
  await click(m, 'muRollPos'); await click(m, 'muRollFq');
  await sleep(700);                                                    // the pads glide to their new cells; a drag must start from where they land
  const col = await m.ev(`multiOscs[0].p % 4`), cell0 = await m.ev(`multiOscs[0].p`);
  await m.drag(await m.ev(`'#mcell' + multiOscs[0].id`), col < 3 ? 90 : -90, 0);   // a pad dragged one cell across: a move or a swap
  ok('the touch drag moved the pad', (await m.ev(`multiOscs[0].p`)) !== cell0, [cell0, await m.ev(`multiOscs[0].p`)]);
  const wasMuted = await m.ev(`multiOscs[1].muted`);
  await m.tap(await m.ev(`'#mcell' + multiOscs[1].id`));               // a tap on a pad's body switches it on / off
  ok('the tap toggled the operator', (await m.ev(`multiOscs[1].muted`)) !== wasMuted);
  await mirrors('MATHS layout, ratios, a dragged pad and a mute mirror');
  ok('the slave kept every oscillator it had', (await s.ev(`multiOscs.length === window.__osc.length && multiOscs.every(function(o){ return o.osc && window.__osc.indexOf(o.osc) >= 0; })`)) === true);

  await click(m, 'muStripPlus');                                       // "+" adds an operator, with a ratio the master rolled
  await mirrors('an added operator mirrors');
  await m.tap(await m.ev(`'#mcell' + multiOscs[2].id`), 1200);         // a one-second hold selects
  await slide(m, 'multiMVolR', 33);                                    // the footer fader is now that operator's level
  await pick(m, '#mselWaveOpts .msel-opt[data-val="2"]');              // and the wave dropdown its own wave
  const held = JSON.parse(await read(m))['mu.hold'];
  ok('the hold selected an operator and set its level', Array.isArray(held) && held[1] === 33, held);
  await mirrors('a held level and a per-operator wave mirror');
  await shows('the slave shows the selection', s, {
    'one pad marked selected': `document.querySelectorAll('#mathsGrid .maths-cell.fm-sel').length === 1`,
    'fader shows the operator\'s level': `document.getElementById('multiMVolR').value === '33'`,
    'the level is the master\'s': `multiOscs[muSelIdx].vol === 33`,
    'its wave is its own': `multiOscs[muSelIdx].wv === 2 && multiWv === 1`,
  });
  await s.ev(`switchTab('noise'); switchTab('voice'); 1`);            // leaving MATHS normally clears a selection
  await sleep(300);
  ok('a slave changing tabs does not drop the held operator', (await s.ev(`muSelIdx >= 0`)) === true);
  const before = await m.ev(`multiOscs.length`);
  await click(m, 'muStripPlus');                                       // with a selection the button reads "−": remove it
  ok('the master removed the selected operator', (await m.ev(`multiOscs.length`)) === before - 1);
  await moved('removing it clears the hold', { 'mu.hold': null });
  await mirrors('a removed operator mirrors');

  await click(m, 'mathsSettingsBtn');
  await slide(m, 'multiDurR', 3000); await slide(m, 'multiVolRateR', 6000);
  await m.drag('#mdrL', -60, 0);
  await click(m, 'mVolCarBtn'); await click(m, 'mAutoBtn');
  const t4 = JSON.parse(await read(m));
  ok('the touch drag moved the level-sweep range', t4['mu.vr'][0] < 65, t4['mu.vr']);
  await moved('MATHS settings: the master\'s table moved', { 'mu.set.open': 1, 'mu.dur': await m.ev(`expS(3000, 0.10, 30)`), 'mu.vrate': await m.ev(`expS(sliderFlip(6000, 10000), 0.05, 60)`), 'mu.vco': 1, 'mu.auto': 0 });
  await mirrors('MATHS settings mirror');
  await click(m, 'mathsSettingsBtn');
  await slide(m, 'multiFmDepthR', 80); await click(m, 'muFiltBtn'); await m.drag('#mfrL', 70, 0);
  await click(m, 'muVsPanelBtn'); await click(m, 'muVsLabelBtn'); await click(m, 'muVsPerOscBtn'); await click(m, 'muVsAutoBtn'); await click(m, 'muVsDirCycle');
  await typeNum(m, 'muVsAV', 200); await typeNum(m, 'muVsBV', 3000); await typeNum(m, 'muVsDurV', 2.5);
  await slide(m, 'muVsFaderR', 300); await m.drag('#muVsEnvR', 40, 0, 24);
  const t5 = JSON.parse(await read(m));
  ok('the touch drags moved the filter and the decay', t5['mu.filt'][0] > 0 && t5['mu.vs.env'][1] !== 0.15, [t5['mu.filt'], t5['mu.vs.env']]);
  await moved('MATHS filter and pulse: the master\'s table moved', { 'mu.set.open': 0, 'mu.fmd': 80, 'mu.filt.on': 1, 'mu.vs.open': 1, 'mu.vs.on': 1, 'mu.vs.perosc': 0, 'mu.vs.auto': 1, 'mu.vs.dir': 'rev', 'mu.vs.a': 0.2, 'mu.vs.b': 3, 'mu.vs.dur': 2.5, 'mu.vs.fader': 700 });
  await mirrors('MATHS filter and pulse rows mirror');
  await shows('the slave\'s MATHS footer shows it', s, {
    'fm depth': `document.getElementById('multiFmDepthR').value === '80'`,
    'filter view on': `document.getElementById('muFiltBtn').classList.contains('on')`,
    'filter low label': `document.getElementById('msFiltLoVal').textContent === String(fmtFilterHz(${t5['mu.filt'][0]}))`,
    'pulse on': `document.getElementById('muVsLabelBtn').classList.contains('on')`,
    'per-osc off': `document.getElementById('muVsPerOscBtn').textContent === 'OFF'`,
    'auto on': `document.getElementById('muVsAutoBtn').classList.contains('on')`,
    'A and B': `document.getElementById('muVsAV').textContent === '200' && document.getElementById('muVsBV').textContent === '3000'`,
    'transition time slider': `+document.getElementById('multiDurR').value === expSI(multiDur, 0.10, 30)`,
  });
  { const a = await wall(m, 'muVsAutoStart'), b = await wall(s, 'muVsAutoStart');
    ok('the MATHS pulse sweep started at the same moment on both phones', Math.abs(a - b) < 15, Math.round((b - a) * 10) / 10 + ' ms apart'); }

  // ── stage 4: the FX rack ──
  await m.ev(`switchTab('mixer')`);
  await m.drag('#mixerSliders .mix-fx[data-key="noise"] .fxk.u-drive', 0, -64);     // a send knob, dragged up
  await m.drag('#mixerSliders .mix-fx[data-key="multi"] .fxk.u-verb', 0, -40);
  await m.drag('#mixerSliders .mix-fx[data-key="master"] .fxk.u-comp', 0, -80);
  await m.drag('#drvPanel .fx-rack-knobs .fxk:nth-child(1)', 0, -48);                // rack knobs: DRIVE, then COMP's bipolar MAKEUP
  await m.drag('#cmpPanel .fx-rack-knobs .fxk:nth-child(3)', 0, 40);
  await m.drag('#vrbPanel .fx-rack-knobs .fxk:nth-child(2)', 0, -30);
  await click(m, 'drvTypeBtn'); await click(m, 'drvTypeBtn'); await click(m, 'drvModeBtn');
  await click(m, 'cmpTypeBtn'); await click(m, 'vrbTypeBtn'); await click(m, 'vrbModeBtn'); await click(m, 'vrbLabelBtn');
  const fx = JSON.parse(await read(m));
  ok('the touch drags moved the send knobs', fx['fx.drive.noise'] > 20 && fx['fx.verb.multi'] > 10 && fx['fx.comp.master'] > 30, [fx['fx.drive.noise'], fx['fx.verb.multi'], fx['fx.comp.master']]);
  ok('and the rack knobs', fx['fx.drive.drive'] > 60 && fx['fx.comp.makeup'] < 0 && fx['fx.verb.decay'] > 75, [fx['fx.drive.drive'], fx['fx.comp.makeup'], fx['fx.verb.decay']]);
  await moved('FX chips: the master\'s table moved', { 'fx.drive.type': 2, 'fx.drive.mode': 'direct', 'fx.comp.type': 1, 'fx.verb.type': 3, 'fx.verb.mode': 'direct', 'fx.verb.on': 0, 'fx.drive.on': 1 });
  await mirrors('the FX rack mirrors');
  await shows('the slave\'s mixer shows it', s, {
    'send knob turned': `FX.knobOf('drive', 'noise').get() === ${fx['fx.drive.noise']} && FX.knobOf('drive', 'noise').el.classList.contains('fxk-live')`,
    'master COMP knob turned': `FX.knobOf('comp', 'master').get() === ${fx['fx.comp.master']}`,
    'rack knob turned': `FX.rackOf('drive').row('Drive').get() === ${fx['fx.drive.drive']}`,
    'bipolar rack knob turned': `FX.rackOf('comp').row('Makeup').get() === ${fx['fx.comp.makeup']}`,
    'drive type chip': `document.getElementById('drvTypeV').textContent === __drvTest.TYPES[2].n`,
    'drive mode chip': `document.getElementById('drvModeV').textContent === 'DIRECT' && document.getElementById('drvModeBtn').classList.contains('is-direct')`,
    'comp type chip': `document.getElementById('cmpTypeV').textContent === __compTest.TYPES[1].n`,
    'reverb shown off': `!document.getElementById('vrbPanel').classList.contains('rack-on') && !document.getElementById('vrbLabelBtn').classList.contains('on')`,
    'drive shown on': `document.getElementById('drvPanel').classList.contains('rack-on')`,
  });
  /* Not only the knobs: the gains behind them. DRIVE in DIRECT mode crossfades the channel's dry path. */
  await sleep(400);
  { const g = `[FX._chans.noise.snd.drive.gain.value, FX._chans.noise.dry.gain.value, FX._chans.multi.snd.verb.gain.value].map(function(x){ return Math.round(x * 100) / 100; })`;
    const a = await m.ev(g), b = await s.ev(g);
    ok('the slave\'s send gains are the master\'s', JSON.stringify(a) === JSON.stringify(b) && a[0] > 0.3 && a[1] < 0.95 && a[2] === 0, [a, b]); }

  // ── stage 5: VOICE switches and SPEAK settings ──
  const row = (p, id) => `LINK._.rows.filter(function(r){ return r.id === ${JSON.stringify(id)}; })[0]`;
  const type = (p, text) => p.ev(`(function(){ var t = document.getElementById('vtSpeakText'); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`);
  const speaking = `vtSpkPlaying && VT.spkActive()`;
  await m.ev(`switchTab('voice')`);
  await click(m, 'vtOtotuneBtn'); await click(m, 'vtAutoWobbleBtn'); await click(m, 'vtAlwaysVoiceBtn');
  await type(m, 'hello hello'); await slide(m, 'vtSpeakRateR', 70); await click(m, 'vtLoopBtn'); await click(m, 'vtLangBtn');
  await moved('VOICE: the master\'s table moved', { 'vt.oto': 1, 'vt.free': 0, 'vt.wob': 1, 'vt.av': 1, 'vt.spk.text': 'hello hello', 'vt.spk.rate': await m.ev(`0.6 + (70 / 100) * 1.2`), 'vt.spk.loop': 1, 'vt.spk.lang': 'tr' });
  await mirrors('VOICE switches and SPEAK settings mirror');
  await shows('the slave\'s VOICE shows them', s, {
    'ototune': `VT.getOtotune() === true && document.getElementById('vtOtotuneBtn').classList.contains('on')`,
    'free off': `VT.getFree() === false && !document.getElementById('vtFreeBtn').classList.contains('on')`,
    'wobble': `VT.getAutoWobble() === true && document.getElementById('vtAutoWobbleBtn').classList.contains('on')`,
    'always voice': `VT.getAlwaysVoice() === true && document.getElementById('vtAlwaysVoiceBtn').classList.contains('on')`,
    'text': `document.getElementById('vtSpeakText').value === 'hello hello'`,
    'rate slider': `document.getElementById('vtSpeakRateR').value === '70'`,
    'loop': `document.getElementById('vtLoopBtn').classList.contains('on')`,
    'language': `document.getElementById('vtLangBtn').textContent === 'tr'`,
  });

  /* Text is held back while the master types: every keystroke would send the whole text to the room. */
  await m.ev(`document.getElementById('vtSpeakText').focus(); 1`);
  await type(m, 'merhaba dünya, merhaba dünya, merhaba dünya');
  await sleep(300);
  ok('text being typed is not sent yet', JSON.parse(await read(m))['vt.spk.text'] === 'hello hello', JSON.parse(await read(m))['vt.spk.text']);

  // ── stage 5: SPEAK ──
  await m.tap('#vtSpeakBtn');                                          // a real tap: speak, with the box still focused
  await until('the master speaks', m, speaking);
  await until('the slave speaks', s, speaking);
  ok('…the text the master had typed', (await s.ev(`document.getElementById('vtSpeakText').value`)) === 'merhaba dünya, merhaba dünya, merhaba dünya');
  await mirrors('SPEAK rows mirror while speaking');
  ok('the slave\'s speak button shows it', (await s.ev(`document.getElementById('vtSpeakBtn').classList.contains('on') && document.getElementById('vtSpeakBtn').textContent === 'stop'`)) === true);
  /* The master's utterance ending by itself must not cut a slave that is still on its last syllable:
     the flag drops, the counts do not. */
  await s.ev(`(function(){ var r = ${row(s, 'vt.spk')}, v = r.get(); r.set([0, v[1], v[2]]); })(); 1`);
  await sleep(200);
  ok('a master\'s utterance ending by itself does not cut a slave short', (await s.ev(speaking)) === true);
  await m.tap('#vtSpeakBtn');                                          // stop, by hand
  await until('a stop by hand stops the master', m, `!vtSpkPlaying`);
  await until('…and the slave', s, `!vtSpkPlaying && !VT.spkActive()`);
  await mirrors('SPEAK rows mirror after the stop');
  await m.ev(`document.getElementById('vtSpeakText').blur(); 1`);
  await click(m, 'vtLoopBtn'); await click(m, 'vtLangBtn'); await type(m, 'hi');      // one short phrase, in English, not looped
  await moved('SPEAK settings: the master\'s table moved', { 'vt.spk.loop': 0, 'vt.spk.lang': 'en', 'vt.spk.text': 'hi' });
  await s.ev(`window.__ends = 0; (function(){ var real = vtSpkAdvance; vtSpkAdvance = function(){ window.__ends++; return real.apply(this, arguments); }; })(); 1`);
  await m.tap('#vtSpeakBtn');
  await until('a single phrase starts on the slave', s, `vtSpkPlaying`);
  await until('…and ends by itself on the master', m, `!vtSpkPlaying`, 8000);
  await until('…and on the slave', s, `!vtSpkPlaying`, 8000);
  ok('the slave\'s phrase ran to its own end', (await s.ev(`window.__ends`)) === 1, await s.ev(`window.__ends`));
  await mirrors('SPEAK rows mirror after a phrase');

  // ── stage 5: ARCHIVE recall ──
  await m.ev(`switchTab('archive'); document.querySelector('#modArchive .save-btn').click(); 1`);
  await sleep(200);
  await m.ev(`(function(){ var i = document.querySelector('.arc-name-edit'); if (i) i.blur(); })(); 1`);   // saving opens the name for editing
  const saved = JSON.parse(await read(m));
  await m.ev(`switchTab('multi')`);
  await typeNum(m, 'multiFundV', 73); await click(m, 'muStripPlus'); await slide(m, 'multiFmDepthR', 20);
  await slide(m, 'nsSpeedR', 5000); await typeNum(m, 'rsFreqV', 311); await slide(m, 'vtSpeakRateR', 10); await type(m, 'something else'); await click(m, 'vtLoopBtn');
  await moved('before the load: the master\'s table moved', { 'mu.fund': 73, 'mu.fmd': 20, 'rs.freq': 311, 'vt.spk.text': 'something else', 'vt.spk.loop': 1, 'mu.on': 1, 'ns.on': 1 });
  await mirrors('the changes mirror');
  await m.ev(`switchTab('archive')`);
  await m.tap('#archiveList .arc-item .arc-btn');                      // LOAD
  { const t = JSON.parse(await read(m)), off = [];
    /* Rows an archive holds. (NOISE's speed is not one; frequencies are saved to two decimals.) */
    for (const k of ['mu.fund', 'mu.fmd', 'mu.hi', 'mu.wv', 'mu.dur', 'mu.filt', 'rs.freq', 'rs.fqb', 'vt.spk.text', 'vt.spk.rate', 'vt.spk.loop', 'vt.spk.lang', 'vt.oto', 'app.vol']) {
      const same = typeof saved[k] === 'number' ? Math.abs(t[k] - saved[k]) < 0.01 : JSON.stringify(t[k]) === JSON.stringify(saved[k]);
      if (!same) off.push(`${k}: ${JSON.stringify(t[k])}, saved ${JSON.stringify(saved[k])}`);
    }
    for (const k of ['rs.on', 'bb.on', 'ns.on', 'mu.on']) if (t[k] !== 0) off.push(`${k}: still on`);
    const shape = (ops) => JSON.stringify(ops.map((o) => o.slice(1, 5)));          // cell, ratio, wave, mute — the ids are new
    if (shape(t['mu.ops']) !== shape(saved['mu.ops'])) off.push(`mu.ops: ${shape(t['mu.ops'])}, saved ${shape(saved['mu.ops'])}`);
    ok('an ARCHIVE load puts the master back and stops its modules', off.length === 0, off); }
  await mirrors('an ARCHIVE load on the master moves the room');
  await shows('the slave followed the load', s, {
    'every module stopped': `!rsPlaying && !swpPlaying && !nOn && !multiPlaying`,
    'fundamental readout': `document.getElementById('multiFundV').textContent === ${JSON.stringify(Number(saved['mu.fund']).toFixed(2))}`,
    'speak text': `document.getElementById('vtSpeakText').value === 'hi'`,
    'one pad per operator': `document.querySelectorAll('#mathsGrid .maths-cell').length === ${saved['mu.ops'].length}`,
  });

  await m.ev(`toggleRiser(); toggleSweep(); toggleNoise(); multiToggle(); 1`);
  await moved('the master plays again', { 'rs.on': 1, 'bb.on': 1, 'ns.on': 1, 'mu.on': 1 });
  await mirrors('…and the room with it');

  // ── a latecomer, on a phone that has opened nothing, into a room that is playing ──
  const late = await page('/slaves');
  await late.ev(`LINK.start('slave', 'rows')`);
  await until('a latecomer joins', late, `LINK.info().joined && LINK.info().online`);
  await mirrors('a latecomer gets every row from the first snapshot', late);
  await until('a latecomer has the dictionary before anyone speaks', late, `VT_SPK_DICTSTATE === 'ready'`);
  ok('…and has not started its VOICE engine', (await late.ev(`vtInitialized`)) === false);
  await m.ev(`switchTab('voice')`);
  await click(m, 'vtLoopBtn'); await type(m, 'round and round and round and round');
  await m.tap('#vtSpeakBtn');
  await until('a phone that never opened VOICE speaks when the master does', late, `vtInitialized && ${speaking}`);
  ok('…with the switches it was given earlier', (await late.ev(`VT.getOtotune() === true && VT.getAlwaysVoice() === true`)) === true);
  const late2 = await page('/slaves');
  await late2.ev(`LINK.start('slave', 'rows')`);
  await until('a latecomer joins a looping voice', late2, speaking, 8000);
  await mirrors('…and has the room\'s table', late2);
  /* While a loop runs, the row is the text being spoken: what the master types next must not
     reach a latecomer as a half-typed phrase to loop, nor go out whole on every keystroke. */
  await m.ev(`document.getElementById('vtSpeakText').focus(); 1`);
  await type(m, 'now som');
  await sleep(300);
  ok('text typed during a loop is not sent', JSON.parse(await read(m))['vt.spk.text'] === 'round and round and round and round', JSON.parse(await read(m))['vt.spk.text']);
  await type(m, 'round and round and round and round');
  await m.ev(`document.getElementById('vtSpeakText').blur(); 1`);
  /* The app stops SPEAK on a phone whose screen was away for more than 2 s. In a room that phone
     has dropped out of a loop the others are still in. */
  const loop = JSON.parse(await read(m))['vt.spk'];
  ok('the slave\'s screen really went away', (await late.away(2600)) === true);
  await until('a slave back from 2.6 s away falls in with the loop again', late, speaking, 6000);
  ok('the master\'s screen really went away', (await m.away(2600)) === true);
  await sleep(600);
  ok('the master\'s screen going away does not stop the room', (await s.ev(speaking)) === true && (await late2.ev(speaking)) === true, [await s.ev(speaking), await late2.ev(speaking)]);
  await until('…and the master falls in again', m, speaking, 4000);
  await moved('…with no new utterance and no cut', { 'vt.spk': loop });
  await m.tap('#vtSpeakBtn');
  await until('a stop by hand stops every phone', late2, `!vtSpkPlaying`);
  ok('…the first latecomer too', (await late.ev(`vtSpkPlaying`)) === false);
  await mirrors('the room is level after SPEAK', late);

  /* A master that reloads takes the room as it is. The counters (manual rolls, SPEAK) must carry
     on from the room's, or every slave would re-roll and re-speak. */
  const room = JSON.parse(await read(m));
  ok('the room has seen a manual roll', room['ns.roll'] > 0 && room['vt.spk'][1] > 0, [room['ns.roll'], room['vt.spk']]);
  await m.load('/masterctrl');
  await m.ev(`LINK.start('master', 'rows', 'test')`);
  await until('the reloaded master is back', m, `LINK.info().joined && LINK.info().count === 3`);
  await sleep(700);
  { const after = JSON.parse(await read(m)), off = [];
    for (const k of Object.keys(room)) {
      const same = /\.t0$/.test(k) ? Math.abs(after[k] - room[k]) <= 5 : JSON.stringify(after[k]) === JSON.stringify(room[k]);
      if (!same) off.push(`${k}: ${JSON.stringify(after[k])}, was ${JSON.stringify(room[k])}`);
    }
    ok('a reloaded master takes the room as it is', off.length === 0, off); }
  await mirrors('…and the room does not notice', s);
  ok('no uncaught errors on the second latecomer', late2.errors.length === 0, late2.errors);
  ok('no uncaught errors on the master', m.errors.length === 0, m.errors);
  ok('no uncaught errors on the slave', s.errors.length === 0, s.errors);
  ok('no uncaught errors on the latecomer', late.errors.length === 0, late.errors);
  finish();
} catch (e) { console.log('FAIL', e.stack || e.message); finish(1); }
