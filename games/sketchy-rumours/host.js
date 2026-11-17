// Sketchy Rumours: a drawing telephone game.
//
// Everyone starts a notebook by writing a rumour. Notebooks are passed round:
// the next person draws what the last one wrote, the one after writes what
// they think the drawing shows, and so on. Nobody sees their own notebook
// again until the reveal on the TV, where the owner flips the pages and
// everyone else throws reactions at the screen.
//
// Phones run player.js (a proper drawing pad with undo, fill and an eraser,
// and auto-submit when time runs out). The two sides talk with messages whose
// kind starts with "sr-".
import { PROMPTS } from './prompts.js';

const PACES = {
  quick: { label: '⚡ Quick', write: 25, draw: 50 },
  normal: { label: '✏️ Normal', write: 40, draw: 80 },
  relaxed: { label: '🛋️ Relaxed', write: 60, draw: 120 },
};
const GRACE = 5;          // seconds phones get to send their page after time's up
const MAX_STEPS = 10;     // pages per notebook at most (a 12-player game stops at 10)
const REACTIONS = ['😂', '😍', '🤯', '👏', '💀'];
const MAX_IMG = 450_000;  // characters of data URL we accept for a drawing

export default async function (ctx) {
  const { h } = ctx;
  const sfx = (n) => { try { ctx.sfx?.(n); } catch {} };
  addStyles(ctx);
  const root = h('div.sr');
  const paint = (...kids) => { root.replaceChildren(...kids); if (!root.isConnected) ctx.el.replaceChildren(root); };

  // ---- phones talk to us here ----
  const lastView = new Map();      // our own copy, so player.js can ask for it again
  let collecting = null;           // { phase, answers: Map, who: Set }
  let reveal = null;               // { next(), react(p, e) }
  const show = (to, view) => {
    for (const p of [].concat(to === 'all' ? ctx.players : to)) lastView.set(p.id, view);
    ctx.show(to, view);
  };
  ctx.on('message', (p, d) => {
    if (!p || !d || typeof d !== 'object') return;
    if (d.kind === 'sr-hello') {
      const v = lastView.get(p.id);
      if (v) ctx.show(p, v);
    } else if (d.kind === 'sr-answer' && collecting && d.phase === collecting.phase
      && collecting.who.has(p.id) && !collecting.answers.has(p.id)) {
      collecting.answers.set(p.id, d.value);
      show(p, { sr: 'wait', text: collecting.after });
      collecting.onAnswer?.(p);
    } else if (d.kind === 'sr-next') reveal?.next(p);
    else if (d.kind === 'sr-react' && REACTIONS.includes(d.e)) reveal?.react(p, d.e);
  });

  /**
   * Show each player their own view and wait for their pages. At `seconds`
   * the phones are told time's up and send what they have; anyone still
   * silent GRACE seconds later is skipped.
   */
  let phaseSeq = 0;
  async function collect(jobs, seconds, after, onAnswer) {
    const phase = `p${++phaseSeq}`;
    const ends = Date.now() + seconds * 1000;
    collecting = { phase, answers: new Map(), who: new Set(jobs.map((j) => j.p.id)), after, onAnswer };
    for (const j of jobs) show(j.p, { ...j.view, phase, seconds, ends });
    const stopClock = ctx.clock(seconds);
    let warned = false;
    const done = () => [...collecting.who].every((id) => collecting.answers.has(id) || !ctx.player(id)?.connected);
    try {
      while (!done()) {
        const now = Date.now();
        if (!warned && now >= ends) { warned = true; ctx.broadcast({ kind: 'sr-timesup', phase }); }
        if (now >= ends + GRACE * 1000) break;
        await ctx.sleep(200);
      }
    } finally { stopClock(); }
    const got = collecting.answers;
    collecting = null;
    return got;
  }

  // ---- setup ----
  paint(h('div.sr-page.sr-center',
    h('div.sr-logo', 'Sketchy', h('span', 'Rumours')),
    h('p.sr-sub', 'Write a rumour. Pass it on. Watch it fall apart.')));
  show('all', { sr: 'wait', text: 'Get your best pen ready…' });
  await ctx.sleep(3000);

  const vip = ctx.connected[0];
  let pace = PACES.normal;
  if (vip) {
    paint(h('div.sr-page.sr-center', h('h1.sr-title', 'Picking the pace…'),
      h('p.sr-sub', h('b', { style: { color: vip.color } }, vip.name), ' is choosing how long everyone gets to draw.')));
    show(ctx.connected.filter((p) => p.id !== vip.id), { sr: 'wait', text: `${vip.name} is picking the pace…` });
    const got = await ctx.ask(vip, {
      title: 'How fast should we go?',
      text: 'Seconds to write / seconds to draw',
      choices: Object.entries(PACES).map(([k, v]) => ({ label: `${v.label}  (${v.write}s / ${v.draw}s)`, value: k })),
    }, { timeout: 20, after: { wait: 'Nice choice.' } });
    pace = PACES[got.get(vip.id)] || PACES.normal;
  }

  const order = ctx.shuffle(ctx.connected);
  const n = order.length;
  if (n < 3) return ctx.say('Not enough players', 'Sketchy Rumours needs at least 3 people.', 5000);
  const steps = Math.min(n, MAX_STEPS);
  const books = order.map((owner) => ({ owner, pages: [] }));
  let deck = ctx.shuffle(PROMPTS);
  const randomPrompt = () => { if (!deck.length) deck = ctx.shuffle(PROMPTS); return deck.pop(); };
  const lastText = (book) => [...book.pages].reverse().find((pg) => pg.type === 'text' && !pg.missing)?.value;
  const lastPage = (book) => book.pages[book.pages.length - 1];
  const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

  // ---- the passing rounds ----
  for (let s = 0; s < steps; s++) {
    const kind = s === 0 ? 'prompt' : s % 2 ? 'draw' : 'guess';
    // Notebook b is with player (b + s) % n, so nobody gets the same notebook twice.
    const holder = (b) => order[(b + s) % n];
    const jobs = books.map((book, b) => {
      const p = holder(b);
      const prev = lastPage(book);
      let view;
      if (kind === 'prompt') {
        view = { sr: 'write', title: 'Start a rumour', text: 'Write something for the next person to draw.',
          placeholder: 'A penguin who is afraid of ice…', ideas: ctx.shuffle(PROMPTS).slice(0, 12) };
      } else if (kind === 'draw') {
        view = { sr: 'draw', prompt: lastText(book), note: prev.missing ? 'They didn\'t guess in time, so here\'s an earlier page.' : null };
      } else {
        view = prev.missing
          ? { sr: 'write', title: 'A blank page!', text: 'The artist left this page empty. Make up anything for the next person to draw.', placeholder: 'Anything at all…' }
          : { sr: 'write', title: 'What is this?', image: prev.value, text: 'Describe the drawing so the next person can draw it.', placeholder: 'I think it\'s…' };
      }
      return { p, book, view };
    });

    const title = { prompt: '📝 Write a rumour!', draw: '🖍️ Draw it!', guess: '🔍 What is it?' }[kind];
    const sub = { prompt: 'Something silly for the next person to draw.', draw: 'Draw what your notebook says. No letters!',
      guess: 'Describe the drawing you were handed.' }[kind];
    const done = new Set();
    const board = () => paint(h('div.sr-page',
      h('div.sr-steps', Array.from({ length: steps }, (_, i) => h('span' + (i < s ? '.past' : i === s ? '.now' : ''),
        i === 0 ? '📝' : i % 2 ? '🖍️' : '🔍'))),
      h('h1.sr-title', title), h('p.sr-sub', sub),
      h('div.sr-notes', order.map((p, i) => h('div.sr-note' + (done.has(p.id) ? '.done' : '') + (p.connected ? '' : '.away'),
        { style: { '--c': p.color, '--r': `${((i * 37) % 7) - 3}deg` } },
        h('span.sr-name', p.name), h('span.sr-stamp', done.has(p.id) ? '✓' : '…'))))));
    board();
    const seconds = kind === 'draw' ? pace.draw : pace.write;
    const after = kind === 'draw' ? 'Lovely. Waiting for the other artists…' : 'Got it! Waiting for everyone else…';
    const got = await collect(jobs, seconds, after, (p) => { done.add(p.id); sfx('ding'); board(); });

    for (const j of jobs) {
      const v = got.get(j.p.id);
      if (kind === 'draw') {
        const ok = v && typeof v === 'object' && !v.blank && typeof v.img === 'string'
          && /^data:image\/(png|jpeg|webp);base64,/.test(v.img) && v.img.length < MAX_IMG;
        j.book.pages.push(ok ? { type: 'draw', by: j.p, value: v.img } : { type: 'draw', by: j.p, missing: true });
      } else {
        const text = clean(v, 100);
        if (text) j.book.pages.push({ type: 'text', by: j.p, value: text });
        else if (kind === 'prompt') j.book.pages.push({ type: 'text', by: j.p, value: randomPrompt(), auto: true });
        else j.book.pages.push({ type: 'text', by: j.p, value: 'No idea!', missing: true });
      }
    }
    sfx('whoosh');
    show('all', { sr: 'wait', text: s + 1 < steps ? 'Passing the notebooks on…' : 'All done! Look at the TV.' });
    paint(h('div.sr-page.sr-center', h('div.sr-pass', '📓➡️'),
      h('h1.sr-title', s + 1 < steps ? 'Pass the notebooks!' : 'Pens down!')));
    await ctx.sleep(s + 1 < steps ? 1800 : 2500);
  }

  // ---- the reveal ----
  const love = new Map(ctx.players.map((p) => [p.id, 0]));   // reactions received
  const loveBy = new Map(ctx.players.map((p) => [p.id, {}]));
  for (const book of books) await revealBook(book);

  // ---- awards ----
  const ranked = ctx.players.map((p) => ({ p, n: love.get(p.id) || 0 })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
  show('all', { sr: 'wait', text: 'Thanks for playing! Back to the lobby soon…' });
  if (ranked.length) {
    sfx('win');
    paint(h('div.sr-page.sr-center', h('h1.sr-title', '🏆 Crowd favourites'),
      h('div.sr-podium', ranked.map((r, i) => h('div.sr-place', { style: { '--c': r.p.color, '--d': `${i * 0.4}s` } },
        h('div.sr-medal', ['🥇', '🥈', '🥉'][i]), h('div.sr-pname', r.p.name),
        h('div.sr-pemoji', Object.entries(loveBy.get(r.p.id)).sort((a, b) => b[1] - a[1]).map(([e, c]) => `${e}${c}`).join('  ')),
        h('div.sr-pcount', `${r.n} reaction${r.n === 1 ? '' : 's'}`)))),
      h('p.sr-sub', 'Reactions thrown at your pages during the reveal (up to 3 per person per page).')));
    await ctx.sleep(9000);
  } else {
    await sayPaper('That\'s a wrap!', 'Every rumour has been told.', 5000);
  }

  async function sayPaper(title, sub, ms) {
    paint(h('div.sr-page.sr-center', h('h1.sr-title', title), sub && h('p.sr-sub', sub)));
    await ctx.sleep(ms);
  }

  async function revealBook(book) {
    const owner = book.owner;
    const track = h('div.sr-track');
    const fx = h('div.sr-fx');
    const foot = h('div.sr-foot');
    paint(h('div.sr-page.sr-reveal',
      h('h1.sr-title', h('span', { style: { color: owner.color } }, owner.name), '’s notebook'),
      track, foot, fx));
    const others = ctx.players.filter((p) => p.id !== owner.id);
    const reactView = { sr: 'react', title: `${owner.name}'s notebook`, emojis: REACTIONS };
    show(others, reactView);
    let current = null;
    let advance = null;
    reveal = {
      next: (p) => { if (p.id === owner.id) advance?.(); },
      react: (p, e) => {
        const f = h('span.sr-fly', { style: { left: `${10 + Math.random() * 80}%`, '--x': `${Math.random() * 80 - 40}px` } }, e);
        fx.append(f); ctx.setTimeout(() => f.remove(), 2600);
        const key = p.id;
        if (current) current.reacts = current.reacts || {};
        if (current && current.by.id !== p.id && (current.reacts[key] = (current.reacts[key] || 0) + 1) <= 3) {
          love.set(current.by.id, (love.get(current.by.id) || 0) + 1);
          const m = loveBy.get(current.by.id); m[e] = (m[e] || 0) + 1;
        }
      },
    };
    await ctx.sleep(1500);
    for (let i = 0; i < book.pages.length; i++) {
      const pg = book.pages[i];
      current = pg;
      const card = pageCard(pg, i);
      if (i) track.append(h('div.sr-arrow', '➜'));
      track.append(card);
      sfx('pop');
      requestAnimationFrame(() => track.scrollTo({ left: card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2, behavior: 'smooth' }));
      const last = i === book.pages.length - 1;
      show(owner, { sr: 'present', title: 'Your notebook', text: last ? 'That\'s the last page.' : `Page ${i + 1} of ${book.pages.length}`,
        button: last ? 'Finish' : 'Next page ▶', emojis: REACTIONS });
      // The owner flips pages; if they don't, the notebook flips itself.
      const wait = (pg.type === 'draw' ? 12000 : 8000) + (last ? 3000 : 0);
      await new Promise((resolve) => {
        const t = ctx.setTimeout(resolve, wait);
        advance = () => { clearTimeout(t); resolve(); };
      });
      advance = null;
      await ctx.sleep(300);
    }
    const first = book.pages[0].value;
    const end = [...book.pages].reverse().find((pg) => pg.type === 'text' && !pg.missing);
    foot.replaceChildren(h('div.sr-verdict', 'Started as ', h('b', `“${first}”`),
      end && end !== book.pages[0] ? [' and ended up as ', h('b', `“${end.value}”`)] : ''));
    show(ctx.players, { sr: 'wait', text: 'Next notebook coming up…' });
    current = null;
    await ctx.sleep(4500);
    reveal = null;
  }

  function pageCard(pg, i) {
    const by = h('div.sr-by', { style: { color: pg.by.color } },
      i === 0 ? `${pg.by.name} started it` : pg.type === 'draw' ? `drawn by ${pg.by.name}` : `${pg.by.name} guessed`);
    if (pg.type === 'draw') {
      return h('div.sr-card.sr-polaroid', h('div.sr-tape'),
        pg.missing ? h('div.sr-blank', 'blank page 🫥') : h('img', { src: pg.value, alt: '' }), by);
    }
    return h('div.sr-card.sr-sticky' + (i === 0 ? '.first' : ''),
      h('div.sr-words', pg.value), pg.auto ? h('div.sr-auto', '(picked by the notebook)') : null, by);
  }
}

function addStyles() {
  if (!document.getElementById('sr-font')) {
    document.head.append(Object.assign(document.createElement('link'), { id: 'sr-font', rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Patrick+Hand&family=Permanent+Marker&display=swap' }));
  }
  document.getElementById('sr-css')?.remove();
  const css = Object.assign(document.createElement('style'), { id: 'sr-css' });
  css.textContent = `
  .sr { --ink: #24305e; --paper: #fbf8ef; --grid: #d9e3f3; --hand: 'Patrick Hand', 'Comic Sans MS', 'Chalkboard SE', cursive;
    --marker: 'Permanent Marker', 'Patrick Hand', 'Comic Sans MS', cursive;
    width: 100%; flex: 1; display: flex; color: var(--ink); font-family: var(--hand); }
  .sr-page { position: relative; flex: 1; border-radius: 18px; padding: 4vh 4vw 5vh;
    background: linear-gradient(90deg, transparent 6vw, #f4a6a6 6vw, #f4a6a6 calc(6vw + 2px), transparent calc(6vw + 2px)),
      repeating-linear-gradient(0deg, var(--grid) 0 1px, transparent 1px 32px),
      repeating-linear-gradient(90deg, var(--grid) 0 1px, transparent 1px 32px), var(--paper);
    box-shadow: 0 20px 60px #0008, inset 0 0 80px #e9dfc8; display: flex; flex-direction: column; align-items: center; gap: 3vh; overflow: hidden; }
  .sr-center { justify-content: center; }
  .sr-logo { font-family: var(--marker); font-size: 5em; transform: rotate(-3deg); line-height: 1; }
  .sr-logo span { display: block; color: #e8553e; margin-left: 1.5em; }
  .sr-title { font-family: var(--marker); font-size: 2.6em; font-weight: 400; margin: 0; }
  .sr-sub { font-size: 1.4em; color: #4b5687; margin: 0; }
  .sr-steps { display: flex; gap: .6em; font-size: 1.3em; }
  .sr-steps span { opacity: .3; filter: grayscale(1); }
  .sr-steps .past { opacity: .6; filter: none; }
  .sr-steps .now { opacity: 1; filter: none; transform: scale(1.4); }
  .sr-notes { display: flex; flex-wrap: wrap; gap: 2.2vw; justify-content: center; max-width: 1300px; margin-top: 2vh; }
  .sr-note { width: 9em; min-height: 6em; padding: .7em; background: color-mix(in srgb, var(--c) 35%, #fff7c8);
    transform: rotate(var(--r)); box-shadow: 0 6px 14px #0003; display: flex; flex-direction: column; justify-content: space-between;
    font-size: 1.25em; transition: transform .3s; }
  .sr-note.away { opacity: .4; }
  .sr-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sr-stamp { align-self: flex-end; font-family: var(--marker); font-size: 1.6em; opacity: .35; }
  .sr-note.done { transform: rotate(var(--r)) scale(1.06); }
  .sr-note.done .sr-stamp { opacity: 1; color: #1f8a4c; animation: sr-stamp .35s ease-out; }
  @keyframes sr-stamp { from { transform: scale(3); opacity: 0; } }
  .sr-pass { font-size: 5em; animation: sr-slide 1.6s ease-in-out infinite; }
  @keyframes sr-slide { 0% { transform: translateX(-30%); } 50% { transform: translateX(30%); } 100% { transform: translateX(-30%); } }

  .sr-reveal { justify-content: flex-start; padding-left: 0; padding-right: 0; gap: 1vh; max-height: 88vh; }
  .sr-track { width: 100%; display: flex; align-items: center; gap: 2vw; overflow: hidden; padding: 3vh 40vw; flex: 1; min-height: 0; }
  .sr-card { flex: none; position: relative; animation: sr-in .5s cubic-bezier(.2,1.4,.5,1); }
  @keyframes sr-in { from { transform: translateY(40px) rotate(-6deg) scale(.7); opacity: 0; } }
  .sr-polaroid { background: #fff; padding: 1.2vh 1.2vh 0; box-shadow: 0 10px 30px #0004; transform: rotate(1.5deg); }
  .sr-polaroid img, .sr-blank { display: block; width: min(44vh, 38vw); height: min(44vh, 38vw); object-fit: contain; background: #fff; }
  .sr-blank { display: grid; place-items: center; font-size: 1.6em; color: #9aa; border: 3px dashed #ccd; }
  .sr-tape { position: absolute; top: -14px; left: 50%; width: 120px; height: 30px; transform: translateX(-50%) rotate(-4deg);
    background: repeating-linear-gradient(45deg, #ffd96680 0 10px, #ffcf4080 10px 20px); }
  .sr-sticky { width: min(34vh, 30vw); min-height: 26vh; padding: 3vh 2.4vh 2vh; background: #fff27a; box-shadow: 0 10px 24px #0003;
    transform: rotate(-2deg); display: flex; flex-direction: column; justify-content: space-between; gap: 1em; }
  .sr-sticky.first { background: #ffc2d6; }
  .sr-words { font-size: 2em; line-height: 1.15; overflow-wrap: anywhere; }
  .sr-auto { font-size: .9em; opacity: .6; }
  .sr-by { font-family: var(--hand); font-size: 1.2em; padding: .6em 0; text-align: center; font-weight: 700;
    -webkit-text-stroke: .3px #0006; }
  .sr-arrow { flex: none; font-size: 2.4em; color: #8d97c4; }
  .sr-foot { min-height: 3em; font-size: 1.6em; padding: 0 4vw; }
  .sr-verdict { animation: sr-in .5s ease-out; }
  .sr-fx { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .sr-fly { position: absolute; bottom: -1em; font-size: 3em; animation: sr-fly 2.5s ease-out forwards; }
  @keyframes sr-fly { to { transform: translate(var(--x), -75vh) scale(1.4); opacity: 0; } }

  .sr-podium { display: flex; gap: 3vw; align-items: flex-end; }
  .sr-place { background: color-mix(in srgb, var(--c) 30%, #fff); padding: 3vh 2.5vw; box-shadow: 0 10px 24px #0003;
    min-width: 12em; animation: sr-in .6s backwards; animation-delay: var(--d); }
  .sr-place:first-child { transform: scale(1.12); }
  .sr-medal { font-size: 3em; }
  .sr-pname { font-family: var(--marker); font-size: 1.8em; }
  .sr-pemoji { font-size: 1.3em; margin: .3em 0; }
  .sr-pcount { opacity: .7; }
  `;
  document.head.append(css);
}
