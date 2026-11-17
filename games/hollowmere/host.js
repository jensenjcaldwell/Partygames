// Hollowmere: Lord Ambrose Hollowmere is dead and the will is read at
// midnight. Every player secretly backs a few of the twelve heirs. On your
// turn you roll two dice and move ANY heirs, then spring trap cards on
// whoever is standing in a trap. The heir named in the will wins by walking
// out the front door; otherwise whoever the will names at midnight inherits,
// or the last player with an heir standing.
import { HEIRS, CARDS, portrait } from './art.js';
import { MAP, W, H, EXIT, ROOMS, TRAP_TILES, trapAt, cell, walkable, STARTS, DIRS } from './board.js';

const T = 48;                                   // board tile size (SVG units)
const PER = { 2: 4, 3: 3, 4: 3, 5: 2, 6: 2 };  // heirs per player
const ROUNDS = { 2: 10, 3: 8, 4: 6, 5: 5, 6: 4 };
const HAND_START = 3, HAND_MAX = 5;
const TRAP_COPIES = 3, CODICILS = 5;
const ARROW = { u: '⬆ Up', d: '⬇ Down', l: '⬅ Left', r: '➡ Right' };
const NS = 'http://www.w3.org/2000/svg';

export default async function (ctx) {
  const { h } = ctx;
  injectCss();

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
      ctx.setInterval(() => {
        if (bgm) bgm.muted = isMuted();
      }, 250);
    } catch {}
  };
  const playClip = (name, vol = 0.7) => {
    if (isMuted()) return;
    try {
      ctx.playSfx(`audio/${name}.wav`, vol);
    } catch {}
  };
  startBgm();

  const players = ctx.shuffle(ctx.connected).slice(0, 6);
  const n = players.length;
  if (n < 2) return ctx.say('Not enough players', 'Hollowmere needs 2 to 6 people.', 5000);

  // ---------- setup ----------
  const starts = ctx.shuffle(STARTS);
  const heirs = ctx.shuffle(HEIRS).map((x, i) => ({ ...x, x: starts[i][0], y: starts[i][1], alive: true, owner: null }));
  const byId = Object.fromEntries(heirs.map((x) => [x.id, x]));
  for (let i = 0; i < PER[n] * n; i++) heirs[i].owner = players[i % n].id;
  let deck = ctx.shuffle([
    ...Object.keys(TRAP_TILES).flatMap((t) => Array(TRAP_COPIES).fill(t)),
    ...Array(CODICILS).fill('codicil'),
  ]);
  let discard = [];
  const hands = new Map(players.map((p) => [p.id, []]));
  const draw = (p) => {
    if (!deck.length) { deck = ctx.shuffle(discard); discard = []; }
    if (deck.length && hands.get(p.id).length < HAND_MAX) {
      hands.get(p.id).push(deck.pop());
      playClip('sfx_brush_sweep', 0.35);
    }
  };
  for (let i = 0; i < HAND_START; i++) players.forEach(draw);

  let willDeck = ctx.shuffle(heirs.filter((x) => x.owner).map((x) => x.id));
  const S = {
    named: willDeck.shift(), turn: 0, total: ROUNDS[n] * n, active: null,
    dice: [], selected: null, stepsLeft: 0, log: [], over: null, glow: [],
  };
  const nextWill = () => {
    const ok = (id) => byId[id].alive && id !== S.named;
    while (willDeck.length) { const id = willDeck.shift(); if (ok(id)) return id; }
    const pool = ctx.shuffle(heirs.filter((x) => x.owner && ok(x.id)).map((x) => x.id));
    willDeck = pool.slice(1);
    return pool[0] || S.named;
  };
  const mine = (pid) => heirs.filter((x) => x.owner === pid);
  const standing = () => players.filter((p) => mine(p.id).some((x) => x.alive));
  const at = (x, y) => heirs.find((o) => o.alive && o.x === x && o.y === y);
  const legal = (hr) => Object.entries(DIRS).filter(([, [dx, dy]]) => {
    const x = hr.x + dx, y = hr.y + dy;
    if (!walkable(x, y) || at(x, y)) return false;
    return cell(x, y) !== 'E' || hr.id === S.named;
  }).map(([d]) => d);
  const log = (msg) => { S.log.unshift(msg); S.log.length = Math.min(S.log.length, 6); };

  // ---------- phone views ----------
  const hand = (p) => ({
    heirs: mine(p.id).map((x) => ({ id: x.id, out: !x.alive, named: x.id === S.named })),
    cards: [...hands.get(p.id)], named: S.named,
  });
  const V = (p, v) => ({ ...v, hand: hand(p) });
  const ask = async (p, v, opts) => (await ctx.ask(p, V(p, v),
    { ...opts, after: V(p, { wait: 'Look at the big screen!' }) })).get(p.id);
  const showOthers = (p, text) => {
    for (const q of players) if (q.id !== p?.id) ctx.show(q, V(q, { wait: text }));
  };

  // ---------- TV ----------
  const svg = (tag, attrs = {}, html) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (html) e.innerHTML = html;
    return e;
  };
  const board = svg('svg', { viewBox: `0 -30 ${W * T} ${H * T + 60}`, class: 'hm-map' });
  board.innerHTML = drawMansion();
  const overlay = svg('g'); const tokens = svg('g');
  board.append(overlay, tokens);
  const tok = {};
  for (const x of heirs) {
    const g = svg('g', { class: 'hm-tok' });
    g.innerHTML = `<circle class="hm-ring" cx="24" cy="24" r="25"/>` +
      portrait(x, 44).replace('<svg ', '<svg x="2" y="2" ');
    tok[x.id] = g; tokens.append(g);
  }
  const boom = h('div.hm-boom');
  const bloom = h('div.hm-bloom');
  ctx.el.replaceChildren(h('div.hm', h('div.hm-boardwrap', board, boom, bloom), side));

  const triggerBloom = (color = 'rgba(212, 172, 13, 0.85)') => {
    bloom.style.setProperty('--bloom-color', color);
    bloom.classList.remove('active');
    void bloom.offsetWidth;
    bloom.classList.add('active');
    ctx.setTimeout(() => bloom.classList.remove('active'), 1400);
  };

  const place = (x) => { tok[x.id].style.transform = `translate(${x.x * T}px, ${x.y * T}px)`; };
  function render() {
    for (const x of heirs) {
      place(x);
      tok[x.id].classList.toggle('ko', !x.alive);
      tok[x.id].classList.toggle('named', x.id === S.named);
      tok[x.id].classList.toggle('sel', x.id === S.selected);
    }
    overlay.innerHTML = '';
    const sel = S.selected && byId[S.selected];
    if (sel) for (const d of legal(sel)) {
      const [dx, dy] = DIRS[d];
      overlay.append(svg('rect', { x: (sel.x + dx) * T + 6, y: (sel.y + dy) * T + 6, width: T - 12, height: T - 12, rx: 10, class: 'hm-step' }));
    }
    for (const [x, y] of S.glow) overlay.append(svg('rect', { x: x * T + 2, y: y * T + 2, width: T - 4, height: T - 4, rx: 8, class: 'hm-glow' }));

    const will = byId[S.named];
    const act = players.find((p) => p.id === S.active);
    const mins = Math.round((S.turn / S.total) * 360);
    const hh = 6 + Math.floor(mins / 60), mm = mins % 60;
    const time = hh >= 12 ? 'Midnight' : `${hh > 12 ? hh - 12 : hh}:${String(mm).padStart(2, '0')} PM`;
    const out = heirs.filter((x) => !x.alive);
    side.replaceChildren(...[
      h('div.hm-will', h('div.hm-k', 'The will names'), html(portrait(will, 92)), h('div.hm-wname', { style: { color: will.color } }, will.name),
        h('div.hm-small', 'If they walk out the front door, their backer inherits.')),
      h('div.hm-clock', h('div.hm-k', `🕰 ${time}`), h('div.hm-bar', h('div', { style: { width: `${(S.turn / S.total) * 100}%` } })),
        h('div.hm-small', 'The will is read at midnight.')),
      act && h('div.hm-turn', h('span', { style: { color: act.color } }, act.name), '’s turn',
        h('div.hm-dice', S.dice.map((d) => h('div.hm-die' + (d.used ? '.used' : '') + (d.rolling ? '.rolling' : ''), d.v))),
        sel && S.stepsLeft ? h('div.hm-small', `Moving ${sel.name}: ${S.stepsLeft} left`) : null),
      h('div.hm-players', players.map((p) => {
        const alive = mine(p.id).some((x) => x.alive);
        return h('div.hm-pl' + (alive ? '' : '.out') + (p.id === S.active ? '.act' : ''), { style: { '--c': p.color } },
          h('span', p.name), h('span.hm-cards', `🂠 ${hands.get(p.id).length}`));
      })),
      out.length ? h('div.hm-gone', h('div.hm-k', 'Departed'), h('div', out.map((x) => html(portrait(x, 34, true))))) : null,
      h('div.hm-log', S.log.map((l) => h('div', l))),
    ].filter(Boolean));
  }
  const html = (s) => { const d = h('span.hm-svg'); d.innerHTML = s; return d; };

  const sfx = (n) => { try { ctx.sfx?.(n); } catch {} };
  async function flash(icon, title, sub, ms = 3200) {
    playClip('sfx_brush_sweep', 0.45);
    sfx('whoosh');
    boom.replaceChildren(h('div.hm-boomin', h('div.hm-bicon', icon), h('h2', title), sub && h('p', sub)));
    boom.classList.add('on');
    await ctx.sleep(ms);
    boom.classList.remove('on');
  }

  // ---------- intro ----------
  render();
  await flash('🏚️', 'Hollowmere', 'Lord Ambrose Hollowmere is dead. The will is read at midnight…', 4000);
  for (const p of players) ctx.show(p, V(p, {
    title: 'Your secret heirs', buzz: true,
    text: 'These are the heirs you back. Keep them secret! Get the one the will names out the front door, and trap everyone else.',
  }));
  boom.replaceChildren(h('div.hm-boomin.rules',
    h('h2', 'How to inherit'),
    h('ol',
      h('li', 'Check your phone: you secretly back ', h('b', `${PER[n]} heirs`), '. Nobody knows who is whose.'),
      h('li', 'On your turn roll two dice and move ', h('b', 'any'), ' heirs, one die each.'),
      h('li', 'Anyone standing on a red trap tile can be knocked out if you hold that trap card.'),
      h('li', 'The heir named in the will wins if they reach the ', h('b', 'front door'), '. Codicil cards rewrite the will.'),
      h('li', 'At midnight, or when only one player has heirs left, the fortune is settled.'))));
  boom.classList.add('on');
  await ctx.sleep(12000);
  boom.classList.remove('on');

  // ---------- the game ----------
  const roll = () => 1 + Math.floor(Math.random() * 6);

  async function rewrite(p) {
    const hs = hands.get(p.id);
    hs.splice(hs.indexOf('codicil'), 1); discard.push('codicil');
    const old = S.named;
    S.named = nextWill();
    if (byId[old].alive) willDeck.push(old);
    log(`📜 ${p.name} added a codicil: ${byId[S.named].name} is now named.`);
    triggerBloom('rgba(212, 172, 13, 0.85)');
    playClip('sfx_brush_sweep', 0.65);
    render();
    await flash('📜', 'A codicil!', `${p.name} rewrote the will. It now names ${byId[S.named].name}.`);
  }

  async function knockOut(p, hr) {
    const t = trapAt(hr.x, hr.y);
    const hs = hands.get(p.id);
    hs.splice(hs.indexOf(t), 1); discard.push(t);
    S.glow = TRAP_TILES[t]; render();
    await ctx.sleep(600);
    hr.alive = false; S.glow = [];
    triggerBloom('rgba(192, 57, 43, 0.85)');
    playClip('sfx_latch', 0.85);
    sfx('buzz');
    log(`${CARDS[t].icon} ${hr.name} ${CARDS[t].verb}.`);
    render();
    await flash(CARDS[t].icon, `${CARDS[t].name}!`, `${hr.name} ${CARDS[t].verb}.`);
    if (hr.id === S.named) {
      S.named = nextWill();
      log(`📜 The will now names ${byId[S.named].name}.`);
      render();
      await flash('📜', 'The will passes on', `It now names ${byId[S.named].name}.`, 2600);
    }
    const left = standing();
    if (left.length === 1) S.over = { winner: left[0], why: `${left[0].name} is the only player with an heir still standing.` };
  }

  async function turn(p) {
    S.active = p.id; S.dice = []; S.selected = null;
    render();
    showOthers(p, `${p.name} is taking a turn…`);
    const hs = hands.get(p.id);
    const first = [{ label: '🎲 Roll the dice', value: 'roll' }];
    if (hs.includes('codicil')) first.push({ label: '📜 Play a Codicil first (rewrite the will)', value: 'codicil' });
    const a = await ask(p, { title: 'Your turn!', buzz: true, choices: first }, { timeout: 40 });
    if (a === 'codicil') await rewrite(p);

    playClip('sfx_chime', 0.45);
    const final = [roll(), roll()];
    for (let k = 0; k < 7; k++) { sfx('tick'); S.dice = final.map(() => ({ v: roll(), rolling: true })); render(); await ctx.sleep(110); }
    S.dice = final.map((v) => ({ v }));
    log(`🎲 ${p.name} rolled ${final[0]} and ${final[1]}.`);
    render();
    await ctx.sleep(500);

    for (const die of S.dice) {
      if (S.over) return;
      const movable = heirs.filter((x) => x.alive && legal(x).length);
      if (!movable.length) { die.used = true; continue; }
      const choices = movable.map((x) => ({ value: x.id, label: x.name + (x.owner === p.id ? ' ★' : ''), heir: x.id }));
      choices.push({ value: 'skip', label: 'Skip this die' });
      const pick = await ask(p, {
        title: `Move someone ${die.v} step${die.v > 1 ? 's' : ''}`, text: 'Any heir at all. ★ marks yours.', choices, pick: true,
      }, { timeout: 40 });
      const hr = byId[pick];
      if (!hr) { die.used = true; render(); continue; }
      S.selected = hr.id;
      for (let left = die.v; left > 0; left--) {
        const dirs = legal(hr);
        if (!dirs.length) break;
        S.stepsLeft = left; render();
        const mv = await ask(p, {
          title: hr.name, text: `${left} step${left > 1 ? 's' : ''} left`, color: hr.color, dpad: hr.id,
          choices: [...'ulrd'].map((d) => ({ value: d, label: ARROW[d], disabled: !dirs.includes(d) }))
            .concat({ value: 'stop', label: '✋ Stop here' }),
        }, { timeout: 25, clock: false });
        if (!dirs.includes(mv)) break;
        hr.x += DIRS[mv][0]; hr.y += DIRS[mv][1];
        playClip('sfx_creaking_floor', 0.55);
        sfx('pop');
        render();
        if (cell(hr.x, hr.y) === 'E') {
          S.over = { winner: players.find((q) => q.id === hr.owner), why: `${hr.name} walked out the front door with the will!`, heir: hr };
          return;
        }
      }
      die.used = true; S.selected = null; S.stepsLeft = 0; render();
    }

    // Traps: spring any you hold a card for.
    for (;;) {
      if (S.over) return;
      const opps = heirs.filter((x) => x.alive && trapAt(x.x, x.y) && hs.includes(trapAt(x.x, x.y)));
      if (!opps.length) break;
      S.glow = opps.map((x) => [x.x, x.y]); render();
      const choices = opps.map((x) => {
        const c = CARDS[trapAt(x.x, x.y)];
        return { value: x.id, label: `${c.icon} ${c.name} on ${x.name}${x.owner === p.id ? ' (yours!)' : ''}` };
      }).concat({ value: 'no', label: 'Not this time' });
      const t = await ask(p, { title: 'Spring a trap?', text: 'You hold the card for a trap someone is standing in.', buzz: true, choices }, { timeout: 30 });
      S.glow = []; render();
      if (!byId[t]) break;
      await knockOut(p, byId[t]);
    }
    draw(p);
  }

  let i = 0;
  while (!S.over && S.turn < S.total) {
    const p = players[i++ % n];
    if (!mine(p.id).some((x) => x.alive)) continue;
    await turn(p);
    S.turn++;
    S.active = null; S.dice = []; S.selected = null; S.stepsLeft = 0;
    render();
  }

  // ---------- the reading of the will ----------
  if (!S.over) {
    const hr = byId[S.named];
    S.over = { winner: players.find((q) => q.id === hr.owner), why: `The clock strikes midnight. The will names ${hr.name}.`, heir: hr };
    triggerBloom('rgba(44, 36, 66, 0.9)');
    playClip('sfx_chime', 0.95);
    await flash('🕛', 'Midnight', 'The solicitor opens the will…', 3500);
  }
  const win = S.over.winner;
  sfx('win');
  for (const p of players) ctx.show(p, V(p, p.id === win?.id
    ? { title: 'You inherit!', text: S.over.why, buzz: true }
    : { title: `${win ? win.name : 'Nobody'} inherits`, text: S.over.why }));
  boom.replaceChildren(h('div.hm-boomin.final',
    h('div.hm-k', S.over.why),
    h('h2', win ? `🏆 ${win.name} inherits Hollowmere!` : 'Nobody inherits'),
    h('div.hm-reveal', players.map((p) => h('div.hm-rv' + (p.id === win?.id ? '.win' : ''),
      h('div.hm-rvn', { style: { color: p.color } }, p.name),
      h('div', mine(p.id).map((x) => html(portrait(x, 54, !x.alive)))))))));
  boom.classList.add('on');
  await ctx.sleep(15000);
}

// ---------- the mansion, drawn once ----------
function drawMansion() {
  const out = [];
  out.push(`<defs>
    <filter id="hm-paper-grain" x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.045 0.055" numOctaves="4" result="noise"/>
      <feDiffuseLighting in="noise" lighting-color="#fff8ed" surfaceScale="1.4" result="paperLight">
        <feDistantLight azimuth="55" elevation="65"/>
      </feDiffuseLighting>
      <feBlend mode="multiply" in="SourceGraphic" in2="paperLight"/>
    </filter>
    <filter id="hm-watercolor-wash" x="-8%" y="-8%" width="116%" height="116%">
      <feTurbulence type="fractalNoise" baseFrequency="0.038" numOctaves="3" result="roughNoise"/>
      <feDisplacementMap in="SourceGraphic" in2="roughNoise" scale="5" xChannelSelector="R" yChannelSelector="G" result="displaced"/>
      <feMorphology operator="dilate" radius="1.4" in="displaced" result="dilated"/>
      <feComposite operator="out" in="dilated" in2="displaced" result="edge"/>
      <feColorMatrix type="matrix" in="edge" values="
        0 0 0 0 0.12
        0 0 0 0 0.08
        0 0 0 0 0.18
        0 0 0 0 0.55 0" result="wetRim"/>
      <feMerge>
        <feMergeNode in="displaced"/>
        <feMergeNode in="wetRim"/>
      </feMerge>
    </filter>
    <filter id="hm-gouache">
      <feGaussianBlur in="SourceAlpha" stdDeviation="0.8" result="blur"/>
      <feSpecularLighting in="blur" surfaceScale="2" specularConstant="0.6" specularExponent="16" lighting-color="#fffbee" result="spec">
        <fePointLight x="-20" y="-30" z="80"/>
      </feSpecularLighting>
      <feComposite in="SourceGraphic" in2="spec" operator="arithmetic" k1="0" k2="1" k3="0.3" k4="0"/>
    </filter>
  </defs>`);

  const FLOOR = {
    L: ['#4a3326', '#533a2c'], B: ['#d8c7a4', '#c4b28e'], C: ['#2f5d3a', '#376a43'], H: ['#7a2433', '#7a2433'],
    S: ['#433a5c', '#4b4168'], K: ['#e6e0cf', '#9a9488'], F: ['#9aa0b4', '#8a90a4'], '.': ['#6b5440', '#6b5440'],
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = cell(x, y);
    if (c === '#') {
      out.push(`<rect x="${x * T}" y="${y * T}" width="${T}" height="${T}" fill="#1d1729"/>`);
    } else if (c === 'E') {
      out.push(`<rect x="${x * T}" y="${y * T}" width="${T}" height="${T}" fill="#1d1729"/>
        <path d="M${x * T + 6} ${(y + 1) * T} L${x * T + 6} ${y * T + 18} Q${x * T + 24} ${y * T - 2} ${x * T + 42} ${y * T + 18} L${x * T + 42} ${(y + 1) * T} Z" fill="#2ecc71" class="hm-exit"/>
        <circle cx="${x * T + 34}" cy="${y * T + 32}" r="3" fill="#f5d76e"/>`);
    } else {
      const f = FLOOR[c] || FLOOR['.'];
      out.push(`<rect x="${x * T}" y="${y * T}" width="${T}" height="${T}" fill="${f[(x + y) % 2]}"/>`);
      if (c === 'L') out.push(`<path d="M${x * T} ${y * T + 24} H${(x + 1) * T}" stroke="#3b281d" stroke-width="2"/>`);
      if (c === 'C' && (x * 7 + y * 3) % 4 === 0) out.push(`<circle cx="${x * T + 12}" cy="${y * T + 34}" r="5" fill="#4f8a5b"/>`);
    }
  }
  // the hall carpet's gold border
  out.push(`<rect x="${T + 6}" y="${6 * T + 6}" width="${19 * T - 12}" height="${2 * T - 12}" fill="none" stroke="#d4ac0d" stroke-width="3" opacity=".6"/>`);
  // trap tiles
  for (const tiles of Object.values(TRAP_TILES)) for (const [x, y] of tiles) {
    out.push(`<rect x="${x * T + 3}" y="${y * T + 3}" width="${T - 6}" height="${T - 6}" rx="6" class="hm-trap"/>`);
  }
  // trap furniture
  const px = (v) => v * T;
  // bookcase along the library's top wall
  out.push(`<rect x="${px(2)}" y="${px(0) + 8}" width="${px(4)}" height="${T - 8}" fill="#5a3a22" stroke="#2b1b10" stroke-width="3"/>`);
  for (let i = 0; i < 22; i++) {
    const cols = ['#c0392b', '#2e86de', '#27ae60', '#d4ac0d', '#8e44ad', '#e67e22'];
    out.push(`<rect x="${px(2) + 5 + i * 8.3}" y="${px(0) + 14 + (i % 3) * 3}" width="6.5" height="${28 - (i % 3) * 3}" fill="${cols[i % 6]}"/>`);
  }
  // chandelier over the ballroom with swaying shadow
  const cx = px(11.5), cy = px(3);
  out.push(`<ellipse class="hm-chandelier-shadow" cx="${cx}" cy="${cy + 34}" rx="68" ry="24" fill="#08060f" opacity=".38" filter="blur(3px)"/>`);
  out.push(`<g class="hm-chandelier-body" opacity=".95"><path d="M${cx} ${px(0)} V${cy - 30}" stroke="#b7950b" stroke-width="3"/>
    <ellipse cx="${cx}" cy="${cy}" rx="62" ry="22" fill="none" stroke="#f5d76e" stroke-width="6"/>
    <ellipse cx="${cx}" cy="${cy}" rx="34" ry="12" fill="none" stroke="#f5d76e" stroke-width="4"/>
    ${[-56, -28, 0, 28, 56].map((d) => `<rect x="${cx + d - 4}" y="${cy - 26 + Math.abs(d) / 4}" width="8" height="16" fill="#fff8e7"/><ellipse cx="${cx + d}" cy="${cy - 30 + Math.abs(d) / 4}" rx="4" ry="7" fill="#ffb84d"/>`).join('')}
    ${[-44, -14, 14, 44].map((d) => `<path d="M${cx + d} ${cy + 18} l-5 12 l5 8 l5 -8 Z" fill="#bfe9ff" opacity=".8"/>`).join('')}</g>`);
  // the hungry orchid in the conservatory corner
  const ox = px(19) + 12, oy = px(1) + 20;
  out.push(`<g><path d="M${ox} ${oy + 30} Q${ox - 40} ${oy + 20} ${ox - 30} ${oy - 10}" stroke="#1e8449" stroke-width="7" fill="none"/>
    <path d="M${ox} ${oy + 30} Q${ox + 8} ${oy + 50} ${ox - 20} ${oy + 62}" stroke="#1e8449" stroke-width="7" fill="none"/>
    <ellipse cx="${ox - 34}" cy="${oy + 46}" rx="16" ry="7" fill="#27ae60" transform="rotate(-30 ${ox - 34} ${oy + 46})"/>
    <path d="M${ox - 52} ${oy - 18} Q${ox - 30} ${oy - 44} ${ox - 6} ${oy - 18} Z" fill="#e84393" stroke="#7d1a4f" stroke-width="3"/>
    <path d="M${ox - 52} ${oy - 12} Q${ox - 30} ${oy + 14} ${ox - 6} ${oy - 12} Z" fill="#e84393" stroke="#7d1a4f" stroke-width="3"/>
    ${[0, 1, 2, 3, 4].map((i) => `<path d="M${ox - 48 + i * 9} ${oy - 18} l4 7 l4 -7 Z M${ox - 48 + i * 9} ${oy - 12} l4 -7 l4 7 Z" fill="#fff"/>`).join('')}</g>`);
  // trapdoor in the study
  out.push(`<g><rect x="${px(3) + 4}" y="${px(10) + 4}" width="${T * 2 - 8}" height="${T - 8}" fill="#7a5230" stroke="#3b2314" stroke-width="3"/>
    ${[1, 2, 3].map((i) => `<path d="M${px(3) + 4 + i * 22} ${px(10) + 6} V${px(11) - 6}" stroke="#3b2314" stroke-width="2"/>`).join('')}
    <circle cx="${px(4) + 30}" cy="${px(10) + 24}" r="6" fill="none" stroke="#c8c8c8" stroke-width="3"/></g>`);
  // two suits of armour in the hall
  for (const ax of [6, 14]) {
    const x = px(ax) + 24, y = px(5) + 6;
    out.push(`<g><path d="M${x - 11} ${y + 10} Q${x - 12} ${y - 4} ${x} ${y - 4} Q${x + 12} ${y - 4} ${x + 11} ${y + 10} Z" fill="#bdc3c7" stroke="#2c3e50" stroke-width="2"/>
      <path d="M${x - 8} ${y + 3} H${x + 8}" stroke="#2c3e50" stroke-width="2.5"/>
      <path d="M${x - 14} ${y + 12} H${x + 14} L${x + 10} ${y + 38} H${x - 10} Z" fill="#95a5a6" stroke="#2c3e50" stroke-width="2"/>
      <path d="M${x + 20} ${y - 6} V${y + 40}" stroke="#6e4b2a" stroke-width="3"/>
      <path d="M${x + 20} ${y - 4} q14 6 0 16 Z" fill="#d0d3d4" stroke="#2c3e50" stroke-width="1.5"/></g>`);
  }
  // dumbwaiter hatch in the kitchen's right wall
  out.push(`<g><rect x="${px(20) + 6}" y="${px(10) + 6}" width="${T - 12}" height="${T * 2 - 12}" fill="#4a3326" stroke="#c8a165" stroke-width="3"/>
    <path d="M${px(20) + 24} ${px(10) + 10} V${px(12) - 10}" stroke="#c8a165" stroke-width="2" stroke-dasharray="4 4"/>
    <rect x="${px(20) + 12}" y="${px(11)}" width="24" height="18" fill="#7a5230"/></g>`);
  // grandfather clock beside the foyer
  const kx = px(8) + 10, ky = px(9) + 6;
  out.push(`<g><rect x="${kx}" y="${ky}" width="28" height="${T * 3 - 14}" rx="4" fill="#6e3b1f" stroke="#2b1b10" stroke-width="3"/>
    <circle cx="${kx + 14}" cy="${ky + 18}" r="11" fill="#fff8e7" stroke="#d4ac0d" stroke-width="2"/>
    <path d="M${kx + 14} ${ky + 18} l0 -7 M${kx + 14} ${ky + 18} l5 3" stroke="#1a1426" stroke-width="2"/>
    <path d="M${kx + 14} ${ky + 34} L${kx + 14} ${ky + 90}" stroke="#d4ac0d" stroke-width="2" class="hm-pend"/>
    <circle cx="${kx + 14}" cy="${ky + 96}" r="8" fill="#d4ac0d" class="hm-pend"/></g>`);
  // room names
  for (const r of Object.values(ROOMS)) {
    out.push(`<text x="${r.at[0] * T}" y="${r.at[1] * T}" class="hm-room${r.inside ? '' : ' hm-out'}" text-anchor="middle">${r.name.toUpperCase()}</text>`);
  }
  out.push(`<text x="${EXIT[0] * T + 24}" y="${H * T + 22}" class="hm-room hm-exitlbl" text-anchor="middle">▲ FRONT DOOR ▲</text>`);

  // Floating atmospheric dust motes
  out.push(`<g class="hm-dust-motes">`);
  const motes = [
    [320, 310, 1.8, 7.5, 0], [380, 290, 1.4, 9.0, 1.2], [460, 340, 2.0, 8.0, 2.5],
    [520, 300, 1.5, 6.5, 0.8], [580, 360, 2.2, 8.5, 3.1], [640, 320, 1.6, 7.0, 1.8],
    [410, 420, 1.9, 8.2, 2.0], [490, 450, 1.3, 9.5, 0.5], [560, 430, 2.1, 7.8, 3.7],
    [620, 470, 1.7, 6.8, 1.4], [350, 480, 1.5, 8.8, 2.8], [510, 500, 2.0, 7.2, 0.2]
  ];
  for (const [mx, my, mr, md, mdel] of motes) {
    out.push(`<circle class="hm-mote" cx="${mx}" cy="${my}" r="${mr}" fill="#fff8e7" opacity=".65" style="--d:${md}s;--del:${mdel}s;"/>`);
  }
  out.push(`</g>`);

  return out.join('');
}

function injectCss() {
  document.getElementById('hollowmere-css')?.remove();
  const css = Object.assign(document.createElement('style'), { id: 'hollowmere-css' });
  css.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;900&family=Crimson+Pro:ital,wght@0,400;0,700;1,400&display=swap');
  .hm {
    display: grid; grid-template-columns: minmax(0, 1fr) 19em; gap: 2vw; width: 100%; align-items: start; text-align: left;
    font-family: 'Crimson Pro', Georgia, serif;
  }
  .hm-boardwrap { position: relative; }
  .hm-map {
    width: 100%; height: auto; max-height: 86vh; display: block; border-radius: 18px;
    background: #1d1729;
    border: 4px solid #3d2a1c; outline: 2px solid #b7950b;
    box-shadow: 0 20px 60px #000a, inset 0 0 80px rgba(0,0,0,0.5);
  }
  .hm-room { fill: #fff; opacity: .45; font-family: 'Cinzel', serif; font-weight: 900; font-size: 15px; letter-spacing: .14em; }
  .hm-room.hm-out { opacity: .85; fill: #d8cfee; font-size: 17px; }
  .hm-exitlbl { opacity: 1; fill: #2ecc71; font-size: 17px; }
  .hm-exit { filter: drop-shadow(0 0 8px #2ecc71); }
  .hm-trap {
    fill: #8b0000; fill-opacity: .32; stroke: #c0392b; stroke-width: 2.5; stroke-dasharray: 6 3;
    filter: url(#hm-watercolor-wash);
  }
  .hm-tok { transition: transform .28s ease-out, opacity .6s; }
  .hm-tok .hm-ring { fill: none; stroke: transparent; stroke-width: 4; }
  .hm-tok.named .hm-ring { stroke: #f5d76e; stroke-width: 5; filter: drop-shadow(0 0 6px #f5d76e); }
  .hm-tok.sel .hm-ring { stroke: #fff; stroke-width: 5; animation: hmpulse .7s ease-in-out infinite alternate; }
  .hm-tok.ko { opacity: 0; }
  .hm-step { fill: #fff; fill-opacity: .18; stroke: #fff; stroke-width: 2; stroke-dasharray: 4 4; }
  .hm-glow { fill: #ff3b3b; fill-opacity: .45; stroke: #ffb84d; stroke-width: 4; animation: hmpulse .5s ease-in-out infinite alternate; }
  .hm-pend { transform-origin: ${8 * T + 24}px ${9 * T + 40}px; animation: hmswing 2s ease-in-out infinite alternate; }
  @keyframes hmswing { from { transform: rotate(-12deg); } to { transform: rotate(12deg); } }
  @keyframes hmpulse { to { opacity: .45; } }

  /* Swaying Chandelier & Shadows */
  .hm-chandelier-body {
    transform-origin: ${11.5 * T}px 0px;
    animation: hm-chandelier-sway 4.5s ease-in-out infinite alternate;
  }
  .hm-chandelier-shadow {
    transform-origin: ${11.5 * T}px ${3 * T + 34}px;
    animation: hm-shadow-drift 4.5s ease-in-out infinite alternate;
  }
  @keyframes hm-chandelier-sway {
    0%   { transform: rotate(-3deg); }
    100% { transform: rotate(3deg); }
  }
  @keyframes hm-shadow-drift {
    0%   { transform: translate(-16px, 0) scale(0.95, 1.03); opacity: 0.35; }
    100% { transform: translate(16px, 0) scale(1.05, 0.97); opacity: 0.45; }
  }

  /* Floating Dust Motes */
  .hm-mote {
    animation: hm-mote-drift var(--d, 8s) ease-in-out infinite;
    animation-delay: var(--del, 0s);
  }
  @keyframes hm-mote-drift {
    0%   { transform: translate(0, 0); opacity: 0.05; }
    30%  { opacity: 0.75; }
    60%  { transform: translate(24px, -32px); opacity: 0.85; }
    85%  { opacity: 0.3; }
    100% { transform: translate(48px, -65px); opacity: 0; }
  }

  /* Radial Watercolor Bloom Dissolve Wipes */
  .hm-bloom {
    position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; z-index: 10;
  }
  .hm-bloom.active::before {
    content: ''; width: 140px; height: 140px; border-radius: 50%;
    background: radial-gradient(circle, var(--bloom-color, rgba(212, 172, 13, 0.85)) 0%, rgba(139, 0, 0, 0.6) 50%, transparent 75%);
    animation: hm-bloom-expand 1.4s cubic-bezier(0.1, 0.8, 0.2, 1) forwards;
  }
  @keyframes hm-bloom-expand {
    0%   { transform: scale(0.1); opacity: 0.95; filter: url(#hm-watercolor-wash) blur(1px); }
    40%  { transform: scale(1.6); opacity: 0.85; filter: url(#hm-watercolor-wash) blur(3px); }
    80%  { transform: scale(3.2); opacity: 0.35; filter: url(#hm-watercolor-wash) blur(6px); }
    100% { transform: scale(4.8); opacity: 0; filter: blur(12px); }
  }

  .hm-side { display: flex; flex-direction: column; gap: 10px; font-size: .85em; }
  .hm-side > div { background: var(--card); border: 2px solid var(--line); border-radius: 16px; padding: 10px 14px; }
  .hm-k { color: var(--dim); font-family: 'Cinzel', serif; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; font-size: .75em; }
  .hm-small { color: var(--dim); font-size: .75em; }
  .hm-will { text-align: center; border-color: #d4ac0d !important; background: linear-gradient(#3a2f1a, var(--card)) !important; }
  .hm-will .portrait { margin: 6px auto 0; display: block; }
  .hm-wname { font-family: 'Cinzel', serif; font-size: 1.5em; font-weight: 900; }
  .hm-bar { height: 10px; border-radius: 99px; background: var(--bg2); overflow: hidden; margin: 6px 0; }
  .hm-bar div { height: 100%; background: #d4ac0d; transition: width .8s; }
  .hm-turn { font-family: 'Cinzel', serif; font-weight: 900; font-size: 1.2em; }
  .hm-dice { display: flex; gap: 12px; margin-top: 8px; }
  .hm-die {
    width: 2.2em; height: 2.2em; border-radius: 10px; background: #fff8e7; color: #1a1426; display: grid; place-items: center;
    font-family: 'Cinzel', serif; font-size: 1.3em; font-weight: 900; box-shadow: 0 4px 0 #b9ab8c;
  }
  .hm-die.used { opacity: .3; }
  .hm-die.rolling { animation: hmroll .2s linear infinite; }
  @keyframes hmroll { 50% { transform: rotate(20deg) translateY(-4px); } }
  .hm-players { display: flex; flex-direction: column; gap: 6px; }
  .hm-pl { display: flex; justify-content: space-between; font-weight: 800; border-left: 5px solid var(--c); padding-left: 8px; }
  .hm-pl.act { background: color-mix(in srgb, var(--c) 20%, transparent); border-radius: 6px; }
  .hm-pl.out span:first-child { text-decoration: line-through; opacity: .5; }
  .hm-cards { color: var(--dim); }
  .hm-gone .portrait { margin: 2px; }
  .hm-log { font-size: .75em; color: var(--dim); display: flex; flex-direction: column; gap: 4px; min-height: 3em; }
  .hm-log div:first-child { color: var(--fg); }
  .hm-svg { display: inline-block; line-height: 0; }
  .hm-boom { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; opacity: 0;
    transition: opacity .3s; background: #14111fb0; border-radius: 18px; }
  .hm-boom.on { opacity: 1; }
  .hm-boomin { background: var(--card); border: 3px solid #d4ac0d; border-radius: 24px; padding: 3vh 3vw; text-align: center;
    max-width: 90%; animation: pop .35s ease-out; }
  .hm-boomin h2 { font-family: 'Cinzel', serif; font-size: 2.4em; margin: .1em 0; }
  .hm-boomin p { color: var(--dim); font-size: 1.2em; margin: 0; }
  .hm-bicon { font-size: 4em; }
  .hm-boomin.rules { text-align: left; }
  .hm-boomin.rules ol { font-size: 1.1em; display: flex; flex-direction: column; gap: .5em; margin: .5em 0 0; }
  .hm-reveal { display: flex; flex-wrap: wrap; gap: 18px; justify-content: center; margin-top: 1em; }
  .hm-rv { background: var(--bg2); border-radius: 16px; padding: 10px 14px; border: 2px solid transparent; }
  .hm-rv.win { border-color: #d4ac0d; }
  .hm-rvn { font-weight: 900; }
  `;
  document.head.append(css);
}
