// Gobble Gallery: a gentle Thanksgiving drawing game for kids and grown-ups.
//
// Each round everyone picks one of two picture cards ("Turkey on roller
// skates") and draws it. Then the drawings go up one at a time, framed on
// the TV, and everyone else taps which card they think it is from four big
// coloured buttons. The TV reads the four choices out loud, so players who
// can't read yet can still play by colour, shape and emoji.
//
// Kids don't need their own phone: before the game each phone says who's
// playing on it, so a parent can add several kids (and play too, or not).
// A shared phone takes turns: "🦊 Leo's turn! Pass the phone", so secret
// cards stay secret. Every player gets an animal, shown on the phone and
// the TV, so a kid who can't read their name can still find themselves.
//
// Scoring is all upside: 2 pies for a right guess, 1 pie to the artist for
// every person who got theirs, and a bonus pie if everyone did. Nobody loses
// points, there's no speed race, and at the end every player gets an award.
//
// Phones run player.js. The two sides talk with messages whose kind starts
// with "gg-".
import { CARDS, TITLES } from './cards.js';
import { addStyles } from './tv-style.js';

const PACES = {
  quick: { label: '🐇 Quick', rounds: 1, draw: 60 },
  normal: { label: '🦃 Normal', rounds: 2, draw: 80 },
  relaxed: { label: '🐢 Take our time', rounds: 2, draw: 120 },
};
const WHO_TIME = 60;
const PICK_TIME = 20;
const GUESS_TIME = 25;
const GRACE = 5;           // seconds phones get to send their drawing after time's up
const MAX_IMG = 450_000;   // characters of data URL we accept for a drawing
const MAX_KIDS = 4;        // extra players on one phone
const MAX_SEATS = 16;
const REACTIONS = ['❤️', '😂', '🤩', '🦃'];
const AVATARS = ['🦊', '🐻', '🐰', '🐸', '🐼', '🐯', '🐨', '🐵', '🦁', '🐷', '🐮', '🐔', '🐧', '🦄', '🐶', '🐱', '🦉', '🐢'];
const KID_COLORS = ['#ff9ecd', '#7ee0c3', '#ffd166', '#a5b4fc', '#ffb38a', '#9be564', '#7cc6fe', '#f4a6ff'];
const TILES = [            // colour + shape, so "the blue star one" works for little kids
  { c: '#e8553e', s: '●' },
  { c: '#f2b134', s: '▲' },
  { c: '#4f9d5d', s: '■' },
  { c: '#4a7fd1', s: '★' },
];

export default async function (ctx) {
  const { h } = ctx;
  const sfx = (n) => { try { ctx.sfx?.(n); } catch {} };
  addStyles();

  // Custom audio & BGM engine
  ctx.music?.(null);
  const muted = () => { try { return localStorage.getItem('partyhall.muted') === '1'; } catch { return false; } };
  const bgm = new Audio(ctx.asset('audio/bg_main.ogg'));
  bgm.loop = true;
  bgm.volume = 0.35;
  const playBgm = () => {
    if (!muted() && bgm.paused) bgm.play().catch(() => {});
  };
  const syncMute = () => {
    bgm.muted = muted();
  };
  window.addEventListener('storage', syncMute);
  playBgm();

  const playSfx = (file, vol = 0.6) => {
    if (muted()) return;
    try {
      ctx.playSfx(`audio/${file}`, vol);
    } catch {}
  };

  const root = h('div.gg');
  const leaves = h('div.gg-leaves', Array.from({ length: 14 }, (_, i) => h('span', {
    style: { left: `${(i * 7.3 + 3) % 100}%`, animationDelay: `${-(i * 1.7) % 12}s`, animationDuration: `${10 + (i % 5) * 2}s` },
  }, ['🍂', '🍁', '🍃'][i % 3])));
  const paint = (...kids) => {
    root.replaceChildren(leaves, ...kids);
    if (!root.isConnected) ctx.el.replaceChildren(root);
  };

  // ---- talking: the TV reads things out (skipped when the TV is muted) ----
  const say = (text) => {
    try {
      if (muted() || !window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.92; u.pitch = 1.1;
      speechSynthesis.speak(u);
    } catch {}
  };
  const hush = () => { try { window.speechSynthesis?.cancel(); } catch {} };

  // ---- seats: the players. A phone can carry several. ----
  let seats = [];   // { id, name, color, avatar, phone }
  const online = (s) => !!ctx.player(s.phone.id)?.connected;
  const seatsOf = (phoneId) => seats.filter((s) => s.phone.id === phoneId);
  const label = (s) => `${s.avatar} ${s.name}`;
  const shared = () => seats.some((s) => seatsOf(s.phone.id).length > 1);
  const pub = (s) => ({ sid: s.id, name: s.name, color: s.color, avatar: s.avatar });

  // ---- phones talk to us here ----
  const lastView = new Map();
  let collecting = null;
  let reacting = null;     // (phone, emoji) => void
  let whoing = null;       // (phone, data) => void
  const show = (to, view) => {
    for (const p of [].concat(to === 'all' ? ctx.players : to)) lastView.set(p.id, view);
    ctx.show(to, view);
  };
  ctx.on('message', (p, d) => {
    if (!p || !d || typeof d !== 'object') return;
    if (d.kind === 'gg-hello') {
      const v = lastView.get(p.id);
      if (v) ctx.show(p, v);
    } else if (d.kind === 'gg-answer' && collecting && d.phase === collecting.phase) {
      collecting.take(p, d.sid, d.value);
    } else if (d.kind === 'gg-who') whoing?.(p, d);
    else if (d.kind === 'gg-react' && REACTIONS.includes(d.e)) reacting?.(p, d.e);
  });

  // One job per seat. Seats that share a phone take turns on it, so that
  // phone gets time for each of them. At a phone's deadline it is told time's
  // up and sends what it has; anything still missing GRACE seconds later is
  // skipped. Resolves to Map(seatId → answer).
  let phaseSeq = 0;
  async function collect(jobs, seconds, { after, onAnswer, grace = GRACE, handoff = true } = {}) {
    const phase = `g${++phaseSeq}`;
    const now0 = Date.now();
    const phones = new Map();   // phoneId → { phone, turns, ends, warned }
    for (const j of jobs) {
      const ph = phones.get(j.seat.phone.id) || { phone: j.seat.phone, turns: [] };
      ph.turns.push({ ...pub(j.seat), view: j.view });
      phones.set(j.seat.phone.id, ph);
    }
    let longest = 0;
    for (const ph of phones.values()) {
      const secs = seconds * ph.turns.length;
      longest = Math.max(longest, secs);
      ph.ends = now0 + secs * 1000;
      ph.secs = secs;
    }
    const answers = new Map();
    const view = (ph) => ({ gg: 'turns', phase, handoff: handoff && ph.turns.length > 1, seconds: ph.secs, ends: ph.ends,
      turns: ph.turns.filter((t) => !answers.has(t.sid)) });
    collecting = {
      phase,
      take(p, sid, value) {
        const ph = phones.get(p.id);
        const t = ph?.turns.find((x) => x.sid === sid);
        if (!t || answers.has(sid)) return;
        answers.set(sid, value);
        const left = ph.turns.filter((x) => !answers.has(x.sid));
        if (left.length) lastView.set(p.id, view(ph));   // a reload carries on with the next turn
        else if (after) show(p, after);
        onAnswer?.(seats.find((s) => s.id === sid), value);
      },
    };
    for (const ph of phones.values()) show(ph.phone, view(ph));
    const stopClock = ctx.clock(longest);
    const finished = (ph) => ph.turns.every((t) => answers.has(t.sid)) || !ctx.player(ph.phone.id)?.connected
      || Date.now() >= ph.ends + grace * 1000;
    try {
      while (![...phones.values()].every(finished)) {
        const now = Date.now();
        for (const ph of phones.values()) {
          if (!ph.warned && now >= ph.ends) { ph.warned = true; ctx.send(ph.phone, { kind: 'gg-timesup', phase }); }
        }
        await ctx.sleep(150);
      }
    } finally { stopClock(); collecting = null; }
    return answers;
  }

  // ---- intro ----
  paint(h('div.gg-page.gg-center',
    turkey('gg-mascot'),
    h('h1.gg-logo', 'Gobble ', h('span', 'Gallery')),
    h('p.gg-sub', 'Draw it! Guess it! Gobble it up!')));
  show('all', { gg: 'wait', emoji: '🦃', text: 'Get ready to draw!' });
  say('Welcome to Gobble Gallery!');
  await ctx.sleep(3500);

  const phones0 = ctx.connected;
  if (!phones0.length) return;

  // ---- how long? ----
  const vip = phones0[0];
  paint(h('div.gg-page.gg-center', turkey('gg-mascot.small'),
    h('h1.gg-title', 'How long should we play?'),
    h('p.gg-sub', h('b', { style: { color: vip.color } }, vip.name), ' is choosing on their phone.')));
  show(phones0.filter((p) => p.id !== vip.id), { gg: 'wait', emoji: '⏳', text: `${vip.name} is choosing…` });
  const paceAns = await ctx.ask(vip, {
    title: 'How long should we play?',
    choices: Object.entries(PACES).map(([k, v]) => ({
      label: `${v.label}: ${v.rounds} round${v.rounds > 1 ? 's' : ''}, ${v.draw}s to draw`, value: k })),
  }, { timeout: 20, after: { wait: 'Great choice!' } });
  const pace = PACES[paceAns.get(vip.id)] || PACES.normal;

  // ---- who's playing on each phone? ----
  await whoIsPlaying(ctx.connected);
  if (seats.length < 2) return ctx.say('Not enough players', 'Gobble Gallery needs at least 2 players. Add a kid on your phone!', 6000);

  // ---- how to play ----
  paint(h('div.gg-page.gg-center',
    h('h1.gg-title', 'How to play'),
    h('div.gg-how',
      h('div.gg-step', h('div.gg-big', '🃏'), h('b', '1. Pick a card')),
      h('div.gg-step', h('div.gg-big', '🖍️'), h('b', '2. Draw it')),
      h('div.gg-step', h('div.gg-big', '🤔'), h('b', '3. Guess the others')),
      h('div.gg-step', h('div.gg-big', '🥧'), h('b', '4. Win pies!'))),
    h('p.gg-sub', shared()
      ? 'Sharing a phone? Pass it when it says your animal\'s turn. No peeking at someone else\'s card!'
      : 'No letters in your drawing! Right guesses win 2 pies, and artists win a pie for everyone who gets theirs.')));
  show('all', { gg: 'wait', emoji: '👀', text: 'Look at the TV!' });
  say(`Pick a card. Draw it. Then guess what everyone else drew. Right guesses win pies!${shared() ? ' If you share a phone, pass it when it is your turn.' : ''}`);
  await ctx.sleep(8000);

  const pies = new Map(seats.map((s) => [s.id, 0]));
  const stats = new Map(seats.map((s) => [s.id, { right: 0, gotMine: 0, love: 0 }]));
  const addPies = (id, n) => pies.set(id, (pies.get(id) || 0) + n);
  const gallery = [];
  let deck = ctx.shuffle(CARDS);
  const deal = () => { if (!deck.length) deck = ctx.shuffle(CARDS); return deck.pop(); };

  for (let round = 1; round <= pace.rounds; round++) {
    const here = seats.filter(online);
    if (here.length < 2) break;
    const last = round === pace.rounds;

    // ---- pick a card ----
    await banner(pace.rounds > 1 ? `Round ${round}` : 'Let\'s draw!', last && pace.rounds > 1 ? 'Last round!' : 'Pick a card on your phone', 2500);
    const hands = new Map(here.map((s) => [s.id, [deal(), deal()]]));
    const picked = new Set();
    const pickBoard = () => paint(h('div.gg-page.gg-center',
      h('h1.gg-title', '🃏 Pick a card!'),
      h('p.gg-sub', 'Choose the one you want to draw. Keep it secret!'),
      easels(here, picked)));
    pickBoard();
    say('Pick a card to draw. Keep it secret!');
    const picks = await collect(here.map((s) => ({ seat: s, view: { gg: 'pick', cards: hands.get(s.id) } })), PICK_TIME, {
      grace: 1,
      after: { gg: 'wait', emoji: '🖍️', text: 'Got it! Get your crayons ready…' },
      onAnswer: (s) => { picked.add(s.id); sfx('pop'); playSfx('sfx_clay_smack.wav', 0.55); pickBoard(); },
    });
    const cardOf = new Map(here.map((s) => [s.id, hands.get(s.id)[picks.get(s.id) === 1 ? 1 : 0]]));
    for (const s of here) deck.unshift(hands.get(s.id)[picks.get(s.id) === 1 ? 0 : 1]);

    // ---- draw ----
    const drawn = new Set();
    const drawBoard = () => paint(h('div.gg-page.gg-center',
      turkey('gg-mascot.small.draw'),
      h('h1.gg-title', '🖍️ Everybody draw!'),
      h('p.gg-sub', 'Draw your card. No letters or numbers!'),
      easels(here, drawn)));
    drawBoard();
    say('Everybody draw!');
    const got = await collect(here.map((s) => ({ seat: s, view: { gg: 'draw', card: cardOf.get(s.id) } })), pace.draw, {
      after: { gg: 'wait', emoji: '🖼️', text: 'Beautiful! Waiting for the other artists…' },
      onAnswer: (s) => { drawn.add(s.id); sfx('ding'); playSfx('sfx_clay_smack.wav', 0.55); drawBoard(); },
    });
    const art = [];
    for (const s of here) {
      const v = got.get(s.id);
      const ok = v && typeof v === 'object' && !v.blank && typeof v.img === 'string'
        && /^data:image\/(png|jpeg|webp);base64,/.test(v.img) && v.img.length < MAX_IMG;
      if (ok) art.push({ by: s, card: cardOf.get(s.id), img: v.img, right: 0, love: 0 });
    }
    sfx('whoosh');
    show('all', { gg: 'wait', emoji: '🖼️', text: 'Crayons down! Look at the TV.' });
    if (!art.length) { await banner('Oh no, empty easels!', 'Nobody finished a drawing this time.', 4000); continue; }
    await banner('🖼️ Gallery time!', 'What did everyone draw?', 3000);

    const roundCards = [...cardOf.values()];
    for (const [i, a] of ctx.shuffle(art).entries()) {
      await guessDrawing(a, i, art.length, roundCards);
      gallery.push(a);
    }

    if (!last) await scoreboard('Pie count so far');
  }

  // ---- the gallery wall ----
  if (gallery.length) {
    show('all', { gg: 'wait', emoji: '🖼️', text: 'Look at all that art!' });
    paint(h('div.gg-page',
      h('h1.gg-title', '🖼️ The Gobble Gallery'),
      h('div.gg-wall', { style: { '--w': `calc(${gallery.length <= 6 ? 28 : gallery.length <= 12 ? 20 : 14} * var(--fh))` } },
        gallery.map((a, i) => h('figure.gg-mini', { style: { '--r': `${((i * 37) % 7) - 3}deg`, '--d': `${i * 0.12}s` } },
          h('img', { src: a.img, alt: '' }),
          h('figcaption', h('span', a.card.e), ' ', a.card.t, h('small', { style: { background: a.by.color } }, label(a.by))))))));
    say('Look at all that art!');
    await ctx.sleep(Math.min(18000, 6000 + gallery.length * 900));
  }

  await scoreboard('Final pie count', true);
  await awards();
  show('all', { gg: 'wait', emoji: '🦃', text: 'Happy Thanksgiving! Back to the lobby soon…' });
  await ctx.sleep(1500);
  hush();
  bgm.pause();
  bgm.src = '';
  window.removeEventListener('storage', syncMute);

  // ===================================================================

  async function whoIsPlaying(phones) {
    // Every phone says who's on it. Until it answers, its owner plays alone.
    const answers = new Map();
    const board = () => {
      const list = buildSeats(phones, answers);
      paint(h('div.gg-page.gg-center',
        h('h1.gg-title', '👨‍👩‍👧 Who\'s playing?'),
        h('p.gg-sub', 'No phone? No problem! Grown-ups can add kids on their phone and pass it around.'),
        h('div.gg-easels', list.map((s, k) => h('div.gg-easel.done', { style: { '--c': s.color, '--r': `${((k * 37) % 7) - 3}deg` } },
          h('div.gg-canvas.ava', s.avatar), h('span', s.name)))),
        h('p.gg-sub', `${phones.filter((p) => answers.has(p.id)).length} of ${phones.length} phones ready`)));
    };
    board();
    say('Who is playing? No phone? No problem! Grown-ups can add kids on their phone.');
    const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 16) : '');
    whoing = (p, d) => {
      if (!phones.some((x) => x.id === p.id) || answers.has(p.id)) return;
      const kids = (Array.isArray(d.kids) ? d.kids : []).map(clean).filter(Boolean).slice(0, MAX_KIDS);
      answers.set(p.id, { me: d.me !== false, kids });
      show(p, { gg: 'wait', emoji: '👍', text: kids.length ? `${kids.length + (d.me !== false ? 1 : 0)} players on this phone. Pass it when it's your turn!` : 'Ready!' });
      sfx('pop');
      board();
    };
    for (const p of phones) show(p, { gg: 'who', name: p.name, max: MAX_KIDS, seconds: WHO_TIME, ends: Date.now() + WHO_TIME * 1000 });
    const stopClock = ctx.clock(WHO_TIME);
    const until = Date.now() + WHO_TIME * 1000;
    try {
      while (Date.now() < until && !phones.every((p) => answers.has(p.id) || !ctx.player(p.id)?.connected)) await ctx.sleep(200);
    } finally { stopClock(); whoing = null; }
    await ctx.sleep(1200);
    seats = buildSeats(phones, answers);
    function buildSeats(list, ans) {
      const out = [];
      let kidColor = 0;
      for (const p of list) {
        const a = ans.get(p.id) || { me: true, kids: [] };
        if (a.me || !a.kids.length) out.push({ id: p.id, name: p.name, color: p.color, phone: p });
        a.kids.forEach((name, k) => out.push({ id: `${p.id}:${k}`, name, color: KID_COLORS[kidColor++ % KID_COLORS.length], phone: p }));
      }
      out.splice(MAX_SEATS);
      out.forEach((s, k) => { s.avatar = AVATARS[k % AVATARS.length]; });
      return out;
    }
    return answers;
  }

  async function guessDrawing(a, i, n, roundCards) {
    // Four choices: the real card, up to two other cards drawn this round (so
    // "is that Grandma's turkey or mine?" is a real question), and the rest
    // from the deck.
    const used = new Set([a.card.t]);
    const fake = [];
    for (const c of ctx.shuffle(roundCards)) {
      if (fake.length >= 2) break;
      if (!used.has(c.t)) { used.add(c.t); fake.push(c); }
    }
    for (const c of ctx.shuffle(CARDS)) {
      if (fake.length >= 3) break;
      if (!used.has(c.t)) { used.add(c.t); fake.push(c); }
    }
    const opts = ctx.shuffle([a.card, ...fake]).map((c, k) => ({ ...c, ...TILES[k] }));
    const answer = opts.findIndex((o) => o.t === a.card.t);
    const guessers = seats.filter((s) => s.id !== a.by.id && online(s));
    const picks = new Map();

    const frame = h('div.gg-frame', h('img', { src: a.img, alt: 'drawing' }));
    const tiles = opts.map((o) => h('div.gg-tile', { style: { '--c': o.c } },
      h('span.gg-shape', o.s), h('span.gg-emoji', o.e), h('span.gg-text', o.t), h('div.gg-who')));
    const status = h('p.gg-sub');
    const setStatus = () => status.replaceChildren(guessers.length
      ? `${picks.size} of ${guessers.length} guessed`
      : 'Nobody else is here to guess!');
    setStatus();
    const q = h('b', 'What is it?');
    paint(h('div.gg-page.gg-guess',
      h('div.gg-count', `Drawing ${i + 1} of ${n}`),
      h('div.gg-guess-body', frame, h('div.gg-tiles', tiles)),
      h('div.gg-q', q, status)));
    sfx('pop');
    playSfx('sfx_spring_boing.wav', 0.55);
    hush();
    say(`What is it? Is it ${opts.map((o) => o.t).join('? ... ')}?`);

    // A phone whose only player drew this one just waits.
    for (const ph of new Set(seats.map((s) => s.phone))) {
      if (seatsOf(ph.id).every((s) => s.id === a.by.id)) show(ph, { gg: 'mine', card: a.card, who: pub(a.by) });
    }
    if (guessers.length) {
      await collect(guessers.map((s) => ({ seat: s, view: {
        gg: 'guess', options: opts.map(({ e, t, c, s: sh }) => ({ e, t, c, s: sh })),
        note: a.by.phone.id === s.phone.id ? `Shh! ${a.by.name} drew this one.` : null,
      } })), GUESS_TIME, {
        grace: 0, handoff: false,
        after: { gg: 'wait', emoji: '🤔', text: 'Got it! Watch the TV…' },
        onAnswer: (s, k) => { if (Number.isInteger(k) && opts[k]) picks.set(s.id, k); sfx('pop'); playSfx('sfx_clay_smack.wav', 0.5); setStatus(); },
      });
    }

    // ---- reveal ----
    hush();
    const right = guessers.filter((s) => picks.get(s.id) === answer);
    a.right = right.length;
    for (const s of right) { addPies(s.id, 2); stats.get(s.id).right++; }
    let artistPies = right.length;
    const everyone = guessers.length > 1 && right.length === guessers.length;
    if (everyone) artistPies++;
    addPies(a.by.id, artistPies);
    stats.get(a.by.id).gotMine += right.length;

    tiles.forEach((t, k) => {
      t.classList.add(k === answer ? 'yes' : 'no');
      t.querySelector('.gg-who').replaceChildren(...guessers.filter((s) => picks.get(s.id) === k)
        .map((s) => h('span.gg-chip', { style: { background: s.color } }, label(s))));
    });
    frame.append(h('div.gg-tag', 'by ', h('b', { style: { color: a.by.color } }, label(a.by))));
    const fx = h('div.gg-fx');
    root.append(fx);
    let line;
    if (!guessers.length) line = '';
    else if (everyone) line = `Everybody got it! ${a.by.name} wins ${artistPies} pies!`;
    else if (right.length) line = `${right.length === 1 ? right[0].name + ' got it' : right.length + ' people got it'}! ${a.by.name} wins ${artistPies} pie${artistPies === 1 ? '' : 's'}.`;
    else line = 'A tricky one! Nobody guessed it this time.';
    status.replaceChildren(line);
    q.replaceChildren(`It's ${a.card.e} ${a.card.t}!`);
    sfx(right.length ? 'win' : 'ding');
    if (everyone) playSfx('sfx_party_horn.wav', 0.65);
    else if (right.length) playSfx('sfx_pie_splat.wav', 0.65);
    else playSfx('sfx_clay_smack.wav', 0.45);
    say(`It's ${a.card.t}! Drawn by ${a.by.name}. ${line}`);

    // One result screen per phone, with a line for each of its players.
    for (const ph of new Set(seats.map((s) => s.phone))) {
      const mine = seatsOf(ph.id);
      const rows = [];
      for (const s of mine) {
        if (s.id === a.by.id) rows.push({ ...pub(s), mine: true, text: artistPies ? `${right.length} got yours! +${artistPies} 🥧` : 'Tricky! Nobody got yours.' });
        else if (guessers.includes(s)) {
          const ok = picks.get(s.id) === answer;
          rows.push({ ...pub(s), ok, text: ok ? 'You got it! +2 🥧' : picks.has(s.id) ? 'Good try!' : 'Out of time!' });
        }
      }
      if (!rows.length) continue;
      const artistHere = mine.some((s) => s.id === a.by.id);
      show(ph, { gg: 'result', card: a.card, rows, react: artistHere && mine.length === 1 ? [] : REACTIONS, artist: a.by.name });
    }

    const reacted = new Map();
    reacting = (p, e) => {
      const f = h('span.gg-fly', { style: { left: `${8 + Math.random() * 84}%`, '--x': `${Math.random() * 80 - 40}px` } }, e);
      fx.append(f); ctx.setTimeout(() => f.remove(), 2600);
      if (p.id !== a.by.phone.id) {
        const nTimes = (reacted.get(p.id) || 0) + 1;
        reacted.set(p.id, nTimes);
        if (nTimes <= 3) { a.love++; stats.get(a.by.id).love++; }
      }
    };
    await ctx.sleep(7000);
    reacting = null;
    show('all', { gg: 'wait', emoji: '🖼️', text: 'Next picture coming up…' });
  }

  async function scoreboard(title, final = false) {
    const rows = seats.map((s) => ({ s, n: pies.get(s.id) || 0 })).sort((x, y) => y.n - x.n);
    const top = Math.max(1, rows[0]?.n || 0);
    show('all', { gg: 'wait', emoji: '🥧', text: 'Pies are on the TV!' });
    paint(h('div.gg-page.gg-center',
      h('h1.gg-title', `🥧 ${title}`),
      h('div.gg-scores' + (rows.length > 10 ? '.many' : ''), rows.map(({ s, n }, k) => h('div.gg-srow', { style: { '--d': `${k * 0.12}s` } },
        h('span.gg-sname', h('span.gg-ava', s.avatar), h('span', { style: { color: s.color } }, s.name)),
        h('div.gg-sbar', h('div', { style: { width: `${Math.max(3, (n / top) * 100)}%`, background: s.color } })),
        h('span.gg-snum', `${n} 🥧`))))));
    sfx(final ? 'win' : 'ding');
    playSfx(final ? 'sfx_party_horn.wav' : 'sfx_pie_splat.wav', 0.6);
    await ctx.sleep(final ? 6500 : 5000);
  }

  // Everybody gets an award. The real ones go to whoever earned them, and the
  // rest of the table gets a fun title, so nobody goes home empty-handed.
  async function awards() {
    const all = seats;
    if (!all.length) return;
    const best = Math.max(...all.map((s) => pies.get(s.id)));
    const winners = all.filter((s) => pies.get(s.id) === best);
    const given = new Map();
    if (best > 0) for (const s of winners) given.set(s.id, { t: '🏆 Top Turkey', why: `${best} pies!` });
    const award = (title, key, why) => {
      const val = (s) => stats.get(s.id)[key];
      const max = Math.max(0, ...all.map(val));
      if (!max) return;
      const s = all.filter((x) => val(x) === max && !given.has(x.id))[0];
      if (s) given.set(s.id, { t: title, why: why(max) });
    };
    award('🥧 Pie Picasso', 'gotMine', (n) => `${n} right guess${n === 1 ? '' : 'es'} on their art`);
    award('👀 Eagle Eyes', 'right', (n) => `guessed ${n} right`);
    award('❤️ Crowd Favourite', 'love', (n) => `${n} reaction${n === 1 ? '' : 's'}`);
    const spare = ctx.shuffle(TITLES.filter((t) => !/Picasso|Eagle|Favourite|Top Turkey/.test(t)));
    for (const s of all) if (!given.has(s.id)) given.set(s.id, { t: spare.pop() || '🦃 Turkey Trotter', why: 'thanks for playing!' });

    for (const ph of new Set(all.map((s) => s.phone))) {
      show(ph, { gg: 'award', rows: seatsOf(ph.id).map((s) => ({ ...pub(s), title: given.get(s.id).t, text: given.get(s.id).why, win: best > 0 && winners.includes(s) })) });
    }
    paint(h('div.gg-page.gg-center',
      turkey('gg-mascot.small.party'),
      h('h1.gg-title', best === 0 ? '🦃 What a team!' : winners.length > 3 ? `🏆 ${winners.length}-way tie!` : `🏆 ${winners.map(label).join(' & ')} ${winners.length > 1 ? 'win' : 'wins'}!`),
      h('div.gg-awards' + (all.length > 8 ? '.many' : ''), all.map((s, k) => h('div.gg-award', { style: { '--c': s.color, '--d': `${k * 0.2}s` } },
        h('div.gg-aname', s.avatar, ' ', s.name), h('div.gg-atitle', given.get(s.id).t), h('small', given.get(s.id).why)))),
      h('p.gg-sub', 'Happy Thanksgiving! 🍂')));
    sfx('win');
    playSfx('sfx_party_horn.wav', 0.7);
    say(best === 0 ? 'What a team! Happy Thanksgiving, everybody!' : `${winners.map((s) => s.name).join(' and ')} ${winners.length > 1 ? 'win' : 'wins'}! Happy Thanksgiving, everybody!`);
    await ctx.sleep(Math.min(18000, 8000 + all.length * 700));
  }

  async function banner(title, sub, ms) {
    paint(h('div.gg-page.gg-center', turkey('gg-mascot.small'), h('h1.gg-title.pop', title), sub && h('p.gg-sub', sub)));
    sfx('whoosh');
    playSfx('sfx_spring_boing.wav', 0.55);
    say(title.replace(/[^\p{L}\p{N}\s'!?.,]/gu, ''));
    await ctx.sleep(ms);
  }

  function easels(list, done) {
    return h('div.gg-easels' + (list.length > 10 ? '.many' : ''), list.map((s, k) => h('div.gg-easel' + (done.has(s.id) ? '.done' : '') + (online(s) ? '' : '.away'),
      { style: { '--c': s.color, '--r': `${((k * 37) % 7) - 3}deg` } },
      h('div.gg-canvas', h('span.gg-eava', s.avatar), h('span.gg-emark', done.has(s.id) ? '✓' : '🖍️')), h('span', s.name))));
  }

  function turkey(cls) {
    // An original cartoon turkey drawn in SVG: round body, a fan of autumn
    // feathers, big friendly eyes.
    const wrap = h('div.' + cls);
    const feathers = ['#e8553e', '#f2b134', '#4f9d5d', '#e8813e', '#c9473b', '#f2b134', '#e8553e'];
    wrap.innerHTML = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g class="gg-tail">${feathers.map((c, k) => `<ellipse cx="100" cy="62" rx="17" ry="52" fill="${c}"
        transform="rotate(${-72 + k * 24} 100 112)" stroke="#5a2e12" stroke-width="3"/>`).join('')}</g>
      <ellipse cx="100" cy="128" rx="52" ry="48" fill="#8b5a2b" stroke="#5a2e12" stroke-width="4"/>
      <ellipse cx="100" cy="140" rx="30" ry="26" fill="#b07a45"/>
      <g class="gg-head">
        <circle cx="100" cy="86" r="28" fill="#a86b36" stroke="#5a2e12" stroke-width="4"/>
        <circle cx="90" cy="80" r="8" fill="#fff"/><circle cx="110" cy="80" r="8" fill="#fff"/>
        <circle cx="91" cy="81" r="4" fill="#24170c"/><circle cx="111" cy="81" r="4" fill="#24170c"/>
        <path d="M92 92 L108 92 L100 104 Z" fill="#f2b134" stroke="#5a2e12" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M104 100 q8 6 4 16 q-8 -2 -6 -14" fill="#e8413c" stroke="#5a2e12" stroke-width="2"/>
        <ellipse cx="80" cy="94" rx="5" ry="3" fill="#ff8f8f" opacity=".7"/><ellipse cx="120" cy="94" rx="5" ry="3" fill="#ff8f8f" opacity=".7"/>
      </g>
      <path d="M86 174 l-4 14 m4 -14 l4 14 M114 174 l-4 14 m4 -14 l4 14" stroke="#f2b134" stroke-width="5" stroke-linecap="round"/>
    </svg>`;
    return wrap;
  }
}
