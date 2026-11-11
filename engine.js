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

/* ---- suits, ranks, tricks ----
   A domino that is not trump belongs to BOTH of its numbers. The domino led sets the suit by its higher end
   (a double sets its own number), and anyone holding a non-trump domino with that number on either end can follow.
   Inside a suit, the double is highest, then dominoes rank by their OTHER end: with threes led, 3-3 beats 3-6
   beats 3-5 ... beats 3-2. A domino carrying the trump number is trump and follows nothing but trump. */
const isTrumpTile = (t, tr) => tr.mode === 'suit' ? (lo(t) === tr.n || hi(t) === tr.n) : tr.mode === 'doubles' ? lo(t) === hi(t) : false;
const nelloDoublesOwnSuit = tr => tr.mode === 'nello' && (tr.dbl || 'suit') === 'suit';
function ledSuit(t, tr) {            // the suit a domino sets when it is led
  if (isTrumpTile(t, tr)) return TR;
  if (nelloDoublesOwnSuit(tr) && lo(t) === hi(t)) return 7;
  return hi(t);
}
function follows(t, s, tr) {         // can this domino be played to follow suit s?
  if (s === TR) return isTrumpTile(t, tr);
  if (isTrumpTile(t, tr)) return false;
  if (s === 7) return lo(t) === hi(t);                       // nello: the doubles suit
  if (nelloDoublesOwnSuit(tr) && lo(t) === hi(t)) return false;
  return lo(t) === s || hi(t) === s;
}
function rankIn(t, s, tr) {          // strength of a domino inside suit s
  const a = lo(t), b = hi(t);
  if (s === TR) return tr.mode === 'suit' ? (a === b ? 100 : (a === tr.n ? b : a)) : a;
  if (s === 7) return a;
  if (a === b) return (tr.mode === 'nello' && tr.dbl === 'low') ? -1 : 10;
  return a === s ? b : a;
}
const sevenDist = t => Math.abs(pipsOf(t) - 7);
// rough overall strength, used only to order choices ("play the cheapest winner")
const powerOf = (t, tr) => isTrumpTile(t, tr) ? 100 + rankIn(t, TR, tr) : (lo(t) === hi(t) ? 20 : 0) + pipsOf(t);

function trickWinner(plays, tr) {
  if (tr.mode === 'sevens') {
    let best = plays[0];
    for (const p of plays) if (sevenDist(p.tile) < sevenDist(best.tile)) best = p;
    return best.seat;
  }
  const led = ledSuit(plays[0].tile, tr);
  const trumps = plays.filter(p => isTrumpTile(p.tile, tr));
  const pool = trumps.length ? trumps : plays.filter(p => follows(p.tile, led, tr));
  const suit = trumps.length ? TR : led;
  let best = null;
  for (const p of pool) if (!best || rankIn(p.tile, suit, tr) > rankIn(best.tile, suit, tr)) best = p;
  return best.seat;
}
function legalTiles(hand, trick, tr) {
  if (tr.mode === 'sevens' || !trick.length) return hand.slice();
  const led = ledSuit(trick[0].tile, tr);
  const f = hand.filter(t => follows(t, led, tr));
  return f.length ? f : hand.slice();
}
const suitOf = ledSuit;

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
    case 'nello': return 'nello (' + ({ suit: 'doubles are their own suit', high: 'doubles high', low: 'doubles low' }[tr.dbl || 'suit']) + ')';
    case 'sevens': return 'sevens';
  }
}

/* ---- table state ---- */
const DEFAULT_OPTS = { marksToWin: 7, bidHints: true, playHints: true, forceDealer: true, nello: true, splash: true, plunge: true, followMe: true, sevens: true };
function newTable(hostId) {
  return {
    v: 0, phase: 'lobby', hostId, opts: Object.assign({}, DEFAULT_OPTS),
    seats: [0, 1, 2, 3].map(() => ({ id: null, name: '', bot: false })),
    marks: [0, 0], handNo: 0, dealer: 0, turn: 0, hands: {}, bids: [], high: null,
    contract: null, trick: [], trickNo: 0, pending: false, trickWinner: -1, trickPts: 0,
    points: [0, 0], tricks: [0, 0], played: [], taken: [], lastTrick: null, result: null, log: []
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
  s.points = [0, 0]; s.tricks = [0, 0]; s.played = []; s.taken = []; s.lastTrick = null; s.result = null;
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
  if (b.kind === 'nello') s.contract.sitOut = (d + 2) % 4;   // trump phase below: the bidder chooses how doubles count
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
      if (s.contract.bid.kind === 'nello') {
        need(t && t.mode === 'nello' && ['suit', 'high', 'low'].includes(t.dbl), 'Choose how doubles count');
        s.contract.trump = { mode: 'nello', dbl: t.dbl };
        say(s, seatName(s, action.seat) + ' calls ' + trumpLabel(s.contract.trump) + '.');
        startPlay(s, action.seat);
        break;
      }
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
      s.taken = (s.taken || []).concat([{ plays: s.trick, winner: w, pts: s.trickPts }]);   // the hand's trick history, shown on the score card
      s.trick = []; s.pending = false;
      const o = outcome(s);
      if (o.done) {
        s.taken = [];   // hand over: the history goes away
        const c = s.contract, dt = team(c.seat), m = bidMarks(c.bid), wt = o.made ? dt : 1 - dt;
        s.marks[wt] += m;
        s.result = { played: s.tricks[0] + s.tricks[1], made: o.made, declarer: c.seat, bid: c.bid, trump: c.trump, team: wt, marks: m, points: s.points.slice(), tricks: s.tricks.slice() };
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
function beatsWhenLed(u, t, tr) {   // if t is led, could u (played later) take the trick from it?
  const tu = isTrumpTile(u, tr), tt = isTrumpTile(t, tr);
  if (tu !== tt) return tu;
  const led = ledSuit(t, tr);
  if (tt) return rankIn(u, TR, tr) > rankIn(t, TR, tr);
  return follows(u, led, tr) && rankIn(u, led, tr) > rankIn(t, led, tr);
}
const isBossLead = (t, unseen, tr) => !unseen.some(u => beatsWhenLed(u, t, tr));
function currentWinner(trick, tr) { const w = trickWinner(trick, tr); return trick.find(p => p.seat === w); }

/* Chooses a domino AND says why. `why` is a short code the interface turns into a plain-English reason.
   It reads only the player's own hand and public information (the trick so far, what has been played, the contract). */
function decide(c) {
  const { hand, trick, tr, seat, declarer, kind, played, active } = c;
  const legal = legalTiles(hand, trick, tr);
  const pick = (t, w) => ({ t, w });
  if (legal.length === 1) return pick(legal[0], 'only');
  const myTeam = seat % 2, attacking = myTeam === declarer % 2;
  if (kind === 'nello') {
    const wins = t => trickWinner(trick.concat([{ seat, tile: t }]), tr) === seat;
    if (!trick.length) return pick(best(legal, t => -pipsOf(t)), 'nello-lead');
    const safe = legal.filter(t => !wins(t));
    if (safe.length) return pick(best(safe, t => pipsOf(t)), 'nello-shed');
    return pick(best(legal, t => -pipsOf(t)), 'nello-forced');
  }
  if (tr.mode === 'sevens') {
    if (!trick.length) return pick(best(legal, t => -sevenDist(t)), 'sevens-lead');
    const cur = trick.reduce((b, p) => sevenDist(p.tile) < sevenDist(b.tile) ? p : b, trick[0]);
    const last = trick.length === active - 1;
    if (cur.seat % 2 === myTeam) return pick(best(legal, t => sevenDist(t)), 'sevens-partner');
    const beat = legal.filter(t => sevenDist(t) < sevenDist(cur.tile));
    if (beat.length) return last ? pick(best(beat, t => sevenDist(t)), 'sevens-beat-last') : pick(best(beat, t => -sevenDist(t)), 'sevens-beat');
    return pick(best(legal, t => sevenDist(t)), 'sevens-dump');
  }
  const seen = new Set(hand);
  played.forEach(t => seen.add(t)); trick.forEach(p => seen.add(p.tile));
  const unseen = ALL.filter(t => !seen.has(t));
  const dump = t => -(countOf(t) * 100 + powerOf(t, tr));
  if (!trick.length) {
    if ((tr.mode === 'suit' || tr.mode === 'doubles') && attacking) {
      const trumps = hand.filter(t => isTrumpTile(t, tr));
      if (trumps.length) {
        const top = best(trumps, t => rankIn(t, TR, tr));
        const unseenTr = unseen.filter(t => isTrumpTile(t, tr)).length;
        if (unseenTr > 0 && (trumps.length >= 2 || isBossLead(top, unseen, tr))) return pick(top, 'lead-trump');
      }
    }
    const bosses = legal.filter(t => !isTrumpTile(t, tr) && isBossLead(t, unseen, tr));
    if (bosses.length) return pick(best(bosses, t => countOf(t) * 10 + powerOf(t, tr) / 10), 'lead-boss');
    const tb = legal.filter(t => isBossLead(t, unseen, tr));
    if (tb.length && attacking) return pick(best(tb, t => countOf(t)), 'lead-boss-trump');
    return pick(best(legal, dump), 'lead-low');
  }
  const cur = currentWinner(trick, tr);
  if (cur.seat % 2 === myTeam) {
    const last = trick.length === active - 1;
    const safe = last || !unseen.some(u => trickWinner(trick.concat([{ seat: -1, tile: u }]), tr) === -1);
    return safe ? pick(best(legal, t => countOf(t) * 100 - powerOf(t, tr)), last ? 'feed-last' : 'feed-safe') : pick(best(legal, dump), 'partner-dump');
  }
  const winners = legal.filter(t => trickWinner(trick.concat([{ seat, tile: t }]), tr) === seat);
  if (winners.length) return pick(best(winners, t => -powerOf(t, tr)), 'cheapest-win');
  return pick(best(legal, dump), 'cannot-win');
}
const pickTile = c => decide(c).t;
const tileName = t => hi(t) + '-' + lo(t);
const nameWith = (t, f) => (f !== undefined && (lo(t) === f || hi(t) === f)) ? f + '-' + (lo(t) === f ? hi(t) : lo(t)) : tileName(t);

/* The suggestion a player can see: built from their own hand + public information only. */
function suggestPlay(s, seat) {
  const c = s.contract;
  return decide({
    hand: s.hands[seat], trick: s.trick, tr: c.trump, seat, declarer: c.seat,
    kind: c.bid.kind === 'nello' ? 'nello' : 'reg', played: new Set(s.played), active: c.sitOut == null ? 4 : 3
  });
}

/* A plain-English account of a finished trick: the suit, who followed, why the winner won, and what it was worth. */
function explainTrick(plays, tr, nm, bid) {
  const out = [], win = trickWinner(plays, tr), wp = plays.find(p => p.seat === win);
  const lead = plays[0], led = ledSuit(lead.tile, tr), cnt = plays.filter(p => countOf(p.tile) > 0);
  const F = (led !== TR && led !== 7) ? led : undefined;                 // the suit being played
  const N = t => nameWith(t, isTrumpTile(t, tr) && tr.mode === 'suit' ? tr.n : F);   // trumps are named from the trump number
  const nelloOrPts = bid && bid.kind === 'nello' ? 'nello' : 'pts';
  if (tr.mode === 'sevens') {
    out.push('Sevens has no suits. The domino whose spots add closest to 7 wins, and a tie goes to whoever played first.');
    out.push(plays.map(p => nm(p.seat) + ' played ' + N(p.tile) + ' (total ' + pipsOf(p.tile) + ', ' + sevenDist(p.tile) + ' away)').join('; ') + '.');
    out.push(nm(win) + '’s ' + N(wp.tile) + ' was closest to 7.');
  } else {
    let ledTxt;
    if (led === TR) ledTxt = nm(lead.seat) + ' led a trump (' + N(lead.tile) + '), so everyone had to play a trump if they had one.';
    else if (led === 7) ledTxt = nm(lead.seat) + ' led a double (' + N(lead.tile) + '). In this nello doubles are their own suit.';
    else ledTxt = nm(lead.seat) + ' led the ' + N(lead.tile) + ', so the suit is ' + SUIT_NAMES[led] + (lo(lead.tile) === hi(lead.tile) ? ' (a double leads its own number).' : ' (the higher end sets the suit).');
    out.push(ledTxt);
    const rest = plays.slice(1).map(p => {
      const f = follows(p.tile, led, tr);
      if (f) return nm(p.seat) + ' followed with the ' + N(p.tile);
      if (isTrumpTile(p.tile, tr)) return nm(p.seat) + ' had none to follow, so played the trump ' + N(p.tile);
      return nm(p.seat) + ' had none to follow and threw the ' + N(p.tile);
    });
    if (rest.length) out.push(rest.join('. ') + '.');
    const trumps = plays.filter(p => isTrumpTile(p.tile, tr));
    if (trumps.length && led !== TR) out.push('A trump beats every other suit, so ' + nm(win) + '’s ' + N(wp.tile) + ' won' + (trumps.length > 1 ? ' (the highest trump played)' : '') + '.');
    else if (led === TR) out.push(nm(win) + '’s ' + N(wp.tile) + ' was the highest trump' + (lo(wp.tile) === hi(wp.tile) ? ': the double of the trump number is always the top trump.' : '; trumps rank by their other end.'));
    else if (lo(wp.tile) === hi(wp.tile)) out.push(nm(win) + '’s double ' + N(wp.tile) + ' is the highest domino of its suit, so it won.');
    else if (plays.length > 1 && plays.filter(p => follows(p.tile, led, tr)).length > 1) out.push('No trump was played, so the highest ' + SUIT_NAMES[led].replace(/s$/, '') + ' won. Inside a suit, dominoes rank by their other end, so ' + nm(win) + '’s ' + N(wp.tile) + ' beat the rest.');
    else out.push('Nobody else could follow suit, so ' + nm(lead.seat) + '’s ' + N(wp.tile) + ' won.');
  }
  if (nelloOrPts === 'pts') {
    const pts = 1 + cnt.reduce((a, p) => a + countOf(p.tile), 0);
    out.push('Worth ' + pts + (pts === 1 ? ' point' : ' points') + ': 1 for the trick' + (cnt.length ? ' plus count: ' + cnt.map(p => tileName(p.tile) + ' (' + countOf(p.tile) + ')').join(', ') : ' and no count dominoes in it') + '.');
  }
  return out;
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
// Bots want to clear bigger bids by a point or two: real defenders play better than the simulated ones.
const marginFor = pts => pts >= 36 ? 2 : pts >= 32 ? 1 : 0;
function pRegular(res, bid) {
  let bp = 0, bT = null, bm = 0;
  for (const { T, arr } of res) {
    let ok = 0, sum = 0;
    for (const x of arr) { if (bid.kind === 'pts' ? x.p >= Math.min(42, bid.pts + marginFor(bid.pts)) : x.all) ok++; sum += x.p; }
    const p = ok / arr.length, m = sum / arr.length;
    if (p > bp || (p === bp && m > bm)) { bp = p; bT = T; bm = m; }
  }
  return { p: bp, T: bT };
}
const NELLO_MODES = ['suit', 'high', 'low'];
function pSpecial(kind, hand, seat, opts, N) {
  let ok = 0; const nok = { suit: 0, high: 0, low: 0 };
  for (let i = 0; i < N; i++) {
    const w = sampleHands(hand, seat), partner = (seat + 2) % 4;
    let r;
    if (kind === 'nello') {
      for (const dbl of NELLO_MODES) { r = simulate(w, { mode: 'nello', dbl }, seat, partner, seat, 'nello'); if (r.tricks[seat % 2] === 0) nok[dbl]++; }
    }
    else if (kind === 'sevens') { r = simulate(w, { mode: 'sevens' }, seat, null, seat, 'sevens'); if (r.tricks[seat % 2] === 7) ok++; }
    else { r = simulate(w, partnerTrump(w[partner], opts), partner, null, seat, 'reg'); if (r.tricks[seat % 2] === 7) ok++; }
  }
  if (kind === 'nello') return Math.max(nok.suit, nok.high, nok.low) / N;
  return ok / N;
}
/* Works out what a sensible bid is for ONE seat. It reads only that seat's own dominoes plus public information
   (the bids so far, the dealer, the house rules) -- never anyone else's hand. Both the bots and the player-facing
   "suggested bid" use it, and a test checks that no other hand is ever touched. */
function analyzeBid(s, seat) {
  const hand = s.hands[seat];
  const avail = availableBids(hand, s.high && s.high.bid, s.opts);
  const forced = !!(s.opts.forceDealer && seat === s.dealer && s.bids.length === 3 && !s.high);
  const partnerHigh = !!(s.high && s.high.seat === (seat + 2) % 4);
  const reg = evalRegular(hand, seat, s.opts, 60);
  const cache = {};
  const spec = k => cache[k] !== undefined ? cache[k] : (cache[k] = pSpecial(k, hand, seat, s.opts, 60));
  // How sure a bot must be before bidding: easy to open at 30, steadily stricter as the bid climbs,
  // and much stricter above 36 (those bids need nearly a perfect hand). Marks and specials are all-or-nothing, so stricter still.
  const thr = b => (b.kind === 'pts' ? 0.6 + (b.pts - 30) * 0.025 + (b.pts > 36 ? 0.1 : 0)
    : { marks: 0.85, nello: 0.9, sevens: 0.88, splash: 0.85, plunge: 0.85 }[b.kind]) + (partnerHigh ? 0.15 : 0);
  // honest chance of making a bid (no safety margin), and the trump that gives it
  const chance = b => {
    if (b.kind === 'pts' || b.kind === 'marks') {
      const T = pRegular(reg, b).T;
      const arr = reg.find(r => r.T === T).arr;
      const ok = arr.filter(x => b.kind === 'pts' ? x.p >= b.pts : x.all).length;
      return { p: ok / arr.length, T };
    }
    return { p: spec(b.kind), T: null };
  };
  let pick = null;
  for (const b of avail.slice().sort((x, y) => bidValue(y) - bidValue(x))) {
    const p = (b.kind === 'pts' || b.kind === 'marks') ? pRegular(reg, b).p : spec(b.kind);
    if (p >= thr(b)) { pick = b; break; }
  }
  if (!pick && forced) pick = avail.find(b => b.kind === 'pts' && b.pts === 30) || avail[0];
  const lowest = avail.slice().sort((x, y) => bidValue(x) - bidValue(y))[0] || null;
  const out = { pick, forced, partnerHigh, lowest: lowest && Object.assign({ bid: lowest }, chance(lowest)) };
  if (pick) Object.assign(out, chance(pick));
  return out;
}
const botBid = (s, seat) => analyzeBid(s, seat).pick;
function botTrump(s, seat) {
  const b = s.contract.bid;
  if (b.kind === 'nello') {
    const hand = s.hands[seat], partner = (seat + 2) % 4, sc = { suit: 0, high: 0, low: 0 };
    for (let i = 0; i < 60; i++) {
      const w = sampleHands(hand, seat);
      for (const dbl of NELLO_MODES) if (simulate(w, { mode: 'nello', dbl }, seat, partner, seat, 'nello').tricks[seat % 2] === 0) sc[dbl]++;
    }
    const dbl = NELLO_MODES.reduce((x, y) => sc[y] > sc[x] ? y : x, 'suit');
    return { mode: 'nello', dbl };
  }
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

if (typeof module !== 'undefined') module.exports = { nameWith, decide, suggestPlay, explainTrick, tileName, analyzeBid, ledSuit, follows, rankIn, isTrumpTile, botBid, botTrump, seatOfId, ALL, TR, SUIT_NAMES, lo, hi, isDbl, pipsOf, countOf, suitOf, trickWinner, legalTiles, availableBids, bidValue, bidLabel, reduce, newTable, pendingBotAction, simulate, sampleHands, team, outcome, DEFAULT_OPTS };
