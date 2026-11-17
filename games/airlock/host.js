// Airlock: a two-room hidden-team game.
//
// Everyone gets a secret card. The group splits into two station modules
// (two real rooms). Each module elects a chief; at the end of each round the
// chiefs send people through the airlock to the other module. After the last
// round: if the Mimic is in the same module as the Captain, the Swarm wins;
// otherwise the Crew wins. Phones handle cards, sharing, votes and picks;
// the TV shows the modules, the rounds and the timer.
import { ROLES, TEAMS, MODULES, dealRoles, transfers } from './roles.js';

const LENGTHS = {
  quick: { label: 'Quick', rounds: [120, 90, 60] },
  standard: { label: 'Standard', rounds: [180, 120, 60] },
  long: { label: 'Long', rounds: [300, 180, 120] },
};
const ELECT_TIME = 45;
const PICK_TIME = 30;
const MOVE_TIME = 20;

export default async function (ctx) {
  const { h } = ctx;
  injectCss();
  const card = (role) => ctx.asset(`cards/${role}.svg`);
  const teamCard = (team) => ctx.asset(`cards/team-${team}.svg`);

  const everyone = ctx.shuffle(ctx.connected);
  const n = everyone.length;
  if (n < 6) return ctx.say('Not enough crew', 'Airlock needs at least 6 players.', 5000);

  // ---------- state ----------
  const S = {
    phase: 'intro',
    round: 0,
    rounds: 3,
    endsAt: 0,
    role: new Map(),     // id -> role key
    room: new Map(),     // id -> 'A' | 'B'
    chief: { A: null, B: null },
    votes: new Map(),    // id -> id they back as chief (same module)
    seen: new Map(),     // id -> [{ seq, from, what, role, team, scan }] newest first
    shownTo: new Map(),  // id -> Map(to -> Set('card'|'team')) this round
    powerUsed: new Set(),
    shares: { A: 0, B: 0 },
    flash: null,         // short TV message
  };
  let seq = 0;
  const ids = everyone.map((p) => p.id);
  const name = (id) => ctx.player(id)?.name ?? '?';
  const color = (id) => ctx.player(id)?.color ?? '#888';
  const online = (id) => !!ctx.player(id)?.connected;
  const members = (r) => ids.filter((id) => S.room.get(id) === r);
  const other = (r) => (r === 'A' ? 'B' : 'A');
  const meOf = (id) => ({ role: S.role.get(id), room: S.room.get(id) });

  // ---------- phone actions ----------
  ctx.on('message', (p, d) => {
    if (!p || !d || S.phase !== 'round' || !S.role.has(p.id)) return;
    const me = p.id, r = S.room.get(me);
    const sameRoom = (x) => S.role.has(x) && x !== me && S.room.get(x) === r;
    if (d.a === 'show' && sameRoom(d.to) && (d.what === 'card' || d.what === 'team')) {
      const done = S.shownTo.get(me).get(d.to) || new Set();
      if (done.has(d.what)) return; // once per person per round is plenty
      done.add(d.what);
      S.shownTo.get(me).set(d.to, done);
      const role = S.role.get(me);
      S.seen.set(d.to, [{ seq: ++seq, from: me, name: name(me), what: d.what,
        role: d.what === 'card' ? role : null, team: ROLES[role].team }, ...S.seen.get(d.to)]);
      S.shares[r]++;
      ctx.show(d.to, { ...viewFor(d.to), buzz: true });
      ctx.show(me, viewFor(me));
      drawRound();
    } else if (d.a === 'vote' && (sameRoom(d.for) || d.for === me)) {
      S.votes.set(me, d.for);
      checkCoup(r);
      pushAll();
      drawRound();
    } else if (d.a === 'power' && sameRoom(d.target) && ROLES[S.role.get(me)].power && !S.powerUsed.has(me)) {
      S.powerUsed.add(me);
      const role = S.role.get(d.target);
      S.seen.set(me, [{ seq: ++seq, from: d.target, name: name(d.target), what: 'card', role, team: ROLES[role].team, scan: true },
        ...S.seen.get(me)]);
      ctx.show(me, viewFor(me));
    }
  });
  ctx.on('leave', () => { if (S.phase === 'round') drawRound(); });
  ctx.on('join', () => { if (S.phase === 'round') drawRound(); });

  // ---------- intro + length ----------
  const length = await intro();
  const times = LENGTHS[length].rounds;
  const hostages = transfers(n);
  S.rounds = times.length;

  // ---------- deal ----------
  dealRoles(n, ctx.shuffle).forEach((r, i) => S.role.set(ids[i], r));
  ctx.shuffle(ids).forEach((id, i) => S.room.set(id, i % 2 ? 'B' : 'A'));
  for (const id of ids) S.seen.set(id, []), S.shownTo.set(id, new Map());

  S.phase = 'deal';
  put(h('div.al-say',
    h('img.al-back', { src: card('back') }),
    h('h1', 'Check your card'),
    h('p.sub', 'Keep it secret. Then look at which module you start in.')));
  await Promise.all(ids.map((id) => {
    const role = ROLES[S.role.get(id)];
    return ctx.ask(id, {
      title: `You are the ${role.name}`,
      image: card(S.role.get(id)),
      text: role.goal,
      choices: ['Got it'],
      me: meOf(id),
    }, { timeout: 40, clock: false, after: {
      title: `Go to ${MODULES[S.room.get(id)]}`,
      text: S.room.get(id) === 'A' ? 'Module A is the room with the TV.' : 'Module B is the other room.',
      wait: 'Waiting for everyone to read their card…',
      me: meOf(id),
    } });
  }));

  // ---------- split up ----------
  S.phase = 'split';
  for (const id of ids) {
    ctx.show(id, {
      title: `Go to ${MODULES[S.room.get(id)]}`,
      text: S.room.get(id) === 'A' ? 'Module A is the room with the TV.' : 'Module B is the other room. Take your phone!',
      wait: 'Round 1 starts in a moment…', buzz: true, me: meOf(id),
    });
  }
  drawModules('Split up!', 'Go to your module. Module A stays with the TV.');
  await ctx.countdown(MOVE_TIME);

  // ---------- election ----------
  S.phase = 'elect';
  drawModules('Elect your chiefs', 'Vote on your phone. Chiefs decide who goes through the airlock.');
  await Promise.all(['A', 'B'].map(async (r) => {
    const mem = members(r);
    const got = await ctx.ask(mem, {
      title: 'Elect your chief',
      text: `Who leads ${MODULES[r]}? The chief picks who gets sent through the airlock. You can switch your vote later.`,
      choices: mem.map((id) => ({ label: name(id), value: id })),
    }, { timeout: ELECT_TIME, after: { wait: 'Vote in. Waiting for the others…' } });
    for (const [voter, cand] of got) if (mem.includes(cand)) S.votes.set(voter, cand);
    S.chief[r] = plurality(r) ?? ctx.pick(mem.filter(online).length ? mem.filter(online) : mem);
  }));

  // ---------- rounds ----------
  for (let round = 1; round <= S.rounds; round++) {
    S.round = round;
    S.phase = 'round';
    S.shares = { A: 0, B: 0 };
    for (const id of ids) S.shownTo.get(id).clear();
    const secs = times[round - 1];
    S.endsAt = Date.now() + secs * 1000;
    pushAll();
    drawRound();
    sfx('start');
    const stop = ctx.clock(secs);
    await waitOrSkip(secs * 1000);
    stop();

    // chiefs pick who goes
    S.phase = 'pick';
    const k = Math.min(hostages[round - 1], members('A').length - 1, members('B').length - 1);
    for (const id of ids) {
      if (id !== S.chief.A && id !== S.chief.B) ctx.show(id, {
        title: 'Airlock cycling', wait: `Your chief, ${name(S.chief[S.room.get(id)])}, is choosing who goes…`, me: meOf(id),
      });
    }
    drawModules('Airlock cycling', `Chiefs: pick ${k} ${k === 1 ? 'person' : 'people'} to send to the other module.`);
    const sent = {};
    await Promise.all(['A', 'B'].map(async (r) => {
      const chief = S.chief[r];
      const opts = members(r).filter((id) => id !== chief);
      const got = await ctx.ask(chief, {
        title: k === 1 ? 'Who goes through the airlock?' : `Pick ${k} to send through the airlock`,
        text: `They move to ${MODULES[other(r)]}. You stay.`,
        choices: opts.map((id) => ({ label: name(id), value: id })),
        ...(k > 1 ? { multi: { min: k, max: k, submit: 'Send them' } } : {}),
        buzz: true, me: meOf(chief),
      }, { timeout: PICK_TIME, after: { wait: 'Sealing the airlock…', me: meOf(chief) } });
      let picks = got.get(chief);
      picks = (Array.isArray(picks) ? picks : picks != null ? [picks] : []).filter((id) => opts.includes(id));
      picks = [...new Set(picks)];
      for (const id of ctx.shuffle(opts)) if (picks.length < k && !picks.includes(id)) picks.push(id);
      sent[r] = picks.slice(0, k);
    }));

    // swap
    S.phase = 'move';
    for (const r of ['A', 'B']) for (const id of sent[r]) S.room.set(id, other(r));
    const moved = new Set([...sent.A, ...sent.B]);
    for (const [voter, cand] of [...S.votes]) {
      if (moved.has(voter) || S.room.get(voter) !== S.room.get(cand)) S.votes.delete(voter);
    }
    for (const id of ids) {
      ctx.show(id, moved.has(id)
        ? { title: 'Through the airlock!', text: `Walk to ${MODULES[S.room.get(id)]} now.`, buzz: true, color: '#ffd34d', me: meOf(id) }
        : { title: round < S.rounds ? 'Stay put' : 'Airlock sealed', wait: round < S.rounds ? 'New arrivals are on their way…' : 'Look at the TV!', me: meOf(id) });
    }
    drawSwap(sent, round === S.rounds);
    sfx('whoosh');
    await ctx.countdown(round < S.rounds ? MOVE_TIME : 8);
  }

  // ---------- reveal ----------
  S.phase = 'end';
  const captain = ids.find((id) => S.role.get(id) === 'captain');
  const mimic = ids.find((id) => S.role.get(id) === 'mimic');
  const together = S.room.get(captain) === S.room.get(mimic);
  const winner = together ? 'swarm' : 'crew';
  const won = (id) => {
    const t = ROLES[S.role.get(id)].team;
    return t === 'drift' ? S.room.get(id) !== S.room.get(mimic) : t === winner;
  };
  for (const id of ids) {
    const role = ROLES[S.role.get(id)];
    ctx.show(id, {
      title: won(id) ? 'You won!' : 'You lost',
      image: card(S.role.get(id)),
      text: together ? 'The Mimic reached the Captain. The Swarm takes the station.' : 'The Captain escaped the Mimic. The Crew holds the station.',
      color: won(id) ? TEAMS[role.team].color : '#a9a2c8', buzz: true,
    });
  }
  put(h('div.al-say', h('h1', 'Where is the Captain?')));
  await ctx.sleep(2500);
  put(h('div.al-reveal',
    revealCard(captain, 'The Captain')),
  h('p.sub', `${name(captain)} ended in ${MODULES[S.room.get(captain)]}`));
  await ctx.sleep(3500);
  put(h('div.al-say', h('h1', 'And the Mimic?')));
  await ctx.sleep(2500);
  put(h('div.al-reveal', revealCard(captain, 'The Captain'), revealCard(mimic, 'The Mimic')),
    h('h1.al-result', { style: { color: TEAMS[winner].color } }, together ? 'The Swarm takes the station!' : 'The Crew holds the station!'),
    h('p.sub', together ? `Both in ${MODULES[S.room.get(captain)]}.` : 'They ended in different modules.'));
  sfx('win');
  await ctx.sleep(6000);
  // everyone's cards, by module
  put(
    h('h1.al-result', { style: { color: TEAMS[winner].color } }, together ? 'Swarm wins' : 'Crew wins'),
    h('div.al-ship.al-final', ['A', 'B'].map((r) => h('div.al-mod',
      h('h2', MODULES[r]),
      h('div.al-cards', members(r).map((id) => h('div.al-mini' + (won(id) ? '.won' : ''),
        h('img', { src: card(S.role.get(id)) }),
        h('span', { style: { color: color(id) } }, name(id)))))))),
    ids.some((id) => S.role.get(id) === 'drifter')
      ? h('p.sub', ids.filter((id) => S.role.get(id) === 'drifter').map((id) => `Drifter ${name(id)} ${won(id) ? 'got away from the Mimic and wins too.' : 'got stuck with the Mimic.'}`).join(' '))
      : null);
  await ctx.sleep(15000);

  // ================= helpers =================

  function sfx(name) { try { ctx.sfx?.(name); } catch {} }
  function put(...kids) { ctx.el.replaceChildren(...kids.filter(Boolean)); }

  function revealCard(id, label) {
    return h('div.al-big',
      h('p.sub', label),
      h('img', { src: card(S.role.get(id)) }),
      h('h2', { style: { color: color(id) } }, name(id)),
      h('p.al-where', MODULES[S.room.get(id)]));
  }

  async function intro() {
    let choose;
    const chosen = new Promise((r) => (choose = r));
    put(h('div.al-intro',
      h('div.al-introcards', ['captain', 'back', 'mimic'].map((r) => h('img', { src: card(r) }))),
      h('h1', 'Airlock'),
      h('p.lead', 'The station is split into two modules: this room and another one. Somewhere on board are the Captain and a shapeshifting Mimic.'),
      h('ul.al-rules',
        h('li', h('b', { style: { color: TEAMS.crew.color } }, 'Crew'), ' wins if the Captain ends up in a different module from the Mimic.'),
        h('li', h('b', { style: { color: TEAMS.swarm.color } }, 'Swarm'), ' wins if the Mimic ends up in the same module as the Captain.'),
        h('li', 'Use your phone to show your card or just your colour to someone in your module. Trust carefully.'),
        h('li', 'Each module elects a chief. When the timer runs out, chiefs send people through the airlock.'),
        h('li', 'Three rounds, then the airlock seals for good. Then the cards are revealed.')),
      h('p.sub', 'Pick a game length:'),
      h('div.row', Object.entries(LENGTHS).map(([k, v]) => h('button' + (k === 'standard' ? '.big' : '.ghost'),
        { onclick: () => choose(k) }, `${v.label} · ${v.rounds.map(fmt).join(' / ')}`)))));
    ctx.show('all', { title: 'Airlock', wait: 'The host is picking a game length…' });
    const stop = ctx.clock(30);
    const timer = ctx.sleep(30000).then(() => 'standard');
    timer.catch(() => {});
    try { return await Promise.race([chosen, timer]); } finally { stop(); }
  }

  async function waitOrSkip(ms) {
    let skip;
    S.skip = new Promise((r) => (skip = r));
    S.doSkip = skip;
    const t = ctx.sleep(ms);
    t.catch(() => {});
    await Promise.race([t, S.skip]);
    S.doSkip = null;
  }

  function plurality(r) {
    const tally = new Map();
    for (const [voter, cand] of S.votes) {
      if (S.room.get(voter) === r && S.room.get(cand) === r) tally.set(cand, (tally.get(cand) || 0) + 1);
    }
    if (!tally.size) return null;
    const best = Math.max(...tally.values());
    return ctx.pick([...tally].filter(([, v]) => v === best).map(([k]) => k));
  }

  function voteCount(id) {
    let c = 0;
    for (const [voter, cand] of S.votes) if (cand === id && S.room.get(voter) === S.room.get(id)) c++;
    return c;
  }

  /** A challenger who gets more than half the module's votes takes over. */
  function checkCoup(r) {
    const mem = members(r);
    for (const id of mem) {
      if (id !== S.chief[r] && voteCount(id) > mem.length / 2) {
        S.chief[r] = id;
        flash(`${name(id)} is the new chief of ${MODULES[r]}!`);
        sfx('ding');
        return true;
      }
    }
    return false;
  }

  function flash(msg) {
    S.flash = msg;
    clearTimeout(S.flashT);
    S.flashT = ctx.setTimeout(() => { S.flash = null; if (S.phase === 'round') drawRound(); }, 5000);
  }

  function viewFor(id) {
    const r = S.room.get(id);
    return {
      airlock: {
        round: S.round, rounds: S.rounds, endsAt: S.endsAt,
        room: r, roomName: MODULES[r],
        role: S.role.get(id), chief: S.chief[r],
        vote: S.votes.get(id) ?? null,
        powerLeft: !!ROLES[S.role.get(id)].power && !S.powerUsed.has(id),
        mates: members(r).filter((x) => x !== id).map((x) => ({
          id: x, name: name(x), color: color(x), chief: x === S.chief[r], votes: voteCount(x),
          shown: S.shownTo.get(id).has(x),
          shownCard: !!S.shownTo.get(id).get(x)?.has('card'),
        })),
        myVotes: voteCount(id),
        seen: S.seen.get(id).slice(0, 30),
        flash: S.flash,
      },
      me: meOf(id),
    };
  }

  function pushAll() {
    if (S.phase !== 'round') return;
    for (const id of ids) ctx.show(id, viewFor(id));
  }

  function drawRound() {
    if (S.phase !== 'round') return;
    const k = Math.min(hostages[S.round - 1], members('A').length - 1);
    drawModules(`Round ${S.round} of ${S.rounds}`,
      `When time runs out, each chief sends ${k} ${k === 1 ? 'person' : 'people'} through the airlock.`,
      h('div.row',
        S.round === S.rounds ? h('p.al-last', 'Last round! The airlock seals after this.') : null,
        h('button.ghost.sm', { onclick: () => S.doSkip?.() }, 'Open the airlock now')));
  }

  function drawModules(title, sub, extra) {
    put(
      h('h1', title),
      h('p.sub', sub),
      S.flash ? h('div.al-flash', S.flash) : null,
      h('div.al-ship',
        modPanel('A'),
        h('div.al-lock', h('img', { src: card('back') }), h('span', 'AIRLOCK')),
        modPanel('B')),
      extra || null);
  }

  function modPanel(r) {
    return h('div.al-mod',
      h('h2', MODULES[r], h('small', r === 'A' ? ' (TV room)' : ' (other room)')),
      h('div.al-people', members(r).map((id) => h('div.chip.al-chip' + (online(id) ? '' : '.away'),
        { style: { '--c': color(id) } },
        S.chief[r] === id ? h('span.al-crown', '★') : null, name(id)))),
      S.phase === 'round' ? h('p.al-stat', `${S.shares[r]} reveal${S.shares[r] === 1 ? '' : 's'} this round`) : null);
  }

  function drawSwap(sent, last) {
    put(
      h('h1', last ? 'The airlock seals!' : 'Through the airlock'),
      h('div.al-ship.al-swap',
        h('div.al-mod', h('h2', 'A → B'), h('div.al-people', sent.A.map((id) => h('div.chip.al-chip.al-go', { style: { '--c': color(id) } }, name(id))))),
        h('div.al-lock.open', h('img', { src: card('back') })),
        h('div.al-mod', h('h2', 'B → A'), h('div.al-people', sent.B.map((id) => h('div.chip.al-chip.al-go', { style: { '--c': color(id) } }, name(id)))))),
      h('p.sub', last ? 'Final positions are locked in…' : 'Go to your new module now.'));
  }

}

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function injectCss() {
  document.getElementById('airlock-css')?.remove();
  const css = Object.assign(document.createElement('style'), { id: 'airlock-css' });
  css.textContent = `
  .al-intro { display: flex; flex-direction: column; align-items: center; gap: 1.2vh; max-width: 1200px; }
  .al-intro h1 { font-size: 4em; letter-spacing: .04em; margin: 0; }
  .al-intro .lead { font-size: 1.3em; max-width: 900px; margin: 0; }
  .al-introcards { display: flex; gap: 2vw; }
  .al-introcards img { height: 24vh; filter: drop-shadow(0 10px 24px #0008); }
  .al-introcards img:first-child { transform: rotate(-8deg); }
  .al-introcards img:last-child { transform: rotate(8deg); }
  .al-rules { text-align: left; font-size: 1.05em; max-width: 1000px; margin: .4em 0; display: grid; gap: .3em; }
  .al-say { display: flex; flex-direction: column; align-items: center; gap: 2vh; }
  .al-say h1 { font-size: 3.2em; }
  .al-back { height: 34vh; animation: al-flip 1.6s ease-in-out infinite alternate; }
  @keyframes al-flip { from { transform: perspective(800px) rotateY(-18deg); } to { transform: perspective(800px) rotateY(18deg); } }
  .al-ship { display: grid; grid-template-columns: 1fr auto 1fr; gap: 2vw; width: 100%; max-width: 1500px; align-items: stretch; }
  .al-mod { background: var(--card); border: 3px solid var(--line); border-radius: 28px; padding: 2.5vh 1.5vw;
    display: flex; flex-direction: column; gap: 1.5vh; min-height: 34vh; }
  .al-mod h2 { font-size: 1.7em; margin: 0; }
  .al-mod small { color: var(--dim); font-size: .55em; font-weight: 700; }
  .al-people { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; align-content: flex-start; flex: 1; }
  .al-chip { font-size: 1.05em; padding: 8px 18px; }
  .al-crown { color: #ffd34d; font-size: 1.2em; }
  .al-stat { color: var(--dim); margin: 0; font-size: .85em; }
  .al-lock { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: #ffd34d; font-weight: 900; letter-spacing: .2em; font-size: .8em; }
  .al-lock img { height: 18vh; transition: transform .8s; }
  .al-lock.open img { animation: al-spin 2s ease-in-out infinite; }
  @keyframes al-spin { to { transform: rotate(360deg); } }
  .al-go { animation: pop .4s ease-out both; }
  .al-flash { background: #ffd34d; color: #120f1d; font-weight: 900; padding: .5em 1.2em; border-radius: 99px; animation: pop .3s ease-out; }
  .al-last { color: #ffd34d; font-weight: 900; margin: 0; }
  .al-reveal { display: flex; gap: 6vw; justify-content: center; }
  .al-big { display: flex; flex-direction: column; align-items: center; animation: pop .5s ease-out; }
  .al-big img { height: 42vh; filter: drop-shadow(0 10px 30px #000a); }
  .al-big h2 { font-size: 2em; margin: .3em 0 0; }
  .al-where { font-size: 1.3em; font-weight: 900; margin: 0; }
  .al-result { font-size: 3em; }
  .al-final { grid-template-columns: 1fr 1fr; }
  .al-cards { display: flex; flex-wrap: wrap; gap: 14px; justify-content: center; }
  .al-mini { display: flex; flex-direction: column; align-items: center; gap: 4px; font-weight: 900; font-size: .8em; opacity: .55; }
  .al-mini.won { opacity: 1; }
  .al-mini img { height: 15vh; }
  `;
  document.head.append(css);
}
