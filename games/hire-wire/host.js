// Hire Wire: small talk first, then a job interview where every answer has to
// be built from word tiles salvaged out of the other players' small talk.
// Ledger, a filing cabinet from Human Resources, runs the interviews.
import { ICEBREAKERS, INTERVIEWS, JOBS, GLUE, SPARE } from './words.js';

const ICE_TIME = 100;      // seconds for both small-talk answers
const ICE_EACH = 2;        // small-talk questions per player
const BUILD_TIME = 80;     // seconds to build an interview answer
const VOTE_TIME = 25;
const ROUNDS = 3;          // the last one pays double
const HAND_WORDS = 18;     // salvaged tiles per hand
const HAND_GLUE = 8;       // "office supplies" per hand
const MAX_TILES = 12;      // longest answer
const VOTE_PAY = 1000;     // salary per vote
const ROYALTY = 100;       // to a word's original owner, per vote it helped win
const SWEEP_PAY = 500;     // every possible vote

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

export default async function (ctx) {
  const { h } = ctx;
  let svg = '';
  try { svg = await (await fetch(ctx.asset('ledger.svg'))).text(); } catch {}
  const ledger = (mood = '') => {
    const d = h('div.lg' + (mood ? '.' + mood : ''));
    d.innerHTML = svg;
    return d;
  };
  // Ledger talks: big cabinet with a speech bubble.
  const scene = async (title, sub, ms, extra) => {
    ctx.el.replaceChildren(h('div.hw-scene', ledger('talk'),
      h('div.bubble', h('h1', title), sub && h('p', sub), extra)));
    if (ms) await ctx.sleep(ms);
  };

  const pay = new Map(ctx.players.map((p) => [p.id, 0]));
  const add = (id, n) => pay.set(id, (pay.get(id) || 0) + n);
  const nameOf = (id) => ctx.player(id)?.name ?? '?';
  const colorOf = (id) => ctx.player(id)?.color ?? '#888';

  if (ctx.connected.length < 3) return ctx.say('Not enough candidates', 'Hire Wire needs at least 3 people.', 5000);
  ctx.show('all', { wait: 'Look at the TV!' });
  await scene('Welcome to Glumworth & Daughters', 'I am Ledger, Head of Human Resources. Before the interviews, a little small talk.', 5000);

  // ---------- small talk ----------
  const pool = [];       // { w, owner }
  const strips = [];     // { owner, text } for the shredder
  {
    const players = ctx.shuffle(ctx.connected);
    let deck = ctx.shuffle(ICEBREAKERS);
    const done = new Set();
    const board = () => ctx.el.replaceChildren(h('div.hw-scene', ledger('listen'),
      h('div.bubble', h('h1', 'Small talk'), h('p', 'Answer casually on your phone. I am definitely not taking notes.'),
        h('div.chips', players.map((p) => h('div.chip' + (done.has(p.id) ? '' : '.away'),
          { style: { '--c': p.color } }, (done.has(p.id) ? '✓ ' : '') + p.name))))));
    board();
    const deadline = Date.now() + ICE_TIME * 1000;
    const stop = ctx.clock(ICE_TIME);
    await Promise.all(players.map(async (p) => {
      for (let k = 0; k < ICE_EACH; k++) {
        const left = (deadline - Date.now()) / 1000;
        if (left <= 0) break;
        if (!deck.length) deck = ctx.shuffle(ICEBREAKERS);
        const q = deck.pop();
        const got = await ctx.ask(p, {
          title: `Small talk ${k + 1} of ${ICE_EACH}`,
          text: q,
          input: { placeholder: 'A sentence or two', max: 90, submit: 'Send' }, color: '#ffb84d',
        }, { timeout: left, clock: false, after: { wait: 'Lovely. Ledger nods politely…' } });
        const text = String(got.get(p.id) ?? '').trim();
        if (text) {
          strips.push({ owner: p.id, text });
          for (const w of tokenize(text)) pool.push({ w, owner: p.id });
        }
      }
      done.add(p.id);
      board();
    }));
    stop();
  }

  // ---------- the shredder ----------
  ctx.show('all', { wait: 'Look at the TV!' });
  ctx.sfx?.('glitch');
  await shred(ctx, strips, ledger);
  await scene('Thank you. That was not small talk.',
    `That was raw material. Your words are now office property: ${pool.length} tiles salvaged. Answer my interview questions using only what is left of each other.`, 7000);

  // ---------- interviews ----------
  let questions = ctx.shuffle(INTERVIEWS);
  let jobs = ctx.shuffle(JOBS);
  for (let round = 1; round <= ROUNDS; round++) {
    const mult = round === ROUNDS ? 2 : 1;
    const job = jobs.pop() || 'Mystery Position';
    const question = questions.pop() || 'Why are you here?';
    const players = ctx.connected;
    if (players.length < 2) break;
    await scene(round === ROUNDS ? 'Final interview' : `Interview ${round} of ${ROUNDS}`,
      round === ROUNDS ? 'Every offer counts double. Make it count.' : 'Build your answer from the tiles on your phone.', 3500,
      h('div.opening', h('span', 'Now hiring'), h('b', job)));

    // Deal a hand to everyone.
    const hands = new Map();
    for (const p of players) hands.set(p.id, deal(ctx, pool, p.id));
    const key = `${Date.now().toString(36)}-${round}`;
    const done = new Set();
    const board = () => ctx.el.replaceChildren(h('div.hw-scene', ledger('listen'),
      h('div.bubble', h('div.opening', h('span', 'Now hiring'), h('b', job)), h('h1.q', question),
        h('div.chips', players.map((p) => h('div.chip' + (done.has(p.id) ? '' : '.away'),
          { style: { '--c': p.color } }, (done.has(p.id) ? '✓ ' : '') + p.name))))));
    board();
    // A nudge 3 s before time so phones submit whatever they have.
    const hurry = ctx.setTimeout(() => {
      const late = players.filter((p) => !done.has(p.id)).map((p) => p.id);
      try { if (late.length) ctx.send(late, { kind: 'hurry' }); } catch {}
    }, (BUILD_TIME - 3) * 1000);
    // One ask for everyone, so a phone that reloads mid-build can still answer.
    let answers;
    try {
      answers = await ctx.ask(players, {
        title: job, text: question, key, max: MAX_TILES, color: '#ffb84d',
        hands: Object.fromEntries(players.map((p) => [p.id,
          hands.get(p.id).map((t) => ({ id: t.id, w: t.w, k: t.glue ? 'g' : t.owner ? 'w' : 's' }))])),
      }, { timeout: BUILD_TIME, after: { wait: 'Answer filed. Look at the TV!' },
        onAnswer: (pl) => { done.add(pl.id); board(); } });
    } finally { clearTimeout(hurry); }

    const entries = [];
    for (const p of players) {
      const hand = hands.get(p.id);
      const ids = Array.isArray(answers.get(p.id)) ? answers.get(p.id) : [];
      const seen = new Set();
      const tiles = [];
      for (const id of ids) {
        if (!Number.isInteger(id) || seen.has(id) || !hand[id] || tiles.length >= MAX_TILES) continue;
        seen.add(id); tiles.push(hand[id]);
      }
      if (tiles.length) entries.push({ author: p.id, tiles, text: sentence(tiles) });
    }
    ctx.show('all', { wait: 'Look at the TV!' });

    if (!entries.length) { await scene('Nobody answered.', 'Ledger files that under "awkward".', 4000); continue; }
    const order = ctx.shuffle(entries);
    order.forEach((e, i) => (e.letter = String.fromCharCode(65 + i)));

    // ---------- voting ----------
    const cardsView = (reveal) => h('div.answers', order.map((e) => answerCard(ctx, e, reveal, colorOf, nameOf, mult)));
    let votes = new Map();
    if (order.length > 1) {
      ctx.el.replaceChildren(h('div.vote-head', h('div.opening', h('span', 'Now hiring'), h('b', job)), h('h2.q', question)),
        cardsView(false), h('p.sub', 'Vote for the candidate you would hire. Not yourself.'));
      // player.js greys out each voter's own answer using `authors`.
      votes = await ctx.ask(ctx.connected, {
        title: 'Who gets the job?', text: question, color: '#ffb84d',
        choices: order.map((e) => ({ label: `${e.letter}. ${e.text}`, value: e.letter })),
        authors: Object.fromEntries(order.map((e) => [e.letter, e.author])),
      }, { timeout: VOTE_TIME, after: { wait: 'Vote counted. Ledger is reviewing.' } });
    }

    // ---------- tally ----------
    const royalties = new Map();
    for (const e of order) {
      e.voters = [...votes.entries()].filter(([id, l]) => l === e.letter && id !== e.author).map(([id]) => id);
      const n = order.length > 1 ? e.voters.length : 1;
      const eligible = ctx.connected.filter((p) => p.id !== e.author).length;
      e.sweep = order.length > 1 && n >= 2 && n >= eligible;
      e.gain = (n * VOTE_PAY + (e.sweep ? SWEEP_PAY : 0)) * mult;
      add(e.author, e.gain);
      for (const t of e.tiles) {
        if (!t.owner || t.owner === e.author) continue;
        const r = ROYALTY * n * mult;
        if (!r) continue;
        add(t.owner, r);
        royalties.set(t.owner, (royalties.get(t.owner) || 0) + r);
      }
    }
    order.sort((a, b) => b.gain - a.gain);
    ctx.sfx?.('ding');
    ctx.el.replaceChildren(h('div.vote-head', h('div.opening', h('span', 'Now hiring'), h('b', job)), h('h2.q', question)),
      cardsView(true),
      royalties.size ? h('div.royal', h('b', 'Word royalties '), [...royalties].map(([id, r]) =>
        h('span.chip.sm', { style: { '--c': colorOf(id) } }, `${nameOf(id)} +${money(r)}`))) : null);
    await ctx.sleep(Math.min(15000, 6000 + order.length * 1200));

    await payroll(ctx, pay, round === ROUNDS ? 'Final salary offers' : `Salary offers after interview ${round}`, 6500, money);
  }

  // ---------- the hire ----------
  const best = Math.max(...pay.values());
  const winners = ctx.players.filter((p) => pay.get(p.id) === best);
  for (const p of ctx.players) {
    const won = winners.includes(p);
    ctx.show(p, won
      ? { title: 'You\'re hired!', text: `Starting salary ${money(best)}. Please report to the basement on Monday.`, color: '#5df08a', buzz: true }
      : { title: 'Thank you for applying', text: 'We will keep your résumé on file. Forever. In a drawer.', wait: 'Back to the lobby soon…' });
  }
  ctx.sfx?.('win');
  ctx.el.replaceChildren(h('div.hw-scene', ledger('talk'),
    h('div.bubble.final', h('p', 'After careful consideration, the position goes to'),
      h('div.hired', winners.map((p) => h('div.winner', { style: { '--c': p.color } }, p.name)),
        h('div.stamp', 'HIRED')),
      h('p', `Starting salary ${money(best)}. Everyone else, we will keep your résumé on file.`))));
  await ctx.sleep(9000);
}

// Split an answer into tiles: words keep their case, outer punctuation goes.
export function tokenize(text) {
  return String(text).split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean).map((w) => w.slice(0, 20)).slice(0, 18);
}

// Join tiles into a sentence for phones and votes.
function sentence(tiles) {
  const s = tiles.map((t) => t.w).join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// A hand: salvaged words from everyone else, spread across owners, plus glue.
function deal(ctx, pool, me) {
  const byOwner = new Map();
  for (const t of pool) if (t.owner !== me) (byOwner.get(t.owner) || byOwner.set(t.owner, []).get(t.owner)).push(t);
  const groups = ctx.shuffle([...byOwner.values()].map((g) => ctx.shuffle(g)));
  const words = [];
  for (let i = 0; words.length < HAND_WORDS && groups.some((g) => i < g.length); i++) {
    for (const g of groups) if (i < g.length && words.length < HAND_WORDS) words.push(g[i]);
  }
  // A quiet room still gets enough to work with.
  for (const w of ctx.shuffle(SPARE)) { if (words.length >= 12) break; words.push({ w, owner: 0 }); }
  const glue = ctx.shuffle(GLUE).slice(0, HAND_GLUE).map((w) => ({ w, owner: 0, glue: true }));
  return [...ctx.shuffle(words), ...glue].map((t, id) => ({ ...t, id }));
}

function answerCard(ctx, e, reveal, colorOf, nameOf, mult) {
  const { h } = ctx;
  const tiles = h('div.tiles', e.tiles.map((t) => h('span.tile' + (t.glue ? '.glue' : t.owner ? '' : '.spare'),
    { style: reveal && t.owner ? { '--c': colorOf(t.owner) } : {} }, t.w)));
  if (!reveal) return h('div.acard', h('div.letter', e.letter), tiles);
  return h('div.acard.shown' + (e.sweep ? '.sweep' : ''), { style: { '--c': colorOf(e.author) } },
    h('div.letter', e.letter), tiles,
    h('div.who', h('b', { style: { color: colorOf(e.author) } }, nameOf(e.author)),
      h('span.votes', e.voters.map((id) => h('i.dot', { style: { background: colorOf(id) }, title: nameOf(id) }))),
      h('span.gain', '+' + money(e.gain))),
    e.sweep ? h('div.sweeptag', mult > 1 ? 'UNANIMOUS · DOUBLE' : 'UNANIMOUS') : null);
}

async function shred(ctx, strips, ledger) {
  const { h } = ctx;
  const list = ctx.shuffle(strips).slice(0, 12);
  const papers = list.map((s) => h('div.strip', { style: { '--c': ctx.player(s.owner)?.color } },
    h('b', ctx.player(s.owner)?.name ?? ''), ' ', s.text));
  ctx.el.replaceChildren(h('div.shredder', ledger('chomp'), h('div.strips', papers)));
  await ctx.sleep(3500);
  for (const [i, s] of list.entries()) {
    const words = tokenize(s.text);
    papers[i].replaceChildren(...words.map((w) => h('span.tile.fly', {
      style: { '--c': ctx.player(s.owner)?.color, '--dx': `${(Math.random() - .5) * 60}vw`, '--dy': `${30 + Math.random() * 50}vh`,
        '--r': `${(Math.random() - .5) * 720}deg`, animationDelay: `${600 + i * 120 + Math.random() * 400}ms` },
    }, w)));
    papers[i].classList.add('cut');
  }
  await ctx.sleep(3500);
}

async function payroll(ctx, pay, title, ms, money) {
  const { h } = ctx;
  const rows = ctx.players.map((p) => ({ p, s: pay.get(p.id) || 0 })).sort((a, b) => b.s - a.s);
  const top = rows[0]?.s || 1;
  ctx.el.replaceChildren(h('h1', title), h('div.scores', rows.map(({ p, s }) =>
    h('div.srow', h('span.sname', p.name),
      h('div.sbar', h('div', { style: { width: `${Math.max(3, (s / top) * 100)}%`, background: p.color } })),
      h('span.spts', money(s))))));
  await ctx.sleep(ms);
}

document.getElementById('hire-wire-css')?.remove();
const css = Object.assign(document.createElement('style'), { id: 'hire-wire-css' });
css.textContent = `
  .hw-scene { display: flex; align-items: center; justify-content: center; gap: 4vw; width: 100%; max-width: 1500px; }
  .lg { width: min(26vw, 340px); flex: none; filter: drop-shadow(0 18px 30px #0008); }
  .lg svg { width: 100%; height: auto; display: block; overflow: visible; }
  .lg .lg-jaw { transform-box: fill-box; }
  .lg.talk .lg-jaw { animation: jaw .28s ease-in-out infinite alternate; }
  .lg.talk .lg-brows { animation: brow 1.6s ease-in-out infinite; }
  .lg.listen .lg-pupil { animation: look 3s ease-in-out infinite; }
  .lg.chomp .lg-jaw { animation: jaw .12s linear infinite alternate; }
  .lg.chomp { animation: shake .1s linear infinite alternate; }
  @keyframes jaw { to { transform: translateY(7px); } }
  @keyframes brow { 0%, 60%, 100% { transform: none; } 70%, 90% { transform: translateY(-5px); } }
  @keyframes look { 0%, 100% { transform: translateX(-6px); } 50% { transform: translateX(3px); } }
  @keyframes shake { from { transform: rotate(-1.5deg); } to { transform: rotate(1.5deg); } }
  .bubble { position: relative; background: #fff7d6; color: #1b1f2e; border-radius: 28px; padding: 4vh 3vw; max-width: 900px;
    text-align: left; box-shadow: 0 10px 0 #c9b98a; animation: pop .35s ease-out; }
  .bubble::before { content: ''; position: absolute; left: -26px; top: 40%; border: 16px solid transparent; border-right: 14px solid #fff7d6; }
  .bubble h1 { font-size: 2.3em; }
  .bubble h1.q { font-size: 2em; }
  .bubble p { font-size: 1.25em; margin: .3em 0; color: #4a4560; }
  .bubble .chips { justify-content: flex-start; margin-top: 1em; }
  .bubble .chip { color: var(--fg); }
  .opening { display: inline-flex; gap: .6em; align-items: baseline; background: #1b1f2e; color: #fff7d6; border-radius: 10px;
    padding: .3em .8em; margin-bottom: .6em; font-size: 1.05em; }
  .opening span { font-size: .7em; letter-spacing: .15em; text-transform: uppercase; color: var(--accent); font-weight: 900; }
  .vote-head { text-align: center; }
  .vote-head .q { font-size: 2em; max-width: 1200px; }
  .answers { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)); gap: 2vh 2vw; width: 100%; max-width: 1600px; }
  .acard { position: relative; background: var(--card); border: 3px solid var(--line); border-radius: 22px; padding: 2.2vh 1.4vw 2.2vh 4.2em;
    text-align: left; animation: pop .35s ease-out both; }
  .acard.shown { border-color: var(--c); }
  .acard.sweep { box-shadow: 0 0 40px color-mix(in srgb, var(--accent) 50%, transparent); border-color: var(--accent); }
  .letter { position: absolute; left: .7em; top: .6em; width: 1.9em; height: 1.9em; border-radius: 50%; display: grid; place-items: center;
    background: var(--accent); color: #1b1f2e; font-weight: 900; font-size: 1.2em; }
  .tiles { display: flex; flex-wrap: wrap; gap: .35em; }
  .tile { display: inline-block; background: #fff7d6; color: #1b1f2e; border-radius: 8px; padding: .12em .45em; font-weight: 800;
    font-size: 1.15em; box-shadow: 0 3px 0 #c9b98a; border-bottom: 5px solid var(--c, #c9b98a); }
  .tile.glue { background: #d6dde8; box-shadow: 0 3px 0 #9aa6b8; border-bottom-color: #9aa6b8; }
  .tile.spare { background: #ffe0e6; }
  .who { display: flex; align-items: center; gap: .6em; margin-top: .7em; flex-wrap: wrap; }
  .votes { display: flex; gap: 4px; flex: 1; }
  .dot { width: .9em; height: .9em; border-radius: 50%; display: inline-block; border: 2px solid #0006; }
  .gain { font-weight: 900; color: #5df08a; font-variant-numeric: tabular-nums; }
  .sweeptag { position: absolute; right: .8em; top: -.8em; background: var(--accent); color: #1b1f2e; font-weight: 900; font-size: .75em;
    padding: .2em .7em; border-radius: 99px; letter-spacing: .1em; }
  .royal { display: flex; gap: .6em; flex-wrap: wrap; align-items: center; justify-content: center; color: var(--dim); }
  .chip.sm { font-size: .9em; padding: 6px 14px; }
  .shredder { display: flex; align-items: center; gap: 4vw; width: 100%; max-width: 1500px; }
  .strips { flex: 1; display: flex; flex-direction: column; gap: 1.2vh; text-align: left; }
  .strip { background: #fff7d6; color: #1b1f2e; padding: .5em .9em; border-radius: 6px; font-size: 1.05em; font-weight: 700;
    border-left: 8px solid var(--c); animation: pop .3s ease-out both; min-height: 2.2em; }
  .strip.cut { background: transparent; border-color: transparent; display: flex; flex-wrap: wrap; gap: .3em; }
  .tile.fly { animation: fly 1.6s cubic-bezier(.5,-0.3,.8,.6) both; }
  @keyframes fly { to { transform: translate(var(--dx), var(--dy)) rotate(var(--r)); opacity: 0; } }
  .final { text-align: center; }
  .hired { position: relative; margin: .4em 0 .6em; padding: .2em 3.5em; display: inline-block; }
  .winner { font-size: 3.4em; font-weight: 900; line-height: 1.1; color: #1b1f2e !important; text-decoration: underline; text-decoration-color: var(--c); text-decoration-thickness: .12em; text-underline-offset: .12em; }
  .stamp { position: absolute; left: 100%; top: 55%; border: 6px solid #e0475b; color: #e0475b; font-weight: 900; font-size: 1.8em;
    padding: 0 .4em; border-radius: 14px; letter-spacing: .1em; transform: translate(-50%, -50%) rotate(-14deg);
    animation: stamp .5s 1.2s cubic-bezier(.3,1.6,.6,1) both; mix-blend-mode: multiply; }
  @keyframes stamp { from { transform: translate(-50%, -50%) rotate(-14deg) scale(4); opacity: 0; } }
  .scores { width: min(1000px, 100%); display: flex; flex-direction: column; gap: 14px; }
  .srow { display: grid; grid-template-columns: 8em 1fr 6em; gap: 16px; align-items: center; font-weight: 800; text-align: left; }
  .sname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sbar { height: 1.4em; background: var(--bg2); border-radius: 99px; overflow: hidden; }
  .sbar div { height: 100%; border-radius: 99px; transition: width .8s; }
  .spts { text-align: right; font-variant-numeric: tabular-nums; }
  @media (max-aspect-ratio: 1/1) { .hw-scene, .shredder { flex-direction: column; } .bubble::before { display: none; } }
`;
document.head.append(css);
