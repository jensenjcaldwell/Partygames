import { ARENAS, CARDS, copy, createGame, beginRound, resolveBeat, endRound, standings, planBot, validProgram, collapseCells } from './engine.js';
import { installStyle, createArena } from './render.js';
import { artElement } from './art.js';

export default async function (ctx) {
  const { h } = ctx;
  await installStyle(ctx);
  if (ctx.connected.length > 8) return ctx.say('The shift is full', 'Bot Brawl supports up to 8 players. Remove extra players in the lobby and try again.', 4500);
  const humans = ctx.connected.slice(0, 8);
  if (humans.length < 2) return ctx.say('Recruit another operator', 'Bot Brawl needs 2–8 players. You can add computer opponents after starting.', 4500);
  const humanIds = new Set(humans.map((p) => p.id));
  const match = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const settings = { mode: 'race', arena: ARENAS[0].id, bots: Math.max(0, 4 - humans.length), seconds: 35 };
  let phase = 'setup', started = false, state, arena, endsAt = 0, programs = new Map(), locked = new Set(), feed = [];
  let currentBeat = -1;
  const online = (id) => !!ctx.player(id)?.connected;
  const captain = () => humans.find((p) => online(p.id));
  const ui = (extra = {}) => ({ planning: phase === 'program', programs, locked, feed, ...extra });
  const sound = (name) => ctx.sfx(name);

  ctx.on('message', (p, data) => {
    if (!p || !humanIds.has(p.id) || !data || data.match !== match) return;
    if (phase === 'setup' && p.id === captain()?.id && data.type === 'settings') {
      applySettings(data); return;
    }
    if (phase !== 'program' || data.round !== state.round || Date.now() >= endsAt) return;
    const b = state.bots.find((bot) => bot.id === p.id);
    if (!b?.alive) return;
    if (data.type === 'unlock') {
      locked.delete(p.id); sendPhone(b); arena.draw(state, ui());
    } else if (data.type === 'program' && !locked.has(p.id) && validProgram(data.cards) && typeof data.power === 'boolean') {
      programs.set(p.id, { cards: [...data.cards], power: !!b.power && data.power });
      locked.add(p.id); sound('bb-lock'); sendPhone(b); arena.draw(state, ui());
    }
  });
  for (const ev of ['join', 'leave']) ctx.on(ev, () => {
    if (phase === 'setup') drawSetup();
    else if (state && arena && phase === 'program') {
      for (const b of state.bots.filter((b) => !b.cpu)) sendPhone(b);
      arena.draw(state, ui());
    }
  });

  function applySettings(data) {
    if (['race', 'survival'].includes(data.mode)) settings.mode = data.mode;
    if (ARENAS.some((a) => a.id === data.arena)) settings.arena = data.arena;
    if (Number.isInteger(data.bots)) settings.bots = Math.max(0, Math.min(8 - humans.length, data.bots));
    if ([25, 35, 50].includes(data.seconds)) settings.seconds = data.seconds;
    if (data.start === true) started = true;
    else drawSetup();
  }

  function drawSetup() {
    const option = (label, field, value) => h(`button.bb-option${settings[field] === value ? '.selected' : ''}`, {
      onclick: () => applySettings({ [field]: value }), 'aria-pressed': settings[field] === value,
    }, label);
    ctx.el.replaceChildren(h('div.bb-root', h('div.bb-setup',
      h('div', h('h1.bb-title', 'Bot Brawl'),
        artElement(h, 1, '#ffb547', 'bb-hero'),
        h('p', 'Four moves. Eight questionable machines. One deeply unsafe workplace.'),
        h('p.bb-label', 'Choose your workplace hazard'),
        h('div.bb-arena-options', ARENAS.map((a) => h(`button.bb-arena-option${settings.arena === a.id ? '.selected' : ''}`, {
          'aria-pressed': settings.arena === a.id, onclick: () => applySettings({ arena: a.id }),
        }, h('b', `${a.icon} ${a.name}`), h('span', a.description)))),
        h('p', 'Crates arrive in round 2. Every power-up has a cost. Read the label.')),
      h('div.bb-setup-controls', h('h2', 'Welcome to the night shift'),
        h('p', 'Queue four cards in secret. Each beat: bots move in rotating priority, then belts move and factory lasers fire. Shove friends. Mind the holes.'),
        h('p.bb-label', 'Choose the job'),
        h('div.bb-options', option('⚑ Flag race', 'mode', 'race'), option('ϟ Survival', 'mode', 'survival')),
        h('p', settings.mode === 'race'
          ? 'Collect the moving flag once per round. First to 3 flags, or most flags after 10 rounds. Unlimited reboots.'
          : 'Three lives each. Reboot next round when wrecked. The outer floor collapses after rounds 2, 4 and 6. Last bot with lives wins; 8-round limit.'),
        h('div.bb-stepper', 'Computer opponents',
          h('button', { disabled: settings.bots === 0, 'aria-label': 'Remove computer opponent', onclick: () => applySettings({ bots: settings.bots - 1 }) }, '−'),
          h('b', String(settings.bots)),
          h('button', { disabled: settings.bots >= 8 - humans.length, 'aria-label': 'Add computer opponent', onclick: () => applySettings({ bots: settings.bots + 1 }) }, '+')),
        h('p.bb-label', 'Planning time'),
        h('div.bb-options', ...[25, 35, 50].map((seconds) => option(`${seconds}s`, 'seconds', seconds))),
        h('button.bb-start', { onclick: () => { started = true; } }, `Clock in · ${humans.length + settings.bots} bots`),
        h('p', `${captain()?.name || 'The host'} can also start from their phone.`)))));
    for (const p of humans) ctx.show(p.id, { botBrawl: { phase: 'setup', match, captain: captain()?.id === p.id,
      captainName: captain()?.name || 'The host', settings, humans: humans.length } });
  }

  function sendPhone(b, extra = {}) {
    if (b.cpu) return;
    ctx.show(b.id, { color: b.color, botBrawl: {
      phase, match, round: state.round, mode: state.mode, maxRounds: state.maxRounds,
      endsAt, bot: copy(b), beat: currentBeat, event: state.event,
      collapse: collapseCells(state).length > 0, arena: state.arena,
      locked: locked.has(b.id), program: programs.get(b.id) || null,
      priority: state.priority.indexOf(b.id) + 1, ...extra,
    } });
  }
  function sendAll(extra = {}) { for (const b of state.bots) sendPhone(b, extra); }
  function addEvents(events) {
    feed.push(...events.filter((e) => !['bump', 'respawn'].includes(e.type)));
    feed = feed.slice(-6);
    if (events.some((e) => e.type === 'fall')) sound('bb-wail');
    else if (events.some((e) => e.type === 'flag')) sound('bb-cheer');
    else if (events.some((e) => e.type === 'push')) sound('bb-clank');
    else if (events.some((e) => e.type === 'hit')) sound('bb-zap');
    else if (events.some((e) => ['power', 'pickup'].includes(e.type))) sound('bb-chirp');
  }

  drawSetup();
  ctx.music('factory');
  while (!started) await ctx.sleep(150);
  state = createGame(humans, settings);
  arena = createArena(ctx);
  while (!state.done) {
    beginRound(state);
    currentBeat = -1; phase = 'program'; programs = new Map(); locked = new Set();
    feed = [{ text: `Round ${state.round}. ${state.round === 1 ? 'No power-ups this round. Learn the floor before it learns you.' : state.round === 2 ? 'Volatile power-ups have arrived. Read the warning labels.' : state.event.help}` }];
    endsAt = Date.now() + settings.seconds * 1000;
    // AI only sees the board at the start of planning, never human programs.
    for (const b of state.bots) if (b.cpu && b.alive) {
      programs.set(b.id, planBot(state, b)); locked.add(b.id);
    }
    sendAll(); arena.draw(state, ui()); sound('bb-chirp');
    const stopClock = ctx.clock(Math.max(1, Math.ceil((endsAt - Date.now()) / 1000)));
    const earliest = Date.now() + 1200;
    try {
      while (Date.now() < endsAt) {
        const waiting = state.bots.filter((b) => !b.cpu && b.alive && online(b.id) && !locked.has(b.id));
        if (!waiting.length && Date.now() >= earliest) break;
        await ctx.sleep(150);
      }
    } finally { stopClock(); }
    phase = 'resolve';
    for (const b of state.bots) if (b.alive && !programs.has(b.id)) {
      programs.set(b.id, planBot(state, b));
      feed.push({ text: `${b.name}'s safety autopilot filled the missing program.` });
    }
    sendAll(); arena.draw(state, ui({ phase: 'Programs revealed!' })); sound('bb-lock');
    await ctx.sleep(1100);
    let highlight = null;
    for (let beat = 0; beat < 4; beat++) {
      currentBeat = beat;
      const before = copy(state); before.beat = beat; before.events = []; before.beams = [];
      const frames = [{ state: before, phase: `Beat ${beat + 1}`, active: null }];
      let score = 0;
      sendAll();
      for (const frame of resolveBeat(state, programs, beat)) {
        const label = frame.kind === 'belts' ? 'Conveyors rolling' : frame.kind === 'factory' ? 'Factory lasers' : frame.kind === 'power' ? 'Power-ups online' : `Beat ${beat + 1} · ${CARDS[frame.card].label}`;
        addEvents(state.events);
        score += state.events.reduce((n, e) => n + ({ fall: 8, push: 2, flag: 5, hit: 1 }[e.type] || 0), 0);
        frames.push({ state: copy(state), phase: label, active: frame.active });
        arena.draw(state, ui({ phase: label, active: frame.active }));
        if (frame.kind === 'belts') sound('bb-whirr');
        else if (frame.card === 'laser' || frame.kind === 'factory') sound('bb-zap');
        else if (frame.kind === 'action') sound('bb-step');
        await ctx.sleep(frame.kind === 'action' ? 200 : frame.kind === 'factory' ? 600 : 380);
      }
      sendAll();
      if (score >= 5 && (!highlight || score > highlight.score)) highlight = { score, frames };
      await ctx.sleep(350);
    }
    endRound(state); addEvents(state.events);
    arena.draw(state, ui({ phase: 'Shift complete' })); sendAll();
    await ctx.sleep(state.events.length ? 1800 : 700);
    if (highlight) {
      phase = 'replay'; sendAll();
      sound('bb-rewind');
      for (const frame of highlight.frames) {
        arena.draw(frame.state, ui({ planning: false, replay: true, phase: frame.phase, active: frame.active,
          feed: frame.state.events.length ? frame.state.events : [{ text: 'The incident review board would like another look.' }] }));
        await ctx.sleep(frame.state.events.some((e) => e.type === 'fall') ? 950 : 420);
      }
      phase = 'resolve'; arena.draw(state, ui({ phase: 'Back to the factory' }));
      await ctx.sleep(600);
    }
  }
  phase = 'results';
  const ranking = standings(state);
  const winners = ranking.filter((b) => state.winnerIds.includes(b.id));
  const winnerText = winners.length === 1 ? `${winners[0].name} wins!` : 'Shared employee of the month!';
  for (const b of state.bots) sendPhone(b, { winner: state.winnerIds.includes(b.id), winnerText });
  sound('win');
  let leaveResults = false;
  ctx.el.replaceChildren(h('div.bb-root', h('div.bb-results',
    h('p.bb-label', 'Management has reviewed the footage'), h('h1', winnerText),
    h('p', state.mode === 'race' ? 'Flag race · ranked by flags, knockouts, hull, then fewest wrecks.' : 'Factory survival · ranked by lives, hull (or latest elimination), then knockouts.'),
    h('div.bb-podium', ranking.slice(0, 3).map((b, i) => h('div.bb-final-bot',
      artElement(h, b.number, b.color), h('strong', `${i + 1}. ${b.name}`),
      h('span', state.mode === 'race' ? `${b.flags} flags · ${b.kos} KO` : `${b.lives} lives · ${b.kos} KO`)))),
    h('div.bb-placements', ranking.slice(3).map((b, i) => h('div', `${i + 4}. ${b.name} · ${state.mode === 'race' ? `${b.flags} flags` : `${b.lives} lives`} · ${b.kos} KO`))),
    h('p', 'Thanks for working an entirely avoidable night shift.'),
    h('button.bb-start', { onclick: () => { leaveResults = true; } }, 'Back to the lobby'))));
  const resultEnd = Date.now() + 20000;
  while (!leaveResults && Date.now() < resultEnd) await ctx.sleep(200);
}
