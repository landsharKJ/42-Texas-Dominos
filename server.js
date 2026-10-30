'use strict';
/* 42 table server: serves the page, keeps the one shared table in memory,
   runs the bots, and sends each player only their own dominoes. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const E = require('./engine.js');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.TABLE_PASSWORD || '';
const SCALE = Number(process.env.BOT_DELAY_SCALE) || 1; // tests shrink the bot delays
// index.html sits next to this file (an older layout kept it in public/, so look there too)
const INDEX_PATH = [path.join(__dirname, 'index.html'), path.join(__dirname, 'public', 'index.html')].find(p => fs.existsSync(p));
if (!INDEX_PATH) { console.error('index.html is missing from the repository. Upload it next to server.js.'); process.exit(1); }
const INDEX = fs.readFileSync(INDEX_PATH);

let state = E.reduce(null, { type: 'init' }, { id: null });   // the one table; lives in memory, created at startup (nobody is host until someone sits)
const clients = new Set();  // { ws, id, alive }

const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const passwordOk = pw => !PASSWORD || crypto.timingSafeEqual(sha(pw), sha(PASSWORD));

/* ---------- what each player is allowed to see ---------- */
function view(s, id) {
  if (!s) return null;
  const v = JSON.parse(JSON.stringify(s));
  const mine = v.seats.findIndex(p => p.id === id && !p.bot);
  for (let i = 0; i < 4; i++) if (i !== mine && v.hands && v.hands[i]) v.hands[i] = v.hands[i].map(() => 'xx');
  v.hostSeat = v.seats.findIndex(p => p.id && p.id === v.hostId && !p.bot);
  v.seats.forEach(p => { if (p.id && !p.bot && p.id !== id) p.id = 'other'; });
  if (v.hostId !== id) v.hostId = 'other';
  return v;
}
function send(c) {
  if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ type: 'state', state: view(state, c.id) }));
}
const broadcast = () => clients.forEach(send);

/* ---------- applying actions ---------- */
function apply(action, actor) {
  const next = E.reduce(state, action, actor);   // throws on illegal moves
  if (next) { state = next; broadcast(); }
  drive();
}

/* ---------- bots and trick collection run here, not in anyone's browser ---------- */
let timer = null;
function drive() {
  clearTimeout(timer);
  const s = state;
  if (!s || !s.hostId || s.phase === 'lobby') return;
  const host = { id: s.hostId }, v = s.v;
  const guarded = fn => () => {
    if (!state || state.v !== v) return;
    try { fn(); } catch (e) { console.error('driver error:', e.message); timer = setTimeout(drive, 2000); }
  };
  if (s.phase === 'playing' && s.pending) {
    timer = setTimeout(guarded(() => apply({ type: 'collect' }, host)), 1900 * SCALE);
    return;
  }
  const botTurn = (s.phase === 'bidding' && s.seats[s.turn].bot) ||
    (s.phase === 'trump' && s.seats[s.contract.chooser].bot) ||
    (s.phase === 'playing' && !s.pending && s.seats[s.turn].bot);
  if (botTurn) {
    timer = setTimeout(guarded(() => {
      const a = E.pendingBotAction(state);
      if (a) apply(a, host);
    }), (s.phase === 'playing' ? 850 : 1250) * SCALE);
  }
}

/* ---------- http ---------- */
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  if (url === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('User-agent: *\nDisallow: /\n'); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
  res.end(INDEX);
});

/* ---------- websocket ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const id = q.get('id') || '';
  if (!passwordOk(q.get('pw') || '')) { ws.close(4001, 'password'); return; }
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) { ws.close(4002, 'bad id'); return; }
  const c = { ws, id, alive: true, stamps: [] };
  clients.add(c);
  ws.on('pong', () => { c.alive = true; });
  send(c);
  ws.on('message', data => {
    const now = Date.now();
    c.stamps = c.stamps.filter(t => now - t < 5000);
    if (c.stamps.length >= 40) { ws.send(JSON.stringify({ type: 'error', message: 'Slow down a little.' })); return; } // flood guard; dropped messages don't count
    c.stamps.push(now);
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (m && m.type === 'ping') { ws.send('{"type":"pong"}'); return; }
    if (!m || m.type !== 'action' || !m.action || typeof m.action !== 'object') return;
    try { apply(m.action, { id }); ws.send('{"type":"ack"}'); }
    catch (e) { ws.send(JSON.stringify({ type: 'error', message: e.message })); send(c); }
  });
  ws.on('close', () => clients.delete(c));
  ws.on('error', () => clients.delete(c));
});
// drop dead connections; the pings also keep the hosting platform from treating the table as idle mid-game
setInterval(() => {
  clients.forEach(c => { if (!c.alive) { c.ws.terminate(); clients.delete(c); return; } c.alive = false; try { c.ws.ping(); } catch (e) { } });
}, 25000);

server.listen(PORT, () => console.log('42 table listening on ' + PORT + (PASSWORD ? ' (password protected)' : ' (no password set)')));
