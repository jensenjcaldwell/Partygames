// Saltwind Isles: the TV. Owns the game, relays state to phones, runs the
// turn timers and plays for anyone who wanders off.
import { Game, RES, RES_INFO, COST, CHARTS, formatCards } from './rules.js';
import { drawBoard, useStyle } from './board.js';

// Seconds the game waits before moving for someone.
const LIMIT = { setup: 75, roll: 40, discard: 45, squall: 40, steal: 30, crew: 45, main: 150 };
const AWAY = 5;        // when the player isn't connected
const OFFER_TIME = 60;

export default async function (ctx) {
  const { h } = ctx;
  useStyle(ctx.asset('style.css'));

  // Custom audio & SFX engine
  ctx.music?.(null);
  const isMuted = () => {
    try { return localStorage.getItem('partyhall.muted') === '1'; } catch { return false; }
  };
  const bgm = new Audio(ctx.asset('audio/bg_main.ogg'));
  bgm.loop = true;
  bgm.volume = 0.35;
  const playBgm = () => {
    if (!isMuted() && bgm.paused) bgm.play().catch(() => {});
  };
  const syncMute = () => {
    bgm.muted = isMuted();
  };
  window.addEventListener('storage', syncMute);
  playBgm();
  const playSfx = (name, vol = 0.55) => {
    if (isMuted()) return;
    try {
      ctx.playSfx(`audio/${name}.wav`, vol);
    } catch {}
  };

  const seats = ctx.shuffle(ctx.connected);
  if (seats.length < 2) return ctx.say('Not enough players', 'Saltwind Isles needs at least 2.', 5000);

  // How long a game?
  ctx.el.replaceChildren(h('div.say', h('div.sw-logo', '🏝️'), h('h1', 'Saltwind Isles'),
    h('p', `${seats[0].name} is picking the game length…`)));
  ctx.show(seats.slice(1), { wait: `${seats[0].name} is picking the game length…` });
  const lenAns = await ctx.ask(seats[0], {
    title: 'How long a game?',
    text: 'First to the target score wins. A full game takes about an hour.',
    choices: [{ label: 'Quick: 7 points (~35 min)', value: 7 }, { label: 'Full: 10 points (~60 min)', value: 10 }],
  }, { timeout: 25 });
  const target = lenAns.get(seats[0].id) || 10;

  await ctx.say('Saltwind Isles', `Build huts and bridges across the islands, trade cargo, light lighthouses. First to ${target} points wins.`, 4000);

  const game = new Game(seats.map((p) => ({ id: p.id, name: p.name, color: p.color })), { target });
  const colors = new Map(seats.map((p) => [p.id, p.color]));
  window.__saltwind = game; // for the browser test (test/play.mjs)
  let lastGains = {}, lastRoll = null, rollAnim = 0;
  let deadline = 0, deadKey = '', stopClock = null, offerAt = 0, mainTurn = '', clockFor = 0;

  // ---------- networking ----------
  const secsLeft = () => Math.max(0, Math.round((deadline - Date.now()) / 1000));
  // Phones get one shared public snapshot plus their own hand, and only when
  // something changed. Bursts are coalesced, because the server rate-limits
  // every connection (the TV's too).
  const lastMe = new Map();
  let flushT = null;
  const sendMe = (pid, force) => {
    const me = JSON.stringify(game.view(pid).me);
    if (!force && lastMe.get(pid) === me) return;
    lastMe.set(pid, me);
    ctx.send(pid, { t: 'me', me: JSON.parse(me) });
  };
  const flush = () => {
    flushT = null;
    for (const p of seats) sendMe(p.id, false);
    const pub = game.view();
    ctx.send('all', { t: 'pub', s: pub, secs: secsLeft() });
    render();
  };
  const push = (pid) => { sendMe(pid, true); ctx.send(pid, { t: 'pub', s: game.view(), secs: secsLeft() }); };
  const pushAll = () => { if (!flushT) flushT = ctx.setTimeout(() => { try { flush(); } catch {} }, 150); };

  const apply = (pid, m, auto = false) => {
    playBgm();
    const r = game.act(pid, m);
    if (r.err) return r;
    if (r.roll) {
      lastRoll = r.roll; lastGains = r.gains || {}; rollAnim = Date.now();
      ctx.sfx?.(r.roll === 7 ? 'glitch' : 'pop');
      if (r.roll === 7) playSfx('sfx_squall_wind', 0.65);
      else playSfx('sfx_wood_block', 0.55);
    }
    if (m.a === 'build' || m.a === 'place') {
      ctx.sfx?.('ding');
      if (m.k === 'lighthouse') playSfx('sfx_ship_bell', 0.65);
      else playSfx('sfx_wood_block', 0.5);
    }
    if (m.a === 'deal' || m.a === 'bank' || m.a === 'trade' || m.a === 'chart') {
      ctx.sfx?.('whoosh');
      playSfx('sfx_paper_rustle', 0.5);
    }
    if (m.a === 'squall') {
      playSfx('sfx_squall_wind', 0.6);
    }
    if (m.a === 'end') lastGains = {};
    if (m.a === 'offer') {
      offerAt = Date.now();
      playSfx('sfx_paper_rustle', 0.45);
    }
    if (auto && pid === game.active && game.phase.name !== 'over') game.say(`(played for ${game.name(pid)})`);
    // A quick move by the active player buys them a little more time.
    if (game.phase.name === 'main' && deadline - Date.now() < 30000 && !auto) deadline = Date.now() + 30000;
    pushAll();
    return r;
  };

  ctx.on('message', (p, d) => {
    if (!p || !d) return;
    if (d.t === 'hello') return push(p.id);
    if (d.t === 'act') {
      const r = apply(p.id, d.m);
      if (r.err) ctx.send(p.id, { t: 'err', msg: r.err });
      else if (r.chart) ctx.send(p.id, { t: 'toast', msg: `You drew ${CHARTS[r.chart].icon} ${CHARTS[r.chart].name}!` });
    }
  });
  ctx.on('join', (p) => p && push(p.id));
  ctx.on('leave', () => render());

  // ---------- timers ----------
  function tick() {
    const ph = game.phase.name;
    const waiting = game.waitingOn();
    const key = `${ph}:${game.active}:${game.phase.step ?? ''}:${game.phase.want ?? ''}:${waiting.join(',')}`;
    if (key !== deadKey) {
      deadKey = key;
      const turnKey = `${game.round}:${game.turn}`;
      // Back in the main phase of the same turn (after a chart or the squall): keep the clock.
      if (ph === 'main' && mainTurn === turnKey && deadline > Date.now()) deadline = Math.max(deadline, Date.now() + 20000);
      else deadline = Date.now() + (LIMIT[ph] || 60) * 1000;
      if (ph === 'main') mainTurn = turnKey;
      pushAll();
    }
    if (deadline !== clockFor && ph !== 'over') { clockFor = deadline; stopClock?.(); stopClock = ctx.clock(secsLeft()); }
    // Nobody left in the room: pause rather than play the whole game by itself.
    if (!ctx.connected.length) { deadline = Math.max(deadline, Date.now() + 5000); return; }
    // Absent players get played for quickly.
    const away = waiting.filter((pid) => !ctx.player(pid)?.connected);
    const late = Date.now() > deadline;
    for (const pid of waiting) {
      const gone = away.includes(pid);
      if (!late && !(gone && Date.now() > awaySince(pid) + AWAY * 1000)) continue;
      for (let k = 0; k < 8 && game.waitingOn().includes(pid) && game.phase.name !== 'over'; k++) {
        const m = game.autoMove(pid, false);
        if (!m || apply(pid, m, true).err) break;
        if (game.phase.name === 'roll' || game.active !== pid) break;
      }
    }
    if (game.offer && Date.now() - offerAt > OFFER_TIME * 1000) { game.offer = null; game.say('The offer expired.'); pushAll(); }
  }
  const awayAt = new Map();
  function awaySince(pid) {
    if (ctx.player(pid)?.connected) { awayAt.delete(pid); return Infinity; }
    if (!awayAt.has(pid)) awayAt.set(pid, Date.now());
    return awayAt.get(pid);
  }

  // ---------- the TV ----------
  const phaseText = () => {
    const s = game.phase;
    switch (s.name) {
      case 'setup': return s.want === 'hut' ? `is placing ${s.step >= seats.length ? 'a second' : 'a'} hut` : 'is placing a bridge';
      case 'roll': return 'is about to roll';
      case 'discard': return 'Squall! Waiting for big hands to drop half';
      case 'squall': return 'is moving the squall ⛈️';
      case 'steal': return 'is choosing who to rob';
      case 'crew': return 'is building free bridges';
      case 'main': return 'is building and trading';
      default: return '';
    }
  };

  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const die = (n) => h('div.sw-die', Array.from({ length: 9 }, (_, i) => h('i' + (PIPS[n].includes(i) ? '.on' : ''))));

  function render() {
    const v = game.view();
    const act = v.active != null ? game.p.get(v.active) : null;
    const dice = v.dice ? h('div.sw-dice' + (Date.now() - rollAnim < 1500 ? '.sw-roll' : ''),
      v.dice.map(die),
      h('div.sw-dsum' + (v.dice[0] + v.dice[1] === 7 ? '.sw-seven' : ''), v.dice[0] + v.dice[1])) : null;
    const offer = v.offer && h('div.sw-offer',
      h('div', h('b', { style: { color: colors.get(v.offer.from) } }, game.name(v.offer.from)), ' offers'),
      h('div.sw-trade', h('span', formatCards(v.offer.give)), h('span.sw-arrow', '⇄'), h('span', formatCards(v.offer.get))),
      h('div.sw-replies', seats.filter((p) => p.id !== v.offer.from).map((p) => {
        const r = v.offer.replies[p.id];
        return h('span.sw-reply', { style: { '--c': p.color } }, (r === true ? '✓ ' : r === false ? '✗ ' : '… ') + p.name);
      })));
    const rows = v.players.map((p) => {
      const g = lastGains[p.id];
      return h('div.sw-prow' + (p.id === v.active ? '.sw-act' : '') + (ctx.player(p.id)?.connected ? '' : '.sw-away'), { style: { '--c': p.color } },
        h('div.sw-pname', p.name, !ctx.player(p.id)?.connected && h('span.sw-tag', 'away')),
        h('div.sw-pts', p.points, h('small', '★')),
        h('div.sw-pstats',
          h('span', { title: 'cards' }, '🂠 ', p.cards),
          h('span', { title: 'charts' }, '📜 ', p.charts),
          h('span', { title: 'longest causeway' }, '🌉 ', p.causeway),
          p.vanes ? h('span', { title: 'weathervanes played' }, '🌀 ', p.vanes) : null,
          g && h('span.sw-gain', '+', formatCards(g))),
        h('div.sw-awards',
          v.awards.causeway === p.id && h('span.sw-award', '🌉 Longest Causeway'),
          v.awards.rider === p.id && h('span.sw-award', '🌀 Storm Rider')));
    });
    const legend = h('div.sw-legend', [
      ['Bridge', COST.bridge, '1 piece of causeway'], ['Hut', COST.hut, '1★'],
      ['Lighthouse', COST.lighthouse, '2★, double cargo'], ['Chart', COST.chart, 'a surprise'],
    ].map(([n, c]) => h('div', h('b', n), h('span', formatCards(c)))));
    const many = v.players.length > 4;

    if (v.phase === 'over') {
      const ranked = [...v.players].sort((a, b) => b.points - a.points);
      ctx.el.replaceChildren(h('div.sw-tv',
        h('div.sw-boardwrap', drawBoard(v, { colors })),
        h('div.sw-side',
          h('h1.sw-win', { style: { color: colors.get(v.winner) } }, `${game.name(v.winner)} wins!`),
          ranked.map((p, i) => h('div.sw-prow', { style: { '--c': p.color } },
            h('div.sw-pname', `${i + 1}. ${p.name}`), h('div.sw-pts', p.points, h('small', '★')),
            h('div.sw-pstats', p.coves ? `🏝️ ${p.coves} hidden cove${p.coves > 1 ? 's' : ''}` : ''))),
          h('div.sw-log', v.log.slice(-5).map((l) => h('div', l.text))))));
      return;
    }
    ctx.el.replaceChildren(h('div.sw-tv',
      h('div.sw-boardwrap', drawBoard(v, { colors })),
      h('div.sw-side',
        h('div.sw-turn', { style: { '--c': act?.color || '#fff' } },
          v.phase === 'discard' ? h('div.sw-phase', phaseText())
            : [h('div.sw-who', act?.name), h('div.sw-phase', phaseText())],
          dice || h('div.sw-dice')),
        h('div.sw-target', `First to ${v.target}★ · round ${Math.max(1, v.round)}`),
        h('div.sw-players' + (many ? '.sw-many' : ''), rows),
        offer,
        h('div.sw-log', v.log.slice(-6).map((l) => h('div', { style: { color: l.pid ? colors.get(l.pid) : null } }, l.text))),
        !(many && offer) && legend)));
  }

  pushAll();
  tick();
  while (game.phase.name !== 'over') {
    await ctx.sleep(400);
    tick();
    if (Date.now() - rollAnim < 1600) render();
  }
  stopClock?.();
  render();
  ctx.sfx?.('win');
  playSfx('sfx_ship_bell', 0.75);
  const w = game.p.get(game.winner);
  ctx.show('all', { title: `${w.name} wins!`, text: `with ${game.points(w.id)} points. Look at the TV for the final scores.`, color: w.color });
  try {
    await ctx.sleep(20000);
  } finally {
    bgm.pause();
    bgm.src = '';
    window.removeEventListener('storage', syncMute);
  }
}
