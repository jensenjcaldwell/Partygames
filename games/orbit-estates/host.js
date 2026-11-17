// Orbit Estates on the TV: draws the ring board and runs the rules engine,
// turning its questions into phone views.
import { Game, money, deedText } from './engine.js';
import { BOARD, GROUPS } from './board.js';
import { CSS } from './style.js';

const LENGTHS = [
  { label: '⏱️ 30 minutes', value: 30 },
  { label: '⏱️ 45 minutes', value: 45 },
  { label: '⏱️ 60 minutes', value: 60 },
  { label: '⏱️ 90 minutes', value: 90 },
  { label: '♾️ No limit: play until one pilot is left', value: 0 },
];

export default async function (ctx) {
  const { h } = ctx;
  installCss();
  const players = ctx.connected;
  if (players.length < 2) return ctx.say('Not enough pilots', 'Orbit Estates needs at least 2 players.', 4000);

  // ---------- game length ----------
  const vip = players[0];
  ctx.show(players.filter((p) => p !== vip), { title: 'Orbit Estates', wait: `${vip.name} is picking the game length…` });
  ctx.el.replaceChildren(h('div.oe-intro',
    h('div.oe-logo', ringArt(h), h('h1', 'Orbit Estates')),
    h('p', 'Buy up the ring station, build domes, charge rent, and trade your way to the top.'),
    h('p.oe-dim', `${vip.name} is picking how long to play…`)));
  const len = await ctx.ask(vip, {
    title: 'How long should we play?',
    text: 'When time runs out, everyone finishes the round and the richest pilot wins.',
    choices: LENGTHS,
  }, { timeout: 30 });
  const minutes = LENGTHS.some((l) => l.value === len.get(vip.id)) ? len.get(vip.id) : 60;

  // ---------- state for the TV ----------
  const ui = { focus: null, status: '', overlay: null, rolling: false };
  const sent = new Map();
  let game;

  const isConnected = (p) => ctx.player(p.id)?.connected;
  const idle = (except) => {
    const to = ctx.players.filter((x) => !except || x.id !== except.id);
    if (!to.length) return;
    const cur = game?.turnOf && game.get(game.turnOf);
    ctx.show(to, { title: cur ? `${cur.token} ${cur.name}'s turn` : 'Orbit Estates', wait: 'Watch the big screen' });
  };
  const ask1 = async (p, view, fallback, timeout) => {
    if (!isConnected(p)) return fallback;
    const m = await ctx.ask(p.id, { color: p.color, ...view }, { timeout, after: { wait: 'Look at the big screen' } });
    return m.has(p.id) ? m.get(p.id) : fallback;
  };

  const io = {
    now: () => Date.now(),
    random: Math.random,
    pause: (ms) => ctx.sleep(ms),
    update: () => { render(); sendStatus(); },
    sfx: (n) => ctx.sfx(n),
    step: () => ctx.sfx('tick'),
    choose: (p, view, fallback, t) => ask1(p, view, fallback, t),
    multi: async (p, view, t) => (await ask1(p, view, [], t)) || [],
    number: (p, view, fallback, t) => ask1(p, view, fallback, t),
    show: (p, view) => ctx.show(p.id, view),
    focus: (i, text) => { ui.focus = i; ui.status = text; render(); },
    async waitFor(p, secs) {
      idle(p);
      for (let k = 0; k < secs * 2 && !isConnected(p); k++) {
        ui.status = `Waiting for ${p.name} to reconnect…`; render();
        await ctx.sleep(500);
      }
      ui.status = '';
    },
    async rollDice(a, b) {
      ui.rolling = true;
      for (let k = 0; k < 8; k++) {
        game.dice = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
        ctx.sfx(k % 2 ? 'tick' : 'tock'); render();
        await ctx.sleep(70);
      }
      game.dice = [a, b]; ui.rolling = false; render();
    },
    async card(p, text) {
      ctx.sfx('whoosh');
      ui.overlay = h('div.oe-card', h('div.oe-card-head', '📡 Transmission'), h('p', text), h('div.oe-card-to', `for ${p.token} ${p.name}`));
      render(); await ctx.sleep(3800); ui.overlay = null;
    },
    async announce(title, sub) {
      ctx.sfx('whoosh');
      ui.overlay = h('div.oe-announce', h('h2', title), h('p', sub));
      render(); await ctx.sleep(3200); ui.overlay = null; render();
    },
    trade(deal) {
      if (!deal) { ui.overlay = null; render(); return; }
      const side = (who, lots, cash) => h('div.oe-tside', h('div.oe-tname', { style: { color: who.color } }, `${who.token} ${who.name} gives`),
        lots.map((i) => h('div.oe-tlot', { style: { '--g': gcol(i) } }, BOARD[i].name)), cash ? h('div.oe-tcash', money(cash)) : null,
        !lots.length && !cash ? h('div.oe-dim', 'nothing') : null);
      ui.overlay = h('div.oe-trade', h('h2', '🤝 Trade offer'),
        h('div.oe-tsides', side(deal.from, deal.give, deal.giveCash), h('div.oe-tarrow', '⇄'), side(deal.to, deal.get, deal.getCash)),
        h('p.oe-dim', `Waiting for ${deal.to.name} to answer…`));
      render();
    },
    async auction(i, bidders, secs) {
      const s = BOARD[i];
      const done = new Set();
      const draw = () => {
        ui.overlay = h('div.oe-auction', h('h2', '🔨 Auction'), deedCard(h, i),
          h('p', 'Everyone bid in secret on your phone. Highest bid wins it.'),
          h('div.oe-bidders', bidders.map((p) => h('span.oe-bidder' + (done.has(p.id) ? '.in' : ''), { style: { '--c': p.color } },
            `${p.token} ${p.name} ${done.has(p.id) ? '✓' : '…'}`))));
        render();
      };
      draw();
      ctx.sfx('start');
      const stop = ctx.clock(secs);
      const res = await Promise.all(bidders.map((p) => (isConnected(p) ? ctx.ask(p.id, {
        title: `Auction: ${s.name}`, color: s.group ? GROUPS[s.group].color : '#ffb84d',
        text: `${deedText(s)}\nList price ${money(s.price)}. You have ${money(p.cash)}. Bid 0 to pass.`,
        number: { min: 0, max: Math.floor(p.cash / 10) * 10, step: 10, value: 0, submit: 'Place secret bid' },
      }, { timeout: secs, clock: false, after: { wait: 'Bid placed! Watch the big screen' }, onAnswer: (pl) => { done.add(pl.id); draw(); } })
        : Promise.resolve(new Map()))));
      stop();
      const bids = new Map();
      res.forEach((m) => m.forEach((v, k) => bids.set(k, v)));
      return bids;
    },
    async auctionResult(i, list, winner, price) {
      ui.overlay = h('div.oe-auction', h('h2', `${winner.token} ${winner.name} wins!`), deedCard(h, i),
        h('div.oe-bids', list.sort((a, b) => b.bid - a.bid).map(({ p, bid }) => h('div.oe-bid' + (p === winner ? '.win' : ''),
          { style: { '--c': p.color } }, h('span', `${p.token} ${p.name}`), h('b', bid ? money(bid) : 'pass')))));
      render(); await ctx.sleep(3500); ui.overlay = null;
      idle(null);
    },
  };

  // ---------- phones: status strip ----------
  function sendStatus(force) {
    if (!game) return;
    const left = game.timeLeft();
    for (const p of game.players) {
      const deeds = game.owned(p).map((i) => {
        const L = game.lots.get(i);
        return { name: BOARD[i].name, color: gcol(i), level: L.level, mortgaged: L.mortgaged };
      });
      const st = {
        kind: 'oe-status', cash: p.cash, token: p.token, color: p.color, passes: p.passes, jailed: p.jailed,
        bankrupt: p.bankrupt, myTurn: game.turnOf === p.id, worth: game.worth(p), deeds,
        minutesLeft: left == null ? null : Math.ceil(left / 60000), lastRound: game.lastRound,
      };
      const key = JSON.stringify(st);
      if (!force && sent.get(p.id) === key) continue;
      sent.set(p.id, key);
      if (ctx.player(p.id)) ctx.send(p.id, st);
    }
  }
  ctx.on('message', (p, d) => { if (d?.kind === 'oe-hello') { sent.delete(p.id); sendStatus(); } });
  ctx.on('join', (p) => { sent.delete(p.id); sendStatus(); });

  // ---------- TV: the board ----------
  const root = h('div.oe-root');
  ctx.el.replaceChildren(root);

  function render() {
    if (!game) return;
    const left = game.timeLeft();
    const tiles = BOARD.map((s, i) => tile(h, game, i, ui.focus === i));
    const [r1, r2] = [game.dice[0], game.dice[1]];
    const cur = game.turnOf && game.get(game.turnOf);
    const center = h('div.oe-center',
      ui.overlay || [
        h('div.oe-logo.sm', ringArt(h), h('h1', 'Orbit Estates')),
        h('div.oe-dice' + (ui.rolling ? '.rolling' : ''), die(h, r1), die(h, r2)),
        h('div.oe-status', ui.status || (cur ? `${cur.token} ${cur.name}'s turn` : '')),
        h('div.oe-feed', game.feed.slice(0, 5).map((f, k) => h('div', { style: { '--c': f.color || 'var(--dim)', opacity: 1 - k * 0.16 } }, f.text))),
      ]);
    const side = h('div.oe-side',
      h('div.oe-clock' + (game.lastRound ? '.last' : ''), game.lastRound ? '⏰ Last round' : left == null ? `Round ${game.round}` : `⏱️ ${fmt(left)} left · round ${game.round}`),
      game.players.map((p) => h('div.oe-pl' + (p.id === game.turnOf ? '.turn' : '') + (p.bankrupt ? '.out' : '') + (isConnected(p) ? '' : '.away'),
        { style: { '--c': p.color } },
        h('div.oe-pl-tok', p.token),
        h('div.oe-pl-main',
          h('div.oe-pl-name', p.name, p.jailed ? ' 🧪' : '', p.passes ? ' 🎫' : ''),
          h('div.oe-pl-deeds', game.owned(p).map((i) => h('span.oe-pip' + (game.lots.get(i).mortgaged ? '.mort' : ''), { style: { '--g': gcol(i) } })))),
        h('div.oe-pl-cash', p.bankrupt ? 'bankrupt' : money(p.cash)))));
    root.replaceChildren(h('div.oe-board', tiles, center), side);
  }

  // ---------- play ----------
  ctx.music('lobby');
  game = new Game(io, players, { limitMs: minutes * 60000 });
  idle(null);
  render();
  await ctx.sleep(500);
  const ticker = ctx.setInterval(() => { if (game.limitMs) render(); }, 15000);
  let standings;
  try {
    ctx.music('party');
    standings = await game.play();
  } finally { clearInterval(ticker); }

  // ---------- results ----------
  ctx.music('lobby');
  ctx.sfx('win');
  const win = standings[0];
  for (const [k, p] of standings.entries()) {
    if (ctx.player(p.id)) {
      ctx.send(p.id, { kind: 'oe-status', done: true });
      ctx.show(p.id, { title: k === 0 ? '🏆 You win!' : `#${k + 1}`, text: p.bankrupt ? 'You went bankrupt.' : `Net worth ${money(p.worth)}`, wait: 'Look at the big screen' });
    }
  }
  root.replaceChildren(h('div.oe-results',
    h('div.oe-logo', ringArt(h), h('div.oe-wintok', win.token), h('h1', `${win.name} owns the ring!`)),
    h('div.oe-rank', standings.map((p, k) => h('div.oe-rrow', { style: { '--c': p.color, animationDelay: `${k * 0.25}s` } },
      h('span.oe-rk', `#${k + 1}`), h('span', `${p.token} ${p.name}`),
      h('b', p.bankrupt ? 'bankrupt' : money(p.worth))))),
    h('p.oe-dim', 'Net worth counts cash, lots at list price (half if mortgaged) and domes at cost.')));
  await ctx.sleep(14000);
}

// ---------- drawing helpers ----------
const gcol = (i) => (BOARD[i].group ? GROUPS[BOARD[i].group].color : BOARD[i].kind === 'pad' ? '#cfd6ff' : '#9ef0ff');
const fmt = (ms) => { const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60; return `${m}:${String(s).padStart(2, '0')}`; };

function cell(i) {
  // 9×9 grid. 0 is the bottom-right corner; the ring runs clockwise from there
  // along the bottom, up the left, along the top and down the right.
  if (i <= 8) return [9, 9 - i, 'b'];
  if (i <= 16) return [9 - (i - 8), 1, 'l'];
  if (i <= 24) return [1, 1 + (i - 16), 't'];
  return [1 + (i - 24), 9, 'r'];
}

function tile(h, game, i, focused) {
  const s = BOARD[i];
  const [row, col, side] = cell(i);
  const L = game.lots.get(i);
  const owner = L?.owner && game.get(L.owner);
  const corner = i % 8 === 0;
  const here = game.players.filter((p) => !p.bankrupt && p.pos === i);
  return h(`div.oe-tile.s-${side}` + (corner ? '.corner' : '') + (focused ? '.focus' : '') + (L?.mortgaged ? '.mort' : ''), {
    style: { gridRow: row, gridColumn: col, '--g': s.group ? GROUPS[s.group].color : 'transparent', '--o': owner ? owner.color : 'transparent' },
  },
    s.group && h('div.oe-band', L.level === 5 ? '🏙️' : '●'.repeat(L.level)),
    h('div.oe-tbody',
      !s.group && h('div.oe-ticon', s.kind === 'pad' ? '🛬' : s.icon),
      h('div.oe-tname', s.name),
      s.price && h('div.oe-tprice', owner ? `${owner.token}` : money(s.price)),
      s.kind === 'tax' && h('div.oe-tprice', money(s.amount))),
    here.length > 0 && h('div.oe-tokens', here.map((p) => h('span.oe-tok', { style: { '--c': p.color } }, p.token))));
}

function deedCard(h, i) {
  const s = BOARD[i];
  return h('div.oe-deed', { style: { '--g': gcol(i) } }, h('div.oe-deed-band', s.name), h('p', deedText(s)), h('b', `List price ${money(s.price)}`));
}

const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
function die(h, n) {
  return h('div.oe-die', Array.from({ length: 9 }, (_, k) => h('span' + (PIPS[n].includes(k + 1) ? '.on' : ''))));
}

function ringArt(h) {
  return h('div.oe-ring', h('div.oe-ring-planet'), h('div.oe-ring-band'));
}

function installCss() {
  document.getElementById('orbit-estates-css')?.remove();
  document.head.append(Object.assign(document.createElement('style'), { id: 'orbit-estates-css', textContent: CSS }));
}
