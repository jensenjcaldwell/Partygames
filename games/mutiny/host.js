// Mutiny on the Starling: a hidden-role voting game for 5–10 players.
//
// Most of the crew is loyal. A few are secret mutineers, and one of them is
// the Ringleader. Each round a Captain nominates a First Mate and everyone
// votes. If the pair is approved, the Captain draws three ship's orders,
// secretly scraps one, and hands two to the First Mate, who carries out one.
// Five Steady orders and the crew wins; six Mutiny orders, or the Ringleader
// made First Mate once three Mutiny orders are in, and the mutineers win.
// Mutiny orders also hand the Captain a special power (see POWERS).

const FAST = new URLSearchParams(location.search).has('fast'); // for automated tests
const T = (s) => (FAST ? Math.max(3, s / 10) : s);

// Players -> [crew, mutineers] (the Ringleader is extra).
const TEAMS = { 5: [3, 1], 6: [4, 1], 7: [4, 2], 8: [5, 2], 9: [5, 3], 10: [6, 3] };
// Power granted by the 1st..5th Mutiny order, by player count.
const POWERS = {
  small: [null, null, 'scan', 'airlock', 'airlock'],
  mid: [null, 'inspect', 'appoint', 'airlock', 'airlock'],
  big: ['inspect', 'inspect', 'appoint', 'airlock', 'airlock'],
};
const POWER_INFO = {
  scan: { icon: '📡', name: 'Long-range scan', text: 'The Captain secretly looks at the next three orders.' },
  inspect: { icon: '🔍', name: 'Background check', text: 'The Captain secretly learns one player’s loyalty.' },
  appoint: { icon: '🎖️', name: 'Field promotion', text: 'The Captain picks who is Captain next.' },
  airlock: { icon: '🚪', name: 'Airlock', text: 'The Captain throws someone out of the airlock.' },
};
const STEADY_TO_WIN = 5, MUTINY_TO_WIN = 6, RINGLEADER_DANGER = 3, VETO_AT = 5;

const CREW = '#4dd8ff', RED = '#ff5d73', GOLD = '#ffd166';

class GameOver { constructor(winner, why) { this.winner = winner; this.why = why; } }

export default async function (ctx) {
  const { h } = ctx;
  const say = (ms) => ctx.sleep(FAST ? Math.max(150, ms / 12) : ms);
  const seats = ctx.shuffle(ctx.connected);
  const n = seats.length;
  if (n < 5) return ctx.say('Not enough crew', 'Mutiny on the Starling needs 5 to 10 players.', 5000);
  if (n > 10) return ctx.say('Too many crew', 'Mutiny on the Starling takes at most 10 players.', 5000);

  // ---------- secret setup ----------
  const [, mutCount] = TEAMS[n];
  const order = ctx.shuffle(seats);
  const role = new Map();
  order.forEach((p, i) => role.set(p.id, i === 0 ? 'ringleader' : i <= mutCount ? 'mutineer' : 'crew'));
  const team = (id) => (role.get(id) === 'crew' ? 'crew' : 'mutiny');
  const powers = n <= 6 ? POWERS.small : n <= 8 ? POWERS.mid : POWERS.big;

  const S = {
    steady: 0, mutiny: 0, unrest: 0,
    deck: ctx.shuffle([...Array(6).fill('S'), ...Array(11).fill('M')]),
    discard: [],
    dead: new Set(), cleared: new Set(), inspected: new Set(),
    rot: -1, appointed: null,
    captain: null, mate: null, nominee: null,
    lastCaptain: null, lastMate: null,
    votes: null, answered: new Set(),
    log: [],
  };
  const alive = () => seats.filter((p) => !S.dead.has(p.id));
  const name = (p) => p.name;

  // ---------- phones ----------
  const roleInfo = (p) => {
    const r = role.get(p.id);
    const mates = seats.filter((q) => q.id !== p.id && team(q.id) === 'mutiny');
    const ring = seats.find((q) => role.get(q.id) === 'ringleader');
    let text;
    if (r === 'crew') text = 'You are loyal crew. Keep the Starling on course: pass Steady orders, and work out who the mutineers are. Watch for the Ringleader.';
    else if (r === 'mutineer') {
      const others = mates.filter((q) => q.id !== ring.id);
      text = `You are a mutineer. The Ringleader is ${ring.name}.`
        + (others.length ? ` Your fellow mutineers: ${others.map(name).join(', ')}.` : '')
        + ' Pass Mutiny orders, keep your cover, and get the Ringleader made First Mate.';
    } else {
      text = n <= 6
        ? `You are the Ringleader. Your mutineer is ${mates.map(name).join(', ')}. Act loyal. Once three Mutiny orders are in, being made First Mate wins it for you.`
        : 'You are the Ringleader. Your mutineers know you, but you don’t know them. Act loyal. Once three Mutiny orders are in, being made First Mate wins it for you.';
    }
    const title = r === 'crew' ? 'Loyal crew' : r === 'mutineer' ? 'Mutineer' : 'Ringleader';
    return { kind: 'role', title, text, image: ctx.asset(r === 'crew' ? 'crew.svg' : r + '.svg'),
      color: r === 'crew' ? CREW : r === 'mutineer' ? RED : GOLD };
  };
  const sendRole = (p) => { try { ctx.send(p, roleInfo(p)); } catch {} };
  ctx.on('message', (p, d) => { if (p && d?.kind === 'hello' && role.has(p.id)) sendRole(p); });
  ctx.on('join', (p) => { if (role.has(p.id)) sendRole(p); render(); });
  ctx.on('leave', () => render());

  const idle = (p, msg) => S.dead.has(p.id)
    ? { title: 'Airlocked', text: 'You are drifting in space. Don’t talk, and don’t reveal your role.', wait: 'Watch the big screen' }
    : { wait: msg || 'Look at the big screen' };
  const showIdle = (except = [], msg) => {
    for (const p of seats) if (!except.includes(p.id)) ctx.show(p, idle(p, msg));
  };

  // Ask one player, waiting for them if their phone drops. Returns fallback()
  // if they run out of time.
  const joinWaiters = new Map(); // player id -> resolve
  ctx.on('join', (p) => { const w = p && joinWaiters.get(p.id); if (w) { joinWaiters.delete(p.id); w(); } });
  const waitForJoin = (p, ms) => new Promise((res) => {
    const t = ctx.setTimeout(() => { joinWaiters.delete(p.id); res(); }, Math.max(0, ms));
    joinWaiters.set(p.id, () => { clearTimeout(t); res(); });
  });

  // Ask one player, waiting for them if their phone drops. Returns fallback()
  // if they run out of time.
  async function askOne(p, view, seconds, fallback) {
    const end = Date.now() + T(seconds) * 1000;
    for (;;) {
      if (!ctx.player(p.id)?.connected) {
        render(`Waiting for ${p.name} to reconnect…`);
        await waitForJoin(p, end - Date.now());
        render();
      }
      const left = (end - Date.now()) / 1000;
      if (left <= 0.2) return fallback();
      const got = await ctx.ask(p, view, { timeout: left, after: idle(p, 'Done. Look at the big screen') });
      if (got.has(p.id)) return got.get(p.id);
    }
  }

  // ---------- the TV ----------
  let phaseEl = h('div.mt-phase');
  function phase(main, sub, extra) {
    phaseEl = h('div.mt-phase', h('h1', main), sub && h('p', sub), extra);
    render();
  }
  function render(banner) {
    const slots = (count, filled, kind, labels) => h('div.mt-track.' + kind,
      Array.from({ length: count }, (_, i) => {
        const done = i < filled;
        const pw = labels?.[i];
        return h('div.mt-slot' + (done ? '.on' : ''),
          done ? h('img', { src: ctx.asset(kind === 'steady' ? 'order-steady.svg' : 'order-mutiny.svg'), alt: '' })
            : h('div.mt-slot-in',
              i === count - 1 ? h('span.mt-win', kind === 'steady' ? '🏁' : '☠️', h('small', kind === 'steady' ? 'Crew wins' : 'Mutiny wins'))
                : pw ? h('span.mt-pw', POWER_INFO[pw].icon, h('small', POWER_INFO[pw].name)) : null,
              kind === 'mutiny' && i === RINGLEADER_DANGER ? h('small.mt-danger', 'Ringleader danger') : null,
              kind === 'mutiny' && i === VETO_AT - 1 ? h('small.mt-veto', 'unlocks veto') : null));
      }));
    const chip = (p) => {
      const conn = ctx.player(p.id)?.connected;
      const tags = [];
      if (S.captain?.id === p.id) tags.push(h('span.mt-tag.cap', 'Captain'));
      if (S.mate?.id === p.id) tags.push(h('span.mt-tag.mate', 'First Mate'));
      if (S.nominee?.id === p.id) tags.push(h('span.mt-tag.nom', 'Nominee'));
      if (!S.captain && !S.reveal && S.lastCaptain === p.id) tags.push(h('span.mt-tag.old', 'Last Captain'));
      if (!S.captain && !S.reveal && S.lastMate === p.id) tags.push(h('span.mt-tag.old', 'Last Mate'));
      if (S.cleared.has(p.id)) tags.push(h('span.mt-tag.ok', 'Not the Ringleader'));
      let vote = null;
      if (S.votes) vote = S.votes.has(p.id) ? h('div.mt-vote.' + (S.votes.get(p.id) ? 'aye' : 'nay'), S.votes.get(p.id) ? 'AYE' : 'NAY') : null;
      else if (S.answered.has(p.id)) vote = h('div.mt-vote.in', '✓');
      const r = S.reveal && role.get(p.id);
      return h('div.mt-seat' + (S.dead.has(p.id) ? '.dead' : '') + (conn ? '' : '.away') + (r ? '.r-' + r : ''),
        { style: { '--c': p.color } },
        h('div.mt-name', S.dead.has(p.id) ? '🚪 ' + p.name : p.name),
        r ? h('div.mt-role', r === 'crew' ? 'Crew' : r === 'mutineer' ? 'Mutineer' : '👑 Ringleader') : null,
        h('div.mt-tags', tags), vote);
    };
    ctx.el.replaceChildren(h('div.mt',
      h('div.mt-head', h('div.mt-title', h('span', 'MUTINY'), ' on the ', h('b', 'Starling')),
        h('div.mt-meta',
          h('span', `🂠 Deck ${S.deck.length}`), h('span', `🗑 Scrapped ${S.discard.length}`),
          h('span.mt-unrest', 'Unrest ', [0, 1, 2].map((i) => h('i' + (i < S.unrest ? '.on' : ''))),
            h('small', ' 3 = chaos')))),
      h('div.mt-tracks',
        h('div.mt-trow', h('div.mt-tlabel.steady', 'Steady'), slots(STEADY_TO_WIN, S.steady, 'steady')),
        h('div.mt-trow', h('div.mt-tlabel.mutiny', 'Mutiny'), slots(MUTINY_TO_WIN, S.mutiny, 'mutiny', powers))),
      banner ? h('div.mt-phase', h('h1', banner)) : phaseEl,
      h('div.mt-seats' + (n > 7 ? '.many' : ''), { style: { '--n': n } }, seats.map(chip))));
  }

  // ---------- deck ----------
  const draw = (k) => {
    if (S.deck.length < k) { S.deck = ctx.shuffle([...S.deck, ...S.discard]); S.discard = []; }
    return S.deck.splice(0, k);
  };
  const reshuffleIfLow = () => {
    if (S.deck.length < 3) { S.deck = ctx.shuffle([...S.deck, ...S.discard]); S.discard = []; }
  };
  const cardLabel = (c) => (c === 'S' ? '🟦 Steady' : '🟥 Mutiny');

  // ---------- intro ----------
  ctx.show('all', { wait: 'Getting your role…' });
  for (const p of seats) sendRole(p);
  phase('Secret roles are out', 'Look at your phone without letting anyone see it.');
  await ctx.ask(seats, { title: 'Your secret role', text: 'Hold the button at the bottom of your screen to see your role. Check it the same way any time.', choices: ['Got it'] },
    { timeout: T(60), after: { wait: 'Waiting for the rest of the crew…' },
      onAnswer: (p) => { S.answered.add(p.id); render(); } });
  S.answered.clear();
  phase('Aboard the Starling', `${n} crew, ${mutCount + 1} of them mutineers, one of those the Ringleader. Nobody knows who to trust.`);
  await say(6000);
  phase('How it works',
    'Each round the Captain picks a First Mate and the crew votes. An approved pair passes one ship’s order: '
    + 'the Captain secretly scraps one of three, the First Mate enacts one of the last two.');
  await say(9000);

  // ---------- main loop ----------
  let result;
  try {
    for (;;) await round();
  } catch (e) {
    if (!(e instanceof GameOver)) throw e;
    result = e;
  }

  // ---------- ending ----------
  S.captain = S.mate = S.nominee = null; S.votes = null; S.reveal = true;
  const crewWon = result.winner === 'crew';
  for (const p of seats) {
    const won = (team(p.id) === 'crew') === crewWon;
    ctx.show(p, { title: won ? 'You won!' : 'You lost', text: result.why, color: crewWon ? CREW : RED,
      wait: 'Back to the lobby soon…' });
  }
  ctx.music(null);
  ctx.sfx('win');
  phase(crewWon ? '🏁 The crew holds the ship!' : '☠️ The mutiny wins!', result.why);
  await say(14000);
  for (const p of seats) try { ctx.send(p, { kind: 'role', hide: true }); } catch {}

  // ======================================================================
  async function round() {
    // Captain for this round.
    let cap;
    if (S.appointed) { cap = S.appointed; S.appointed = null; }
    else {
      do { S.rot = (S.rot + 1) % n; } while (S.dead.has(seats[S.rot].id));
      cap = seats[S.rot];
    }
    S.captain = cap; S.mate = null; S.nominee = null; S.votes = null;
    const living = alive();
    const eligible = living.filter((p) => p.id !== cap.id && p.id !== S.lastMate
      && !(living.length > 5 && p.id === S.lastCaptain));

    // Nominate.
    showIdle([cap.id], `${cap.name} is choosing a First Mate`);
    phase(`${cap.name} is Captain`, 'Talk it over. The Captain is choosing a First Mate.');
    const pickId = await askOne(cap, {
      title: 'You are Captain', text: 'Choose your First Mate. The crew will vote on the pair.', buzz: true,
      choices: eligible.map((p) => ({ label: p.name, value: p.id })),
    }, 300, () => ctx.pick(eligible).id);
    const nom = seats.find((p) => p.id === pickId) || ctx.pick(eligible);
    S.nominee = nom;

    // Vote.
    S.answered.clear();
    phase(`Captain ${cap.name} + First Mate ${nom.name}?`, 'Everyone vote on your phone. Votes are shown once all are in.');
    const votes = await ctx.ask(living, {
      title: 'Vote', text: `Captain ${cap.name} with First Mate ${nom.name}`, buzz: true,
      choices: [{ label: '👍 Aye', value: true }, { label: '👎 Nay', value: false }],
    }, { timeout: T(180), after: { wait: 'Vote in. Waiting for the rest…' },
      onAnswer: (p) => { S.answered.add(p.id); render(); } });
    for (const p of seats) if (S.dead.has(p.id)) ctx.show(p, idle(p));
    S.answered.clear();
    S.votes = votes;
    const ayes = [...votes.values()].filter(Boolean).length, nays = votes.size - ayes;
    const passed = ayes > nays;
    showIdle();
    ctx.sfx(passed ? 'ding' : 'buzz');
    phase(passed ? `Approved, ${ayes} to ${nays}` : `Voted down, ${ayes} to ${nays}`,
      passed ? `${nom.name} is First Mate.` : 'The Captain’s seat moves on, and unrest grows.');
    await say(5500);
    S.votes = null;

    if (!passed) {
      S.nominee = null;
      S.unrest++;
      if (S.unrest >= 3) await chaos();
      return;
    }

    S.unrest = 0;
    S.nominee = null; S.mate = nom;
    S.lastCaptain = cap.id; S.lastMate = nom.id;
    if (S.mutiny >= RINGLEADER_DANGER) {
      ctx.music('tense');
      if (role.get(nom.id) === 'ringleader') {
        phase(`${nom.name} is the Ringleader!`, 'They took the First Mate’s chair and the ship with it.');
        await say(4000);
        throw new GameOver('mutiny', `${nom.name}, the Ringleader, was made First Mate after ${S.mutiny} Mutiny orders.`);
      }
      S.cleared.add(nom.id);
      phase(`${nom.name} is not the Ringleader`, 'At least we know that much.');
      await say(3500);
    }

    // Orders.
    const hand = draw(3);
    showIdle([cap.id], 'The Captain is reading the orders');
    phase('The Captain reads three orders', `${cap.name} scraps one in secret and hands two to ${nom.name}.`, cardBacks(3));
    const scrapIdx = await askOne(cap, {
      title: 'Scrap one order', text: 'Tap the order to throw away. The other two go to your First Mate. Keep a straight face.', buzz: true,
      choices: hand.map((c, i) => ({ label: cardLabel(c), value: i })),
    }, 180, () => Math.floor(Math.random() * 3));
    const scrap = hand.splice(Number(scrapIdx) || 0, 1)[0];
    S.discard.push(scrap);

    phase('The First Mate holds two orders', `${nom.name} enacts one of them.`, cardBacks(2));
    const veto = S.mutiny >= VETO_AT;
    let enacted = null;
    for (let tries = 0; enacted == null; tries++) {
      const canVeto = veto && tries === 0;
      showIdle([nom.id], 'The First Mate is choosing');
      const pick = await askOne(nom, {
        title: 'Enact one order', text: 'The other is scrapped.' + (canVeto ? ' You may also ask the Captain to scrap both.' : ''), buzz: true,
        choices: [...hand.map((c, i) => ({ label: cardLabel(c), value: i })),
          ...(canVeto ? [{ label: '✋ Ask to veto both', value: 'veto' }] : [])],
      }, 180, () => Math.floor(Math.random() * 2));
      if (pick === 'veto') {
        phase(`${nom.name} wants to veto`, `Will Captain ${cap.name} agree to scrap both orders?`);
        showIdle([cap.id]);
        const ok = await askOne(cap, {
          title: 'Veto?', text: `${nom.name} wants to scrap both orders.`, buzz: true,
          choices: [{ label: 'Agree: scrap both', value: true }, { label: 'Refuse', value: false }],
        }, 120, () => false);
        if (ok) {
          S.discard.push(...hand);
          showIdle();
          phase('Both orders scrapped', 'The veto stands, and unrest grows.');
          await say(4500);
          S.mate = null;
          S.unrest++;
          if (S.unrest >= 3) await chaos();
          return;
        }
        phase('Veto refused', `${nom.name} has to enact one.`);
        await say(2500);
      } else {
        enacted = hand.splice(Number(pick) || 0, 1)[0];
        S.discard.push(...hand);
      }
    }
    showIdle();
    await enact(enacted, false);
    S.mate = null;
    if (enacted === 'M') await power(cap);
  }

  function cardBacks(k) {
    return h('div.mt-backs', Array.from({ length: k }, (_, i) => h('div.mt-back', { style: { animationDelay: `${i * 0.12}s` } }, '★')));
  }

  async function enact(c, chaotic) {
    ctx.sfx(c === 'S' ? 'ding' : 'glitch');
    if (c === 'S') S.steady++; else S.mutiny++;
    S.log.push(c);
    reshuffleIfLow();
    phase(c === 'S' ? 'A Steady order is enacted' : 'A Mutiny order is enacted',
      chaotic ? 'Chaos on deck! The top order was carried out by force.' : null,
      h('img.mt-big', { src: ctx.asset(c === 'S' ? 'order-steady.svg' : 'order-mutiny.svg'), alt: '' }));
    await say(5000);
    if (S.steady >= STEADY_TO_WIN) throw new GameOver('crew', 'Five Steady orders. The Starling stays on course.');
    if (S.mutiny >= MUTINY_TO_WIN) throw new GameOver('mutiny', 'Six Mutiny orders. The mutineers have the ship.');
    if (c === 'M' && S.mutiny === RINGLEADER_DANGER) {
      phase('Ringleader danger!', 'From now on, if the Ringleader is made First Mate, the mutiny wins.');
      await say(5000);
    }
    if (c === 'M' && S.mutiny === VETO_AT) {
      phase('Veto unlocked', 'A First Mate may now ask to scrap both orders. If the Captain agrees, both go.');
      await say(5000);
    }
  }

  async function chaos() {
    S.unrest = 0;
    S.captain = S.mate = S.nominee = null;
    ctx.sfx('glitch');
    phase('Chaos!', 'Three governments failed. The crew grabs the next order and carries it out.');
    await say(4000);
    const [c] = draw(1);
    S.lastCaptain = S.lastMate = null; // term limits reset
    await enact(c, true);
  }

  async function power(cap) {
    const pw = powers[S.mutiny - 1];
    if (!pw) return;
    const info = POWER_INFO[pw];
    S.captain = cap;
    const others = alive().filter((p) => p.id !== cap.id);
    showIdle([cap.id], `Captain ${cap.name} is using a power`);
    phase(`${info.icon} ${info.name}`, info.text);
    await say(2500);

    if (pw === 'scan') {
      reshuffleIfLow();
      const top = S.deck.slice(0, 3);
      await askOne(cap, {
        title: '📡 Long-range scan', text: 'The next three orders, in order:\n\n' + top.map(cardLabel).join('\n') + '\n\nYou can tell the crew, or lie.',
        buzz: true, choices: ['Done'],
      }, 120, () => 'Done');
      phase(`${cap.name} has seen the next three orders`, 'Will they tell the truth?');
      await say(3000);
    } else if (pw === 'inspect') {
      const pool = others.filter((p) => !S.inspected.has(p.id));
      const id = await askOne(cap, {
        title: '🔍 Background check', text: 'Pick someone. You will secretly see whether they are loyal crew or with the mutiny.', buzz: true,
        choices: pool.map((p) => ({ label: p.name, value: p.id })),
      }, 240, () => ctx.pick(pool).id);
      const t = seats.find((p) => p.id === id) || ctx.pick(pool);
      S.inspected.add(t.id);
      phase(`${cap.name} checks ${t.name}`, 'Only the Captain sees the result.');
      const isCrew = team(t.id) === 'crew';
      await askOne(cap, {
        title: `${t.name} is…`, text: isCrew ? 'LOYAL CREW' : 'WITH THE MUTINY',
        image: ctx.asset(isCrew ? 'crew.svg' : 'mutineer.svg'), color: isCrew ? CREW : RED,
        choices: ['Done'],
      }, 90, () => 'Done');
      ctx.show(t, idle(t));
    } else if (pw === 'appoint') {
      const id = await askOne(cap, {
        title: '🎖️ Field promotion', text: 'Pick the next Captain. After them, the Captain’s seat carries on from you as usual.', buzz: true,
        choices: others.map((p) => ({ label: p.name, value: p.id })),
      }, 240, () => ctx.pick(others).id);
      const t = seats.find((p) => p.id === id) || ctx.pick(others);
      S.appointed = t;
      phase(`${t.name} will be the next Captain`, `Promoted by ${cap.name}.`);
      await say(3500);
    } else if (pw === 'airlock') {
      const id = await askOne(cap, {
        title: '🚪 Airlock', text: 'Choose someone to throw out of the airlock. They are out of the game.', buzz: true,
        choices: others.map((p) => ({ label: p.name, value: p.id })),
      }, 300, () => ctx.pick(others).id);
      const t = seats.find((p) => p.id === id) || ctx.pick(others);
      S.dead.add(t.id);
      ctx.sfx('whoosh');
      if (S.appointed?.id === t.id) S.appointed = null;
      ctx.show(t, idle(t));
      phase(`${t.name} is thrown out of the airlock`, 'Silence, please. The airlocked don’t talk.');
      await say(4500);
      if (role.get(t.id) === 'ringleader') {
        throw new GameOver('crew', `${t.name} was the Ringleader, and is now drifting in space. The mutiny collapses.`);
      }
      phase(`${t.name} was not the Ringleader`, 'The mutiny carries on.');
      await say(3500);
    }
    S.captain = null;
  }
}

// ---------- styles ----------
document.getElementById('mutiny-css')?.remove();
const css = Object.assign(document.createElement('style'), { id: 'mutiny-css' });
css.textContent = `
  .game .stage:has(.mt) { justify-content: flex-start; }
  .mt { width: min(1500px, 100%); display: flex; flex-direction: column; gap: 1.6vh; align-items: stretch; }
  .mt-head { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 1em; }
  .mt-title { font-size: 1.5em; font-weight: 800; color: var(--dim); }
  .mt-title span { color: ${RED}; font-weight: 900; letter-spacing: .08em; }
  .mt-title b { color: ${CREW}; }
  .mt-meta { display: flex; gap: 1.4em; color: var(--dim); font-weight: 700; align-items: center; }
  .mt-unrest { display: flex; align-items: center; gap: .3em; }
  .mt-unrest i { width: .9em; height: .9em; border-radius: 50%; border: 2px solid ${GOLD}; display: inline-block; }
  .mt-unrest i.on { background: ${GOLD}; box-shadow: 0 0 12px ${GOLD}; }
  .mt-unrest small { font-size: .7em; }
  .mt-tracks { display: flex; flex-direction: column; gap: 1.4vh; }
  .mt-trow { display: grid; grid-template-columns: 6.5em 1fr; gap: 1em; align-items: center; }
  .mt-tlabel { font-weight: 900; font-size: 1.1em; letter-spacing: .06em; text-transform: uppercase; text-align: right; }
  .mt-tlabel.steady { color: ${CREW}; } .mt-tlabel.mutiny { color: ${RED}; }
  .mt-track { display: grid; gap: .8vw; grid-template-columns: repeat(6, 1fr); }
  .mt-slot { aspect-ratio: 1; border-radius: 14px; border: 3px dashed var(--line); position: relative; overflow: hidden;
    display: flex; align-items: center; justify-content: center; max-height: 15vh; }
  .mt-track.steady .mt-slot { border-color: color-mix(in srgb, ${CREW} 40%, var(--line)); }
  .mt-track.mutiny .mt-slot { border-color: color-mix(in srgb, ${RED} 40%, var(--line)); }
  .mt-slot.on { border-style: solid; animation: pop .4s ease-out; }
  .mt-slot img { width: 100%; height: 100%; object-fit: contain; padding: 4px; }
  .mt-slot-in { display: flex; flex-direction: column; align-items: center; gap: .2em; padding: .3em; }
  .mt-pw, .mt-win { display: flex; flex-direction: column; align-items: center; font-size: 1.4em; line-height: 1.1; }
  .mt-pw small, .mt-win small { font-size: .45em; color: var(--dim); font-weight: 700; }
  .mt-danger, .mt-veto { font-size: .6em; font-weight: 800; color: ${GOLD}; text-transform: uppercase; letter-spacing: .05em; }
  .mt-phase { min-height: 17vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .3em;
    background: linear-gradient(180deg, color-mix(in srgb, var(--card) 80%, transparent), transparent); border-radius: 24px; padding: 2vh 2vw; }
  .mt-phase h1 { font-size: 2.3em; margin: 0; animation: pop .3s ease-out; }
  .mt-phase p { font-size: 1.15em; color: var(--dim); margin: 0; max-width: 1100px; }
  .mt-big { height: 17vh; filter: drop-shadow(0 0 30px rgba(255,255,255,.15)); animation: pop .4s ease-out; margin-top: .5em; }
  .mt-backs { display: flex; gap: 1em; margin-top: .6em; }
  .mt-back { width: 3.2em; height: 4.4em; border-radius: 10px; background: linear-gradient(160deg, #2b3a66, #141b33);
    border: 3px solid #5a6aa8; display: flex; align-items: center; justify-content: center; color: #8fa0e0; font-size: 1.3em;
    animation: deal .5s ease-out backwards; }
  @keyframes deal { from { transform: translateY(-40px) rotate(-12deg); opacity: 0; } }
  .mt-seats { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: .8vw; margin-top: .6em; }
  .mt-seats.many { font-size: .8em; }
  .mt-seat { background: color-mix(in srgb, var(--c) 14%, var(--card)); border: 3px solid var(--c); border-radius: 18px;
    padding: .6em .7em; position: relative; min-height: 3.6em; display: flex; flex-direction: column; gap: .3em; }
  .mt-seat.away { opacity: .5; }
  .mt-seat.dead { filter: grayscale(1); opacity: .45; }
  .mt-seat.dead .mt-name { text-decoration: line-through; }
  .mt-seat.r-crew { box-shadow: 0 0 0 4px ${CREW}; }
  .mt-seat.r-mutineer { box-shadow: 0 0 0 4px ${RED}; }
  .mt-seat.r-ringleader { box-shadow: 0 0 0 4px ${GOLD}, 0 0 30px ${GOLD}; }
  .mt-name { font-weight: 900; font-size: 1.1em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mt-role { font-weight: 900; font-size: .85em; text-transform: uppercase; }
  .r-crew .mt-role { color: ${CREW}; } .r-mutineer .mt-role { color: ${RED}; } .r-ringleader .mt-role { color: ${GOLD}; }
  .mt-tags { display: flex; flex-wrap: wrap; gap: .3em; }
  .mt-tag { font-size: .62em; font-weight: 900; text-transform: uppercase; letter-spacing: .04em; border-radius: 99px; padding: .15em .6em; }
  .mt-tag.cap { background: ${GOLD}; color: #1a1206; }
  .mt-tag.mate { background: ${CREW}; color: #061a22; }
  .mt-tag.nom { border: 2px solid ${CREW}; color: ${CREW}; }
  .mt-tag.old { border: 1px solid var(--line); color: var(--dim); }
  .mt-tag.ok { background: color-mix(in srgb, #5df08a 25%, transparent); color: #5df08a; }
  .mt-vote { position: absolute; top: -.7em; right: -.5em; font-weight: 900; border-radius: 12px; padding: .1em .55em; font-size: .9em;
    animation: pop .3s ease-out; }
  .mt-vote.aye { background: #5df08a; color: #062010; }
  .mt-vote.nay { background: ${RED}; color: #22060c; }
  .mt-vote.in { background: var(--line); color: var(--fg); }
`;
document.head.append(css);
