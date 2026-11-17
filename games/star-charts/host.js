// Star Charts: two teams race to chart their own stars on a 5×5 sky of words.
// Each team's astronomer sees the secret star map on their phone and gives a
// one-word clue plus a number; teammates vote on their phones for which words
// to chart. Dust is a wasted guess, the other team's star helps them, and the
// black hole loses the game on the spot.
import { WORDS } from './words.js';
import { TEAMS, art, emblem } from './shared.js';

const CLUE_TIME = 150;    // seconds for an astronomer to give a clue
const GUESS_TIME = 90;    // seconds per guess (resets after each chart)
const LOST_NAV = 15;      // seconds before a missing astronomer is replaced
const SIZE = 25;
const ANY = 99;           // "∞" clue: guess as many as you like

const other = (t) => (t === 'sun' ? 'moon' : 'sun');

export default async function (ctx) {
  const { h } = ctx;
  const sfx = (n) => { try { ctx.sfx?.(n); } catch {} };
  if (ctx.connected.length < 4) {
    return ctx.say('Not enough players', 'Star Charts needs at least 4 people: two teams of two.', 5000);
  }

  // Teams last across rematches; astronomers rotate.
  const team = new Map();        // playerId -> 'sun' | 'moon'
  const turnAt = { sun: 0, moon: 0 };
  const shuffled = ctx.shuffle(ctx.connected);
  shuffled.forEach((p, i) => team.set(p.id, i % 2 ? 'moon' : 'sun'));
  let S = null;                   // current match state
  let lastFirst = null;           // first team alternates between rematches
  const lastSent = new Map();     // playerId -> JSON of last view, to skip repeats

  const members = (t) => ctx.players.filter((p) => team.get(p.id) === t);
  const placeLate = (p) => {
    if (team.has(p.id)) return;
    const n = (t) => members(t).filter((m) => m.connected).length;
    team.set(p.id, n('sun') <= n('moon') ? 'sun' : 'moon');
  };

  const ops = (t) => members(t).filter((p) => p.connected && p.id !== S.nav[t]);
  const need = (t) => Math.floor(ops(t).length / 2) + 1;
  const left = (t) => S.board.filter((c) => c.kind === t && !c.open).length;

  // ---------- phone + TV sync ----------
  function viewFor(p) {
    const t = team.get(p.id);
    const nav = S.nav[t] === p.id;
    const votes = S.board.map(() => []);
    for (const [pid, v] of S.votes) {
      const q = ctx.player(pid);
      if (q && typeof v === 'number') votes[v].push(q.name);
    }
    const stopVotes = [...S.votes.values()].filter((v) => v === 'stop').length;
    const guessing = S.phase === 'guess' && S.turn === t && !nav;
    return {
      color: TEAMS[t].color,
      sc: {
        role: nav ? 'nav' : 'op', team: t, teamName: TEAMS[t].name,
        words: S.board.map((c) => c.word),
        open: S.board.map((c) => (c.open ? c.kind : null)),
        key: nav || S.phase === 'over' ? S.board.map((c) => c.kind) : null,
        turn: S.turn, turnName: TEAMS[S.turn].name, phase: S.phase,
        navName: ctx.player(S.nav[S.turn])?.name || '',
        clue: S.clue && { word: S.clue.word, n: S.clue.n, left: S.clue.left },
        votes, myVote: S.votes.get(p.id) ?? null,
        stopVotes, need: guessing ? need(t) : 0,
        canStop: guessing && S.guessed > 0,
        canPick: guessing,
        giveClue: nav && S.phase === 'clue' && S.turn === t,
        err: nav ? S.err : null,
        left: { sun: left('sun'), moon: left('moon') },
        winner: S.winner, reason: S.reason,
      },
    };
  }

  function sync() {
    drawTV();
    for (const p of ctx.players) {
      if (!team.has(p.id)) continue;
      const v = viewFor(p);
      const key = JSON.stringify(v);
      if (lastSent.get(p.id) === key) continue;
      lastSent.set(p.id, key);
      ctx.show(p, v);
    }
  }

  function drawTV() {
    const panel = (t) => {
      const navId = S.nav[t];
      return h(`div.sc-team.sc-${t}` + (S.turn === t && S.phase !== 'over' ? '.active' : ''),
        h('div.sc-emblem', emblem(h, t)),
        h('h2', TEAMS[t].name),
        h('div.sc-left', h('b', left(t)), h('span', left(t) === 1 ? 'star to chart' : 'stars to chart')),
        h('div.sc-who', members(t).map((p) => h('div.sc-member' + (p.connected ? '' : '.away'),
          p.id === navId ? h('span.sc-scope', '🔭 ') : null, p.name))),
        h('div.sc-log', S.log.filter((l) => l.team === t).slice(-4).map((l) =>
          h('div', h('b', l.word), ` ${l.n === ANY ? '∞' : l.n}`, h('span', ` · ${l.hits} ✓`)))));
    };
    const votesAt = S.board.map(() => []);
    for (const [pid, v] of S.votes) if (typeof v === 'number') votesAt[v].push(ctx.player(pid));
    const grid = h('div.sc-grid', S.board.map((c, i) => h(`div.sc-card` + (c.open ? `.open.k-${c.kind}` : '') +
      (S.flash === i ? '.flash' : '') + (S.phase === 'over' && !c.open ? `.ghost.k-${c.kind}` : ''),
      c.open || S.phase === 'over' ? h('div.sc-art', art(h, c.kind)) : null,
      h('span.sc-word', c.word),
      votesAt[i].length ? h('div.sc-votes', votesAt[i].map((p) => h('span.sc-dot', { style: { background: p?.color } }, p?.name[0] || ''))) : null)));

    let banner;
    if (S.phase === 'over') {
      banner = h(`div.sc-banner.sc-${S.winner}`, h('b', `${TEAMS[S.winner].name} wins!`), h('span', S.reason));
    } else if (S.phase === 'clue') {
      banner = h(`div.sc-banner.sc-${S.turn}`, h('span', `🔭 ${ctx.player(S.nav[S.turn])?.name || 'The astronomer'} is reading the stars…`));
    } else {
      const stops = [...S.votes.values()].filter((v) => v === 'stop').length;
      banner = h(`div.sc-banner.sc-${S.turn}`,
        h('span.sc-clue', S.clue.word), h('span.sc-n', S.clue.n === ANY ? '∞' : S.clue.n),
        h('span.sc-hint', S.clue.left === Infinity ? 'guess freely' : `${S.clue.left} guess${S.clue.left === 1 ? '' : 'es'} left`,
          stops ? ` · ${stops}/${need(S.turn)} want to stop` : ''));
    }
    ctx.el.replaceChildren(h('div.sc-wrap', panel('sun'), h('div.sc-mid', banner, grid), panel('moon')));
  }

  // ---------- input from phones ----------
  ctx.on('message', (p, d) => {
    if (!S || !p || !d || !team.has(p.id)) return;
    const t = team.get(p.id);
    if ('pick' in d && S.phase === 'guess' && S.turn === t && p.id !== S.nav[t]) {
      const v = d.pick;
      const ok = v === 'stop' ? S.guessed > 0 : Number.isInteger(v) && S.board[v] && !S.board[v].open;
      if (!ok) return;
      if (S.votes.get(p.id) === v) S.votes.delete(p.id); else { S.votes.set(p.id, v); sfx('pop'); }
      sync();
    } else if (d.clue && S.phase === 'clue' && S.turn === t && p.id === S.nav[t]) {
      const word = String(d.clue.word || '').trim();
      const n = Number(d.clue.n);
      const err = checkClue(word, n, S.board);
      if (err) { S.err = err; sync(); return; }
      S.err = null;
      S.pending = { word: word.toUpperCase(), n };
    }
  });
  ctx.on('join', (p) => { if (!S) return; placeLate(p); lastSent.delete(p.id); sync(); });
  ctx.on('leave', () => { if (S) sync(); });

  // ---------- one match ----------
  async function match(round) {
    for (const p of ctx.connected) placeLate(p);
    const first = lastFirst = lastFirst ? other(lastFirst) : (Math.random() < 0.5 ? 'sun' : 'moon');
    const kinds = ctx.shuffle([
      ...Array(9).fill(first), ...Array(8).fill(other(first)), ...Array(7).fill('dust'), 'hole']);
    const words = ctx.shuffle(WORDS).slice(0, SIZE);
    const pickNav = (t) => {
      const ms = members(t).filter((p) => p.connected);
      return ms.length ? ms[turnAt[t]++ % ms.length].id : null;
    };
    S = {
      board: words.map((w, i) => ({ word: w.toUpperCase(), kind: kinds[i], open: false })),
      nav: { sun: pickNav('sun'), moon: pickNav('moon') },
      turn: first, phase: 'clue', clue: null, votes: new Map(), guessed: 0,
      log: [], err: null, pending: null, winner: null, reason: '', flash: -1,
    };
    lastSent.clear();

    // Intro: show the teams.
    ctx.show('all', { wait: 'Look at the big screen!' });
    ctx.el.replaceChildren(h('div.sc-intro',
      h('h1', round ? 'Star Charts: rematch!' : 'Star Charts'),
      h('p.sub', 'Chart your team\'s stars from one-word clues. Never touch the black hole.'),
      h('div.sc-teams', ['sun', 'moon'].map((t) => h(`div.sc-team.sc-${t}.active`,
        h('div.sc-emblem', emblem(h, t)), h('h2', TEAMS[t].name),
        h('div.sc-who', members(t).filter((p) => p.connected).map((p) => h('div.sc-member',
          p.id === S.nav[t] ? h('span.sc-scope', '🔭 ') : null, p.name))),
        h('p.sub', '🔭 = astronomer')))),
      h('p.sub', `${TEAMS[first].name} goes first and has 9 stars; ${TEAMS[other(first)].name} has 8.`)));
    for (const t of ['sun', 'moon']) {
      const nav = ctx.player(S.nav[t]);
      if (nav) ctx.show(nav, { title: 'You\'re the astronomer 🔭', text: `Only you can see ${TEAMS[t].name}'s star map. Give one-word clues; your team guesses on their phones.`, color: TEAMS[t].color, buzz: true });
    }
    await ctx.sleep(7000);

    while (S.phase !== 'over') {
      await giveClue();
      if (S.phase === 'over') break;
      if (S.clue) await guess();
      if (S.phase === 'over') break;
      S.turn = other(S.turn);
      S.clue = null; S.phase = 'clue';
    }
    sync();
    await ctx.sleep(9000);
  }

  async function giveClue() {
    const t = S.turn;
    S.phase = 'clue'; S.clue = null; S.pending = null; S.err = null; S.votes.clear();
    sync();
    const stop = ctx.clock(CLUE_TIME);
    const end = Date.now() + CLUE_TIME * 1000;
    let goneSince = null;
    try {
      while (!S.pending && Date.now() < end) {
        await ctx.sleep(150);
        const nav = ctx.player(S.nav[t]);
        if (nav?.connected) { goneSince = null; continue; }
        goneSince ??= Date.now();
        const spare = members(t).find((p) => p.connected);
        if (spare && Date.now() - goneSince > LOST_NAV * 1000) {
          S.nav[t] = spare.id; goneSince = null; sync();
        }
      }
    } finally { stop(); }
    if (!S.pending) {
      S.log.push({ team: t, word: '(no clue)', n: 0, hits: 0 });
      await notice(`${TEAMS[t].name} ran out of time`, 'The sky turns to the other team.');
      return;
    }
    const n = S.pending.n;
    S.clue = { word: S.pending.word, n, left: n === 0 || n === ANY ? Infinity : n + 1 };
    S.log.push({ team: t, word: S.clue.word, n, hits: 0 });
    S.phase = 'guess'; S.guessed = 0;
    sfx('ding');
    sync();
    for (const p of ops(t)) ctx.show(p, { ...viewFor(p), buzz: true });
  }

  async function guess() {
    const t = S.turn;
    const entry = S.log[S.log.length - 1];
    while (true) {
      S.votes.clear(); sync();
      const stop = ctx.clock(GUESS_TIME);
      const end = Date.now() + GUESS_TIME * 1000;
      let pick = null;
      try {
        while (pick == null && Date.now() < end) {
          await ctx.sleep(150);
          pick = tally(t);
        }
      } finally { stop(); }
      if (pick == null || pick === 'stop') {
        S.votes.clear();
        await notice(pick ? `${TEAMS[t].name} stops guessing` : `${TEAMS[t].name} ran out of time`, '');
        return;
      }
      const card = S.board[pick];
      card.open = true; S.guessed++; S.votes.clear(); S.flash = pick;
      if (card.kind === t) entry.hits++;
      sfx(card.kind === t ? 'ding' : card.kind === 'hole' ? 'lose' : card.kind === 'dust' ? 'tock' : 'buzz');
      sync();
      await ctx.sleep(1800);
      S.flash = -1;
      if (card.kind === 'hole') return over(other(t), `${TEAMS[t].name} flew into the black hole at ${card.word}.`);
      if (left(t) === 0) return over(t, 'Every star charted!');
      if (left(other(t)) === 0) return over(other(t), `${TEAMS[t].name} charted the last of their rival's stars.`);
      if (card.kind !== t) {
        await notice(card.kind === 'dust' ? 'Just space dust' : `That was one of ${TEAMS[card.kind].name}'s stars!`, '');
        return;
      }
      S.clue.left--;
      if (S.clue.left <= 0) { await notice('Out of guesses', ''); return; }
    }
  }

  function tally(t) {
    const counts = new Map();
    const live = new Set(ops(t).map((p) => p.id));
    for (const [pid, v] of S.votes) if (live.has(pid)) counts.set(v, (counts.get(v) || 0) + 1);
    const n = need(t);
    for (const [v, c] of counts) if (c >= n) return v;
    return null;
  }

  async function notice(title, sub) {
    sync();
    ctx.el.querySelector('.sc-mid')?.append(h('div.sc-notice', h('b', title), sub && h('span', sub)));
    await ctx.sleep(2200);
  }

  function over(winner, reason) {
    S.phase = 'over'; S.winner = winner; S.reason = reason;
    ctx.setTimeout(() => sfx('win'), 700);
    sync();
  }

  // ---------- rematches ----------
  for (let round = 0; ; round++) {
    await match(round);
    S = null;
    ctx.el.replaceChildren(h('div.say', h('h1', 'Another sky?'), h('p', 'Vote on your phone. New astronomers next time.')));
    const ans = await ctx.ask('all', {
      title: 'Play again?', text: 'Same teams, new astronomers, new sky.',
      choices: [{ label: '🔭 Rematch', value: 'again' }, { label: 'Back to the lobby', value: 'lobby' }],
    }, { timeout: 20, after: { wait: 'Vote counted!' } });
    const yes = [...ans.values()].filter((v) => v === 'again').length;
    if (yes <= ans.size - yes || ctx.connected.length < 4) break;
  }
  ctx.show('all', { wait: 'Back to the lobby…' });
}

export function checkClue(word, n, board) {
  if (!word) return 'Type a clue word.';
  if (!/^[\p{L}\p{N}'-]+$/u.test(word)) return 'One word only, no spaces.';
  if (word.length > 24) return 'That clue is too long.';
  if (!(Number.isInteger(n) && ((n >= 0 && n <= 9) || n === ANY))) return 'Pick a number.';
  const w = word.toUpperCase();
  for (const c of board) {
    if (c.open) continue;
    if (c.word === w) return `${c.word} is on the board. Pick another clue.`;
    const [a, b] = c.word.length < w.length ? [c.word, w] : [w, c.word];
    if (a.length >= 3 && b.includes(a)) return `Too close to ${c.word}, which is on the board.`;
  }
  return null;
}

// ---------- styles ----------
document.getElementById('star-charts-css')?.remove();
const css = Object.assign(document.createElement('style'), { id: 'star-charts-css' });
css.textContent = `
  .game:has(.sc-wrap), .game:has(.sc-intro) {
    background:
      radial-gradient(1.5px 1.5px at 12% 18%, #fff8 50%, transparent 51%),
      radial-gradient(1px 1px at 33% 72%, #fff9 50%, transparent 51%),
      radial-gradient(2px 2px at 58% 12%, #fffa 50%, transparent 51%),
      radial-gradient(1px 1px at 81% 44%, #fff8 50%, transparent 51%),
      radial-gradient(1.5px 1.5px at 92% 82%, #fff9 50%, transparent 51%),
      radial-gradient(1px 1px at 6% 88%, #fff7 50%, transparent 51%),
      radial-gradient(1200px 600px at 50% 120%, #2a1a5e 0%, transparent 70%);
    background-size: 340px 300px, 410px 380px, 520px 460px, 300px 330px, 470px 420px, 390px 350px, 100% 100%;
    border-radius: 20px;
  }
  .sc-wrap { display: grid; grid-template-columns: minmax(9em, 1fr) minmax(0, 4.2fr) minmax(9em, 1fr); gap: 2vw; width: 100%; align-items: start; }
  .sc-team { --tc: #fff; background: color-mix(in srgb, var(--tc) 8%, #16122acc); border: 3px solid color-mix(in srgb, var(--tc) 35%, transparent);
    border-radius: 22px; padding: 1em .8em; display: flex; flex-direction: column; gap: .5em; align-items: center; transition: box-shadow .3s, border-color .3s; }
  .sc-team.active { border-color: var(--tc); box-shadow: 0 0 40px color-mix(in srgb, var(--tc) 35%, transparent); }
  .sc-team h2 { color: var(--tc); font-size: 1.3em; margin: 0; }
  .sc-emblem { width: 3.4em; height: 3.4em; border-radius: 50%; padding: .35em; background: color-mix(in srgb, var(--tc) 70%, #000); }
  .sc-svg, .sc-svg svg { display: block; width: 100%; height: 100%; }
  .sc-left { display: flex; flex-direction: column; line-height: 1; }
  .sc-left b { font-size: 3em; color: var(--tc); }
  .sc-left span { color: var(--dim); font-size: .8em; }
  .sc-who { display: flex; flex-direction: column; gap: .2em; font-weight: 800; }
  .sc-member.away { opacity: .4; }
  .sc-log { font-size: .75em; color: var(--dim); display: flex; flex-direction: column; gap: .15em; }
  .sc-log b { color: var(--fg); }
  .sc-mid { display: flex; flex-direction: column; gap: 1.6vh; position: relative; }
  .sc-banner { --tc: #fff; display: flex; align-items: baseline; justify-content: center; gap: .6em; flex-wrap: wrap;
    background: color-mix(in srgb, var(--tc) 16%, #16122a); border: 3px solid var(--tc); border-radius: 18px; padding: .5em 1em; font-size: 1.15em; min-height: 3.2em; align-items: center; }
  .sc-sun { --tc: #ffb547; } .sc-moon { --tc: #7fc8ff; }
  .sc-banner b { color: var(--tc); font-size: 1.4em; }
  .sc-clue { font-size: 1.9em; font-weight: 900; letter-spacing: .06em; }
  .sc-n { font-size: 1.9em; font-weight: 900; color: var(--tc); }
  .sc-hint { color: var(--dim); }
  .sc-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1vw; }
  .sc-card { position: relative; aspect-ratio: 1.75; border-radius: 14px; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(160deg, #3a3266, #221c40); border: 2px solid #4d4580; box-shadow: inset 0 2px 0 #ffffff1a;
    overflow: hidden; padding: 0 .3em; }
  .sc-word { position: relative; font-weight: 900; font-size: clamp(14px, 1.25vw, 30px); letter-spacing: .03em; overflow-wrap: anywhere; z-index: 1; }
  .sc-art { position: absolute; inset: 12% 30%; opacity: .9; }
  .sc-card.open .sc-word { font-size: clamp(11px, .9vw, 22px); align-self: flex-end; margin-bottom: .3em; opacity: .85; }
  .sc-card.open .sc-art { inset: 6% 32% 32%; }
  .sc-card.k-sun { background: linear-gradient(160deg, #ffc867, #d9781f); border-color: #ffd998; color: #3b1d00; }
  .sc-card.k-moon { background: linear-gradient(160deg, #8fd2ff, #3a6fc7); border-color: #c2e6ff; color: #04173a; }
  .sc-card.k-dust { background: linear-gradient(160deg, #57506f, #3a3550); border-color: #6c6490; color: #cfc8e8; }
  .sc-card.k-hole { background: radial-gradient(circle at 50% 50%, #000 30%, #2b0f3f 70%, #150a22); border-color: #c77dff; color: #f2d9ff;
    animation: sc-swirl 3s ease-in-out infinite alternate; }
  .sc-card.ghost { opacity: .45; filter: saturate(.6); }
  .sc-card.ghost .sc-word { font-size: clamp(11px, .9vw, 22px); align-self: flex-end; margin-bottom: .3em; }
  .sc-card.ghost .sc-art { inset: 6% 32% 32%; }
  .sc-card.flash { animation: sc-flip .6s ease-out; box-shadow: 0 0 50px #fff8; }
  @keyframes sc-flip { from { transform: rotateY(90deg) scale(1.1); } }
  @keyframes sc-swirl { to { box-shadow: 0 0 34px #c77dff; } }
  .sc-votes { position: absolute; top: 4px; right: 4px; display: flex; gap: 3px; z-index: 2; }
  .sc-dot { width: 1.3em; height: 1.3em; border-radius: 50%; font-size: .65em; font-weight: 900; color: #120f1d;
    display: flex; align-items: center; justify-content: center; border: 2px solid #fff; animation: pop .25s ease-out; }
  .sc-notice { position: absolute; left: 50%; top: 55%; transform: translate(-50%, -50%); z-index: 5; background: #0d0a1ae8;
    border: 3px solid var(--accent); border-radius: 22px; padding: 1em 2em; display: flex; flex-direction: column; gap: .3em;
    font-size: 1.6em; animation: pop .3s ease-out; white-space: nowrap; }
  .sc-notice span { font-size: .6em; color: var(--dim); }
  .sc-intro { display: flex; flex-direction: column; align-items: center; gap: 3vh; }
  .sc-intro h1 { font-size: 3.4em; background: linear-gradient(90deg, #ffb547, #fff, #7fc8ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .sc-teams { display: flex; gap: 4vw; }
  .sc-teams .sc-team { min-width: 14em; font-size: 1.3em; animation: pop .4s ease-out; }
  @media (max-aspect-ratio: 4/3) {
    .sc-wrap { grid-template-columns: 1fr 1fr; }
    .sc-mid { grid-column: 1 / -1; grid-row: 1; }
  }
`;
document.head.append(css);
