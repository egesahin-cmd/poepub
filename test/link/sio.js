'use strict';
/* A minimal Socket.IO v4 client over Node's built-in WebSocket (Node 22+), for tests only, so the
   project needs no socket.io-client dependency.

   Wire format. Engine.IO frames start with one digit: 0 open, 2 ping, 3 pong, 4 message.
   Inside a message, Socket.IO adds: one digit (0 connect, 2 event, 3 ack), the namespace and a
   comma, an optional ack id, then a JSON array.  Example:  42/link,7["claim",{"v":1}]  */
function connect(base, nsp) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket');
    const handlers = {}, acks = new Map(); let nextAck = 0, open = true;
    const api = {
      on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
      emit(ev, ...args) { ws.send('42' + nsp + ',' + JSON.stringify([ev, ...args])); },
      /* emit and wait for the server's ack */
      ask(ev, ...args) { return new Promise((res) => { const id = nextAck++; acks.set(id, res); ws.send('42' + nsp + ',' + id + JSON.stringify([ev, ...args])); }); },
      close() { ws.close(); },
      get open() { return open; },
      closed: null,
    };
    api.closed = new Promise((res) => ws.addEventListener('close', () => { open = false; res(); }));
    ws.addEventListener('error', () => reject(new Error('cannot reach ' + base)));
    const giveUp = setTimeout(() => { reject(new Error('no answer from namespace ' + nsp)); ws.close(); }, 5000);
    ws.addEventListener('message', (m) => {
      const s = String(m.data);
      if (s[0] === '0') return ws.send('40' + nsp + ',');           // engine is open: join the namespace
      if (s[0] === '2') return ws.send('3');                         // heartbeat
      if (s[0] !== '4') return;
      const type = s[1]; let rest = s.slice(2);
      if (rest.startsWith(nsp + ',')) rest = rest.slice(nsp.length + 1);
      if (type === '0') { clearTimeout(giveUp); return resolve(api); }  // namespace joined
      if (type === '4') { clearTimeout(giveUp); ws.close(); return reject(new Error('namespace ' + nsp + ' refused: ' + rest)); }
      const parts = /^(\d*)([\s\S]*)$/.exec(rest);
      const body = parts[2] ? JSON.parse(parts[2]) : [];
      if (type === '2') (handlers[body[0]] || []).forEach((fn) => fn(...body.slice(1)));
      if (type === '3') { const res = acks.get(+parts[1]); if (res) { acks.delete(+parts[1]); res(body[0]); } }
    });
  });
}
module.exports = { connect };
