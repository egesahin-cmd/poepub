// Shared rig for the LINK browser checks: a throwaway server, a headless Chrome, pages over CDP.
// It starts its OWN server and its OWN Chrome and stops both by process handle. The dev server on
// :3000 and your own Chrome are never touched.
// Needs Google Chrome (override the path with CHROME=...) and Node 22+ (built-in WebSocket).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function rig({ port, debugPort }) {
  const BASE = `http://127.0.0.1:${port}`;
  let server = null, browser = null, nextId = 0, pass = 0, fail = 0;
  const waiting = new Map(), thrown = new Map();     // thrown: sessionId -> uncaught exceptions seen in that page
  const profile = mkdtempSync(path.join(tmpdir(), 'link-rig-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--mute-audio',
    // several pages are open at once: none of them may be throttled as a background tab
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    // make (hover:none) and (pointer:coarse) match, so the app's phone branch runs
    '--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1',
    'about:blank'], { stdio: 'ignore' });
  const guard = setTimeout(() => { console.log('TIMEOUT'); finish(2); }, 170000);

  function finish(code) {
    clearTimeout(guard);
    if (code === undefined) { console.log(`\n${pass} passed, ${fail} failed`); code = fail ? 1 : 0; }
    try { chrome.kill(); } catch {}
    try { server && server.kill(); } catch {}
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
    process.exit(code);
  }
  async function startServer() {
    server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), LINK_KEY: 'test' }, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/')).ok) return; } catch {} await sleep(100); }
    throw new Error('test server did not start');
  }
  async function stopServer() { const s = server; server = null; s.kill(); await new Promise((r) => s.once('exit', r)); }

  function ok(label, cond, got) { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '   got: ' + JSON.stringify(got)}`); }
  /* Wait until an expression is true in a page, or report what it was. */
  async function until(label, p, expr, ms = 5000) {
    const end = Date.now() + ms; let v;
    do { v = await p.ev(expr); if (v === true) return ok(label, true); await sleep(100); } while (Date.now() < end);
    ok(label, false, v);
  }

  async function openBrowser() {
    for (let i = 0; i < 80 && !browser; i++) {
      try { browser = new WebSocket((await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()).webSocketDebuggerUrl); }
      catch { await sleep(150); }
    }
    await new Promise((res, rej) => { browser.onopen = res; browser.onerror = rej; });
    browser.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result || m); waiting.delete(m.id); }
      else if (m.method === 'Runtime.exceptionThrown' && thrown.has(m.sessionId)) {
        const d = m.params.exceptionDetails;
        thrown.get(m.sessionId).push(((d.exception && d.exception.description) || d.text || '').split('\n')[0]);
      }
    };
  }
  const cdp = (method, params = {}, sessionId) => new Promise((res) => { const id = ++nextId; waiting.set(id, res); browser.send(JSON.stringify({ id, method, params, sessionId })); });

  /* One page = one browser window, so every page counts as visible and its animation frames run. */
  async function page(pathname) {
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', newWindow: true });
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => cdp(method, params, sessionId);
    const errors = []; thrown.set(sessionId, errors);
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true }); return r.result ? r.result.value : undefined; };
    const load = async (to) => {
      await send('Page.navigate', { url: BASE + (to || pathname) });
      for (let i = 0; i < 80; i++) { if ((await ev(`typeof LINK === 'object' && document.readyState === 'complete'`)) === true) return sleep(150); await sleep(100); }
      throw new Error('page did not load ' + (to || pathname));
    };
    const centre = (sel) => ev(`(function(){var r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`);
    /* A real (trusted) touch. hold = how long the finger stays down. */
    const tap = async (sel, hold = 60, settle = 300) => {
      const [x, y] = await centre(sel);
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await sleep(hold);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(settle);
    };
    /* A real touch drag from the element's centre by (dx, dy), in `steps` moves. */
    const drag = async (sel, dx, dy, steps = 8) => {
      const [x, y] = await centre(sel);
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= steps; i++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / steps, y: y + dy * i / steps }] }); await sleep(25); }
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(300);
    };
    /* A REAL screen-away: the page opens a tab over itself in its own window, so `visibilitychange`
       is trusted — a dispatched one is not, and the app tells the two apart. Resolves to whether
       the page really was hidden. */
    const away = async (ms) => {
      await send('Runtime.evaluate', { expression: `window.__w = window.open('about:blank', '_blank'); 1`, userGesture: true });
      await sleep(ms);
      const hidden = await ev(`document.hidden`);
      await send('Runtime.evaluate', { expression: `window.__w && window.__w.close(); 1`, userGesture: true });
      await send('Page.bringToFront');
      for (let i = 0; i < 40 && (await ev(`document.hidden`)) === true; i++) await sleep(50);
      return hidden === true;
    };
    const shot = async (file) => { writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); };
    await load();
    return { ev, load, centre, tap, drag, away, shot, errors };
  }
  return { BASE, startServer, stopServer, openBrowser, page, ok, until, finish };
}
