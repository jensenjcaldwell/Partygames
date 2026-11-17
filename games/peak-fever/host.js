// Peak Fever: Mid-Century Screenprint Alpine Poster Overhaul.
// Runs turns, draws screenprinted alpine peaks on TV, drives phones, and plays custom audio.
import * as audio from '/sdk/audio.js';
import * as R from './rules.js';
import { CSS, PIPS, diceImage } from './look.js';

const DECIDE_TIME = 40;   // seconds to pick a move or push / camp before the default
const SVGNS = 'http://www.w3.org/2000/svg';
const W = 1100, G = 770, STEP = 51;
const colX = (peak) => 52 + (peak - 2) * 99.6;
const stepY = (k) => G - k * STEP;
const topY = (peak) => stepY(R.HEIGHT[peak]) - 34;

export default async function (ctx) {
  const { h } = ctx;
  document.getElementById('peak-fever-css')?.remove();
  document.head.append(Object.assign(document.createElement('style'), { id: 'peak-fever-css', textContent: CSS }));
  ctx.el.parentElement.classList.add('pf-frame');

  // ---------- Audio Subsystem ----------
  ctx.music(null); // Mute generic platform music
  let bgm = null;
  try {
    bgm = new Audio(ctx.asset('audio/bg_main.ogg'));
    bgm.loop = true;
    bgm.volume = 0.35;
    if (!audio.isMuted()) {
      bgm.play().catch(() => {});
    }
  } catch (e) {}

  function playSfx(name, vol = 0.7) {
    if (audio.isMuted()) return;
    try {
      const sfx = new Audio(ctx.asset(`audio/${name}.wav`));
      sfx.volume = vol;
      sfx.play().catch(() => {});
    } catch (e) {}
  }

  try {
    // ---------- intro ----------
    ctx.show('all', { title: 'Peak Fever', wait: 'Look at the big screen!' });
    ctx.el.replaceChildren(h('div.pf-centre',
      h('div.pf-title', 'Peak Fever'),
      h('p.pf-sub', 'Race your climbers up eleven peaks. First to plant three flags wins.'),
      h('div.pf-rules',
        rule(h, '🎲 Roll & pair', 'Roll four dice and split them into two pairs. Each pair\'s sum climbs that peak.', 0),
        rule(h, '🔥 Push your luck', 'Three climbers a turn. Keep rolling to climb higher, or make camp to keep your progress.', 1),
        rule(h, '🏔️ Avalanche!', 'Roll with no pair that fits and the turn\'s climbing is swept away. Summit and camp to plant a flag.', 2))));
    ctx.sfx('whoosh');
    await ctx.sleep(9000);

    // ---------- board ----------
    const s = R.newGame();
    const order = ctx.shuffle(ctx.connected.map((p) => p.id));
    let active = null;

    const head = h('div.pf-head');
    const svg = buildBoard();
    const marks = svgEl('g');
    svg.append(marks);
    const board = h('div.pf-board', svg);
    const cheers = h('div.pf-cheers');
    const snow = h('div.pf-snow');
    const dieEls = [0, 1, 2, 3].map(() => h('div.pf-die.idle', Array.from({ length: 9 }, () => h('i'))));
    const trayLine = h('div.pf-trayline', 'Waiting for the first roll');
    const ropes = h('div.pf-ropes');
    const players = h('div.pf-players');
    const odds = h('div.pf-odds');
    ctx.el.replaceChildren(h('div.pf-wrap',
      h('div.pf-left', head, board, cheers, snow),
      h('div.pf-side',
        h('div.pf-tray', h('div.pf-dice', dieEls), trayLine, ropes),
        odds,
        players)));

    const setHead = (text, sub, color) => {
      head.replaceChildren(text, ...(sub ? [h('small', sub)] : []));
      head.style.color = color || '';
    };
    const showDice = (dice, pairs) => dieEls.forEach((el, i) => {
      el.className = 'pf-die';
      if (!dice) el.classList.add('idle');
      if (pairs?.[0]?.includes(i)) el.classList.add('p0');
      else if (pairs?.[1]?.includes(i)) el.classList.add('p1');
      else if (pairs) el.classList.add('idle');
      const on = new Set(PIPS[dice ? dice[i] : 1]);
      [...el.children].forEach((pip, k) => pip.classList.toggle('on', on.has(k)));
    });
    showDice(null);

    function renderSide() {
      const pc = ctx.player(active)?.color || '#162330';
      const used = Object.keys(s.temp).length;
      ropes.replaceChildren(h('span', 'Climbers left'), ...Array.from({ length: R.CLIMBERS }, (_, i) =>
        h('span.pf-rp' + (i < used ? '.used' : ''), { style: { '--pc': pc } })));
      players.replaceChildren(...order.map((id) => {
        const p = ctx.player(id);
        const n = R.flagsOf(s, id);
        return h('div.pf-pl' + (id === active ? '.on' : '') + (p.connected ? '' : '.away'), { style: { '--pc': p.color } },
          h('span.pf-dot'), h('span.pf-name', p.name),
          h('span.pf-flags', Array.from({ length: R.FLAGS_TO_WIN }, (_, i) => h('span' + (i < n ? '.got' : '')))));
      }));
    }

    // Markers are kept between renders so they glide to their new spots.
    const live = new Map();
    function renderMarks({ fall = false } = {}) {
      const want = new Map();
      for (const peak of R.PEAKS) {
        const x = colX(peak);
        const flag = s.flags[peak];
        svg.querySelector(`[data-spire="${peak}"]`).classList.toggle('closed', flag != null);
        if (flag != null) {
          want.set(`flag-${peak}`, { x, y: topY(peak), make: () => flagEl(ctx.player(flag)) });
          continue;
        }
        const byStep = new Map();
        for (const [id, k] of Object.entries(s.camps[peak])) {
          if (k > 0) byStep.set(k, [...(byStep.get(k) || []), Number(id)]);
        }
        for (const [k, ids] of byStep) ids.forEach((id, j) => {
          const dx = (j - (ids.length - 1) / 2) * 22;
          want.set(`camp-${peak}-${id}`, { x: x + dx, y: stepY(k) + 8, make: () => tentEl(ctx.player(id)) });
        });
        if (peak in s.temp && active != null) {
          const from = s.camps[peak][active] || 0;
          want.set(`climb-${peak}`, {
            x, y: stepY(s.temp[peak]) - 4, from: stepY(from) - 4, rope: from,
            make: () => climberEl(ctx.player(active)),
          });
        }
      }
      for (const [key, el] of live) {
        if (want.has(key)) continue;
        live.delete(key);
        if (fall && key.startsWith('climb-')) {
          const [, x] = /translate\(([-\d.]+)px/.exec(el.style.transform) || [0, 0];
          el.style.transition = 'transform 1.1s cubic-bezier(.6,0,.9,.6), opacity 1.1s';
          el.style.transform = `translate(${x}px, ${G + 80}px) rotate(200deg)`;
          el.classList.add('gone');
          setTimeout(() => el.remove(), 1200);
        } else {
          el.classList.add('gone');
          setTimeout(() => el.remove(), 550);
        }
      }
      for (const [key, w] of want) {
        let el = live.get(key);
        if (!el) {
          el = w.make();
          el.classList.add('pf-mk');
          el.style.transform = `translate(${w.x}px, ${w.from ?? w.y}px)`;
          marks.append(el);
          live.set(key, el);
          el.getBoundingClientRect();
        }
        el.style.transform = `translate(${w.x}px, ${w.y}px)`;
        const rope = el.querySelector('.pf-rope');
        if (rope) rope.setAttribute('y2', String(stepY(w.rope) - 4 - w.y));
      }
      renderSide();
    }

    // ---------- cheering from the other phones ----------
    const lastCheer = new Map();
    ctx.on('message', (p, data) => {
      if (!p || p.id === active || data?.kind !== 'choice' || typeof data.value !== 'string') return;
      const now = Date.now();
      if (now - (lastCheer.get(p.id) || 0) < 1200) return;
      lastCheer.set(p.id, now);
      const text = { push: '🔥 Push on!', camp: '⛺ Make camp!', boom: '😱 Avalanche!' }[data.value];
      if (!text) return;
      const b = h('div.pf-cheer', { style: { '--pc': p.color, left: `${8 + Math.random() * 70}%` } }, `${p.name}: ${text}`);
      cheers.append(b);
      ctx.sfx('pop');
      setTimeout(() => b.remove(), 2700);
    });
    const cheerView = (name) => ({
      title: `${name} is climbing`, text: 'Shout at them:',
      choices: [{ label: '🔥 Push on!', value: 'push' }, { label: '⛺ Make camp!', value: 'camp' }, { label: '😱 Avalanche!', value: 'boom' }],
    });

    async function rollDice(dice) {
      playSfx('dice_cup_rattle', 0.8);
      dieEls.forEach((el) => { el.className = 'pf-die rolling'; });
      for (let t = 0; t < 10; t++) {
        showDice(dice.map(() => 1 + Math.floor(Math.random() * 6)));
        dieEls.forEach((el) => el.classList.add('rolling'));
        ctx.sfx(t % 2 ? 'tick' : 'tock');
        await ctx.sleep(90);
      }
      showDice(dice);
      ctx.sfx('pop');
    }

    async function avalanche(p) {
      setHead('AVALANCHE!', `${p.name} loses this turn's climb`, '#d35400');
      trayLine.replaceChildren('No pair fits anywhere');
      playSfx('avalanche_rumble', 0.85);
      ctx.sfx('buzz');
      ctx.sfx('lose', 0.3);
      board.classList.remove('shake'); board.getBoundingClientRect(); board.classList.add('shake');

      // Sharp geometric polygon avalanche shards in screenprint spot colors
      const colors = ['#d35400', '#208994', '#1b4d3e', '#e67e22', '#faf5eb', '#162330'];
      const shards = Array.from({ length: 65 }, () => {
        const poly = Math.random() > 0.5
          ? 'polygon(50% 0%, 0% 100%, 100% 100%)'
          : 'polygon(20% 0%, 100% 30%, 80% 100%, 0% 80%)';
        const c = colors[Math.floor(Math.random() * colors.length)];
        const sz = 8 + Math.random() * 16;
        return h('div.pf-shard', { style: {
          left: `${Math.random() * 100}%`,
          width: `${sz}px`,
          height: `${sz * 1.2}px`,
          backgroundColor: c,
          clipPath: poly,
          animationDuration: `${1.1 + Math.random() * 1.5}s`,
          animationDelay: `${Math.random() * 0.5}s`,
          '--dx': `${(Math.random() - 0.5) * 260}px`,
          '--rot': `${(Math.random() - 0.5) * 540}deg`,
        } });
      });

      snow.replaceChildren(h('div.pf-scree-wall'), ...shards);
      R.bust(s);
      renderMarks({ fall: true });
      ctx.show(p, { title: 'Avalanche! 😱', text: 'No pair fits, so this turn\'s climbing is swept away.', color: '#d35400', buzz: true });
      await ctx.sleep(3400);
      snow.replaceChildren();
    }

    async function turn(pid) {
      const p = ctx.player(pid);
      active = pid;
      s.temp = {};
      renderMarks();
      showDice(null);
      setHead(`${p.name}'s turn`, null, p.color);
      trayLine.replaceChildren('Rolling soon…');
      odds.replaceChildren();
      ctx.sfx('ding');
      ctx.show(order.filter((id) => id !== pid), cheerView(p.name));
      await ctx.ask(p, {
        title: 'Your turn!', text: 'Grab the dice.', color: p.color, buzz: true,
        choices: [{ label: '🎲 Roll', value: 'roll' }],
      }, { timeout: DECIDE_TIME, after: { title: 'Rolling…', wait: 'Watch the dice on the TV!', color: p.color } });

      for (;;) {
        const dice = R.roll();
        setHead(`${p.name}'s turn`, 'rolling…', p.color);
        await rollDice(dice);
        const ms = R.moves(s, pid, dice);
        if (!ms.length) return avalanche(p);

        let move = ms[0];
        if (ms.length === 1) {
          setHead(`${p.name}'s turn`, 'only one way up', p.color);
          ctx.show(p, { title: moveLabel(move), image: diceImage(dice, R.pairsFor(dice, move)), text: 'Only one way up this time.', color: p.color });
          await ctx.sleep(1400);
        } else {
          setHead(`${p.name}'s turn`, 'choosing a route…', p.color);
          trayLine.replaceChildren(`${ms.length} ways up`);
          const a = await ctx.ask(p, {
            title: 'Pick your route', image: diceImage(dice), color: p.color,
            choices: ms.map((m, i) => ({ label: moveLabel(m), value: i })),
          }, { timeout: DECIDE_TIME, after: { title: 'Climbing…', wait: 'Look at the TV!', color: p.color } });
          move = ms[a.get(pid)] || ms[0];
        }
        const pairs = R.pairsFor(dice, move);
        showDice(dice, move.length === 1 ? [pairs[0], []] : pairs);
        litPlaques(move);
        R.apply(s, pid, move);
        trayLine.replaceChildren(...moveText(move));
        playSfx('piton_hammer', 0.7);
        renderMarks();
        ctx.sfx('whoosh');
        await ctx.sleep(1000);

        const tops = R.summits(s);
        const winsNow = R.flagsOf(s, pid) + tops.length >= R.FLAGS_TO_WIN;
        const pct = Math.round(R.safeChance(s, pid) * 100);
        odds.replaceChildren(`Next roll is safe ${pct}% of the time`);
        setHead(`${p.name}'s turn`, 'push on or make camp?', p.color);
        const status = Object.entries(s.temp).map(([k, step]) => {
          const left = R.HEIGHT[k] - step;
          return `Peak ${k}: ${left ? `${left} to the top` : 'summit! 🚩'}`;
        }).join('\n');
        const a = await ctx.ask(p, {
          title: winsNow ? 'Make camp to win!' : 'Push on?',
          text: `${status}\n\nNext roll is safe ${pct}% of the time.`, color: p.color,
          choices: [{ label: '🎲 Keep climbing', value: 'roll' }, { label: winsNow ? '🏆 Make camp and win' : '⛺ Make camp', value: 'camp' }],
        }, { timeout: DECIDE_TIME, after: { title: 'Got it', wait: 'Look at the TV!', color: p.color } });
        litPlaques([]);
        if (a.get(pid) !== 'roll') {
          const planted = R.bank(s, pid);
          odds.replaceChildren();
          renderMarks();
          setHead(`${p.name} makes camp`, planted.length ? null : 'progress saved', p.color);
          if (planted.length) {
            playSfx('alpine_horn', 0.9);
            ctx.sfx('win');
            setHead(`🚩 ${p.name} claims Peak ${planted.join(' & ')}!`, null, p.color);
            ctx.show(p, { title: `Flag planted on Peak ${planted.join(' & ')}!`, text: `That's ${R.flagsOf(s, pid)} of ${R.FLAGS_TO_WIN}.`, color: p.color, buzz: true });
            await ctx.sleep(2600);
          } else {
            ctx.sfx('ding');
            ctx.show(p, { title: 'Camp made ⛺', text: 'Your climbers are safe up there.', color: p.color });
            await ctx.sleep(1600);
          }
          return;
        }
        odds.replaceChildren();
        ctx.show(p, { title: 'Rolling…', wait: 'Fingers crossed!', color: p.color });
      }
    }

    function litPlaques(move) {
      svg.querySelectorAll('.pf-plaque').forEach((c) => c.classList.remove('lit', 'lit2'));
      svg.querySelectorAll('.pf-ledge.hot').forEach((c) => c.classList.remove('hot'));
      move.forEach((peak, i) => {
        const plq = svg.querySelector(`[data-plaque="${peak}"]`);
        plq.classList.add(i && move[0] !== peak ? 'lit2' : 'lit');
      });
    }

    // ---------- turns ----------
    renderMarks();
    setHead('Peak Fever', 'climbing order: ' + order.map((id) => ctx.player(id).name).join(', '));
    await ctx.sleep(2500);
    let ti = 0, winner = null;
    while (winner == null) {
      if (!order.some((id) => ctx.player(id)?.connected)) {
        await ctx.say('Everyone left', 'Back to the lobby…', 3000);
        return;
      }
      const pid = order[ti++ % order.length];
      if (!ctx.player(pid)?.connected) continue;
      await turn(pid);
      if (R.flagsOf(s, pid) >= R.FLAGS_TO_WIN) winner = pid;
    }

    // ---------- the end ----------
    active = null;
    renderMarks();
    const w = ctx.player(winner);
    playSfx('alpine_horn', 0.95);
    ctx.music('party');
    ctx.sfx('win');
    const ranking = order.map((id) => ({
      p: ctx.player(id), flags: R.flagsOf(s, id),
      height: R.PEAKS.reduce((n, k) => n + (s.flags[k] === id ? R.HEIGHT[k] : (s.camps[k][id] || 0)), 0),
    })).sort((a, b) => b.flags - a.flags || b.height - a.height);
    ctx.show('all', { title: `${w.name} wins!`, text: ranking.map((r, i) => `${i + 1}. ${r.p.name}: ${r.flags} 🚩`).join('\n'), wait: 'Back to the lobby soon…' });
    setHead(`🏆 ${w.name} conquers the range!`, null, w.color);
    await ctx.sleep(4000);
    ctx.el.replaceChildren(h('div.pf-centre',
      h('div.pf-title', { style: { color: w.color } }, `${w.name} wins!`),
      h('p.pf-sub', 'Three flags planted. Thanks for climbing Peak Fever.'),
      h('div.pf-players', { style: { width: 'min(640px, 90%)' } }, ranking.map((r) => h('div.pf-pl', { style: { '--pc': r.p.color } },
        h('span.pf-dot'), h('span.pf-name', r.p.name),
        h('span.pf-flags', Array.from({ length: R.FLAGS_TO_WIN }, (_, i) => h('span' + (i < r.flags ? '.got' : '')))))))));
    await ctx.sleep(8000);
  } finally {
    if (bgm) {
      bgm.pause();
      bgm.removeAttribute('src');
      bgm = null;
    }
  }
}

function rule(h, title, text, i) {
  return h('div.pf-rule', { style: { animationDelay: `${300 + i * 350}ms` } }, h('b', title), text);
}

function moveLabel(m) {
  if (m.length === 1) return `⛰️ Climb Peak ${m[0]}`;
  if (m[0] === m[1]) return `⛰️ Climb Peak ${m[0]} twice`;
  return `⛰️ Climb Peaks ${m[0]} and ${m[1]}`;
}
function moveText(m) {
  if (m.length === 1) return ['Climbing ', bold(m[0])];
  if (m[0] === m[1]) return ['Climbing ', bold(m[0]), ' twice'];
  return ['Climbing ', bold(m[0]), ' and ', bold(m[1])];
}
const bold = (t) => Object.assign(document.createElement('b'), { textContent: t });

// ---------- SVG pieces ----------
function svgEl(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids.filter(Boolean));
  return el;
}

function buildBoard() {
  const svg = svgEl('svg', { viewBox: `0 0 ${W} 850`, preserveAspectRatio: 'xMidYMax meet' });
  const defs = svgEl('defs');
  defs.innerHTML = `
    <!-- Halftone Dot Pattern: Glacier Teal (Cyan Screen Angle 45deg) -->
    <pattern id="pf-halftone-teal" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <circle cx="5" cy="5" r="2.8" fill="#208994"/>
    </pattern>
    <!-- Halftone Dot Pattern: Key Navy (Screen Angle 45deg) -->
    <pattern id="pf-halftone-navy" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <circle cx="5" cy="5" r="3.2" fill="#162330"/>
    </pattern>
    <!-- Halftone Dot Pattern: Burnt Orange (Screen Angle 15deg) -->
    <pattern id="pf-halftone-orange" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(15)">
      <circle cx="5" cy="5" r="2.6" fill="#d35400"/>
    </pattern>
    <!-- Ink Misregistration Filter (2px offset plates) -->
    <filter id="pf-misreg-filter" x="-10%" y="-10%" width="120%" height="120%">
      <feOffset in="SourceGraphic" dx="1.8" dy="1.4" result="orangeShift"/>
      <feColorMatrix in="orangeShift" type="matrix" values="
        0 0 0 0 0.827
        0 0 0 0 0.329
        0 0 0 0 0.000
        0 0 0 0.7 0" result="orangePlate"/>
      <feOffset in="SourceGraphic" dx="-1.5" dy="-1.2" result="tealShift"/>
      <feColorMatrix in="tealShift" type="matrix" values="
        0 0 0 0 0.125
        0 0 0 0 0.537
        0 0 0 0 0.580
        0 0 0 0.7 0" result="tealPlate"/>
      <feMerge>
        <feMergeNode in="orangePlate"/>
        <feMergeNode in="tealPlate"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>`;
  svg.append(defs);

  // Printer Registration Targets in 4 corners
  const regMark = (cx, cy) => {
    const g = svgEl('g', { stroke: '#162330', 'stroke-width': 1.5, opacity: 0.45 });
    g.append(
      svgEl('circle', { cx, cy, r: 10, fill: 'none' }),
      svgEl('line', { x1: cx - 14, y1: cy, x2: cx + 14, y2: cy }),
      svgEl('line', { x1: cx, y1: cy - 14, x2: cx, y2: cy + 14 })
    );
    return g;
  };
  svg.append(regMark(25, 25), regMark(W - 25, 25), regMark(25, 825), regMark(W - 25, 825));

  // Giant Mid-Century Burnt Orange Solar Disk
  svg.append(
    svgEl('circle', { cx: 880, cy: 160, r: 110, fill: '#d35400', opacity: 0.95 }),
    svgEl('circle', { cx: 880, cy: 160, r: 125, fill: 'none', stroke: '#e67e22', 'stroke-width': 3, 'stroke-dasharray': '6 6' })
  );

  // Background Alpine Ridges in Flat Pine Green & Glacier Teal
  let ridgePine = `M-1200 ${G + 60} L-1200 480`;
  for (let x = -1200; x <= W + 1200; x += 80) ridgePine += ` L${x} ${430 + Math.sin(x / 90) * 55}`;
  ridgePine += ` L${W + 1200} ${G + 60} Z`;
  svg.append(svgEl('path', { d: ridgePine, fill: '#1b4d3e', opacity: 0.75 }));

  let ridgeTeal = `M-1200 ${G + 60} L-1200 550`;
  for (let x = -1200; x <= W + 1200; x += 65) ridgeTeal += ` L${x} ${510 + Math.cos(x / 75) * 40}`;
  ridgeTeal += ` L${W + 1200} ${G + 60} Z`;
  svg.append(svgEl('path', { d: ridgeTeal, fill: 'url(#pf-halftone-teal)', opacity: 0.85 }));

  // The 11 Peaks: Faceted Chiseled Geometric Screenprint Polygons
  for (const peak of [...R.PEAKS].sort((a, b) => R.HEIGHT[a] - R.HEIGHT[b] || a - b).reverse()) {
    const x = colX(peak), top = topY(peak), hh = G + 40 - top;
    const g = svgEl('g', { class: 'pf-spire', 'data-spire': peak });
    const body = [[x - 64, G + 40], [x - 52, G - .3 * hh], [x - 40, G - .55 * hh], [x - 26, G - .8 * hh], [x - 9, top + 8], [x, top],
      [x + 11, top + 12], [x + 27, G - .77 * hh], [x + 40, G - .52 * hh], [x + 54, G - .28 * hh], [x + 64, G + 40]];
    const shade = [[x, top], [x + 11, top + 12], [x + 27, G - .77 * hh], [x + 40, G - .52 * hh], [x + 54, G - .28 * hh], [x + 64, G + 40], [x + 4, G + 40]];
    const cap = [[x - 9, top + 8], [x, top], [x + 11, top + 12], [x + 19, top + 38], [x + 9, top + 30], [x + 2, top + 44], [x - 7, top + 30], [x - 16, top + 40]];
    const pts = (a) => a.map((q) => q.join(',')).join(' ');
    g.append(
      svgEl('polygon', { points: pts(body), fill: '#162330', stroke: '#162330', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
      svgEl('polygon', { points: pts(shade), fill: 'url(#pf-halftone-navy)' }),
      svgEl('polygon', { points: pts(cap), fill: '#fffbf0' })
    );
    for (let k = 1; k <= R.HEIGHT[peak]; k++) {
      g.append(svgEl('rect', { class: 'pf-ledge', x: x - 21, y: stepY(k) + 8, width: 42, height: 8, rx: 2 }));
    }
    svg.append(g);
  }
  for (const peak of R.PEAKS) {
    const x = colX(peak);
    svg.append(
      svgEl('circle', { class: 'pf-plaque', 'data-plaque': peak, cx: x, cy: G + 34, r: 28 }),
      svgEl('text', { class: 'pf-num', x, y: G + 46 }, document.createTextNode(String(peak)))
    );
  }
  return svg;
}

function tentEl(p) {
  return svgEl('g', {},
    svgEl('path', { d: 'M-14 0 L0 -24 L14 0 Z', fill: p.color, stroke: '#162330', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
    svgEl('path', { d: 'M-4 0 L0 -10 L4 0 Z', fill: '#162330' }));
}

function climberEl(p) {
  return svgEl('g', { class: 'pf-climber' },
    svgEl('line', { class: 'pf-rope', x1: 0, y1: 0, x2: 0, y2: 0, stroke: p.color }),
    svgEl('circle', { class: 'ring', r: 21, fill: 'none', stroke: '#162330', 'stroke-width': 3 }),
    svgEl('circle', { r: 15, fill: p.color, stroke: '#162330', 'stroke-width': 3.5 }),
    svgEl('text', { y: 6, 'text-anchor': 'middle', 'font-size': 16, 'font-weight': 900, fill: '#faf5eb', 'font-family': "'Alfa Slab One', serif" },
      document.createTextNode((p.name || '?')[0].toUpperCase())));
}

function flagEl(p) {
  // Stamped screenprinted rotating starburst badge behind summit flag
  const pts = [];
  const rays = 12, rInner = 14, rOuter = 26;
  for (let i = 0; i < rays * 2; i++) {
    const ang = (i * Math.PI) / rays;
    const r = i % 2 === 0 ? rOuter : rInner;
    pts.push(`${Math.sin(ang) * r},${-50 - Math.cos(ang) * r}`);
  }
  return svgEl('g', { class: 'pf-flag-in' },
    svgEl('polygon', { class: 'pf-starburst', points: pts.join(' '), fill: '#e67e22', opacity: 0.75, stroke: '#162330', 'stroke-width': 1.5 }),
    svgEl('line', { x1: 0, y1: 4, x2: 0, y2: -62, stroke: '#162330', 'stroke-width': 4, 'stroke-linecap': 'round' }),
    svgEl('path', { class: 'pf-flag', d: 'M2 -62 L48 -50 L2 -36 Z', fill: p.color, stroke: '#162330', 'stroke-width': 2.5 }),
    svgEl('text', { x: 16, y: -45, 'font-size': 13, 'font-weight': 900, fill: '#faf5eb', 'font-family': "'Alfa Slab One', serif" },
      document.createTextNode((p.name || '?')[0].toUpperCase())));
}
