// TENFACE screen: the tracker grid, the transport strip, lane labels, mute, BUS.
// Real (trusted) touches at 390x844 with the phone pointer branch on.
//   node test/tenface/ui.mjs
import { rig, sleep } from '../link/rig.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync(new URL('../../.superpowers/shots/', import.meta.url).pathname, { recursive: true });

const { startServer, openBrowser, page, ok, until, finish } = rig({ port: 3082, debugPort: 9396 });

try {
  await startServer(); await openBrowser();
  const p = await page('/');
  await p.ev(`try{dismissLanding()}catch(e){}; switchTab('burst'); 1`);
  await sleep(300);

  const geo = await p.ev(`(function(){
    var cells = [].slice.call(document.querySelectorAll('.tf-cell')), bad = [];
    cells.forEach(function(c){ var r = c.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
      if (hit !== c && !c.contains(hit)) bad.push(c.dataset.l + ':' + c.dataset.s); });
    var inView = function(sel){ return [].slice.call(document.querySelectorAll(sel)).every(function(e){ var r = e.getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && r.height > 0; }); };
    var bus = document.getElementById('tfBus').getBoundingClientRect();
    return { n: cells.length, bad: bad, cellsIn: inView('.tf-cell'), lblIn: inView('.tf-lbl'), muteIn: inView('.tf-mute'), busIn: inView('#tfBus'),
             busBR: bus.left + bus.width/2 > innerWidth/2 && bus.top + bus.height/2 > innerHeight/2,
             scroll: document.getElementById('modBurst').scrollHeight > document.getElementById('modBurst').clientHeight + 1,
             strip: ['#tfPlay','#tfBpm','#tfBpmDn','#tfBpmUp'].every(function(s){ return !!document.querySelector(s); }) && document.querySelectorAll('.tf-slot').length === 4 };
  })()`);
  ok('80 cells', geo.n === 80, geo.n);
  ok('every cell is what a finger on its centre hits', geo.bad.length === 0, geo.bad);
  ok('grid, labels, mutes and BUS all inside 390x844', geo.cellsIn && geo.lblIn && geo.muteIn && geo.busIn, geo);
  ok('no scrolling inside TENFACE', geo.scroll === false);
  ok('BUS sits bottom-right', geo.busBR === true);
  ok('top strip has play, BPM, - / + and four slots', geo.strip === true);

  const cell = '.tf-cell[data-l="1"][data-s="4"]';
  const v = () => p.ev(`[document.querySelector('${cell}').dataset.v, TF.state.slots[TF.state.slot].lanes[1].steps[4]]`);
  await p.tap(cell); const a = await v();
  await p.tap(cell); const b = await v();
  await p.tap(cell); const c = await v();
  ok('taps cycle off -> hit -> accent -> off, in the DOM and the state', a[0] === '1' && a[1] === 1 && b[0] === '2' && b[1] === 2 && c[0] === '0' && c[1] === 0, [a, b, c]);

  await p.ev(`TF.state.slots[TF.state.slot].lanes[2].len = 8; TF.render(); 1`);
  const offs = await p.ev(`[8,9,10,11,12,13,14,15].every(function(s){ return document.querySelector('.tf-cell[data-l="2"][data-s="'+s+'"]').classList.contains('off'); }) && !document.querySelector('.tf-cell[data-l="2"][data-s="7"]').classList.contains('off')`);
  ok('lane 3 at length 8: rows 9-16 are off, row 8 is not', offs === true);
  await p.tap('.tf-cell[data-l="2"][data-s="11"]');
  ok('a tap on an off row changes nothing', (await p.ev(`TF.state.slots[TF.state.slot].lanes[2].steps[11]`)) === 0);

  await p.tap('#tfPlay');
  ok('PLAY starts the machine', (await p.ev(`TF.playing`)) === true);
  await p.tap('.tf-mute[data-l="0"]');
  await sleep(200);
  ok('mute marks the label and silences the lane', (await p.ev(`document.querySelector('.tf-lbl[data-l="0"]').classList.contains('muted') && TF.state.slots[TF.state.slot].lanes[0].mute === true && TF._nodes.lanes[0].gain.value < 0.01`)) === true);
  await p.tap('.tf-mute[data-l="0"]');
  await sleep(200);
  ok('unmute brings it back', (await p.ev(`!document.querySelector('.tf-lbl[data-l="0"]').classList.contains('muted') && TF._nodes.lanes[0].gain.value > 0.1`)) === true);
  await until('the playhead lights a row', p, `document.querySelectorAll('.tf-cell.now').length > 0`, 2000);

  await p.tap('#tfBpmUp');
  ok('BPM + from 120 gives 121', (await p.ev(`[TF.state.bpm, document.getElementById('tfBpm').textContent]`)).join() === '121,121');
  await p.ev(`TF.state.bpm = 240; TF.render(); 1`);
  await p.tap('#tfBpmUp');
  ok('BPM is clamped at 240', (await p.ev(`TF.state.bpm`)) === 240);
  await p.ev(`TF.state.bpm = 120; TF.render(); 1`);

  await p.ev(`TF.state.slots[1].lanes[3].steps[6] = 2; 1`);
  await p.tap('.tf-slot[data-i="1"]');
  const early = await p.ev(`[TF.state.slot, document.querySelector('.tf-cell[data-l="3"][data-s="6"]').dataset.v, document.querySelector('.tf-slot[data-i="1"]').classList.contains('pending')]`);
  ok('slot B is pending until the bar line (grid still shows A)', early[0] === 0 && early[1] === '0' && early[2] === true, early);
  await until('at the bar line the grid shows B', p, `TF.state.slot === 1 && document.querySelector('.tf-cell[data-l="3"][data-s="6"]').dataset.v === '2' && document.querySelector('.tf-slot[data-i="1"]').classList.contains('on')`, 3000);
  await p.tap('#tfPlay');
  ok('STOP stops it', (await p.ev(`TF.playing`)) === false);
  await p.tap('.tf-slot[data-i="0"]');
  ok('while stopped a slot switches at once', (await p.ev(`TF.state.slot`)) === 0);

  await p.tap('.tf-lbl[data-l="2"]');
  ok('a label opens its lane panel', (await p.ev(`TF.panel && TF.panel.kind === 'lane' && TF.panel.lane === 2`)) === true);
  await p.tap('#tfBus');
  ok('BUS opens the bus panel', (await p.ev(`TF.panel && TF.panel.kind === 'bus'`)) === true);

  await p.ev(`TF.openPanel(null); 1`);
  await p.shot(new URL('../../.superpowers/shots/tf-grid.png', import.meta.url).pathname);

  /* ── panels ── */
  await p.tap('.tf-lbl[data-l="1"]');
  ok('lane 2 panel shows SOUND snare', (await p.ev(`document.querySelector('#tfPanel.open.lane select.tf-snd').value`)) === 'snare');
  await p.ev(`var s = document.querySelector('#tfPanel select.tf-snd'); s.value = 'cow'; s.dispatchEvent(new Event('change')); 1`);
  ok('choosing COW renames the label and the lane plays it', (await p.ev(`[document.querySelector('.tf-lbl[data-l="1"]').textContent, TF.state.slots[TF.state.slot].lanes[1].snd].join()`)) === 'COW,cow');
  await p.tap('.tf-lbl[data-l="1"]');
  ok('tapping the same label again closes the panel', (await p.ev(`TF.panel === null && !document.getElementById('tfPanel').classList.contains('open')`)) === true);
  await p.tap('#tfBus');
  ok('bus panel has LENGTH, SWING, COMP, DRIVE, REV and a VOLUME slider',
    (await p.ev(`['len','swing','comp','drive','verb'].every(function(k){ return !!document.querySelector('#tfPanel.bus .tf-k-' + k); }) && !!document.querySelector('#tfPanel.bus input[type=range].tf-busvol')`)) === true);
  await p.tap('.tf-cell[data-l="0"][data-s="0"]');
  ok('a tap outside the sheet closes it and writes no step', (await p.ev(`TF.panel === null && TF.state.slots[TF.state.slot].lanes[0].steps[0]`)) === 0);

  await p.ev(`TF.setBusLen(12); 1`);
  ok('bus LENGTH 12 sets every lane to 12', (await p.ev(`TF.state.slots[TF.state.slot].lanes.map(function(l){return l.len}).join()`)) === '12,12,12,12,12');
  await p.tap('.tf-lbl[data-l="0"]');
  for (let i = 0; i < 4; i++) await p.tap('#tfPanel .tf-len-up', 40, 80);
  ok('the lane panel then sets lane 1 to 16 alone', (await p.ev(`TF.state.slots[TF.state.slot].lanes.map(function(l){return l.len}).join()`)) === '16,12,12,12,12');

  await p.tap('#tfPlay');
  await p.drag('#tfPanel .tf-k-vol', 0, 220);
  await sleep(200);
  ok('VOL knob to 0 silences lane 1', (await p.ev(`[TF.state.slots[TF.state.slot].lanes[0].vol, TF._nodes.lanes[0].gain.value < 0.001]`)).join() === '0,true');
  await p.tap('#tfPlay');
  await p.ev(`TF.openPanel(null); 1`);

  /* ── persistence ── */
  await p.ev(`var L = TF.state.slots[0].lanes; L[0].steps[3] = 2; L[4].snd = 'tom'; TF.setLaneFx(0, 'verb', 40);
              TF.state.slots[2].lanes[1].steps[9] = 1; TF.state.slots[2].lanes[0].snd = 'rim';
              TF.state.bpm = 133; TF.setSwing(60); TF.render(); 1`);
  await sleep(600);
  await p.load();
  await p.ev(`try{dismissLanding()}catch(e){}; switchTab('burst'); 1`);
  await sleep(300);
  const back = await p.ev(`(function(){ var s = TF.state, L = s.slots[0].lanes; return [s.bpm, s.swing, L[0].steps[3], L[4].snd, L[0].fx.verb, FX.amt('verb','tf1'), s.slots[2].lanes[1].steps[9], document.getElementById('tfBpm').textContent].join(); })()`);
  ok('after a reload slots A and C, BPM, swing and lane REV are all back', back === '133,60,2,tom,40,40,1,133', back);

  await p.tap('.tf-slot[data-i="2"]');
  ok('switching to slot C swaps in its own kit', (await p.ev(`document.querySelector('.tf-lbl[data-l="0"]').textContent`)) === 'RIM');

  await p.ev(`localStorage.setItem('ptf_', '{"slots":[null]}'); 1`);
  await p.load();
  await p.ev(`try{dismissLanding()}catch(e){}; switchTab('burst'); 1`);
  await sleep(300);
  ok('a corrupt save opens TENFACE on the defaults', (await p.ev(`TF.state.bpm === 120 && document.querySelectorAll('.tf-cell').length === 80 && TF.state.slots[0].lanes[0].snd === 'kick'`)) === true);

  /* ── final-review fixes ── */
  await p.ev(`TF.state.slots[2].lanes[0].fx.verb = 55; TF.state.slots[1].lanes[0].snd = 'rim'; 1`);
  await p.tap('.tf-slot[data-i="2"]');
  ok('a slot picked while stopped brings its own sends', (await p.ev(`FX.amt('verb','tf1')`)) === 55);
  await p.tap('.tf-lbl[data-l="0"]');
  await p.tap('.tf-slot[data-i="1"]');
  ok('an open lane panel follows a slot picked while stopped', (await p.ev(`document.querySelector('#tfPanel select.tf-snd').value + ',' + TF.state.slot`)) === 'rim,1');
  await p.ev(`TF.openPanel(null); 1`);

  await p.tap('#tfPlay');
  await p.tap('.tf-slot[data-i="3"]');
  await p.tap('#tfPlay');
  ok('stop resolves a pending slot: D is current and nothing blinks', (await p.ev(`TF.state.slot === 3 && !document.querySelector('.tf-slot.pending') && document.querySelector('.tf-slot[data-i="3"]').classList.contains('on')`)) === true);

  /* hidden = a 2 s look-ahead, so the gap between the clock taking a switch and its bar line is wide */
  await p.ev(`TF.state.slots[0].lanes[0].mute = false; TF.state.slot = 3; TF.render();
              Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return true; } });
              document.dispatchEvent(new Event('visibilitychange')); 1`);
  await p.tap('#tfPlay');
  await p.ev(`TF.state.slots[0].lanes[0].mute = false; document.querySelector('.tf-slot[data-i="0"]').click(); 1`);
  await until('the clock takes the switch ahead of its bar line', p, `TF.state.slot === 0 && TF._switchAt > AC.currentTime + 0.05`, 4000);
  await p.ev(`TF.state.slots[0].lanes[0].mute = true; TF.syncLanes(); window.__sa = TF._switchAt; 1`);
  await until('past the bar line', p, `AC.currentTime > window.__sa + 0.1`, 4000);
  ok('a mute pressed between the switch and its bar line still silences the lane', (await p.ev(`TF._nodes.lanes[0].gain.value < 0.01`)) === true, await p.ev(`TF._nodes.lanes[0].gain.value`));
  await p.tap('#tfPlay');
  await p.ev(`delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); TF.state.slots[0].lanes[0].mute = false; TF.render(); 1`);

  await p.tap('.tf-cell[data-l="4"][data-s="15"]', 30, 0);      /* no settle: inside the 300 ms save debounce */
  const flushed = await p.ev(`window.dispatchEvent(new Event('pagehide')); JSON.parse(localStorage.getItem('ptf_')).slots[TF.state.slot].lanes[4].steps[15]`);
  ok('an edit is saved at once when the page is hidden or left', flushed === 1, flushed);

  /* ── pages: up to 64 steps, 16 rows a page ── */
  await p.ev(`TF.openPanel(null); TF.setBusLen(16); 1`);
  const pages = () => p.ev(`(function(){ var b = [].slice.call(document.querySelectorAll('.tf-page')), bus = document.getElementById('tfBus').getBoundingClientRect();
    return { n: b.length, txt: b.map(function(x){ return x.textContent; }).join(''),
             left: b.every(function(x){ var q = x.getBoundingClientRect(); return q.width > 0 && q.right < innerWidth / 2 && Math.abs((q.top + q.bottom) / 2 - (bus.top + bus.bottom) / 2) < 4; }),
             dis: b.map(function(x){ return x.classList.contains('dis') ? 1 : 0; }).join(''), on: b.map(function(x){ return x.classList.contains('on') ? 1 : 0; }).join(''),
             now: b.map(function(x){ return x.classList.contains('now') ? 1 : 0; }).join(''), first: document.querySelector('.tf-idx').textContent }; })()`);
  let pg = await pages();
  ok('4 page buttons 1-4 sit bottom-left, level with BUS', pg.n === 4 && pg.txt === '1234' && pg.left, pg);
  ok('at LENGTH 16 only page 1 is enabled, and shown', pg.dis === '0111' && pg.on === '1000', pg);
  await p.ev(`TF.setBusLen(70); 1`);
  ok('bus LENGTH goes up to 64', (await p.ev(`TF.state.busLen + ',' + TF.state.slots[TF.state.slot].lanes[0].len`)) === '64,64');
  await p.ev(`TF.setBusLen(40); 1`);
  ok('LENGTH 40 enables pages 1-3', (await pages()).dis === '0001');
  await p.tap('.tf-page[data-p="1"]');
  pg = await pages();
  ok('a tap on page 2 shows steps 17-32', pg.on === '0100' && pg.first === '17', pg);
  await p.tap('.tf-cell[data-l="3"][data-s="5"]');
  ok('a tap on page 2 row 6 writes step 22', (await p.ev(`[TF.state.slots[TF.state.slot].lanes[3].steps[21], document.querySelector('.tf-cell[data-l="3"][data-s="5"]').dataset.v].join()`)) === '1,1');
  ok('rows past LENGTH 40 on page 3 are off', (await p.ev(`(function(){ document.querySelector('.tf-page[data-p="2"]').click(); var r = document.querySelector('.tf-cell[data-l="0"][data-s="8"]').classList.contains('off') && !document.querySelector('.tf-cell[data-l="0"][data-s="7"]').classList.contains('off'); return r; })()`)) === true);
  await p.tap('.tf-lbl[data-l="1"]');
  for (let i = 0; i < 3; i++) await p.tap('#tfPanel .tf-len-up', 40, 60);
  ok('the lane LENGTH buttons go past 16', (await p.ev(`TF.state.slots[TF.state.slot].lanes[1].len`)) === 43);
  await p.ev(`TF.openPanel(null); TF.setBusLen(32); TF.state.bpm = 240; TF.render(); 1`);
  await p.tap('.tf-page[data-p="0"]');
  await p.tap('#tfPlay');
  await until('playing, the view follows the playhead to page 2', p, `TF.view === 1 && document.querySelector('.tf-page[data-p="1"]').classList.contains('now')`, 3000);
  await until('and back to page 1 when the pattern wraps', p, `TF.view === 0`, 3000);
  await p.tap('.tf-page[data-p="1"]', 30, 0);
  await sleep(2300);
  ok('after a tap on another page the view stays there for a whole loop', (await p.ev(`TF.view === 1 && TF.follow === false`)) === true, await p.ev(`[TF.view, TF.follow, TF.playPage]`));
  await until('the playhead reaches page 2', p, `TF.playPage === 1`, 3000);
  await p.tap('.tf-page[data-p="1"]', 30, 0);
  ok('a tap on the playing page resumes following', (await p.ev(`TF.follow`)) === true);
  await until('following again', p, `TF.view === 0`, 3000);
  await p.tap('#tfPlay');
  pg = await pages();
  ok('stopped: no page is marked as playing', pg.now === '0000', pg);
  await p.ev(`TF.state.bpm = 120; TF.setBusLen(16); TF.render(); 1`);
  ok('lowering LENGTH below the page on screen brings the view back to page 1', (await p.ev(`TF.view`)) === 0);

  /* ── module lanes: picker, notes, envelope ── */
  await p.ev(`TF.openPanel(null); TF.state.slot = 0; TF.state.slots[0].lanes.forEach(function (l) { l.mod = null; l.notes.fill(0); }); TF.render(); 1`);
  const notes = () => p.ev(`TF.state.slots[0].lanes[2].notes.slice(0, 16).join('')`);
  const cls = (s) => p.ev(`(function(){ var c = document.querySelector('.tf-cell[data-l="2"][data-s="${s}"]'); return ['n','n0','n1'].filter(function(k){ return c.classList.contains(k); }).join(' '); })()`);
  await p.tap('.tf-lbl[data-l="2"]');
  await p.tap('#tfPanel .tf-mod');
  const list = await p.ev(`[].slice.call(document.querySelectorAll('#tfPanel .tf-mod-opt')).filter(function(o){ return o.dataset.m; }).map(function(o){ return o.dataset.m + ':' + o.style.getPropertyValue('--tf-mc').trim() + ':' + (o.getBoundingClientRect().height > 0); }).join()`);
  ok('the MODULE picker lists the five modules in their colours', list === 'voice:#d9a0d5:true,multi:#9c342a:true,birdbox:#2d6a4e:true,noise:#000:true,riser:#a0ad95:true', list);
  await p.tap('#tfPanel .tf-mod-opt[data-m="birdbox"]');
  const lbl = await p.ev(`(function(){ var l = document.querySelector('.tf-lbl[data-l="2"]'); return [l.textContent, getComputedStyle(l).backgroundColor, TF.state.slots[0].lanes[2].mod, l.getBoundingClientRect().height > 20].join('|'); })()`);
  ok('picking BIRDBOX names and colours the label, and it stays on screen', lbl === 'BIRDBOX|rgb(45, 106, 78)|birdbox|true', lbl);
  ok('a module lane panel has the envelope, RATE and LENGTH, and no drum knobs',
    (await p.ev(`['a','d','s','r'].every(function(k){ return !!document.querySelector('#tfPanel .tf-k-' + k); }) && !document.querySelector('#tfPanel .tf-k-vol') && !document.querySelector('#tfPanel .tf-k-tune') && !document.querySelector('#tfPanel .tf-k-verb') && !!document.querySelector('#tfPanel svg.tf-env path') && !!document.querySelector('#tfPanel .tf-rate') && !!document.querySelector('#tfPanel .tf-len-up')`)) === true);
  const path0 = await p.ev(`document.querySelector('#tfPanel svg.tf-env path').getAttribute('d')`);
  await p.drag('#tfPanel .tf-k-a', 0, -80);
  const env = await p.ev(`[TF.state.slots[0].lanes[2].env.a, document.querySelector('#tfPanel svg.tf-env path').getAttribute('d')]`);
  ok('the ATTACK knob writes the lane envelope and redraws it', env[0] > 10 && env[1] !== path0, env);
  await p.shot(new URL('../../.superpowers/shots/tf-env.png', import.meta.url).pathname);
  await p.tap('.tf-lbl[data-l="3"]');
  await p.tap('#tfPanel .tf-mod');
  ok('another lane sees BIRDBOX taken', (await p.ev(`document.querySelector('#tfPanel .tf-mod-opt[data-m="birdbox"]').classList.contains('dis')`)) === true);
  await p.ev(`document.querySelector('#tfPanel .tf-mod-opt[data-m="birdbox"]').click(); 1`);
  ok('and cannot pick it', (await p.ev(`TF.state.slots[0].lanes[3].mod`)) === null);
  await p.ev(`TF.openPanel(null); 1`);

  const rowH = await p.ev(`document.querySelector('.tf-cell[data-l="2"][data-s="0"]').getBoundingClientRect().height`);
  await p.tap('.tf-cell[data-l="2"][data-s="1"]');
  ok('a tap on a module lane makes a 1-row note', (await notes()) === '0100000000000000' && (await cls(1)) === 'n n0 n1', [await notes(), await cls(1)]);
  await p.drag('.tf-cell[data-l="2"][data-s="4"]', 0, rowH * 2);
  ok('a drag down 2 rows from an empty cell draws a 3-row note', (await notes()) === '0100300000000000' && (await cls(5)) === 'n' && (await cls(6)) === 'n n1', [await notes(), await cls(5), await cls(6)]);
  await p.drag('.tf-cell[data-l="2"][data-s="5"]', 0, rowH * 3);
  ok('dragging inside a note resizes it from its end', (await notes()) === '0100500000000000', await notes());
  await p.drag('.tf-cell[data-l="2"][data-s="1"]', 0, rowH * 6);
  ok('a note stops at the next one', (await notes()) === '0300500000000000', await notes());
  await p.drag('.tf-cell[data-l="2"][data-s="8"]', 0, -rowH * 3);
  ok('dragging up shortens it', (await notes()) === '0300200000000000', await notes());
  await p.tap('.tf-cell[data-l="2"][data-s="2"]');
  ok('a tap on a note deletes it', (await notes()) === '0000200000000000', await notes());
  await p.tap('.tf-cell[data-l="0"][data-s="9"]');
  ok('drum lanes still cycle hits', (await p.ev(`TF.state.slots[0].lanes[0].steps[9]`)) === 1);
  await p.ev(`TF.setBusLen(32); 1`);
  await p.drag('.tf-cell[data-l="2"][data-s="13"]', 0, rowH * 4.5, 60);
  ok('dragging past the last row flips to page 2 and keeps extending', (await p.ev(`[TF.view, TF.state.slots[0].lanes[2].notes[13] > 3].join()`)) === '1,true', await p.ev(`[TF.view, TF.state.slots[0].lanes[2].notes[13]].join()`));
  /* synthetic pointers on lane 2's cells (rig has no touchcancel) */
  const PT = `window.__pt = function (type, row, dy) { var c = document.querySelector('.tf-cell[data-l="2"][data-s="' + row + '"]'), r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 + (dy || 0) })); }; 1`;
  await p.ev(PT);
  await p.tap('.tf-page[data-p="0"]');
  await p.ev(`__pt('pointerdown', 4); __pt('pointercancel', 4); 1`);
  ok('a cancelled press on a note keeps the note', (await p.ev(`TF.state.slots[0].lanes[2].notes[4]`)) === 2);
  await p.ev(`TF.state.slots[1].lanes[2].mod = null; TF.state.slots[1].lanes[2].notes.fill(0); __pt('pointerdown', 9); 1`);
  await p.tap('.tf-slot[data-i="1"]');
  await p.ev(`__pt('pointermove', 9, ${rowH} * 2); __pt('pointerup', 11); 1`);
  ok('a slot switch mid-drag: the note is drawn in the slot it was started in',
    (await p.ev(`[TF.state.slots[0].lanes[2].notes[9], TF.state.slots[1].lanes[2].notes.join('').replace(/0/g, '')].join()`)) === '3,', await p.ev(`[TF.state.slots[0].lanes[2].notes[9], TF.state.slots[1].lanes[2].notes.join('')].join()`));
  await p.tap('.tf-slot[data-i="0"]');
  await p.ev(`TF.state.bpm = 240; TF.render(); 1`);
  await p.tap('#tfPlay');
  await until('following on page 1', p, `TF.playPage === 0 && TF.view === 0`, 3000);
  await p.ev(`__pt('pointerdown', 13); 1`);
  await until('the playhead crosses to page 2', p, `TF.playPage === 1`, 3000);
  const held = await p.ev(`[TF.view, TF.state.slots[0].lanes[2].notes[13]].join()`);
  await p.ev(`__pt('pointerup', 13); 1`);
  await p.tap('#tfPlay');
  await p.ev(`TF.state.bpm = 120; TF.render(); 1`);
  ok('follow never turns the page under a finger drawing a note', held.split(',')[0] === '0', held);

  await p.tap('.tf-page[data-p="0"]');
  await p.shot(new URL('../../.superpowers/shots/tf-notes.png', import.meta.url).pathname);
  await p.tap('.tf-lbl[data-l="2"]');
  await p.ev(`var s = document.querySelector('#tfPanel select.tf-snd'); s.value = 'ch'; s.dispatchEvent(new Event('change')); 1`);
  ok('picking a SOUND makes it a drum lane again, notes kept', (await p.ev(`[TF.state.slots[0].lanes[2].mod, TF.state.slots[0].lanes[2].notes[4], document.querySelector('.tf-lbl[data-l="2"]').textContent].join()`)) === ',2,C.HAT');
  await p.ev(`TF.openPanel(null); TF.setBusLen(16); 1`);

  await p.tap('.tf-lbl[data-l="2"]');
  await p.shot(new URL('../../.superpowers/shots/tf-lane.png', import.meta.url).pathname);
  await p.tap('#tfBus');
  await p.shot(new URL('../../.superpowers/shots/tf-bus.png', import.meta.url).pathname);
  ok('no uncaught exceptions', p.errors.length === 0, p.errors);
  finish();
} catch (e) {
  console.log('ERROR', e && e.stack || e);
  finish(1);
}
