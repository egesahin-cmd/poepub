'use strict';
/* Fan-out check: one master sending 20 reliable batches a second to a full room.
     node test/link/load.js [followers=100] [seconds=10]
   Starts its OWN throwaway server on port 3075 and stops it by process handle.
   Every batch carries the time it was sent, so each follower can measure how late it arrived. */
const { spawn } = require('node:child_process');
const path = require('node:path');
const { connect } = require('./sio');

const N = +process.argv[2] || 100, SECONDS = +process.argv[3] || 10, RATE = 20;
const PORT = 3075, BASE = 'http://127.0.0.1:' + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', '..'), env: { ...process.env, PORT: String(PORT), LINK_KEY: 'test' }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/')).ok) break; } catch (_) {} await sleep(100); }
    const master = await connect(BASE, '/link');
    await master.ask('claim', { v: 1, room: 'load', key: 'test' });
    await master.ask('put', { st: { 't.ms': 0 } });
    const got = new Array(N).fill(0), late = [];
    const followers = [];
    for (let i = 0; i < N; i++) {
      const f = await connect(BASE, '/link');
      f.on('d', (m) => { got[i]++; late.push(Date.now() - m.d['t.ms']); });
      const a = await f.ask('follow', { v: 1, room: 'load' });
      if (!a.ok) throw new Error('follower ' + i + ' refused: ' + a.err);
      followers.push(f);
    }
    const total = RATE * SECONDS;
    for (let k = 0; k < total; k++) { master.emit('d', { d: { 't.ms': Date.now() } }); await sleep(1000 / RATE); }
    await sleep(500);
    late.sort((a, b) => a - b);
    const at = (q) => late[Math.min(late.length - 1, Math.floor(late.length * q))];
    const short = got.filter((g) => g !== total).length;
    console.log(`${N} followers, ${total} batches each expected`);
    console.log(`delivered: ${late.length} of ${N * total}   followers missing any: ${short}`);
    console.log(`lateness ms: median ${at(0.5)}  p95 ${at(0.95)}  worst ${late[late.length - 1]}`);
    followers.forEach((f) => f.close()); master.close();
    process.exitCode = short ? 1 : 0;
  } finally { server.kill(); }
})();
