// TRACKER audio: voices (offline renders), lane -> bus routing, bus volume on the sends,
// the hidden-page look-ahead, edits inside the look-ahead window, stop and restart.
//   node test/tenface/audio.mjs
import { rig, sleep } from '../link/rig.mjs';

const { startServer, openBrowser, page, ok, until, finish } = rig({ port: 3081, debugPort: 9395 });

/* Run an async function body in the page and wait for its JSON result
   (rig's ev() does not await promises). */
async function run(p, body, ms = 20000) {
  await p.ev(`window.__r = undefined; (async function(){ ${body} })().then(function(v){ window.__r = JSON.stringify(v === undefined ? null : v); }, function(e){ window.__r = JSON.stringify({ err: String(e && e.stack || e) }); }); 1`);
  const end = Date.now() + ms;
  for (;;) {
    const r = await p.ev(`window.__r`);
    if (typeof r === 'string') return JSON.parse(r);
    if (Date.now() > end) return { err: 'timeout' };
    await sleep(50);
  }
}

/* Page helpers: render a voice offline, and the peak an analyser sees over a time span. */
const HELPERS = `
window.__render = async function (hits, secs) {
  var c = new OfflineAudioContext(1, 48000 * (secs || 1), 48000);
  hits.forEach(function (h) { TF.voice(c, c.destination, h.snd, h.t || 0, h.o || {}); });
  return (await c.startRendering()).getChannelData(0);
};
window.__peakOf = function (d, a, b) { var m = 0; for (var i = a || 0; i < (b || d.length); i++) m = Math.max(m, Math.abs(d[i])); return m; };
window.__rms = function (d, a, b) { var s = 0; for (var i = a; i < b; i++) s += d[i] * d[i]; return Math.sqrt(s / (b - a)); };
window.__an = function (node) { var an = AC.createAnalyser(); an.fftSize = 2048; node.connect(an); return an; };
window.__watch = function (an, ms) {
  return new Promise(function (res) {
    var buf = new Float32Array(an.fftSize), m = 0, end = performance.now() + ms;
    (function poll() {
      an.getFloatTimeDomainData(buf);
      for (var i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
      if (performance.now() < end) setTimeout(poll, 15); else res(m);
    })();
  });
};
1`;

try {
  await startServer(); await openBrowser();
  const p = await page('/');
  await p.ev(`dismissLanding(); switchTab('burst'); 1`);
  await p.ev(HELPERS);

  // ── voices, rendered offline ──
  const v = await run(p, `
    if (typeof TF.voice !== 'function') throw new Error('TF.voice missing');
    var out = {};
    for (var i = 0; i < TF._.KIT.length; i++) {
      var s = TF._.KIT[i];
      var plain = __peakOf(await __render([{ snd: s }])), acc = __peakOf(await __render([{ snd: s, o: { accent: true } }]));
      out[s] = [plain, acc];
    }
    return out;`);
  if (v.err) ok('voices render', false, v.err);
  else for (const s of Object.keys(v)) {
    const [plain, acc] = v[s];
    ok(`${s}: peak in 0.05..1.0`, plain >= 0.05 && plain <= 1.0, plain);
    ok(`${s}: accent >= 1.8x`, acc / plain >= 1.8, acc / plain);
  }

  const zc = await run(p, `
    function zc(d) { var n = 0, end = Math.round(0.1 * 48000); for (var i = 1; i < end; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) n++; return n; }
    var a = zc(await __render([{ snd: 'tom', o: { tune: 0 } }])), b = zc(await __render([{ snd: 'tom', o: { tune: 12 } }]));
    return b / a;`);
  ok('tom tune +12 doubles the zero-crossing rate (1.8..2.2)', zc >= 1.8 && zc <= 2.2, zc);

  const choke = await run(p, `
    var a = __rms(await __render([{ snd: 'oh' }]), 4800, 14400);
    var b = __rms(await __render([{ snd: 'oh' }, { snd: 'ch', t: 0.05 }]), 4800, 14400);
    return b / a;`);
  ok('a closed hat chokes the open hat (RMS 100..300 ms < 10%)', choke < 0.1, choke);

  const longOh = await run(p, `
    var d = await __render([{ snd: 'oh', o: { dec: 100 } }], 2.5);
    return [__rms(d, 45600, 48000), __rms(d, 48000, 50400)];`);
  ok('oh at DECAY 100 has no cliff at 1.0 s (RMS 0.95..1.0 vs 1.0..1.05 within 2x)', longOh[1] > longOh[0] * 0.5 && longOh[1] > 1e-4, longOh);

  // ── routing: a trusted tap on PLAY starts the AudioContext ──
  const hasBtn = (await p.ev(`!!document.getElementById('tfPlay')`)) === true;
  ok('#tfPlay exists in #modBurst', hasBtn);
  if (hasBtn) await p.tap('#tfPlay'); else await p.ev(`TF.play && TF.play(); 1`);
  await until('PLAY runs the context and sets TF.playing', p, `!!AC && AC.state === 'running' && TF.playing === true`);
  ok('FX channels tf1 and tenface exist', (await p.ev(`!!(FX._chans.tf1 && FX._chans.tenface)`)) === true);
  ok('lane channels are not in the MIXER', (await p.ev(`FX.chKeys().every(function (k) { return !/^tf|tenface/.test(k); })`)) === true);
  ok('TF.clock is the live clock', (await p.ev(`!!TF.clock && typeof TF.clock.events === 'function'`)) === true);
  ok('TRACKER does not count as an active module', (await p.ev(`appCountActiveModules()`)) === 0, await p.ev(`appCountActiveModules()`));

  await p.ev(`
    var L = TF.state.slots[TF.state.slot].lanes;
    L[0].snd = 'kick'; L[0].steps = L[0].steps.map(function (z, i) { return i % 4 ? 0 : 1; });
    L[1].snd = 'snare'; L[1].steps = L[1].steps.map(function (z, i) { return i % 4 === 2 ? 1 : 0; });
    window.__laneAn = __an(FX._chans.tf1.dry); window.__mastAn = __an(appMaster);
    window.__verbAn = __an(FX.unit('verb').busIn()); window.__busAn = __an(FX._chans.tenface.dry);
    1`);
  /* a cold headless Chrome can report 'running' before its audio clock moves */
  await until('the audio clock moves and hits are being scheduled', p, `AC.currentTime > 0.3 && TF._scheduledCount >= 2`);
  const route = await run(p, `
    TF.setBusVol(0); await new Promise(function (r) { setTimeout(r, 250); });
    var lane = __watch(__laneAn, 1200), mast = __watch(__mastAn, 1200);
    return [await lane, await mast];`);
  ok('bus volume 0: the lane still sounds into the bus', route[0] > 0.01, route);
  ok('bus volume 0: the master is silent, so tf1 dry feeds the bus, not out()', route[1] < 1e-4, route);

  const send = await run(p, `
    FX.setAmt('verb', 'tf1', 100); await new Promise(function (r) { setTimeout(r, 250); });
    var off = await __watch(__verbAn, 1200);
    TF.setBusVol(80); await new Promise(function (r) { setTimeout(r, 150); });
    var on = await __watch(__verbAn, 1200);
    return [off, on, FX.amt('verb', 'tf1')];`);
  ok('bus volume 0 with lane REV 100: the reverb input is silent', send[0] < 1e-4, send);
  ok('bus volume 80 with lane REV 100: the reverb input sounds', send[1] > 1e-3, send);
  ok('bus volume never rewrites the stored lane amount', send[2] === 100, send);
  await p.ev(`FX.setAmt('verb', 'tf1', 0); 1`);

  // ── hidden page: the look-ahead widens and scheduling keeps going ──
  const hid = await run(p, `
    Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return true; } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'hidden'; } });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(function (r) { setTimeout(r, 200); });
    var la = TF._la, ahead = TF._horizon - AC.currentTime, n = [TF._scheduledCount];
    for (var i = 0; i < 3; i++) { await new Promise(function (r) { setTimeout(r, 1000); }); n.push(TF._scheduledCount); }
    delete document.hidden; delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(function (r) { setTimeout(r, 100); });
    return { la: la, ahead: ahead, n: n, back: TF._la };`);
  ok('hidden: the look-ahead widens to 2 s', hid.la === 2 && hid.ahead > 1.5, hid);
  ok('hidden: TF._scheduledCount keeps rising every second for 3 s', !!hid.n && hid.n[1] > hid.n[0] && hid.n[2] > hid.n[1] && hid.n[3] > hid.n[2], hid);
  ok('visible again: the look-ahead returns to 0.1 s', hid.back === 0.1, hid);

  // ── (Review 4) hammering a step inside the look-ahead window ──
  await sleep(2200);                        // let the 2 s horizon drain back to the foreground window
  const ham = await run(p, `
    var log = []; TF._onEvent = function (e) { log.push([e.lane, e.step, e.t]); };
    var tgt = null;
    TF.clock.onStep(function (l, s, t) { if (!tgt && l === 1 && t > AC.currentTime) tgt = { s: s, t: t }; });
    while (!tgt) await new Promise(function (r) { setTimeout(r, 5); });
    var steps = TF.state.slots[TF.state.slot].lanes[1].steps, flips = 0;
    await new Promise(function (r) {
      var iv = setInterval(function () { steps[tgt.s] = TF._.cycle(steps[tgt.s]); if (++flips === 20) { clearInterval(iv); r(); } }, 5);
    });
    await new Promise(function (r) { setTimeout(r, 1200); });
    TF._onEvent = null;
    var same = log.filter(function (e) { return e[0] === 1 && e[1] === tgt.s && Math.abs(e[2] - tgt.t) < 1e-6; }).length;
    var seen = {}, dup = 0;
    log.forEach(function (e) { var k = e[0] + '|' + e[2].toFixed(6); if (seen[k]) dup++; seen[k] = 1; });
    return { same: same, dup: dup, flips: flips, n: log.length };`);
  ok('20 toggles in 100 ms inside the window: the step is scheduled at most once', ham.same <= 1 && ham.flips === 20, ham);
  ok('and no lane is scheduled twice at one time', ham.dup === 0 && ham.n > 0, ham);

  // ── stop silences promptly; a new play restarts the lanes at step 0 ──
  const stop = await run(p, `
    var L = TF.state.slots[TF.state.slot].lanes;
    L[4].snd = 'oh'; L[4].steps = L[4].steps.map(function () { return 1; });
    await new Promise(function (r) { setTimeout(r, 600); });
    var before = await __watch(__busAn, 300);
    TF.stop(); var playing = TF.playing;
    await new Promise(function (r) { setTimeout(r, 120); });
    var after = await __watch(__busAn, 600);
    return { before: before, after: after, playing: playing };`);
  ok('stop: TF.playing is false', stop.playing === false, stop);
  ok('stop: the bus goes silent within ~120 ms, ringing hats included', stop.before > 0.01 && stop.after < 1e-4, stop);

  const again = await run(p, `
    var first = {}; TF._onEvent = function (e) { if (!(e.lane in first)) first[e.lane] = e.step; };
    var L = TF.state.slots[TF.state.slot].lanes;
    L[0].steps = L[0].steps.map(function () { return 1; });
    TF.play();
    await new Promise(function (r) { setTimeout(r, 500); });
    TF._onEvent = null;
    var peak = await __watch(__busAn, 400);
    TF.stop();
    return { first: first, peak: peak };`);
  ok('play again: lanes restart at step 0', again.first && again.first[0] === 0 && again.first[4] === 0, again);
  ok('play again: the bus sounds again', again.peak > 0.01, again);

  // ── a slot switch changes lane vol/mute AT the bar line, not up to LA early ──
  const sw = await run(p, `
    var S = TF.state, a = S.slots[0].lanes[0], b = S.slots[1].lanes[0];
    S.slot = 0; a.vol = 100; a.mute = false; a.steps = a.steps.map(function (z, i) { return i === 15 ? 1 : 0; });
    b.vol = 100; b.mute = true;
    var hitT = null, samples = [];
    TF._onEvent = function (e) {                  /* request the switch inside the look-ahead, right after the old hit is queued */
      if (hitT === null && e.lane === 0 && e.step === 15 && e.slot === 0) { hitT = e.t; TF.clock.requestSlot(1, AC.currentTime); }
    };
    TF.play();
    var g = TF._nodes.lanes[0].gain;
    await new Promise(function (r) {
      (function poll() {
        samples.push([AC.currentTime, g.value]);
        if (hitT !== null && AC.currentTime > hitT + 0.45) r(); else setTimeout(poll, 4);
      })();
    });
    TF._onEvent = null; TF.stop(); S.slot = 0; b.mute = false;
    var bar = hitT + 0.125;
    var pre = samples.filter(function (x) { return x[0] >= hitT - 0.05 && x[0] < bar - 0.01; }).map(function (x) { return x[1]; });
    var post = samples.filter(function (x) { return x[0] > bar + 0.1; }).map(function (x) { return x[1]; });
    return { pre: Math.min.apply(null, pre), post: Math.max.apply(null, post), npre: pre.length, npost: post.length, slot: TF.state.slot };`);
  ok('slot switch: the old slot\'s last hit before the bar keeps the old lane gain', sw.npre > 3 && sw.pre > 0.9, sw);
  ok('slot switch: after the bar the new slot\'s mute silences the lane', sw.npost > 3 && sw.post < 0.01, sw);

  // ── module lanes: a note gates the module through its FX input with the lane's envelope ──
  const MODSETUP = `
    TF.stop(); await new Promise(function (r) { setTimeout(r, 400); });
    var S = TF.state; S.slot = 0; S.bpm = 120; S.swing = 50;
    var L = S.slots[0].lanes;
    L.forEach(function (l) { l.steps.fill(0); l.mod = null; l.notes.fill(0); l.mute = false; l.len = 16; l.rate = 1; });
    /* a silent node's AudioParam does not advance in Chrome, so read a gate the way a
       user meets it: switch the module on by hand, let it play, read, switch it off */
    var byHand = async function (toggle, g) { toggle(); await new Promise(function (r) { setTimeout(r, 150); }); var v = g.value; toggle(); return v; };
    var sample = async function (g, isOn, until) {
      var e0 = null, out = [];
      TF._onEvent = function (e) { if (e.kind === 'note' && e0 === null) e0 = e.t; };
      TF.play();
      await new Promise(function (r) { (function poll() { out.push([AC.currentTime, g.value, isOn()]); if (e0 !== null && AC.currentTime > e0 + until) r(); else setTimeout(poll, 8); })(); });
      TF._onEvent = null;
      return { e0: e0, s: out, at: function (x) { var b = null; out.forEach(function (q) { if (!b || Math.abs(q[0] - x) < Math.abs(b[0] - x)) b = q; }); return b; },
               span: function (a, z) { return out.filter(function (q) { return q[0] >= e0 + a && q[0] <= e0 + z; }); } };
    };`;
  const bb = await run(p, MODSETUP + `
    L[2].mod = 'birdbox'; L[2].env = { a: 100, d: 100, s: 50, r: 200 }; L[2].notes[0] = 4; L[2].notes[4] = 4;   /* 2 x 0.5 s, back to back */
    var g = FX.ports('birdbox').inp.gain, was = swpPlaying;
    var r = await sample(g, function () { return swpPlaying; }, 1.9);
    var max = function (q) { return Math.max.apply(null, q.map(function (x) { return x[1]; })); };
    return { was: was, pre: r.at(r.e0 - 0.03)[1], peak1: max(r.span(0, 0.3)), sus: r.at(r.e0 + 0.45)[1], peak2: max(r.span(0.5, 0.75)), sus2: r.at(r.e0 + 0.95)[1],
             rel: r.at(r.e0 + 1.17)[1], onAll: r.span(0.02, 0.98).every(function (x) { return x[2]; }), offAfter: !r.at(r.e0 + 1.85)[2], gateBack: (TF.stop(), await new Promise(function (r) { setTimeout(r, 400); }), await byHand(toggleSweep, g)) };`);   /* stop: the next loop's note may already own it */
  ok('BIRDBOX was off before the lane played it', bb.was === false, bb);
  ok('note: the gate is shut just before the note starts', bb.pre < 0.01, bb);
  ok('note: ATTACK 100 ms opens the gate to ~1', bb.peak1 > 0.9, bb);
  ok('note: DECAY falls to SUSTAIN 50%', Math.abs(bb.sus - 0.5) < 0.05, bb);
  ok('a back-to-back note re-attacks to ~1 and holds SUSTAIN', bb.peak2 > 0.9 && Math.abs(bb.sus2 - 0.5) < 0.05, bb);
  ok('RELEASE 200 ms: the gate is nearly shut 170 ms after the last note ends', bb.rel < 0.1, bb);
  ok('the module stays on through back-to-back notes (no stutter)', bb.onAll === true, bb);
  ok('after the release the module is off, and on by hand its gate is open (1)', bb.offAfter && bb.gateBack > 0.99, bb);

  const hand = await run(p, MODSETUP + `
    L[2].mod = 'birdbox'; L[2].notes[0] = 2;
    toggleSweep();                                       /* on by hand */
    var g = FX.ports('birdbox').inp.gain;
    var r = await sample(g, function () { return swpPlaying; }, 0.6);
    var low = Math.min.apply(null, r.s.map(function (x) { return x[1]; }));
    TF.stop(); await new Promise(function (r) { setTimeout(r, 500); });
    var still = swpPlaying; if (swpPlaying) toggleSweep();
    return { low: low, still: still };`);
  ok('hand wins: a module on by hand ignores the lane, gate untouched', hand.low > 0.99, hand);
  ok('hand wins: stop leaves a module that was on by hand on', hand.still === true, hand);

  const mid = await run(p, MODSETUP + `
    L[3].mod = 'riser'; L[3].env = { a: 10, d: 10, s: 100, r: 100 }; L[3].notes[0] = 16;
    if (typeof rsGateNode !== 'function') throw new Error('rsGateNode missing');
    var g = rsGateNode().gain;
    var r = await sample(g, function () { return rsPlaying; }, 0.5);
    var during = r.at(r.e0 + 0.45);
    TF.stop(); await new Promise(function (r) { setTimeout(r, 600); });
    return { during: during, after: [rsPlaying, await byHand(toggleRiser, g)] };`);
  ok('TONE GEN: a note switches it on and opens its own gate', mid.during && mid.during[2] === true && mid.during[1] > 0.95, mid);
  ok('stop mid-note: the module goes off, and on by hand its gate is open', mid.after[0] === false && mid.after[1] > 0.99, mid);

  const nz = await run(p, MODSETUP + `
    L[0].mod = 'noise'; L[1].mod = 'multi'; L[4].mod = 'voice';
    L[0].notes[0] = 2; L[1].notes[0] = 2; L[4].notes[0] = 2;
    var r = await sample(FX.ports('noise').inp.gain, function () { return [nOn, multiPlaying, VT.getAlwaysVoice()]; }, 0.15);
    var on = r.at(r.e0 + 0.12)[2];
    TF.stop(); await new Promise(function (r) { setTimeout(r, 600); });
    var off = [nOn, multiPlaying, VT.getAlwaysVoice()];
    return { on: on, off: off, gates: [await byHand(toggleNoise, FX.ports('noise').inp.gain), await byHand(multiToggle, FX.ports('multi').inp.gain), await byHand(vtToggleAlwaysVoice, FX.ports('voice').inp.gain)] };`);
  ok('NOISE, MATHS and VOICE (always voice) all switch on for a note', nz.on && nz.on.join() === 'true,true,true', nz);
  ok('and off again on stop; on by hand all three gates are open', nz.off.join() === 'false,false,false' && nz.gates.every(function (v) { return v > 0.99; }), nz);

  // ── final review: clicks at hand-over, VOICE settle, mute ──
  const clk = await run(p, MODSETUP + `
    L[0].mod = 'noise'; L[0].env = { a: 50, d: 50, s: 80, r: 300 }; L[0].notes[4] = 2;
    if (!nsInitialized) { nsInitialized = true; randomizeNoise(); }
    var an = __an(FX._chans.noise ? FX._chans.noise.dry : FX.ports('noise').dry), g = FX.ports('noise').inp.gain, atOff = null;
    var o = TF.MOD.noise.off; TF.MOD.noise.off = function () { atOff = g.value; o(); };
    var buf = new Float32Array(an.fftSize), pre = 0, e0 = null;
    TF._onEvent = function (e) { if (e.kind === 'note' && e0 === null) e0 = e.t; };
    TF.play();
    await new Promise(function (r) { (function poll() {
      if (e0 === null || AC.currentTime < e0 - 0.02) { an.getFloatTimeDomainData(buf); for (var i = 0; i < buf.length; i++) pre = Math.max(pre, Math.abs(buf[i])); }
      if (e0 !== null && AC.currentTime > e0 + 1.2) r(); else setTimeout(poll, 5); })(); });
    TF._onEvent = null; TF.MOD.noise.off = o;
    return { pre: pre, atOff: atOff };`);
  ok('a module picked up by a note makes no sound before the note', clk.pre < 1e-3, clk);
  ok('a released module is switched off only once its gate is shut', clk.atOff !== null && clk.atOff < 0.005, clk);

  const vs = await run(p, MODSETUP + `
    L[4].mod = 'voice'; L[4].env = { a: 10, d: 10, s: 100, r: 50 }; L[4].notes[0] = 2;
    var g = FX.ports('voice').inp.gain, offAt = null, late = null;
    var o = TF.MOD.voice.off; TF.MOD.voice.off = function () { offAt = AC.currentTime; o(); };
    TF.play();
    while (offAt === null) await new Promise(function (r) { setTimeout(r, 10); });
    while (AC.currentTime < offAt + 0.3) await new Promise(function (r) { setTimeout(r, 10); });
    late = g.value; TF.MOD.voice.off = o; TF.stop();
    return { late: late };`);
  ok('VOICE: the gate stays shut while its voicing dies away after a note', vs.late < 0.01, vs);

  const mu = await run(p, MODSETUP + `
    L[3].mod = 'riser'; L[3].env = { a: 10, d: 10, s: 100, r: 1000 }; L[3].notes[0] = 16; L[3].rate = 0.5;
    var g = rsGateNode().gain, e0 = null;
    TF._onEvent = function (e) { if (e.kind === 'note' && e0 === null) e0 = e.t; };
    TF.play();
    while (e0 === null || AC.currentTime < e0 + 0.3) await new Promise(function (r) { setTimeout(r, 10); });
    TF._onEvent = null;
    var before = g.value;
    document.querySelector('.tf-mute[data-l="3"]').click();
    await new Promise(function (r) { setTimeout(r, 35); });
    var shut = g.value;
    await new Promise(function (r) { setTimeout(r, 250); });
    var after = [shut, rsPlaying];
    document.querySelector('.tf-mute[data-l="3"]').click(); TF.stop();
    return { before: before, after: after };`);
  ok('M on a module lane cuts its sounding note and switches the module off', mu.before > 0.9 && mu.after[0] < 0.01 && mu.after[1] === false, mu);

  ok('no page exceptions', p.errors.length === 0, p.errors);
  finish();
} catch (e) {
  console.log('ERROR', e && e.stack || e);
  finish(1);
}
