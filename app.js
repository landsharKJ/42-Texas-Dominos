/* ===================== APP ===================== */
const $app = document.getElementById('app');
const $status = document.getElementById('status');
const $nick = document.getElementById('nick');
const $toast = document.getElementById('toast');
const tabId = 't' + Math.random().toString(36).slice(2, 10);

const store = (() => {
  const mem = {};
  return {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] || null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } }
  };
})();

const S = { mode: 'connecting', local: null, remote: null, actor: { id: null }, realId: null, pwBad: false };
let ws = null, wsOpen = false, retry = 0, waking = false, replyT = null, pongT = null;
const cur = () => (S.mode === 'local' ? S.local : S.remote);
const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getName = () => (($nick.value || '').trim() || store.get('g42-name') || 'Player').slice(0, 14);
$nick.value = store.get('g42-name') || '';
$nick.addEventListener('input', () => store.set('g42-name', $nick.value));

let toastT = null;
function toast(msg) {
  $toast.textContent = msg; $toast.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { $toast.hidden = true; }, 3200);
}

/* ---------- dominoes ---------- */
const PIPS = { 0: [], 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
function tileSVG(t, cls) {
  const half = (n, cy) => PIPS[n].map(p => '<circle cx="' + (25 + p[0] * 12) + '" cy="' + (cy + p[1] * 11) + '" r="4.3"/>').join('');
  return '<svg class="dom ' + (cls || '') + '" viewBox="0 0 50 96" aria-hidden="true"><rect class="dbody" x="1.5" y="1.5" width="47" height="93" rx="7"/>' +
    '<line class="dline" x1="9" y1="48" x2="41" y2="48"/><g class="dpips">' + half(hi(t), 24) + half(lo(t), 72) + '</g><circle class="dpin" cx="25" cy="48" r="2.2"/></svg>';
}
const backSVG = '<svg viewBox="0 0 50 96" aria-hidden="true"><rect class="back-body" x="1.5" y="1.5" width="47" height="93" rx="7"/><line class="back-line" x1="9" y1="48" x2="41" y2="48"/></svg>';

function tallySVG(n) {
  const g = Math.floor(n / 5), r = n % 5, W = 44, lines = [];
  const j = (i) => ((i * 7919) % 5 - 2) * 0.5; // deterministic chalk wobble
  let x0 = 4, i = 0;
  const stroke = (x1, y1, x2, y2) => lines.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>');
  for (let k = 0; k < g; k++, x0 += W) {
    for (let q = 0; q < 4; q++, i++) stroke(x0 + q * 9 + j(i), 5 + j(i + 1), x0 + q * 9 + j(i + 2), 31 + j(i + 3));
    stroke(x0 - 3, 26 + j(i), x0 + 35, 9 + j(i + 1)); i++;
  }
  for (let q = 0; q < r; q++, i++) stroke(x0 + q * 9 + j(i), 5 + j(i + 1), x0 + q * 9 + j(i + 2), 31 + j(i + 3));
  const w = Math.max(60, x0 + r * 9 + 6);
  return '<svg viewBox="0 0 ' + w + ' 36" preserveAspectRatio="xMinYMid meet" role="img" aria-label="' + n + ' marks">' + lines.join('') + '</svg>';
}

/* ---------- shared table connection ----------
   Tries a WebSocket first. If that fails to hold, falls back to plain HTTP (event stream down, POST up),
   which works through nearly every network. Either way, a silent failure is turned into a visible message. */
const BUILD = '__BUILD__';
let tp = new URLSearchParams(location.search).get('tp') === 'sse' ? 'sse' : 'ws';
let es = null, wsFails = 0, lastRx = Date.now(), lastIssue = '';
const qs = () => 'id=' + encodeURIComponent(S.realId) + '&pw=' + encodeURIComponent(store.get('g42-pw') || '');

function goOffline(reason) {
  wsOpen = false; waking = true; if (reason) lastIssue = reason;
  if (S.mode === 'remote' || S.mode === 'connecting') { S.mode = 'offline'; update(); } else if (S.mode !== 'local') update();
  setTimeout(connectWS, Math.min(1000 * Math.pow(2, retry++), 6000));
}
function connected() {
  retry = 0; wsOpen = true; waking = false; lastRx = Date.now();
  if (S.mode === 'connecting' || S.mode === 'offline') S.mode = 'remote';
  if (S.mode !== 'local') update();
}
function onServerMessage(m) {
  lastRx = Date.now(); clearTimeout(replyT); clearTimeout(pongT);
  if (m.type === 'state') { S.remote = m.state; if (S.mode !== 'local') update(); }
  else if (m.type === 'error') toast(m.message);
}
async function connectWS() {
  closeTransport();
  const pw = store.get('g42-pw') || '';
  try {   // a plain HTTP request first: it wakes a sleeping server and checks the password
    const r = typeof fetch !== 'function' ? { status: 200, ok: true } : await fetch('/auth?pw=' + encodeURIComponent(pw), { cache: 'no-store' });
    if (r.status === 401) { S.pwBad = !!pw; if (S.mode !== 'local') { S.mode = 'password'; update(); } return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (e) { goOffline('could not reach the server'); return; }
  if (tp === 'sse') openSSE(); else openWS();
}
function closeTransport() {
  const o = ws, e = es; ws = null; es = null;
  if (o) { o.onopen = o.onmessage = o.onclose = o.onerror = null; try { o.close(); } catch (x) { } }
  if (e) { e.onopen = e.onmessage = e.onerror = null; try { e.close(); } catch (x) { } }
}
function openWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let sock, gotState = false, openedAt = 0;
  try { sock = new WebSocket(proto + '//' + location.host + '/ws?' + qs()); } catch (e) { wsFailed('websocket unavailable'); return; }
  ws = sock;
  const giveUp = setTimeout(() => { if (!gotState && ws === sock) wsFailed('websocket did not answer'); }, 6000);
  sock.onopen = () => { openedAt = Date.now(); };
  sock.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.type === 'state' && !gotState) { gotState = true; clearTimeout(giveUp); wsFails = 0; connected(); }
    onServerMessage(m);
  };
  sock.onclose = ev => {
    clearTimeout(giveUp);
    if (ws !== sock) return;
    wsOpen = false;
    if (ev.code === 4001) { S.pwBad = true; if (S.mode !== 'local') { S.mode = 'password'; update(); } return; }
    if (!gotState || Date.now() - openedAt < 3000) wsFailed('websocket closed (' + ev.code + ')');
    else goOffline('websocket closed (' + ev.code + ')');
  };
}
function wsFailed(why) {
  closeTransport(); wsFails++;
  if (wsFails >= 2) { tp = 'sse'; lastIssue = why + '; switched to the plain-HTTP connection'; update(); }
  goOffline(why);
}
function openSSE() {
  let src;
  try { src = new EventSource('/events?' + qs()); } catch (e) { goOffline('http stream unavailable'); return; }
  es = src;
  src.onopen = () => connected();
  src.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } onServerMessage(m); };
  src.onerror = () => { if (es === src) { closeTransport(); goOffline('http stream dropped'); } };
}
/* watchdogs: a connection can die without the browser noticing */
function dropSocket() {
  clearTimeout(replyT); clearTimeout(pongT);
  closeTransport(); wsOpen = false;
  if (S.mode === 'remote') S.mode = 'offline';
  waking = false; if (S.mode !== 'local') update();
  setTimeout(connectWS, 400);
}
function checkAlive() {
  if (!wsOpen) return;
  if (tp === 'sse') { if (Date.now() - lastRx > 45000) dropSocket(); return; }
  if (!ws || ws.readyState !== 1) return;
  try { ws.send('{"type":"ping"}'); } catch (e) { dropSocket(); return; }
  clearTimeout(pongT); pongT = setTimeout(dropSocket, 6000);
}
setInterval(checkAlive, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkAlive(); });
window.addEventListener('online', checkAlive);

async function dispatch(action) {
  if (S.mode === 'local') {
    try {
      const next = reduce(S.local, action, S.actor);
      if (next) { S.local = next; update(); }
      return true;
    } catch (e) { toast(e.message || 'Something went wrong'); return false; }
  }
  if (!wsOpen) { toast('Not connected to the table. Reconnecting\u2026'); return false; }
  if (tp === 'sse') {
    try {
      const r = await fetch('/act?' + qs(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
      if (!r.ok) { let j = {}; try { j = await r.json(); } catch (e) { } toast(j.error || ('The table said no (' + r.status + ').')); return false; }
      return true;
    } catch (e) { toast('Could not reach the table. Reconnecting\u2026'); dropSocket(); return false; }
  }
  if (!ws || ws.readyState !== 1) { toast('Not connected to the table. Reconnecting\u2026'); return false; }
  try { ws.send(JSON.stringify({ type: 'action', action })); } catch (e) { dropSocket(); toast('Lost the connection. Reconnecting\u2026'); return false; }
  clearTimeout(replyT);
  replyT = setTimeout(() => { toast('The table isn\u2019t answering. Reconnecting, then try again.'); dropSocket(); }, 4500);
  return true;
}

/* ---------- host driver: bots and trick collection ---------- */
let driverT = null;
function drive() {
  clearTimeout(driverT);
  const s = cur();
  if (S.mode !== 'local' || !s || s.hostId !== S.actor.id) return;
  const v = s.v;
  const retry = ok => { if (!ok) setTimeout(drive, 1200); };
  if (s.phase === 'playing' && s.pending) {
    driverT = setTimeout(() => { const c = cur(); if (c && c.v === v) dispatch({ type: 'collect' }).then(retry); }, 1900);
    return;
  }
  const botTurn = (s.phase === 'bidding' && s.seats[s.turn].bot) || (s.phase === 'trump' && s.seats[s.contract.chooser].bot) ||
    (s.phase === 'playing' && !s.pending && s.seats[s.turn].bot);
  if (botTurn) {
    driverT = setTimeout(() => {
      const c = cur();
      if (!c || c.v !== v) return;
      const a = pendingBotAction(c);
      if (a) dispatch(a).then(retry);
    }, s.phase === 'playing' ? 850 : 1250);
  }
}

/* ---------- views ---------- */
const hostSeatIdx = s => (s.hostSeat != null ? s.hostSeat : s.seats.findIndex(p => p.id && p.id === s.hostId && !p.bot));
function teamLabel(s, t, base) { return t === team(base) ? 'Us' : 'Them'; }
function memberNames(s, t) { return [t, t + 2].map(i => esc(seatName(s, i))).join(' & '); }
function trumpName(tr) { return trumpLabel(tr); }
const suitWord = (sv) => sv === TR ? 'trump' : sv === 7 ? 'doubles' : SUIT_NAMES[sv];

function update() {
  const s = cur();
  render();
  const my = s ? seatOfId(s, S.actor.id) : -1;
  const myTurn = s && my >= 0 && ((s.phase === 'bidding' && s.turn === my) || (s.phase === 'trump' && s.contract.chooser === my) || (s.phase === 'playing' && !s.pending && s.turn === my));
  const foot = document.getElementById('foot');
  if (foot) foot.textContent = 'Build ' + BUILD + '. ' + (S.mode === 'local' ? 'Practice game, nothing is sent to the server.' : (wsOpen ? 'Connected by ' + (tp === 'sse' ? 'plain HTTP' : 'websocket') + '.' : 'Not connected' + (lastIssue ? ': ' + lastIssue + '.' : '.')));
  document.title = (myTurn ? '\u25CF Your turn \u2013 ' : '') + '42 with friends';
  drive();
}

function render() {
  const s = cur();
  $status.textContent = '';
  if (S.mode === 'connecting') {
    $app.innerHTML = '<div class="card empty"><h1>Pulling up a chair\u2026</h1><p>Connecting to the table.</p></div>';
    return;
  }
  if (S.mode === 'remote' && !s) {
    $app.innerHTML = '<div class="card empty"><h1>The table is empty</h1><p>Open it and you become the host: you choose the rules and deal. Then ask your friends to open this same link and take a seat.</p>' +
      '<div class="row" style="justify-content:center"><button class="btn primary" data-act="open">Open the table</button><button class="btn" data-act="practice">Practice against bots</button></div></div>';
    return;
  }
  if (S.mode === 'password') {
    $app.innerHTML = '<div class="card empty"><h1>This table is private</h1><p>' + (S.pwBad ? 'That password didn\u2019t work. Try again.' : 'Enter the table password your host gave you.') + '</p>' +
      '<div class="row" style="justify-content:center"><input id="pwin" type="password" autocomplete="current-password" aria-label="Table password" style="padding:9px 12px;border-radius:9px;border:1px solid var(--line);background:var(--panel-2);color:var(--text);font:inherit"> <button class="btn primary" data-act="pw">Join</button></div></div>';
    return;
  }
  if (S.mode === 'offline') {
    $app.innerHTML = '<div class="card empty"><h1>Waking the table\u2026</h1><p>' + (waking ? 'The server sleeps when nobody has played for a while, and takes up to a minute to wake. This page will connect on its own.' : 'Connecting\u2026') + '</p><button class="btn" data-act="practice">Practice against bots while you wait</button></div>';
    return;
  }
  if (s.phase === 'lobby') { $app.innerHTML = lobbyHTML(s); setStatus(s); return; }
  $app.innerHTML = gameHTML(s);
  setStatus(s);
}
function setStatus(s) {
  const bits = [];
  bits.push(S.mode === 'local' ? 'Practice game' : (wsOpen ? 'Shared table, connected' : 'Shared table'));
  if (s.phase !== 'lobby') bits.push('hand ' + s.handNo);
  const my = seatOfId(s, S.actor.id);
  if (s.hostId !== S.actor.id && my >= 0 && hostSeatIdx(s) >= 0) bits.push('host: ' + s.seats[hostSeatIdx(s)].name);
  $status.textContent = bits.join(', ');
}

/* --- lobby --- */
function lobbyHTML(s) {
  const my = seatOfId(s, S.actor.id), host = s.hostId === S.actor.id;
  const hostSeat = s.seats[hostSeatIdx(s)];
  let seats = '';
  for (let i = 0; i < 4; i++) {
    const p = s.seats[i], mine = p.id === S.actor.id && !p.bot, empty = !p.id;
    let btns = '';
    if (mine) btns = '<button class="btn small" data-act="leave">Stand up</button>';
    else if (empty || p.bot) btns = '<button class="btn small primary" data-act="sit" data-seat="' + i + '">' + (my >= 0 ? 'Move here' : 'Sit here') + '</button>';
    if (host && empty) btns += ' <button class="btn small" data-act="bot" data-seat="' + i + '" data-on="1">Add bot</button>';
    if (host && p.bot) btns += ' <button class="btn small" data-act="bot" data-seat="' + i + '" data-on="0">Remove bot</button>';
    seats += '<div class="seatcard t' + (i % 2) + (mine ? ' mine' : '') + ' sg-' + i + '"><div><div class="nm">' + (empty ? '<span class="muted">Open seat</span>' : esc(p.name) + (p.bot ? ' (bot)' : '') + (mine ? ' (you)' : '')) + '</div>' +
      '<div class="tag">' + (i === hostSeatIdx(s) ? 'Host' : 'Seat ' + (i + 1)) + '</div></div><div class="row" style="gap:6px">' + btns + '</div></div>';
  }
  const o = s.opts, dis = host ? '' : ' disabled';
  const sw = (k, label, hint) => '<label class="opt"><span>' + label + '<small>' + hint + '</small></span><input class="switch" type="checkbox" data-act="opt" data-key="' + k + '"' + (o[k] ? ' checked' : '') + dis + '></label>';
  const seg = [3, 5, 7, 10].map(n => '<button data-act="marks" data-n="' + n + '" aria-pressed="' + (o.marksToWin === n) + '"' + dis + '>' + n + '</button>').join('');
  const humans = s.seats.filter(p => p.id && !p.bot).length;
  return '<div class="lobby"><section class="card"><h2>Take a seat</h2><div class="seatgrid">' + seats +
    '<div class="sg-c">Partners sit across from each other</div></div>' +
    '<div class="row" style="margin-top:16px">' +
    (host ? '<button class="btn primary" data-act="start"' + (humans ? '' : ' disabled') + '>Deal the dominoes</button><span class="muted">Empty seats are filled with bots.</span>'
      : '<span class="muted">' + (hostSeat ? 'Waiting for ' + esc(hostSeat.name) + ' to deal.' : 'The host hasn\u2019t sat down yet.') + '</span>' + (my >= 0 ? ' <button class="btn small" data-act="takehost">Become host</button>' : '')) +
    '</div>' +
    (S.mode === 'remote' ? '<p class="muted" style="margin-bottom:0">Everyone with the link sees this table live. Bots are played by the server, so the game keeps going even if the host closes their tab.</p>' : '') +
    (S.mode === 'remote' ? '<div class="row" style="margin-top:6px"><button class="btn small ghost" data-act="practice">Practice alone instead</button></div>' : '<div class="row" style="margin-top:6px"><button class="btn small ghost" data-act="exit">Leave practice</button></div>') +
    '</section><section class="card"><h2>House rules</h2>' +
    '<div class="opt"><span>Marks to win<small>A made bid scores marks for your team.</small></span><span class="seg">' + seg + '</span></div>' +
    sw('bidHints', 'Bid suggestions', 'Shows each player a suggested bid on their turn, worked out from their own dominoes only. Players can also hide it for themselves.') +
    sw('playHints', 'Play hints and explanations', 'Suggests a domino with the reason, explains each trick in plain English, and shows count points on your dominoes. Based only on a player\u2019s own dominoes. Players can hide it for themselves.') +
    sw('forceDealer', 'Dealer must bid', 'If everyone passes, the dealer bids at least 30. Off means a redeal.') +
    sw('followMe', 'Follow me', 'Call no trump: highest end leads, doubles are high in their suit.') +
    sw('nello', 'Nello', 'Bid 1 or 2 marks and lose every trick. Your partner sits out. You choose how doubles count: own suit, high or low.') +
    sw('sevens', 'Sevens', 'Bid 1 or 2 marks and win every trick. Closest total to 7 wins; no following suit.') +
    sw('splash', 'Splash', 'Hold 3+ doubles: bid 2 or 3 marks. Partner calls trump and leads. Take every trick.') +
    sw('plunge', 'Plunge', 'Hold 4+ doubles: bid 4 or 5 marks. Partner calls trump and leads. Take every trick.') +
    (host ? '' : '<p class="muted" style="margin-bottom:0">Only the host can change rules.</p>') + '</section></div>';
}

/* --- game --- */
function plateHTML(s, seat, base) {
  const p = s.seats[seat], rel = (seat - base + 4) % 4, c = s.contract;
  const out = c && c.sitOut === seat;
  const turn = !out && ((s.phase === 'bidding' && s.turn === seat) || (s.phase === 'trump' && c.chooser === seat) || (s.phase === 'playing' && !s.pending && s.turn === seat));
  const sameTeam = seat % 2 === base % 2;
  let chips = '';
  if (seat === s.dealer) chips += '<span class="pill">Dealer</span>';
  if (s.phase === 'bidding') {
    const b = s.bids.find(x => x.seat === seat);
    chips += b ? (b.bid ? '<span class="pill gold">' + esc(bidLabel(b.bid)) + '</span>' : '<span class="pill">Pass</span>') : '';
  }
  if (c && c.seat === seat && s.phase !== 'bidding') chips += '<span class="pill gold">Bid ' + esc(bidLabel(c.bid)) + '</span>';
  if (out) chips += '<span class="pill">Sitting out</span>';
  const n = (s.hands[seat] || []).length;
  const backs = Array.from({ length: Math.min(n, 7) }, () => backSVG).join('');
  const who = seat === base ? 'You' : (sameTeam ? 'Partner' : 'Opponent');
  return '<div class="plate pos-' + rel + (turn ? ' turn' : '') + '"><div class="nm"><span class="dot t' + (seat % 2) + '"></span>' + esc(p.name) + '</div><div class="sub">' + who + (p.bot ? ' (bot)' : '') + (turn && p.bot ? ', thinking\u2026' : '') + '</div>' +
    '<div class="backs" aria-label="' + n + ' dominoes">' + backs + '</div><div class="chips">' + chips + '</div></div>';
}
function centerHTML(s, base) {
  const slots = [0, 1, 2, 3].map(rel => {
    const seat = (base + rel) % 4, pl = s.trick.find(x => x.seat === seat);
    const win = s.pending && s.trickWinner === seat;
    return '<div class="slot sl-' + rel + (pl ? ' filled' : '') + (win ? ' win' : '') + '">' + (pl ? tileSVG(pl.tile, 'trk-' + pl.tile) : '') + '</div>';
  }).join('');
  let mid = '';
  const c = s.contract;
  if (s.phase === 'bidding') mid = s.high ? '<b>' + esc(bidLabel(s.high.bid)) + '</b>High bid by ' + esc(seatName(s, s.high.seat)) : 'No bid yet';
  else if (s.phase === 'trump') mid = '<b>' + esc(bidLabel(c.bid)) + '</b>' + esc(seatName(s, c.chooser)) + (c.bid.kind === 'nello' ? ' is choosing how doubles count' : ' is calling trump');
  else if (s.phase === 'handover' || s.phase === 'gameover') mid = '<b>Hand over</b>' + (s.result.made ? 'Bid made' : 'Bid set');
  else if (c) mid = '<b>' + esc(trumpName(c.trump).replace(/ \(.*\)/, '')) + '</b>' + (s.pending ? esc(seatName(s, s.trickWinner)) + ' takes it' : 'Trick ' + Math.min(s.trickNo, 7) + ' of 7');
  return '<div class="center">' + slots + '<div class="mid">' + mid + '</div></div>';
}
function rackHTML(s, my, sug) {
  if (my < 0) return '';
  const hand = s.hands[my] || [], c = s.contract;
  const out = c && c.sitOut === my;
  const myTurn = s.phase === 'playing' && !s.pending && s.turn === my && !out;
  const legal = myTurn ? legalTiles(hand, s.trick, c.trump) : [];
  const badges = aidsOn(s) && s.phase !== 'lobby' && !(c && c.bid.kind === 'nello') && !(c && c.trump && c.trump.mode === 'sevens');
  const tiles = hand.map(t => {
    const ok = legal.includes(t), isSug = sug && sug.t === t;
    return '<button class="tile' + (ok ? ' playable' : (myTurn ? ' dim' : '')) + (isSug ? ' suggest' : '') + '" data-act="play" data-tile="' + t + '"' + (ok ? '' : ' disabled') + ' aria-label="' + tileName(t) + (countOf(t) && badges ? ', worth ' + countOf(t) + ' count points' : '') + (isSug ? ', suggested' : (ok ? ', playable' : '')) + '">' + tileSVG(t) +
      (badges && countOf(t) ? '<span class="cb" aria-hidden="true">' + countOf(t) + '</span>' : '') + '</button>';
  }).join('');
  return '<div class="rack' + (out ? ' out' : '') + '">' + (tiles || '<span style="color:#e9d9bf">No dominoes left</span>') + '</div>';
}
/* ---- suggested bid: worked out in this browser from your own dominoes and the bids so far, nothing else ---- */
let hintCache = null, hintPending = null;
const hintsAllowed = s => s.opts.bidHints !== false;      // the host's table-wide switch
const hintsOn = () => store.get('g42-hints') !== '0';      // each player's own switch
function getHint(s, my) {
  const key = s.handNo + ':' + s.bids.length + ':' + my + ':' + s.hands[my].join(',');
  if (hintCache && hintCache.key === key) return hintCache.val;
  if (hintPending !== key) {
    hintPending = key;
    setTimeout(() => {
      let val;
      try { val = analyzeBid(s, my); } catch (e) { val = { error: true }; }
      hintCache = { key, val }; hintPending = null; render();
    }, 30);
  }
  return null;
}
const learnAllowed = s => s.opts.playHints !== false;      // the host's table-wide switch for play hints + explanations
const aidsOn = s => learnAllowed(s) && hintsOn();           // ...and this player's own switch
const COUNT_TILES = ['55', '46', '05', '14', '23'];
const chipHTML2 = t => '<span class="mt">' + hi(t) + '<i>|</i>' + lo(t) + '</span>';
const chipHTML = (t, cls) => '<span class="mt cnt' + (cls ? ' ' + cls : '') + '" title="' + countOf(t) + ' count points">' + hi(t) + '<i>|</i>' + lo(t) + '<small>' + countOf(t) + '</small></span>';
function playWhyText(w, t, s, my) {
  const c = s.contract, tn = tileName(t), cnt = countOf(t), partner = seatName(s, (my + 2) % 4);
  const trickPts = 1 + s.trick.reduce((x, p) => x + countOf(p.tile), 0);
  const isDecl = c.seat === my;
  switch (w) {
    case 'only': return 'It\u2019s your only legal domino.';
    case 'lead-trump': return 'Lead your highest trump. Pulling out the other trumps early makes the rest of your dominoes safer.';
    case 'lead-boss': return 'Nothing still unplayed can beat it, so it should win the trick.' + (cnt ? ' It carries ' + cnt + ' count points, and you keep them.' : '');
    case 'lead-boss-trump': return 'Nothing still unplayed can beat this trump, so it should win the trick.';
    case 'lead-low': return 'You have no sure winner, so lead a weak domino with no count in it and see how the table answers.';
    case 'feed-last': return esc(partner) + ' is winning and you play last, so nothing can beat them. ' + (cnt ? 'Add the ' + tn + ' (' + cnt + ' count points) to their trick.' : 'You have no count to add, so play your weakest.');
    case 'feed-safe': return esc(partner) + ' is winning and looks safe. ' + (cnt ? 'Add the ' + tn + ' (' + cnt + ' count points) to their trick.' : 'You have no count to add, so play your weakest.');
    case 'partner-dump': return esc(partner) + ' is winning but could still be beaten, so play your cheapest domino and keep your count for a trick you will win.';
    case 'cheapest-win': return 'This is the cheapest domino that wins the trick, which keeps your stronger ones for later.' + (trickPts > 1 ? ' The trick already holds ' + trickPts + ' points.' : '');
    case 'cannot-win': return 'You can\u2019t win this trick, so give away your weakest domino and keep your count points safe.';
    case 'nello-lead': return isDecl ? 'You must lose every trick, so lead your lowest domino.' : 'The bidder must lose every trick, so lead low and let the bidder have to take one.';
    case 'nello-shed': return isDecl ? 'This is the highest domino you can play that still loses the trick, so you get rid of a dangerous one safely.' : 'Don\u2019t take this trick. You want the bidder to win one.';
    case 'nello-forced': return isDecl ? 'Every legal domino would win, so play the lowest one.' : 'Every legal domino would win, so play the lowest one.';
    case 'sevens-lead': return 'Lead the domino whose spots add closest to 7. It is the strongest you have.';
    case 'sevens-partner': return 'Your partner is already closest to 7, so play your farthest domino and save the good ones.';
    case 'sevens-beat-last': return 'You play last, so use the weakest domino that still gets closer to 7 than the current leader.';
    case 'sevens-beat': return 'Take the lead with the domino closest to 7, because others still have to play.';
    case 'sevens-dump': return 'You can\u2019t get closer to 7 than the current leader, so play your farthest domino.';
  }
  return '';
}
const pctWord = p => 'about ' + (Math.round(p * 20) * 5) + '%';
function hintInfo(s, my) {
  if (!hintsAllowed(s)) return { html: '', sug: null, pass: false };
  if (!hintsOn()) return { html: '<div class="row" style="margin:2px 0 8px"><button class="btn small ghost" data-act="hints">Show bid suggestion</button></div>', sug: null, pass: false };
  const h = getHint(s, my);
  if (!h) return { html: '<div class="note hint">Working out a suggestion\u2026</div>', sug: null, pass: false };
  if (h.error) return { html: '', sug: null, pass: false };
  let msg;
  if (h.pick) {
    const t = h.T ? ' with ' + esc(trumpLabel(h.T)) + ' as trump' : '';
    msg = (h.forced ? 'Everyone passed, so you must bid. ' : '') + 'Suggested bid: <b>' + esc(h.pick.kind === 'pts' ? h.pick.pts : bidLabel(h.pick)) + '</b>. In simulated deals it was made ' + pctWord(h.p) + ' of the time' + t + '.';
  } else {
    msg = 'Suggested: <b>pass</b>.' + (h.lowest ? ' Even a bid of ' + esc(h.lowest.bid.kind === 'pts' ? h.lowest.bid.pts : bidLabel(h.lowest.bid)) + ' was made only ' + pctWord(h.lowest.p) + ' of the time.' : '') + (h.partnerHigh ? ' Your partner already holds the bid.' : '');
  }
  return {
    html: '<div class="note hint">' + msg + '<div class="hintfoot">Based only on your own dominoes and the bids so far. <button class="linkish" data-act="hints">Hide</button></div></div>',
    sug: h.pick || null, pass: !h.pick
  };
}
function bidButtons(s, my, sug) {
  const av = availableBids(s.hands[my], s.high && s.high.bid, s.opts);
  const sg = b => (sug && sameBid(b, sug)) ? ' suggest' : '';
  const btn = b => '<button class="chip' + sg(b) + '" data-act="bid" data-kind="' + b.kind + '"' + (b.pts ? ' data-pts="' + b.pts + '"' : '') + (b.marks ? ' data-marks="' + b.marks + '"' : '') + '>' + esc(b.kind === 'pts' ? b.pts : bidLabel(b)) + '</button>';
  const pts = av.filter(b => b.kind === 'pts'), marks = av.filter(b => b.kind === 'marks');
  const spec = av.filter(b => !['pts', 'marks'].includes(b.kind));
  return (pts.length ? '<div class="bidrow"><span class="cap">Points</span>' + pts.map(btn).join('') + '</div>' : '') +
    (marks.length ? '<div class="bidrow"><span class="cap">All tricks</span>' + marks.map(b => '<button class="chip' + sg(b) + '" data-act="bid" data-kind="marks" data-marks="' + b.marks + '">' + (b.marks === 1 ? '42 (1 mark)' : '84 (2 marks)') + '</button>').join('') + '</div>' : '') +
    (spec.length ? '<div class="bidrow"><span class="cap">Specials</span>' + spec.map(btn).join('') + '</div>' : '');
}
function panelHTML(s, my, sug) {
  const c = s.contract;
  const wait = (txt) => '<div class="panel card"><p class="lead" style="margin:0">' + txt + '</p></div>';
  if (my < 0) {
    const bots = s.seats.map((p, i) => p.bot ? '<button class="btn small" data-act="sit" data-seat="' + i + '">Replace ' + esc(p.name) + ' (seat ' + (i + 1) + ')</button>' : '').join(' ');
    return '<div class="panel card"><p class="lead">You\u2019re watching</p>' + (bots ? '<p>Take over a bot\u2019s seat to join this game:</p><div class="row">' + bots + '</div>' : '<p>All seats are held by people.</p>') + '</div>';
  }
  if (s.phase === 'bidding') {
    if (s.turn !== my) return wait('Waiting for ' + esc(seatName(s, s.turn)) + ' to bid\u2026');
    const forced = s.opts.forceDealer && my === s.dealer && s.bids.length === 3 && !s.high;
    const hint = hintInfo(s, my);
    return '<div class="panel card"><p class="lead">Your bid</p>' + (s.high ? '<p>High bid: ' + esc(bidLabel(s.high.bid)) + ' by ' + esc(seatName(s, s.high.seat)) + '.</p>' : '<p>No bid yet. Bids start at 30.</p>') +
      (forced ? '<div class="note">Everyone passed. As dealer you must bid.</div>' : '') + hint.html +
      (forced ? '' : '<div class="bidrow"><span class="cap">Or</span><button class="chip pass' + (hint.pass ? ' suggest' : '') + '" data-act="bid" data-kind="pass">Pass</button></div>') +
      bidButtons(s, my, hint.sug) + '</div>';
  }
  if (s.phase === 'trump') {
    if (c.chooser !== my) return wait(esc(seatName(s, c.chooser)) + (c.bid.kind === 'nello' ? ' is choosing how doubles count\u2026' : ' is calling trump\u2026'));
    const hand = s.hands[my];
    if (c.bid.kind === 'nello') {
      const nd = (dbl, name, hint) => '<button class="chip trumpchip" data-act="trump" data-mode="nello" data-dbl="' + dbl + '">' + name + '<small>' + hint + '</small></button>';
      return '<div class="panel card"><p class="lead">How do doubles count?</p><p>You bid ' + esc(bidLabel(c.bid)) + ' and must lose every trick. Your partner sits out. Choose before you lead.</p><div class="bidrow">' +
        nd('suit', 'Own suit', 'a seventh suit, 6-6 down to 0-0') + nd('high', 'Doubles high', 'top of their own number') + nd('low', 'Doubles low', 'bottom of their own number') +
        '</div><p style="margin:0">You hold ' + hand.filter(isDbl).length + ' doubles.</p></div>';
    }
    const chips = SUIT_NAMES.map((nm, n) => {
      const k = hand.filter(t => lo(t) === n || hi(t) === n).length;
      return '<button class="chip trumpchip" data-act="trump" data-mode="suit" data-n="' + n + '">' + nm[0].toUpperCase() + nm.slice(1) + '<small>' + k + ' in hand</small></button>';
    }).join('') +
      '<button class="chip trumpchip" data-act="trump" data-mode="doubles">Doubles<small>' + hand.filter(isDbl).length + ' in hand</small></button>' +
      (s.opts.followMe ? '<button class="chip trumpchip" data-act="trump" data-mode="none">Follow me<small>no trump</small></button>' : '');
    const partner = c.seat !== my;
    return '<div class="panel card"><p class="lead">Call trump</p><p>' + (partner ? esc(seatName(s, c.seat)) + ' bid ' + esc(bidLabel(c.bid)) + ' and is counting on you. You call trump and lead.' : 'You won the bid at ' + esc(bidLabel(c.bid)) + '. Call trump, then lead.') + '</p><div class="bidrow">' + chips + '</div></div>';
  }
  if (s.phase === 'playing') {
    if (c.sitOut === my) return wait('You\u2019re sitting out this nello. Your partner plays alone.');
    if (s.pending) {
      const isNello = c.bid.kind === 'nello';
      let why = '';
      if (aidsOn(s)) {
        const lines = explainTrick(s.trick, c.trump, i => seatName(s, i), c.bid).map(l => '<li>' + esc(l) + '</li>').join('');
        const t = my % 2, tot = (isNello || c.trump.mode === 'sevens') ? '' : '<p class="muted" style="margin:6px 0 0">So far this hand: your team has ' + s.points[t] + ' of the 42 points, and they have ' + s.points[1 - t] + '.</p>';
        why = '<ul class="why">' + lines + '</ul>' + tot;
      }
      return '<div class="panel card"><p class="lead">' + esc(seatName(s, s.trickWinner)) + ' takes the trick</p>' +
        (isNello || c.trump.mode === 'sevens' ? '' : '<p>+' + s.trickPts + (s.trickPts === 1 ? ' point' : ' points') + ' for ' + (s.trickWinner % 2 === my % 2 ? 'your team' : 'their team') + '.</p>') + why +
        '<button class="btn primary" data-act="collect">Next trick</button></div>';
    }
    if (s.turn !== my) return wait('Waiting for ' + esc(seatName(s, s.turn)) + ' to play\u2026');
    const hand = s.hands[my], legal = legalTiles(hand, s.trick, c.trump);
    let hint = 'Pick a raised domino.';
    if (s.trick.length && c.trump.mode !== 'sevens') {
      const led = ledSuit(s.trick[0].tile, c.trump);
      hint = legal.length < hand.length ? 'You must follow ' + suitWord(led) + '.' : 'You can\u2019t follow ' + suitWord(led) + ', so any domino goes.';
    } else if (c.trump.mode === 'sevens') hint = 'Play the domino closest to a total of 7.';
    let aid = '';
    if (learnAllowed(s)) {
      if (!hintsOn()) aid = '<div class="row" style="margin-top:8px"><button class="btn small ghost" data-act="hints">Show suggestions</button></div>';
      else if (sug) aid = '<div class="note hint">Suggested: ' + chipHTML2(sug.t) + ' ' + playWhyText(sug.w, sug.t, s, my) + '<div class="hintfoot">A sensible play, not always the best one. Based only on your dominoes and what has been played. <button class="linkish" data-act="hints">Hide</button></div></div>';
    }
    return '<div class="panel card"><p class="lead">Your turn</p><p style="margin:0">' + hint + '</p>' + aid + '</div>';
  }
  if (s.phase === 'handover' || s.phase === 'gameover') {
    const r = s.result, d = esc(seatName(s, r.declarer));
    const line = d + (r.made ? ' made ' : ' was set on ') + esc(bidLabel(r.bid)) + '. ' + (r.team === my % 2 ? 'Your team' : 'Their team') + ' scores ' + r.marks + (r.marks === 1 ? ' mark.' : ' marks.');
    const breakdown = (() => {
      const me = my % 2, ot = 1 - me;
      let h = '';
      if (r.bid.kind === 'pts') {
        const row = (t, name) => '<li>' + name + ': ' + r.tricks[t] + (r.tricks[t] === 1 ? ' trick' : ' tricks') + ' (' + r.tricks[t] + ' ' + (r.tricks[t] === 1 ? 'point' : 'points') + ') + ' + (r.points[t] - r.tricks[t]) + ' from count dominoes = <b>' + r.points[t] + '</b></li>';
        const dt = r.declarer % 2;
        h = '<ul class="why">' + row(me, 'Us') + row(ot, 'Them') + '<li>' + (dt === me ? 'We' : 'They') + ' needed ' + r.bid.pts + ' and scored ' + r.points[dt] + (r.made ? ', so the bid was made.' : ', so the bid was set.') + '</li></ul>';
      } else if (r.bid.kind === 'nello') {
        h = '<ul class="why"><li>Nello is about tricks, not points. The bidder won ' + r.tricks[r.declarer % 2] + (r.tricks[r.declarer % 2] === 1 ? ' trick.' : ' tricks.') + '</li></ul>';
      } else {
        h = '<ul class="why"><li>This bid needs every trick. The bidding team won ' + r.tricks[r.declarer % 2] + ' of the ' + r.played + ' played.</li></ul>';
      }
      if (r.played < 7) h += '<p class="muted" style="margin:4px 0 8px">The hand stopped after trick ' + r.played + ' because the result was already decided.</p>';
      return h;
    })();
    if (s.phase === 'handover') return '<div class="panel card"><p class="lead">' + line + '</p>' + breakdown + '<button class="btn primary" data-act="next">Deal next hand</button></div>';
    const won = s.marks[my % 2] >= s.opts.marksToWin;
    return '<div class="panel card"><p class="lead">' + (won ? 'Your team wins, ' : 'Their team wins, ') + Math.max(s.marks[0], s.marks[1]) + ' to ' + Math.min(s.marks[0], s.marks[1]) + '</p><p>' + line + '</p>' + breakdown +
      (s.hostId === S.actor.id ? '<div class="row"><button class="btn primary" data-act="start">Play again</button><button class="btn" data-act="lobby">Back to the lobby</button></div>' : '<p>Waiting for the host to start another game.</p>') + '</div>';
  }
  return '';
}
function sideHTML(s, base) {
  const me = base % 2, other = 1 - me;
  const chip = (t, win) => '<span class="mt' + (win ? ' w' : '') + (countOf(t) ? ' cnt' : '') + '">' + hi(t) + '<i>|</i>' + lo(t) + '</span>';
  const wonBy = t => (s.taken || []).filter(k => k.winner % 2 === t);
  const tricksHTML = t => {
    const won = wonBy(t);
    if (!won.length) return '';
    return '<details class="won" open><summary>Tricks won this hand: ' + won.length + '</summary>' + won.map(k =>
      '<div class="trk"><span class="chips-row">' + k.plays.map(p => '<span title="' + esc(seatName(s, p.seat)) + '">' + chip(p.tile, p.seat === k.winner) + '</span>').join('') +
      '</span><em>' + esc(seatName(s, k.winner)) + ' +' + k.pts + '</em></div>').join('') + '</details>';
  };
  const row = (t) => '<div class="srow"><div class="tn"><span class="dot t' + t + '"></span>' + (t === me ? 'Us' : 'Them') + '</div><div class="num">' + s.marks[t] + '</div><div class="mem">' + memberNames(s, t) + '</div><div class="tally">' + tallySVG(s.marks[t]) + '</div>' + tricksHTML(t) + '</div>';
  const slate = '<div class="slate"><div class="goal">First to ' + s.opts.marksToWin + ' marks</div>' + row(me) + row(other) + '</div>';
  const c = s.contract, tot = s.points[0] + s.points[1];
  let hb = '';
  if (c) {
    const dt = c.seat % 2;
    const need = c.bid.kind === 'pts' ? 'need ' + c.bid.pts + ' points' : c.bid.kind === 'nello' ? 'must lose every trick' : 'must win every trick';
    hb = '<div class="card handbox"><div class="line"><span class="k">Contract</span><b>' + esc(seatName(s, c.seat)) + ', ' + esc(bidLabel(c.bid)) + '</b></div>' +
      '<div class="line"><span class="k">Goal</span><span>' + (dt === me ? 'We' : 'They') + ' ' + need + '</span></div>' +
      (c.trump ? '<div class="line"><span class="k">Trump</span><span>' + esc(trumpName(c.trump)) + '</span></div>' : '') +
      (s.phase === 'playing' && aidsOn(s) && !['nello', 'sevens'].includes(c.bid.kind) ? '<div class="line"><span class="k">Still to win</span><span>' + (42 - s.points[0] - s.points[1]) + ' points</span></div>' + (() => {
        const out = COUNT_TILES.filter(t => !(s.played || []).includes(t));
        const mine = s.hands[base] || [];
        return '<div class="line" style="align-items:flex-start"><span class="k">Count still out</span><span class="chips-row" style="flex-wrap:wrap;justify-content:flex-end">' + (out.length ? out.map(t => chipHTML(t, mine.includes(t) ? 'mine' : '')).join('') : '<span class="muted">none</span>') + '</span></div>' + (out.some(t => mine.includes(t)) ? '<div class="muted" style="font-size:12px;text-align:right">Outlined: in your hand</div>' : '');
      })() : '') +
      (s.phase === 'playing' || s.phase === 'handover' || s.phase === 'gameover' ? '<div class="line"><span class="k">Points</span><span>Us ' + s.points[me] + ', them ' + s.points[other] + '</span></div><div class="bar" aria-hidden="true"><i class="a" style="width:' + (s.points[me] / 42 * 100) + '%"></i><i class="b" style="width:' + (s.points[other] / 42 * 100) + '%;margin-left:auto"></i></div>' : '') +
      '</div>';
  }
  const last = s.lastTrick && s.phase === 'playing' ? '<div class="last" aria-label="Last trick">' + s.lastTrick.plays.map(p => tileSVG(p.tile)).join('') + '<span class="muted" style="font-size:12.5px">Last trick: ' + esc(seatName(s, s.lastTrick.winner)) + '</span></div>' : '';
  const log = '<div class="card"><div class="log" aria-live="polite">' + s.log.slice(-9).map(l => '<div>' + esc(l) + '</div>').join('') + '</div>' + last + '</div>';
  const host = (s.hostId !== S.actor.id && seatOfId(s, S.actor.id) >= 0) ? '<button class="btn small ghost" data-act="takehost">Take over as host</button>' : '';
  return '<aside class="side">' + slate + hb + log + host + '</aside>';
}
function gameHTML(s) {
  const my = seatOfId(s, S.actor.id), base = my >= 0 ? my : 0;
  const plates = [1, 2, 3].map(r => plateHTML(s, (base + r) % 4, base)).join('');
  const board = '<div class="board">' + plates + centerHTML(s, base) + '</div>';
  const meBar = my >= 0 ? '<div class="row" style="margin-top:12px"><span class="dot t' + (my % 2) + '"></span><b>' + esc(s.seats[my].name) + '</b><span class="muted">' + (my === s.dealer ? 'dealer' : '') + '</span></div>' : '';
  const me = base % 2;
  const mini = '<div class="minibar"><span><span class="dot t' + me + '"></span>Us<b>' + s.marks[me] + '</b></span><span><span class="dot t' + (1 - me) + '"></span>Them<b>' + s.marks[1 - me] + '</b></span><span class="tg">First to ' + s.opts.marksToWin + '</span></div>';
  let sug = null;
  if (my >= 0 && aidsOn(s) && s.phase === 'playing' && !s.pending && s.turn === my && !(s.contract && s.contract.sitOut === my)) {
    try { sug = suggestPlay(s, my); } catch (e) { sug = null; }
  }
  return '<div class="wrap"><div>' + mini + board + meBar + rackHTML(s, my, sug) + panelHTML(s, my, sug) + '</div>' + sideHTML(s, base) + '</div>';
}

/* ---------- events ---------- */
$app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || el.tagName === 'INPUT') return;
  const d = el.dataset, s = cur(), my = s ? seatOfId(s, S.actor.id) : -1;
  switch (d.act) {
    case 'open': dispatch({ type: 'init' }); break;
    case 'pw': { const v = (document.getElementById('pwin') || {}).value || ''; store.set('g42-pw', v); S.mode = 'connecting'; update(); wsFails = 0; connectWS(); break; }
    case 'practice': startPractice(); break;
    case 'exit': exitPractice(); break;
    case 'sit': dispatch({ type: 'claim', seat: +d.seat, name: getName() }); break;
    case 'leave': dispatch({ type: 'leave' }); break;
    case 'bot': dispatch({ type: 'bot', seat: +d.seat, on: d.on === '1' }); break;
    case 'marks': dispatch({ type: 'opts', opts: { marksToWin: +d.n } }); break;
    case 'start': dispatch({ type: 'start' }); break;
    case 'lobby': dispatch({ type: 'toLobby' }); break;
    case 'takehost': dispatch({ type: 'takeHost' }); break;
    case 'bid':
      dispatch({ type: 'bid', seat: my, bid: d.kind === 'pass' ? null : (d.kind === 'pts' ? { kind: 'pts', pts: +d.pts } : { kind: d.kind, marks: +d.marks }) }); break;
    case 'trump':
      dispatch({ type: 'trump', seat: my, trump: d.mode === 'suit' ? { mode: 'suit', n: +d.n } : d.mode === 'nello' ? { mode: 'nello', dbl: d.dbl } : { mode: d.mode } }); break;
    case 'play': dispatch({ type: 'play', seat: my, tile: d.tile }); break;
    case 'collect': dispatch({ type: 'collect' }); break;
    case 'hints': store.set('g42-hints', hintsOn() ? '0' : '1'); render(); break;
    case 'next': dispatch({ type: 'nextHand' }); break;
  }
});
$app.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target && e.target.id === 'pwin') { const b = $app.querySelector('[data-act=pw]'); if (b) b.click(); }
});
$app.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset && el.dataset.act === 'opt') dispatch({ type: 'opts', opts: { [el.dataset.key]: el.checked } });
});

function startPractice() {
  S.mode = 'local'; S.actor = { id: 'local' };
  let s = reduce(null, { type: 'init' }, S.actor);
  s = reduce(s, { type: 'claim', seat: 0, name: getName() }, S.actor);
  s = reduce(s, { type: 'start' }, S.actor);
  S.local = s; update();
}
function exitPractice() {
  clearTimeout(driverT);
  S.local = null; S.actor = { id: S.realId };
  S.mode = wsOpen ? 'remote' : 'offline';
  update();
}


/* ---------- cheat sheet and counting drill ---------- */
const csDlg = document.getElementById('cheat'), csBody = document.getElementById('cheatBody');
const fig = (t, top, cap) => '<div class="cs-tile">' + tileSVG(t) + '<div><b>' + top + '</b></div><div>' + cap + '</div></div>';
function cheatHTML() {
  const rank = ['33', '36', '35', '34', '23', '13', '03'].map(t => tileSVG(t)).join('<span class="gt">&gt;</span>');
  return '<h2>Cheat sheet</h2>' +
    '<h3>Counting: every hand is worth 42 points</h3>' +
    '<div class="cs-tiles">' + fig('55', '10', '5-5') + fig('46', '10', '6-4') + fig('05', '5', '5-0') + fig('14', '5', '4-1') + fig('23', '5', '3-2') + '</div>' +
    '<p>These five <b>count dominoes</b> are worth 35 points between them. Each of the 7 tricks is worth 1 more point, so 35 + 7 = 42. A trick is worth <b>1 point plus the count dominoes in it</b>. Every other domino is worth nothing by itself. A quick way to spot them: a count domino’s spots add up to 5 or 10.</p>' +
    '<h3>Bidding and marks</h3>' +
    '<p>A bid is a promise: <b>“my team will win at least this many of the 42 points.”</b> Make it and your team scores 1 mark. Miss it (called getting <b>set</b>) and the other team scores the mark. A bid of 42 or 84 means winning every trick for 1 or 2 marks. First team to 7 marks wins.</p>' +
    '<h3>Who wins a trick</h3>' +
    '<ol style="margin:4px 0;padding-left:20px"><li>The domino led sets the suit by its <b>higher end</b> (a double sets its own number).</li><li>Follow suit if you can. <b>Either end</b> counts, so with threes led, 3-6 and 1-3 are threes.</li><li>A <b>trump</b> beats everything else. Otherwise the highest of the led suit wins.</li></ol>' +
    '<p style="margin-bottom:2px">Inside a suit the double is highest, then dominoes rank by their <b>other end</b>. Threes, high to low:</p><div class="cs-rank">' + rank + '</div>' +
    '<h3>Trump</h3><p>The team that wins the bid picks trump. A domino with the trump number on either end is a trump, and it follows nothing but trump. The double of the trump number is the top trump, then the rest rank by their other end.</p>' +
    '<h3>Suit names</h3><table class="cs-table"><tr><td>0 blanks</td><td>1 aces</td><td>2 deuces</td><td>3 treys</td></tr><tr><td>4 fours</td><td>5 fives</td><td>6 sixes</td><td></td></tr></table>' +
    '<h3>Counting drill</h3><p style="margin-top:0">How many points would the winner of each trick collect?</p><div class="drill" id="drill"></div>';
}
const drill = { n: 0, score: 0, cur: null, picked: null };
function drillNew() {
  const shuffled = a => a.slice().sort(() => Math.random() - 0.5);
  const k = [0, 1, 1, 1, 1, 2, 2, 2, 3][Math.floor(Math.random() * 9)];
  const tiles = shuffled(shuffled(COUNT_TILES).slice(0, k).concat(shuffled(ALL.filter(t => !COUNT_TILES.includes(t))).slice(0, 4 - k)));
  const pts = 1 + tiles.reduce((x, t) => x + countOf(t), 0);
  const wrong = shuffled([pts - 1, pts + 5, pts - 5, pts + 10, pts + 1].filter(v => v >= 1 && v !== pts)).slice(0, 3);
  drill.cur = { tiles, pts, opts: shuffled([pts].concat(wrong)) }; drill.picked = null;
}
function drillHTML() {
  if (drill.n >= 5) return '<p style="text-align:center;margin:6px 0"><b>You got ' + drill.score + ' of 5.</b> ' + (drill.score === 5 ? 'Nice counting.' : 'Run it again, it gets quick.') + '</p><div class="row" style="justify-content:center"><button class="btn primary" data-drill="again">Try again</button></div>';
  const c = drill.cur, counts = c.tiles.filter(t => countOf(t) > 0);
  const sum = '1 for the trick' + (counts.length ? ' + ' + counts.map(t => tileName(t) + ' (' + countOf(t) + ')').join(' + ') : ' and no count dominoes') + ' = ' + c.pts;
  let h = '<div class="cs-tiles">' + c.tiles.map(t => '<div class="cs-tile">' + tileSVG(t) + '</div>').join('') + '</div><p style="text-align:center;margin:0 0 2px">Question ' + (drill.n + 1) + ' of 5</p>';
  if (drill.picked == null) h += '<div class="opts">' + c.opts.map(v => '<button class="chip" data-drill="pick" data-v="' + v + '">' + v + '</button>').join('') + '</div>';
  else h += '<p style="text-align:center;margin:8px 0"><span class="' + (drill.picked === c.pts ? 'ok">Right.' : 'no">Not quite.') + '</span> ' + sum + '.</p><div class="row" style="justify-content:center"><button class="btn primary" data-drill="next">' + (drill.n >= 4 ? 'See my score' : 'Next trick') + '</button></div>';
  return h;
}
function drillRender() { const d = document.getElementById('drill'); if (d) d.innerHTML = drillHTML(); }
document.getElementById('cheatBtn').addEventListener('click', () => {
  if (!csBody.innerHTML) csBody.innerHTML = cheatHTML();
  drill.n = 0; drill.score = 0; drillNew(); drillRender();
  csDlg.showModal();
});
document.getElementById('cheatClose').addEventListener('click', () => csDlg.close());
csDlg.addEventListener('click', e => {
  const b = e.target.closest('[data-drill]'); if (!b) return;
  const act = b.dataset.drill;
  if (act === 'pick' && drill.picked == null) { drill.picked = +b.dataset.v; if (drill.picked === drill.cur.pts) drill.score++; }
  else if (act === 'next') { drill.n++; if (drill.n < 5) drillNew(); drill.picked = null; }
  else if (act === 'again') { drill.n = 0; drill.score = 0; drillNew(); }
  drillRender();
});

/* ---------- boot ---------- */
document.getElementById('rulesBtn').addEventListener('click', () => document.getElementById('rules').showModal());
document.getElementById('rulesClose').addEventListener('click', () => document.getElementById('rules').close());

function boot() {
  let id = store.get('g42-id');
  if (!id || !/^[A-Za-z0-9_-]{8,40}$/.test(id)) { const rnd = (window.crypto && crypto.getRandomValues) ? Array.from(crypto.getRandomValues(new Uint8Array(12))) : Array.from({ length: 12 }, () => Math.floor(Math.random() * 256));
    id = 'g' + rnd.map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 20); store.set('g42-id', id); }
  S.realId = id; S.actor = { id };
  update();
  connectWS();
}
boot();
