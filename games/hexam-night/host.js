// Hexam Night: a wizarding-world trivia exam you might not survive.
// Everyone answers on their phone. Living students who get a question wrong
// go to detention, a deadly mini-game; the fallen keep playing as ghosts.
// After the exam comes the Midnight Escape: a race to the castle gate where
// ghosts start behind but can catch up and come back to life.
import { QUESTIONS, STATEMENTS } from './questions.js';
import { CSS, GOLD, GHOST, BLOOD, proctorSvg, backdrop, tombSvg, cauldronSvg } from './theme.js';

const ROUNDS = 8;          // exam questions before the escape
const Q_TIME = 20;         // seconds per exam question
const FINAL_TIME = 15;     // seconds per escape question
const TRACK = 12;          // steps to the gate
const MAX_FINAL = 14;      // escape questions before the bell tolls
const SEEN_KEY = 'hexam-night.seen';

const LIVE_POINTS = 1000;  // most for a fast right answer
const GHOST_POINTS = 300;  // ghosts score a flat amount

export default async function (ctx) {
  const { h } = ctx;
  installCss();
  const frame = ctx.el.parentElement;
  frame.classList.add('hx');
  frame.prepend(backdrop());

  // ---- Custom Audio Lifecycle & Bespoke SFX ----
  ctx.music(null);
  ctx.music = () => {}; // Supersede built-in platform synth
  const isMuted = () => {
    try { return localStorage.getItem('partyhall.muted') === '1'; } catch { return false; }
  };
  let bgm = null;
  const startBgm = () => {
    if (bgm) return;
    try {
      bgm = new Audio(ctx.asset('audio/bg_main.ogg'));
      bgm.loop = true;
      bgm.volume = isMuted() ? 0 : 0.35;
      bgm.play().catch(() => {});
      setInterval(() => {
        if (bgm) bgm.muted = isMuted();
      }, 250);
    } catch {}
  };
  const playClip = (name, vol = 0.7) => {
    if (isMuted()) return;
    try {
      const a = new Audio(ctx.asset(`audio/${name}.wav`));
      a.volume = vol;
      a.play().catch(() => {});
    } catch {}
  };
  startBgm();

  const state = new Map();
  const st = (p) => {
    const id = typeof p === 'object' ? p.id : p;
    if (!state.has(id)) state.set(id, { alive: true, score: 0, pos: 0 });
    return state.get(id);
  };
  ctx.players.forEach(st);
  const isGhost = (p) => !st(p).alive;
  const living = () => ctx.connected.filter((p) => st(p).alive);
  const ghosts = () => ctx.connected.filter((p) => !st(p).alive);
  const deck = makeDeck(ctx);
  let lastGame = null;

  // ---- little TV helpers ----
  const proc = (mood, small) => {
    const d = h('div.hx-proc' + (small ? '.small' : ''));
    d.innerHTML = proctorSvg(mood);
    return d;
  };
  const talk = async (line, ms, { mood = 'smug', below, sub } = {}) => {
    const b = h('div.hx-bubble.hx-bleed');
    b.innerHTML = line; // lines are written in this file; player names go through esc()
    if (sub) b.append(h('small', sub));
    ctx.el.replaceChildren(...[h('div.hx-host', proc(mood), b), below].filter(Boolean));
    ctx.sfx('whoosh');
    if (ms) await ctx.sleep(ms);
  };
  const cauldron = () => { const d = h('div.hx-cauldron'); d.innerHTML = cauldronSvg(); return d; };
  const N = (p) => `<b>${ctx.esc(p.name)}</b>`;
  const names = (ps) => {
    const n = ps.map(N);
    return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  };
  const chip = (p, extra = '') => h('div.hx-chip' + (isGhost(p) ? '.ghost' : '') + extra, { style: { '--c': p.color } },
    (isGhost(p) ? '👻 ' : '') + p.name);
  const pip = (p) => h('span.hx-pip' + (isGhost(p) ? '.ghost' : ''), { style: { '--c': p.color } }, p.name);
  const accent = (p) => (isGhost(p) ? GHOST : GOLD);

  // ---- intro ----
  ctx.music('think');
  ctx.show('all', { title: 'Hexam Night', text: 'Your exam is about to begin.', wait: 'Look at the big screen!', color: GOLD });
  ctx.el.replaceChildren(
    h('p.hx-kicker', 'Blackspire Academy presents'),
    h('h1.hx-title', 'Hexam Night'),
    h('p.hx-tag', 'A wizarding trivia exam. Not everyone graduates.'),
    proc('smug'));
  ctx.sfx('start');
  playClip('sfx_bell', 0.85);
  await ctx.sleep(4500);
  await talk('Good evening, students. I am <b>Proctor Hollowell</b>, and I have invigilated this exam for four hundred years. Mostly because I died during one.', 6500);
  await talk('Answer on your phones. A right answer earns points, and quick answers earn more. <b>Get one wrong</b> and you go straight to detention.', 6500);
  await talk('Detention here is… rather final. But do not fret: ghosts may keep answering. And at midnight, everyone races for the gate.', 6000, { mood: 'grim' });

  // ---- the exam ----
  for (let round = 1; round <= ROUNDS; round++) {
    if (!living().length) {
      await talk('No living students remain. How efficient. Straight on to the escape, then.', 5000, { mood: 'shock' });
      break;
    }
    const diff = round <= 2 ? [1, 1, 2] : round <= 5 ? [1, 2, 2, 3] : [2, 2, 3];
    const q = deck.draw(ctx.pick(diff));
    const res = await question(q, `Question ${round} of ${ROUNDS}`, Q_TIME);
    const wrong = res.players.filter((p) => !isGhost(p) && !res.right.has(p.id));
    await scoreQuestion(res);
    if (!wrong.length) {
      await talk(ctx.pick(['Nobody failed. Disappointing. For me.', 'Everyone survived. I shall try harder.', 'A clean sheet! The dungeon sits empty tonight.']), 3500);
    } else {
      const dead = await detention(wrong);
      await bury(dead, wrong);
    }
    if (round < ROUNDS) await standings(`After question ${round}`);
  }

  // ---- the escape ----
  await escape();
  ctx.music('party');

  // ================= the exam question =================
  async function question(q, kicker, time) {
    const players = ctx.connected;
    const order = ctx.shuffle([0, 1, 2, 3]); // order[i] = which answer sits in slot i
    const opts = order.map((k) => q.answers[k]);
    const rightSlot = order.indexOf(0);
    const done = new Set();
    const times = new Map();
    const roster = h('div.hx-roster');
    const drawRoster = () => roster.replaceChildren(...players.map((p) => chip(p, done.has(p.id) ? '.done' : '')));
    drawRoster();
    const optEls = opts.map((o, i) => h('div.hx-opt', h('span.l', 'ABCD'[i]), h('span', o), h('div.who')));
    ctx.music('think');
    ctx.el.replaceChildren(h('p.hx-kicker', kicker), h('h2.hx-q.hx-bleed', q.q), h('div.hx-opts', optEls), roster);
    ctx.sfx('ding');
    const t0 = Date.now();
    const view = (ghost) => ({
      title: ghost ? `👻 ${kicker}` : kicker,
      text: q.q,
      color: ghost ? GHOST : GOLD,
      choices: opts.map((o, i) => ({ label: `${'ABCD'[i]}.  ${o}`, value: i })),
    });
    const onAnswer = (p) => {
      done.add(p.id);
      times.set(p.id, (Date.now() - t0) / 1000);
      drawRoster();
      playClip('sfx_quill_scratch', 0.6);
    };
    const after = { title: 'Answer sealed', wait: 'Eyes on the big screen…' };
    const stop = ctx.clock(time);
    const live = players.filter((p) => !isGhost(p)), dead = players.filter(isGhost);
    const [a, b] = await Promise.all([
      ctx.ask(live, view(false), { timeout: time, clock: false, after, onAnswer }),
      ctx.ask(dead, view(true), { timeout: time, clock: false, after, onAnswer }),
    ]);
    stop();
    const answers = new Map([...a, ...b]);
    // reveal
    for (const [id, slot] of answers) {
      const p = ctx.player(id);
      if (p && optEls[slot]) optEls[slot].querySelector('.who').append(pip(p));
    }
    ctx.music(null);
    await ctx.sleep(1200);
    optEls.forEach((el, i) => el.classList.add(i === rightSlot ? 'right' : 'dim'));
    playClip('sfx_wax_stamp', 0.75);
    ctx.sfx('win');
    const right = new Set([...answers].filter(([, s]) => s === rightSlot).map(([id]) => id));
    for (const p of players) {
      const ok = right.has(p.id);
      ctx.show(p, {
        title: ok ? 'Correct!' : answers.has(p.id) ? 'Wrong!' : 'Out of time!',
        text: ok ? '' : `The answer was: ${q.answers[0]}`,
        color: ok ? accent(p) : BLOOD, buzz: !ok && !isGhost(p),
        wait: 'Look at the big screen…',
      });
    }
    await ctx.sleep(3500);
    return { players, answers, right, times };
  }

  async function scoreQuestion({ players, right, times }) {
    const gains = [];
    for (const p of players) {
      if (!right.has(p.id)) continue;
      const g = isGhost(p) ? GHOST_POINTS
        : Math.round((LIVE_POINTS / 2 + (LIVE_POINTS / 2) * Math.max(0, 1 - (times.get(p.id) || Q_TIME) / Q_TIME)) / 10) * 10;
      st(p).score += g;
      gains.push([p, g]);
    }
    if (!gains.length) return;
    gains.sort((x, y) => y[1] - x[1]);
    ctx.el.replaceChildren(h('p.hx-kicker', 'Points awarded'), h('div.hx-board', gains.map(([p, g], i) =>
      h('div.hx-row' + (isGhost(p) ? '.ghost' : ''), { style: { animationDelay: `${i * 90}ms` } },
        h('span.n', (isGhost(p) ? '👻 ' : '') + p.name), h('span.s', `+${g}`)))));
    ctx.sfx('ding');
    await ctx.sleep(2800);
  }

  // ================= detention =================
  async function detention(condemned) {
    const games = [stairs, counterCurse, candles, brew, oralExam];
    const pool = games.filter((g) => g !== lastGame);
    // The stairs are best with a crowd or with ghosts to choose the victim.
    const weights = pool.map((g) => (g === stairs ? (condemned.length >= 2 || ghosts().length ? 3 : 1) : 2));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0), game = pool[0];
    for (const [i, g] of pool.entries()) { if ((r -= weights[i]) < 0) { game = g; break; } }
    lastGame = game;
    ctx.music('tense');
    playClip('sfx_thunder', 0.85);
    ctx.show(condemned, { title: 'DETENTION', text: 'You got it wrong. Report to the dungeon.', wait: 'Look at the big screen…', color: BLOOD, buzz: true });
    ghosts().forEach((p) => ctx.show(p, { title: '👻 Detention', wait: 'Someone is in trouble…', color: GHOST }));
    await talk(`${names(condemned)}, you answered poorly. To <b>detention</b> with you!`, 3800, { mood: 'grim' });
    const dead = await game(condemned);
    return dead;
  }

  // Everyone condemned picks a staircase; the ghosts pick which one crumbles.
  async function stairs(cond) {
    const NAMES = ['Creaking Stair', 'Moonlit Stair', 'Mossy Stair', 'Crooked Stair', 'Endless Stair'];
    const n = Math.min(5, Math.max(3, cond.length + 1));
    const ss = NAMES.slice(0, n);
    const spirits = ghosts();
    await talk(`<b>The Shifting Stairs.</b> Pick a staircase on your phone. When the castle shifts, one of them crumbles.${spirits.length ? ' And the <b>ghosts</b> decide which one.' : ''}`, 5500);
    const cols = ss.map((nm) => h('div.hx-stair', h('div.on'), h('div.hx-steps', Array.from({ length: 7 }, () => h('i'))), h('div.nm', nm)));
    ctx.el.replaceChildren(h('p.hx-kicker', 'The Shifting Stairs'), h('div.hx-stairs', cols), h('div.hx-roster', cond.map((p) => chip(p))));
    const choices = ss.map((nm, i) => ({ label: nm, value: i }));
    const [picks, votes] = await Promise.all([
      ctx.ask(cond, { title: 'Pick a staircase', text: 'One will crumble. Choose wisely.', color: BLOOD, choices }, { timeout: 15, after: { wait: 'Holding the banister…' } }),
      ctx.ask(spirits, { title: '👻 Haunt a staircase', text: `Pick the one you think they’ll choose. Each student it drops earns you ${200} points.`, color: GHOST, choices }, { timeout: 15, clock: !cond.length, after: { wait: 'Wailing at the stonework…' } }),
    ]);
    const where = new Map(cond.map((p) => [p.id, picks.has(p.id) ? picks.get(p.id) : Math.floor(Math.random() * n)]));
    cond.forEach((p) => cols[where.get(p.id)].querySelector('.on').append(pip(p)));
    ctx.sfx('pop');
    let crumble;
    if (votes.size) {
      const c = new Array(n).fill(0);
      for (const v of votes.values()) c[v]++;
      const top = Math.max(...c);
      crumble = ctx.pick(c.map((x, i) => [x, i]).filter(([x]) => x === top).map(([, i]) => i));
    } else crumble = Math.floor(Math.random() * n);
    await talk('The castle groans… the stairs begin to move…', 0, { below: h('div.hx-stairs', cols) });
    await ctx.sleep(2500);
    cols[crumble].classList.add('shake');
    playClip('sfx_thunder', 0.75);
    ctx.sfx('buzz');
    await ctx.sleep(1800);
    cols[crumble].classList.remove('shake');
    cols[crumble].classList.add('fall');
    ctx.sfx('lose');
    await ctx.sleep(1600);
    const dead = cond.filter((p) => where.get(p.id) === crumble);
    for (const [id, v] of votes) if (v === crumble && dead.length) { const g = ctx.player(id); if (g) st(g).score += 200 * dead.length; }
    await talk(`The <b>${ss[crumble]}</b> collapsed!` + (dead.length ? ` ${names(dead)} went down with it.` : ' Nobody was standing on it. Pity.'), 3500,
      { mood: dead.length ? 'smug' : 'shock' });
    return dead;
  }

  // Type a curse word backwards to undo it.
  async function counterCurse(cond) {
    const word = curseWord();
    const target = [...word].reverse().join('');
    await talk('<b>The Counter-Curse.</b> A curse word is coming. Type it <b>backwards</b> to undo it. Ghosts can play for points.', 5000);
    ctx.el.replaceChildren(h('p.hx-kicker', 'Type it backwards'), h('div.hx-curse', word.toUpperCase()), h('div.hx-roster', cond.map((p) => chip(p))));
    ctx.sfx('glitch');
    const spirits = ghosts();
    const view = (ghost) => ({ title: ghost ? '👻 Counter-Curse' : 'Counter-Curse!', text: `${word.toUpperCase()}\nType it backwards.`,
      color: ghost ? GHOST : BLOOD, input: { placeholder: 'Backwards…', max: 20, submit: 'Cast it' } });
    const [a, b] = await Promise.all([
      ctx.ask(cond, view(false), { timeout: 20, after: { wait: 'Spell cast…' } }),
      ctx.ask(spirits, view(true), { timeout: 20, clock: false, after: { wait: 'Spell cast…' } }),
    ]);
    playClip('sfx_quill_scratch', 0.6);
    const ok = (v) => lev(String(v || '').toLowerCase().replace(/[^a-z]/g, ''), target) <= 1;
    for (const [id, v] of b) if (ok(v)) { const g = ctx.player(id); if (g) st(g).score += 200; }
    const dead = cond.filter((p) => !ok(a.get(p.id)));
    ctx.el.replaceChildren(h('p.hx-kicker', 'The counter-curse was'), h('div.hx-curse', target.toUpperCase()),
      h('div.hx-board', cond.map((p) => h('div.hx-row', h('span.n', p.name), h('span.s', a.has(p.id) ? `“${String(a.get(p.id)).slice(0, 20)}”` : '(silence)'),
        h('span', ok(a.get(p.id)) ? '✅' : '💀')))));
    ctx.sfx(dead.length ? 'lose' : 'win');
    await ctx.sleep(5000);
    return dead;
  }

  // Count the floating candles before they go out.
  async function candles(cond) {
    const count = 12 + Math.floor(Math.random() * 29);
    const tol = Math.max(3, Math.round(count * 0.2));
    await talk(`<b>Candlelight.</b> Floating candles will appear for a few seconds. Guess how many. Be within <b>${tol}</b>… or else.`, 5000);
    const box = h('div.hx-candles');
    const spots = [];
    for (let i = 0; i < count; i++) {
      let x, y, tries = 0;
      do { x = 3 + Math.random() * 92; y = 8 + Math.random() * 82; tries++; } while (tries < 40 && spots.some(([a, b]) => Math.abs(a - x) < 4 && Math.abs(b - y) < 9));
      spots.push([x, y]);
      box.append(h('div.hx-candle', { style: { left: `${x}%`, top: `${y}%`, animationDelay: `${(i % 9) * .29}s` } }));
    }
    ctx.show('all', { title: 'Count the candles!', wait: 'Look at the big screen, quickly!', color: GOLD });
    ctx.el.replaceChildren(h('p.hx-kicker', 'Count the candles'), box);
    ctx.sfx('ding');
    await ctx.sleep(5000);
    box.classList.add('out');
    ctx.sfx('whoosh');
    const spirits = ghosts();
    const view = (ghost) => ({ title: ghost ? '👻 How many candles?' : 'How many candles?', color: ghost ? GHOST : BLOOD,
      number: { min: 0, max: 60, step: 1, value: 25, submit: 'That many' } });
    const [a, b] = await Promise.all([
      ctx.ask(cond, view(false), { timeout: 15, after: { wait: 'Counting on you…' } }),
      ctx.ask(spirits, view(true), { timeout: 15, clock: false, after: { wait: 'Counting on you…' } }),
    ]);
    const ok = (v) => typeof v === 'number' && Math.abs(v - count) <= tol;
    for (const [id, v] of b) if (ok(v)) { const g = ctx.player(id); if (g) st(g).score += 200; }
    const dead = cond.filter((p) => !ok(a.get(p.id)));
    box.classList.remove('out');
    ctx.el.replaceChildren(h('p.hx-big', `${count} candles`), box,
      h('div.hx-board', cond.map((p) => h('div.hx-row', h('span.n', p.name), h('span.s', a.has(p.id) ? a.get(p.id) : '—'), h('span', ok(a.get(p.id)) ? '✅' : '💀')))));
    ctx.sfx(dead.length ? 'lose' : 'win');
    await ctx.sleep(5500);
    return dead;
  }

  // Remember the order ingredients went into the cauldron.
  async function brew(cond) {
    const ING = ['🔴', '🟢', '🔵', '🟡', '🟣', '🟠'];
    const seq = ctx.shuffle(ING).slice(0, 5);
    await talk('<b>The Proctor’s Brew.</b> Watch the order I add the ingredients. Then pick the right order on your phone.', 4500);
    ctx.show('all', { title: 'Watch the cauldron!', wait: 'Remember the order…', color: GOLD });
    const pot = h('div.hx-brew');
    ctx.el.replaceChildren(h('p.hx-kicker', 'Into the cauldron…'), pot, cauldron());
    for (const s of seq) { pot.append(h('span.hx-drop', s)); ctx.sfx('pop'); await ctx.sleep(900); }
    await ctx.sleep(1500);
    pot.replaceChildren(h('span.hx-drop', '❓'));
    const swap = (a, i, j) => { const b = [...a]; [b[i], b[j]] = [b[j], b[i]]; return b; };
    const options = new Set([seq.join('')]);
    const variants = [swap(seq, 0, 1), swap(seq, 2, 3), swap(seq, 3, 4), swap(seq, 1, 3), swap(seq, 0, 4),
      [...seq.slice(0, 4), ING.find((x) => !seq.includes(x))]];
    for (const v of ctx.shuffle(variants)) { if (options.size >= 4) break; options.add(v.join('')); }
    const list = ctx.shuffle([...options]);
    const choices = list.map((s) => ({ label: [...s].join(' '), value: s }));
    const spirits = ghosts();
    const [a, b] = await Promise.all([
      ctx.ask(cond, { title: 'Which order?', color: BLOOD, choices }, { timeout: 15, after: { wait: 'Stirring…' } }),
      ctx.ask(spirits, { title: '👻 Which order?', color: GHOST, choices }, { timeout: 15, clock: false, after: { wait: 'Stirring…' } }),
    ]);
    const ok = (v) => v === seq.join('');
    for (const [id, v] of b) if (ok(v)) { const g = ctx.player(id); if (g) st(g).score += 200; }
    const dead = cond.filter((p) => !ok(a.get(p.id)));
    pot.replaceChildren(...seq.map((s) => h('span.hx-drop', s)));
    ctx.el.append(h('div.hx-board', cond.map((p) => h('div.hx-row', h('span.n', p.name), h('span', ok(a.get(p.id)) ? '✅' : '💀')))));
    ctx.sfx(dead.length ? 'lose' : 'win');
    await ctx.sleep(5000);
    return dead;
  }

  // Three rapid true-or-false statements; get two right to survive.
  async function oralExam(cond) {
    await talk('<b>The Oral Exam.</b> Three statements, true or false. Get <b>two</b> right or stay down here forever.', 4500);
    const items = deck.statements(3);
    const score = new Map(cond.map((p) => [p.id, 0]));
    const spirits = ghosts();
    for (const [i, [text, truth]] of items.entries()) {
      ctx.el.replaceChildren(h('p.hx-kicker', `Statement ${i + 1} of 3`), h('h2.hx-q', text),
        h('div.hx-board', cond.map((p) => h('div.hx-row', h('span.n', p.name), h('span.s', `${score.get(p.id)} right`)))));
      const choices = [{ label: 'True', value: true }, { label: 'False', value: false }];
      const [a, b] = await Promise.all([
        ctx.ask(cond, { title: `True or false? (${i + 1}/3)`, text, color: BLOOD, choices }, { timeout: 8, after: { wait: 'Noted…' } }),
        ctx.ask(spirits, { title: `👻 True or false? (${i + 1}/3)`, text, color: GHOST, choices }, { timeout: 8, clock: false, after: { wait: 'Noted…' } }),
      ]);
      for (const [id, v] of a) if (v === truth) score.set(id, score.get(id) + 1);
      for (const [id, v] of b) if (v === truth) { const g = ctx.player(id); if (g) st(g).score += 100; }
      ctx.el.replaceChildren(h('p.hx-big', truth ? 'TRUE' : 'FALSE'), h('h2.hx-q', text),
        h('div.hx-board', cond.map((p) => h('div.hx-row', h('span.n', p.name), h('span', a.get(p.id) === truth ? '✅' : '❌')))));
      ctx.sfx('ding');
      await ctx.sleep(2500);
    }
    return cond.filter((p) => score.get(p.id) < 2);
  }

  // Turn the dead into ghosts with a little ceremony.
  async function bury(dead, condemned) {
    const saved = condemned.filter((p) => !dead.includes(p));
    for (const p of saved) ctx.show(p, { title: 'You survived!', text: 'Back to class with you.', color: GOLD, wait: 'Look at the big screen…' });
    if (!dead.length) {
      ctx.music(null);
      await talk(`${names(saved)} survived detention. Hmph.`, 3500, { mood: 'shock' });
      return;
    }
    for (const p of dead) st(p).alive = false;
    for (const p of dead) ctx.show(p, { title: '💀 You died', text: 'You are a ghost now. Keep answering for points. In the Midnight Escape, catch a living player to come back to life!', color: GHOST, buzz: true, wait: 'Haunting…' });
    ctx.music(null);
    playClip('sfx_wax_stamp', 0.8);
    ctx.sfx('lose');
    const tombs = h('div.hx-tombs', dead.map((p, i) => {
      const t = h('div.hx-tomb', { style: { animationDelay: `${i * 300}ms` } });
      t.innerHTML = tombSvg(p.name);
      return t;
    }));
    ctx.el.replaceChildren(tombs, h('p.hx-ghostup', `${dead.map((p) => p.name).join(', ')} ${dead.length === 1 ? 'has' : 'have'} joined the ghosts 👻`),
      saved.length ? h('p.hx-tag', `${saved.map((p) => p.name).join(', ')} survived.`) : null);
    await ctx.sleep(4500);
  }

  async function standings(heading) {
    const rows = ctx.players.map((p) => ({ p, s: st(p).score })).sort((a, b) => b.s - a.s);
    ctx.show('all', { wait: 'Next question coming up…', color: GOLD });
    ctx.el.replaceChildren(h('p.hx-kicker', heading), h('div.hx-board', rows.map(({ p, s }, i) =>
      h('div.hx-row' + (isGhost(p) ? '.ghost' : ''), { style: { animationDelay: `${i * 80}ms` } },
        h('span', `#${i + 1}`), h('span.n', (isGhost(p) ? '👻 ' : '') + p.name), h('span.s', s)))));
    ctx.music('lobby');
    await ctx.sleep(4000);
  }

  // ================= the Midnight Escape =================
  async function escape() {
    const racers = ctx.connected;
    if (!racers.length) return;
    const top = Math.max(...racers.map((p) => st(p).score));
    for (const p of racers) st(p).pos = (isGhost(p) ? 0 : 2) + (st(p).score === top && top > 0 ? 1 : 0);
    ctx.music('tense');
    playClip('sfx_bell', 0.9);
    await talk('The clock strikes midnight. Time for <b>the Midnight Escape</b>! First one through the gate wins the whole thing.', 5500);
    await talk(`Right answers move you: living students <b>2 steps</b>, ghosts <b>1</b>, plus a bonus step for the fastest right answer. Ghosts who catch a living student <b>come back to life</b>. Top scorer gets a head start.`, 8000);
    const lanes = new Map();
    const track = h('div.hx-track', { style: { '--len': TRACK } });
    for (const p of racers) {
      const tok = h('div.hx-token', { style: { '--c': p.color } });
      const lane = h('div.hx-lane', h('span.n'), h('div.hx-path', { style: { '--len': TRACK } }, tok));
      lanes.set(p.id, { lane, tok });
      track.append(lane);
    }
    const draw = () => {
      for (const p of racers) {
        const { lane, tok } = lanes.get(p.id);
        lane.classList.toggle('ghost', isGhost(p));
        lane.querySelector('.n').textContent = (isGhost(p) ? '👻 ' : '') + p.name;
        tok.textContent = isGhost(p) ? '👻' : '';
        tok.style.left = `${(Math.min(st(p).pos, TRACK) / TRACK) * 100}%`;
      }
    };
    const showTrack = async (kicker, ms) => {
      draw();
      ctx.el.replaceChildren(h('p.hx-kicker', kicker), track);
      await ctx.sleep(ms);
    };
    await showTrack('The race begins', 3500);
    let winner = null;
    for (let i = 1; i <= MAX_FINAL && !winner; i++) {
      const q = deck.draw(ctx.pick([1, 2, 2, 3]));
      const res = await question(q, `Escape question ${i}`, FINAL_TIME);
      const right = res.players.filter((p) => res.right.has(p.id));
      const fastest = right.slice().sort((a, b) => (res.times.get(a.id) ?? 99) - (res.times.get(b.id) ?? 99))[0];
      // Ghosts crawl while anyone is alive; in an all-ghost race everyone runs.
      const anyAlive = racers.some((p) => !isGhost(p));
      for (const p of right) st(p).pos += (isGhost(p) && anyAlive ? 1 : 2) + (p === fastest ? 1 : 0);
      ctx.sfx('pop');
      await showTrack(fastest ? `${fastest.name} was fastest!` : 'Nobody moves…', 2200);
      // ghosts who catch a living racer are restored
      const alive = racers.filter((p) => !isGhost(p));
      const back = alive.length ? racers.filter((p) => isGhost(p) && st(p).pos >= Math.min(...alive.map((q) => st(q).pos))) : [];
      if (back.length) {
        for (const p of back) {
          st(p).alive = true;
          ctx.show(p, { title: '✨ You’re alive again!', text: 'You move 2 steps per right answer now.', color: GOLD, buzz: true, wait: 'Run!' });
        }
        ctx.sfx('win');
        await talk(`${names(back)} caught up and ${back.length === 1 ? 'is' : 'are'} <b>alive again</b>! Most irregular.`, 3500, { mood: 'shock' });
        await showTrack('Back in the race', 1500);
      }
      const through = racers.filter((p) => st(p).pos >= TRACK);
      if (through.length) {
        through.sort((a, b) => st(b).pos - st(a).pos || st(b).score - st(a).score);
        winner = through[0];
      }
    }
    if (!winner) {
      winner = racers.slice().sort((a, b) => st(b).pos - st(a).pos || st(b).score - st(a).score)[0];
      playClip('sfx_bell', 0.8);
      await talk('The bell has stopped tolling. The gate swings shut on all of you… except the one closest.', 5000, { mood: 'grim' });
    }
    // finish
    ctx.music('party');
    ctx.sfx('win');
    for (const p of ctx.connected) {
      ctx.show(p, p === winner
        ? { title: '🏆 You escaped!', text: 'You win Hexam Night!', color: GOLD, buzz: true, wait: 'Back to the lobby soon…' }
        : { title: `${winner.name} escaped`, text: 'You remain at Blackspire Academy. Forever.', color: isGhost(p) ? GHOST : BLOOD, wait: 'Back to the lobby soon…' });
    }
    ctx.el.replaceChildren(
      h('p.hx-kicker', 'Through the gate'),
      h('h1.hx-title', winner.name),
      h('p.hx-tag', `escapes Blackspire Academy${isGhost(winner) ? ' (as a ghost, somehow)' : ''}!`),
      proc('shock'));
    await ctx.sleep(6500);
    const rows = ctx.players.map((p) => ({ p, s: st(p).score })).sort((a, b) => (b.p === winner) - (a.p === winner) || b.s - a.s);
    ctx.el.replaceChildren(h('p.hx-kicker', 'Final results'), h('div.hx-board', rows.map(({ p, s }, i) =>
      h('div.hx-row' + (isGhost(p) ? '.ghost' : ''), { style: { animationDelay: `${i * 90}ms` } },
        h('span', i === 0 ? '🏆' : `#${i + 1}`), h('span.n', (isGhost(p) ? '👻 ' : '') + p.name), h('span.s', `${s} pts`)))));
    await ctx.sleep(8000);
  }
}

// ---- question deck: avoids repeats across games on this TV ----
function makeDeck(ctx) {
  let seen = new Set();
  try { seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY)) || []); } catch {}
  const save = () => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch {} };
  const used = new Set();
  let sUsed = new Set();
  return {
    draw(diff) {
      let pool = QUESTIONS.map((q, i) => i).filter((i) => !used.has(i) && !seen.has(i));
      if (pool.length < 30) { seen = new Set(); pool = QUESTIONS.map((q, i) => i).filter((i) => !used.has(i)); }
      const exact = pool.filter((i) => QUESTIONS[i][0] === diff);
      const i = ctx.pick(exact.length ? exact : pool);
      used.add(i); seen.add(i); save();
      const [, q, ...answers] = QUESTIONS[i];
      return { q, answers };
    },
    statements(n) {
      let pool = STATEMENTS.filter((_, i) => !sUsed.has(i));
      if (pool.length < n) { sUsed = new Set(); pool = STATEMENTS; }
      const picked = ctx.shuffle(pool).slice(0, n);
      picked.forEach((s) => sUsed.add(STATEMENTS.indexOf(s)));
      return picked;
    },
  };
}

function curseWord() {
  const A = ['vor', 'gral', 'zim', 'quel', 'morb', 'fen', 'drak', 'sul', 'thra', 'nox', 'brim', 'kel'];
  const B = ['ax', 'ul', 'esk', 'or', 'im', 'ath', 'ub', 'en', 'ix', 'oth'];
  const C = ['us', 'ra', 'ik', 'on', 'ma', 'et'];
  const r = (a) => a[Math.floor(Math.random() * a.length)];
  return r(A) + r(B) + (Math.random() < 0.5 ? r(C) : '');
}

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

function installCss() {
  document.getElementById('hexam-night-css')?.remove();
  document.head.append(Object.assign(document.createElement('style'), { id: 'hexam-night-css', textContent: CSS }));
}
