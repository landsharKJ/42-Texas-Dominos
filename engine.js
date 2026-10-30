/* ===================== 42 ENGINE (pure, no DOM) ===================== */
const ALL = (() => { const t = []; for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) t.push('' + a + b); return t; })();
const TR = 9; // marker: "this domino is a trump"
const SUIT_NAMES = ['blanks', 'aces', 'deuces', 'treys', 'fours', 'fives', 'sixes'];
const lo = t => t.charCodeAt(0) - 48;
const hi = t => t.charCodeAt(1) - 48;
const isDbl = t => t[0] === t[1];
const pipsOf = t => lo(t) + hi(t);
const countOf = t => { const p = pipsOf(t); return p === 5 ? 5 : p === 10 ? 10 : 0; };
const team = seat => seat % 2;
const sortHand = h => h.sort((x, y) => (hi(y) * 10 + lo(y)) - (hi(x) * 10 + lo(x)));
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---- suits, ranks, tricks ---- */
function suitOf(t, tr) {
  const a = lo(t), b = hi(t);
  switch (tr.mode) {
    case 'suit': return (a === tr.n || b === tr.n) ? TR : b;
    case 'doubles': return a === b ? TR : b;
    case 'nello': return a === b ? 7 : b;
    case 'sevens': return 0;
    default: return b; // 'none' (follow me): doubles are high in their own number
  }
}
function rankOf(t, tr) {
  const a = lo(t), b = hi(t);
  if (tr.mode === 'suit' && (a === tr.n || b === tr.n)) return a === b ? 100 : (a === tr.n ? b : a);
  if ((tr.mode === 'doubles' || tr.mode === 'nello') && a === b) return a;
  return a === b ? 10 : a;
}
const powerOf = (t, tr) => (suitOf(t, tr) === TR ? 100 : 0) + rankOf(t, tr);
const sevenDist = t => Math.abs(pipsOf(t) - 7);

function trickWinner(plays, tr) {
  if (tr.mode === 'sevens') {
    let best = plays[0];
    for (const p of plays) if (sevenDist(p.tile) < sevenDist(best.tile)) best = p;
    return best.seat;
  }
  const led = suitOf(plays[0].tile, tr);
  const want = plays.some(p => suitOf(p.tile, tr) === TR) ? TR : led;
  let best = null;
  for (const p of plays) {
    if (suitOf(p.tile, tr) !== want) continue;
    if (!best || rankOf(p.tile, tr) > rankOf(best.tile, tr)) best = p;
  }
  return best.seat;
}
function legalTiles(hand, trick, tr) {
  if (tr.mode === 'sevens' || !trick.length) return hand.slice();
  const led = suitOf(trick[0].tile, tr);
  const f = hand.filter(t => suitOf(t, tr) === led);
  return f.length ? f : hand.slice();
}

/* ---- bids ---- */
const bidValue = b => b.kind === 'pts' ? b.pts : b.marks * 42;
const bidMarks = b => b.kind === 'pts' ? 1 : b.marks;
const sameBid = (x, y) => x && y && x.kind === y.kind && x.pts === y.pts && x.marks === y.marks;
function bidLabel(b) {
  const m = n => n + (n === 1 ? ' mark' : ' marks');
  switch (b.kind) {
    case 'pts': return '' + b.pts;
    case 'marks': return m(b.marks);
    case 'nello': return 'Nello, ' + m(b.marks);
    case 'sevens': return 'Sevens, ' + m(b.marks);
    case 'splash': return 'Splash, ' + m(b.marks);
    case 'plunge': return 'Plunge, ' + m(b.marks);
  }
  return '?';
}
function availableBids(hand, high, opts) {
  const floor = high ? bidValue(high) : 29;
  const out = [];
  for (let p = 30; p <= 41; p++) out.push({ kind: 'pts', pts: p });
  for (const m of [1, 2]) out.push({ kind: 'marks', marks: m });
  const dbl = hand.filter(isDbl).length;
  if (opts.nello) for (const m of [1, 2]) out.push({ kind: 'nello', marks: m });
  if (opts.sevens) for (const m of [1, 2]) out.push({ kind: 'sevens', marks: m });
  if (opts.splash && dbl >= 3) for (const m of [2, 3]) out.push({ kind: 'splash', marks: m });
  if (opts.plunge && dbl >= 4) for (const m of [4, 5]) out.push({ kind: 'plunge', marks: m });
  return out.filter(b => bidValue(b) > floor);
}
function trumpLabel(tr) {
  if (!tr) return '';
  switch (tr.mode) {
    case 'suit': return SUIT_NAMES[tr.n];
    case 'doubles': return 'doubles';
    case 'none': return 'follow me (no trump)';
    case 'nello': return 'nello (doubles are their own suit)';
    case 'sevens': return 'sevens';
  }
}

/* ---- table state ---- */
const DEFAULT_OPTS = { marksToWin: 7, forceDealer: true, nello: true, splash: true, plunge: true, followMe: true, sevens: true };
function newTable(hostId) {
  return {
    v: 0, phase: 'lobby', hostId, opts: Object.assign({}, DEFAULT_OPTS),
    seats: [0, 1, 2, 3].map(() => ({ id: null, name: '', bot: false })),
    marks: [0, 0], handNo: 0, dealer: 0, turn: 0, hands: {}, bids: [], high: null,
    contract: null, trick: [], trickNo: 0, pending: false, trickWinner: -1, trickPts: 0,
    points: [0, 0], tricks: [0, 0], played: [], lastTrick: null, result: null, log: []
  };
}
const seatName = (s, i) => (s.seats[i] && s.seats[i].name) || ('Seat ' + (i + 1));
function say(s, msg) { s.log.push(msg); if (s.log.length > 40) s.log.shift(); }
const BOT_NAMES = ['Dusty', 'Juniper', 'Pecos', 'Wrangler'];

function startHand(s) {
  s.handNo++;
  const d = shuffle(ALL.slice());
  s.hands = {};
  for (let i = 0; i < 4; i++) s.hands[i] = sortHand(d.slice(i * 7, i * 7 + 7));
  s.phase = 'bidding'; s.bids = []; s.high = null; s.turn = (s.dealer + 1) % 4;
  s.contract = null; s.trick = []; s.trickNo = 0; s.pending = false; s.trickWinner = -1; s.trickPts = 0;
  s.points = [0, 0]; s.tricks = [0, 0]; s.played = []; s.lastTrick = null; s.result = null;
  say(s, 'Hand ' + s.handNo + ': ' + seatName(s, s.dealer) + ' deals.');
}
function startPlay(s, leader) {
  s.phase = 'playing'; s.turn = leader; s.trick = []; s.trickNo = 1; s.pending = false;
  say(s, seatName(s, leader) + ' leads.');
}
const nextSeat = (s, from) => {
  let n = (from + 1) % 4;
  if (s.contract && s.contract.sitOut === n) n = (n + 1) % 4;
  return n;
};
function finishBidding(s) {
  if (!s.high) {
    say(s, 'Everyone passed. New deal.');
    s.dealer = (s.dealer + 1) % 4; startHand(s); return;
  }
  const d = s.high.seat, b = s.high.bid;
  s.contract = { seat: d, bid: b, trump: null, chooser: d, sitOut: null };
  say(s, seatName(s, d) + ' wins the bid at ' + bidLabel(b) + '.');
  if (b.kind === 'nello') { s.contract.trump = { mode: 'nello' }; s.contract.sitOut = (d + 2) % 4; startPlay(s, d); return; }
  if (b.kind === 'sevens') { s.contract.trump = { mode: 'sevens' }; startPlay(s, d); return; }
  if (b.kind === 'splash' || b.kind === 'plunge') s.contract.chooser = (d + 2) % 4;
  s.phase = 'trump'; s.turn = s.contract.chooser;
}
function outcome(s) {
  const c = s.contract, b = c.bid, dt = team(c.seat), ot = 1 - dt;
  const done7 = s.tricks[0] + s.tricks[1] >= 7;
  if (b.kind === 'pts') {
    const rem = 42 - s.points[0] - s.points[1];
    if (s.points[dt] >= b.pts) return { done: true, made: true };
    if (s.points[dt] + rem < b.pts) return { done: true, made: false };
    return { done: false };
  }
  if (b.kind === 'nello') {
    if (s.tricks[dt] > 0) return { done: true, made: false };
    return done7 ? { done: true, made: true } : { done: false };
  }
  if (s.tricks[ot] > 0) return { done: true, made: false };
  if (s.tricks[dt] >= 7) return { done: true, made: true };
  return { done: false };
}
function canAct(s, seat, actor) {
  const p = s.seats[seat];
  if (!p) return false;
  return p.bot ? actor.id === s.hostId : p.id === actor.id;
}
const cleanName = n => (String(n || '').replace(/[<>&"]/g, '').trim().slice(0, 14)) || 'Player';
const seatOfId = (s, id) => s.seats.findIndex(p => p.id && p.id === id && !p.bot);

/* The one function every client uses to change the table. Returns a new state, or null for "nothing to do". */
function reduce(state, action, actor) {
  if (action.type === 'init') return state ? null : newTable(actor.id);
  if (!state) throw new Error('No table yet');
  const s = JSON.parse(JSON.stringify(state));
  const isHost = actor.id === s.hostId;
  const me = seatOfId(s, actor.id);
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };
  switch (action.type) {
    case 'claim': {
      const i = action.seat;
      need(Number.isInteger(i) && i >= 0 && i < 4, 'Bad seat');
      if (s.phase === 'lobby') {
        need(!s.seats[i].id || s.seats[i].bot || s.seats[i].id === actor.id, 'Seat taken');
        if (me >= 0 && me !== i) s.seats[me] = { id: null, name: '', bot: false };
      } else {
        need(me < 0, 'You already have a seat');
        need(s.seats[i].bot, 'Only a bot seat can be taken over mid-game');
      }
      s.seats[i] = { id: actor.id, name: cleanName(action.name), bot: false };
      if (!s.hostId || (s.seats.every(p => !p.id || p.bot || p.id === actor.id) && s.phase === 'lobby')) s.hostId = s.hostId || actor.id;
      say(s, cleanName(action.name) + ' sits at seat ' + (i + 1) + '.');
      break;
    }
    case 'leave': {
      need(s.phase === 'lobby', 'Game already started');
      need(me >= 0, 'You are not seated');
      s.seats[me] = { id: null, name: '', bot: false };
      break;
    }
    case 'bot': {
      need(isHost && s.phase === 'lobby', 'Only the host can do that in the lobby');
      const i = action.seat;
      need(Number.isInteger(i) && i >= 0 && i < 4, 'Bad seat');
      if (action.on) { need(!s.seats[i].id || s.seats[i].bot, 'Seat taken'); s.seats[i] = { id: 'bot' + i, name: BOT_NAMES[i], bot: true }; }
      else { need(s.seats[i].bot, 'Not a bot'); s.seats[i] = { id: null, name: '', bot: false }; }
      break;
    }
    case 'opts': {
      need(isHost && s.phase === 'lobby', 'Only the host can change rules');
      const o = action.opts || {};
      for (const k of Object.keys(DEFAULT_OPTS)) if (k in o) s.opts[k] = k === 'marksToWin' ? Math.max(1, Math.min(10, o[k] | 0)) : !!o[k];
      break;
    }
    case 'takeHost': {
      need(me >= 0, 'Sit down first');
      s.hostId = actor.id; break;
    }
    case 'toLobby': {
      need(isHost, 'Only the host can do that');
      s.phase = 'lobby'; s.marks = [0, 0]; s.handNo = 0; s.contract = null; s.result = null; s.trick = []; s.hands = {};
      break;
    }
    case 'start': {
      need(isHost && (s.phase === 'lobby' || s.phase === 'gameover'), 'Only the host can start');
      need(s.seats.some(p => p.id && !p.bot), 'Need at least one person seated');
      s.seats = s.seats.map((p, i) => p.id ? p : { id: 'bot' + i, name: BOT_NAMES[i], bot: true });
      s.marks = [0, 0]; s.handNo = 0; s.log = [];
      s.dealer = Math.floor(Math.random() * 4);
      startHand(s);
      break;
    }
    case 'bid': {
      need(s.phase === 'bidding', 'Not bidding now');
      const seat = action.seat;
      need(seat === s.turn, 'Not your turn');
      need(canAct(s, seat, actor), 'Not your seat');
      const forced = s.opts.forceDealer && seat === s.dealer && s.bids.length === 3 && !s.high;
      if (action.bid == null) {
        need(!forced, 'Everyone passed. As dealer you must bid.');
        s.bids.push({ seat, bid: null });
        say(s, seatName(s, seat) + ' passes.');
      } else {
        const ok = availableBids(s.hands[seat], s.high && s.high.bid, s.opts).some(b => sameBid(b, action.bid));
        need(ok, 'That bid is not available');
        s.bids.push({ seat, bid: action.bid });
        s.high = { seat, bid: action.bid };
        say(s, seatName(s, seat) + ' bids ' + bidLabel(action.bid) + '.');
      }
      if (s.bids.length === 4) finishBidding(s); else s.turn = (s.turn + 1) % 4;
      break;
    }
    case 'trump': {
      need(s.phase === 'trump', 'Not choosing trump');
      need(action.seat === s.contract.chooser, 'Not your choice');
      need(canAct(s, action.seat, actor), 'Not your seat');
      const t = action.trump;
      const ok = t && ((t.mode === 'suit' && Number.isInteger(t.n) && t.n >= 0 && t.n <= 6) || t.mode === 'doubles' || (t.mode === 'none' && s.opts.followMe));
      need(ok, 'Invalid trump');
      s.contract.trump = t.mode === 'suit' ? { mode: 'suit', n: t.n } : { mode: t.mode };
      say(s, seatName(s, action.seat) + ' calls ' + trumpLabel(s.contract.trump) + '.');
      startPlay(s, action.seat);
      break;
    }
    case 'play': {
      need(s.phase === 'playing' && !s.pending, 'Cannot play now');
      const seat = action.seat;
      need(seat === s.turn, 'Not your turn');
      need(canAct(s, seat, actor), 'Not your seat');
      const hand = s.hands[seat], tr = s.contract.trump;
      need(hand.includes(action.tile), 'You do not hold that domino');
      need(legalTiles(hand, s.trick, tr).includes(action.tile), 'You must follow suit');
      hand.splice(hand.indexOf(action.tile), 1);
      s.trick.push({ seat, tile: action.tile }); s.played.push(action.tile);
      const active = s.contract.sitOut == null ? 4 : 3;
      if (s.trick.length === active) {
        const w = trickWinner(s.trick, tr);
        const pts = 1 + s.trick.reduce((a, p) => a + countOf(p.tile), 0);
        s.pending = true; s.trickWinner = w; s.trickPts = pts;
        s.points[team(w)] += pts; s.tricks[team(w)]++;
        say(s, seatName(s, w) + ' takes the trick (+' + pts + ').');
      } else s.turn = nextSeat(s, seat);
      break;
    }
    case 'collect': {
      if (!(s.phase === 'playing' && s.pending)) return null;
      need(me >= 0 || isHost, 'Spectators cannot do that');
      const w = s.trickWinner;
      s.lastTrick = { plays: s.trick, winner: w, pts: s.trickPts };
      s.trick = []; s.pending = false;
      const o = outcome(s);
      if (o.done) {
        const c = s.contract, dt = team(c.seat), m = bidMarks(c.bid), wt = o.made ? dt : 1 - dt;
        s.marks[wt] += m;
        s.result = { made: o.made, declarer: c.seat, bid: c.bid, trump: c.trump, team: wt, marks: m, points: s.points.slice(), tricks: s.tricks.slice() };
        say(s, seatName(s, c.seat) + (o.made ? ' makes ' : ' is set on ') + bidLabel(c.bid) + '. Team ' + (wt + 1) + ' +' + m + '.');
        s.phase = s.marks[wt] >= s.opts.marksToWin ? 'gameover' : 'handover';
      } else { s.trickNo++; s.turn = w; }
      break;
    }
    case 'nextHand': {
      need(s.phase === 'handover', 'Not between hands');
      need(me >= 0 || isHost, 'Spectators cannot do that');
      s.dealer = (s.dealer + 1) % 4; startHand(s);
      break;
    }
    default: throw new Error('Unknown action');
  }
  s.v = (s.v || 0) + 1;
  return s;
}

/* ===================== BOTS ===================== */
const best = (list, f) => { let b = null, bs = -Infinity; for (const x of list) { const v = f(x); if (v > bs) { bs = v; b = x; } } return b; };
function beatsWhenLed(u, t, tr) {
  const su = suitOf(u, tr), st = suitOf(t, tr);
  if (su === st) return rankOf(u, tr) > rankOf(t, tr);
  return su === TR;
}
const isBossLead = (t, unseen, tr) => !unseen.some(u => beatsWhenLed(u, t, tr));
function currentWinner(trick, tr) { const w = trickWinner(trick, tr); return trick.find(p => p.seat === w); }

function pickTile(c) {
  const { hand, trick, tr, seat, declarer, kind, played, active } = c;
  const legal = legalTiles(hand, trick, tr);
  if (legal.length === 1) return legal[0];
  const myTeam = seat % 2, attacking = myTeam === declarer % 2;
  if (kind === 'nello') {
    const wins = t => trickWinner(trick.concat([{ seat, tile: t }]), tr) === seat;
    if (!trick.length) return best(legal, t => -pipsOf(t));
    const safe = legal.filter(t => !wins(t));
    if (safe.length) return best(safe, t => pipsOf(t));
    return best(legal, t => -pipsOf(t));
  }
  if (tr.mode === 'sevens') {
    if (!trick.length) return best(legal, t => -sevenDist(t));
    const cur = trick.reduce((b, p) => sevenDist(p.tile) < sevenDist(b.tile) ? p : b, trick[0]);
    const last = trick.length === active - 1;
    if (cur.seat % 2 === myTeam) return best(legal, t => sevenDist(t));
    const beat = legal.filter(t => sevenDist(t) < sevenDist(cur.tile));
    if (beat.length) return last ? best(beat, t => sevenDist(t)) : best(beat, t => -sevenDist(t));
    return best(legal, t => sevenDist(t));
  }
  const seen = new Set(hand);
  played.forEach(t => seen.add(t)); trick.forEach(p => seen.add(p.tile));
  const unseen = ALL.filter(t => !seen.has(t));
  const dump = t => -(countOf(t) * 100 + powerOf(t, tr));
  if (!trick.length) {
    if ((tr.mode === 'suit' || tr.mode === 'doubles') && attacking) {
      const trumps = hand.filter(t => suitOf(t, tr) === TR);
      if (trumps.length) {
        const top = best(trumps, t => rankOf(t, tr));
        const unseenTr = unseen.filter(t => suitOf(t, tr) === TR).length;
        if (unseenTr > 0 && (trumps.length >= 2 || isBossLead(top, unseen, tr))) return top;
      }
    }
    const bosses = legal.filter(t => suitOf(t, tr) !== TR && isBossLead(t, unseen, tr));
    if (bosses.length) return best(bosses, t => countOf(t) * 10 + rankOf(t, tr));
    const tb = legal.filter(t => isBossLead(t, unseen, tr));
    if (tb.length && attacking) return best(tb, t => countOf(t));
    return best(legal, dump);
  }
  const cur = currentWinner(trick, tr);
  if (cur.seat % 2 === myTeam) {
    const last = trick.length === active - 1;
    const safe = last || !unseen.some(u => trickWinner(trick.concat([{ seat: -1, tile: u }]), tr) === -1);
    return safe ? best(legal, t => countOf(t) * 100 - powerOf(t, tr)) : best(legal, dump);
  }
  const winners = legal.filter(t => trickWinner(trick.concat([{ seat, tile: t }]), tr) === seat);
  if (winners.length) return best(winners, t => -powerOf(t, tr));
  return best(legal, dump);
}

function simulate(handsIn, tr, leader, sitOut, declarer, kind) {
  const hands = handsIn.map(h => h.slice());
  const played = new Set(), pts = [0, 0], tricks = [0, 0];
  const active = sitOut == null ? 4 : 3;
  let lead = leader;
  const nxt = f => { let n = (f + 1) % 4; if (n === sitOut) n = (n + 1) % 4; return n; };
  for (let n = 0; n < 7; n++) {
    const trick = []; let seat = lead;
    for (let i = 0; i < active; i++) {
      const t = pickTile({ hand: hands[seat], trick, tr, seat, declarer, kind, played, active });
      hands[seat].splice(hands[seat].indexOf(t), 1);
      trick.push({ seat, tile: t });
      seat = nxt(seat);
    }
    trick.forEach(p => played.add(p.tile));
    const w = trickWinner(trick, tr);
    tricks[w % 2]++; pts[w % 2] += 1 + trick.reduce((a, p) => a + countOf(p.tile), 0);
    lead = w;
  }
  return { pts, tricks };
}
function sampleHands(hand, seat) {
  const unseen = shuffle(ALL.filter(t => !hand.includes(t)));
  const hs = [null, null, null, null]; hs[seat] = hand.slice();
  let k = 0;
  for (let i = 1; i < 4; i++) { hs[(seat + i) % 4] = unseen.slice(k, k + 7); k += 7; }
  return hs;
}
function trumpOptions(opts) {
  const o = [];
  for (let n = 0; n <= 6; n++) o.push({ mode: 'suit', n });
  o.push({ mode: 'doubles' });
  if (opts.followMe) o.push({ mode: 'none' });
  return o;
}
function partnerTrump(hand, opts) {
  let bestT = { mode: 'suit', n: 0 }, bs = -1;
  for (let n = 0; n <= 6; n++) {
    const sc = hand.filter(t => lo(t) === n || hi(t) === n).length + (hand.includes('' + n + n) ? 1 : 0);
    if (sc > bs) { bs = sc; bestT = { mode: 'suit', n }; }
  }
  if (hand.filter(isDbl).length * 1.5 > bs) bestT = { mode: 'doubles' };
  return bestT;
}
function evalRegular(hand, seat, opts, N) {
  const worlds = []; for (let i = 0; i < N; i++) worlds.push(sampleHands(hand, seat));
  return trumpOptions(opts).map(T => ({
    T, arr: worlds.map(w => { const r = simulate(w, T, seat, null, seat, 'reg'); return { p: r.pts[seat % 2], all: r.tricks[seat % 2] === 7 }; })
  }));
}
function pRegular(res, bid) {
  let bp = 0, bT = null, bm = 0;
  for (const { T, arr } of res) {
    let ok = 0, sum = 0;
    for (const x of arr) { if (bid.kind === 'pts' ? x.p >= bid.pts : x.all) ok++; sum += x.p; }
    const p = ok / arr.length, m = sum / arr.length;
    if (p > bp || (p === bp && m > bm)) { bp = p; bT = T; bm = m; }
  }
  return { p: bp, T: bT };
}
function pSpecial(kind, hand, seat, opts, N) {
  let ok = 0;
  for (let i = 0; i < N; i++) {
    const w = sampleHands(hand, seat), partner = (seat + 2) % 4;
    let r;
    if (kind === 'nello') { r = simulate(w, { mode: 'nello' }, seat, partner, seat, 'nello'); if (r.tricks[seat % 2] === 0) ok++; }
    else if (kind === 'sevens') { r = simulate(w, { mode: 'sevens' }, seat, null, seat, 'sevens'); if (r.tricks[seat % 2] === 7) ok++; }
    else { r = simulate(w, partnerTrump(w[partner], opts), partner, null, seat, 'reg'); if (r.tricks[seat % 2] === 7) ok++; }
  }
  return ok / N;
}
function botBid(s, seat) {
  const hand = s.hands[seat];
  const avail = availableBids(hand, s.high && s.high.bid, s.opts);
  const forced = s.opts.forceDealer && seat === s.dealer && s.bids.length === 3 && !s.high;
  const partnerHigh = s.high && s.high.seat === (seat + 2) % 4;
  const reg = evalRegular(hand, seat, s.opts, 60);
  const cache = {};
  const spec = k => cache[k] !== undefined ? cache[k] : (cache[k] = pSpecial(k, hand, seat, s.opts, 60));
  const thr = b => ({ pts: 0.6, marks: 0.82, nello: 0.9, sevens: 0.85, splash: 0.82, plunge: 0.82 }[b.kind]) + (partnerHigh ? 0.1 : 0);
  let pick = null;
  for (const b of avail.slice().sort((x, y) => bidValue(y) - bidValue(x))) {
    const p = (b.kind === 'pts' || b.kind === 'marks') ? pRegular(reg, b).p : spec(b.kind);
    if (p >= thr(b)) { pick = b; break; }
  }
  if (!pick && forced) pick = avail.find(b => b.kind === 'pts' && b.pts === 30) || avail[0];
  return pick;
}
function botTrump(s, seat) {
  const b = s.contract.bid;
  if (b.kind === 'splash' || b.kind === 'plunge') return partnerTrump(s.hands[seat], s.opts);
  return pRegular(evalRegular(s.hands[seat], seat, s.opts, 60), b).T;
}
function botPlay(s, seat) {
  const c = s.contract;
  return pickTile({
    hand: s.hands[seat], trick: s.trick, tr: c.trump, seat, declarer: c.seat,
    kind: c.bid.kind === 'nello' ? 'nello' : 'reg', played: new Set(s.played), active: c.sitOut == null ? 4 : 3
  });
}
function pendingBotAction(s) {
  if (!s || !s.seats) return null;
  if (s.phase === 'bidding' && s.seats[s.turn].bot) return { type: 'bid', seat: s.turn, bid: botBid(s, s.turn) };
  if (s.phase === 'trump' && s.seats[s.contract.chooser].bot) return { type: 'trump', seat: s.contract.chooser, trump: botTrump(s, s.contract.chooser) };
  if (s.phase === 'playing' && !s.pending && s.seats[s.turn].bot) return { type: 'play', seat: s.turn, tile: botPlay(s, s.turn) };
  return null;
}

if (typeof module !== 'undefined') module.exports = { seatOfId, ALL, TR, SUIT_NAMES, lo, hi, isDbl, pipsOf, countOf, suitOf, rankOf, trickWinner, legalTiles, availableBids, bidValue, bidLabel, reduce, newTable, pendingBotAction, simulate, sampleHands, team, outcome, DEFAULT_OPTS };
