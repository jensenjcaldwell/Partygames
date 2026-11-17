// Tin Tongue: 1950s Retro-Mechanical Tin Toy & Blueprint Host Engine.
// Drives TV host screen, interlocking brass gear timers, Solari split-flap cards,
// rotary odometer scores, custom looping BGM and bespoke SFX.
import * as audio from '/sdk/audio.js';
import { WORDS } from './words.js';
import { robot, injectCss, BOT_CSS, gearsSvg } from './art.js';

const TURN_TIME = 60;         // seconds per turn
const READY_TIME = 20;        // clue-giver has this long to press Start
const GLITCH_GRACE = 1500;    // ms: a glitch right after a new card counts against the card before it
const TEAMS = [
  { name: 'Bolts', color: '#ffb84d' },
  { name: 'Sprockets', color: '#4dd8ff' },
];
const RULES = [
  'Words of one syllable only: "big", "red", "goes", "on top of".',
  'No part of the word itself, and no "sounds like".',
  'Gestures are fine. Slip up and the other team hits BZZT: minus one point.',
];

export default async function (ctx) {
  const { h } = ctx;
  injectCss('tin-tongue-css', BOT_CSS + CSS);

  // ---------- Audio Subsystem ----------
  ctx.music(null); // Mute generic platform music
  let bgm = null;
  try {
    bgm = new Audio(ctx.asset('audio/bg_main.ogg'));
    bgm.loop = true;
    bgm.volume = audio.getMusicVol() * 0.7;
    if (!audio.isMuted()) {
      bgm.play().catch(() => {});
    }
  } catch (e) {}

  function playSfx(name, vol = 0.7) {
    if (audio.isMuted()) return;
    try {
      ctx.playSfx(`audio/${name}.wav`, vol);
    } catch (e) {}
  }

  try {
    const people = ctx.shuffle(ctx.connected);
    if (people.length < 4) {
      return ctx.say('Not enough players', 'Tin Tongue needs at least 4 people: two teams of two.', 5000);
    }
    const teams = TEAMS.map((t, i) => ({
      ...t, i, members: people.filter((_, k) => k % 2 === i), score: 0, next: 0, best: null,
    }));
    const teamOf = new Map();
    for (const t of teams) for (const p of t.members) teamOf.set(p.id, t);
    const bot = (color, mood, cls = '') => {
      const d = h('div.tt-botwrap' + cls);
      d.innerHTML = robot(color, mood);
      return d;
    };

    let deck = ctx.shuffle(WORDS);
    const draw = () => {
      if (!deck.length) deck = ctx.shuffle(WORDS);
      return deck.pop();
    };

    // One message handler for the whole game; it forwards to the turn in play.
    let turn = null;
    ctx.on('message', (p, data) => turn?.(p, data?.kind === 'choice' ? data.value : data));

    // ---------- intro ----------
    ctx.el.replaceChildren(h('div.tt-intro',
      h('div.tt-draft-header',
        h('span.tt-patent-no', 'PATENT SPEC. NO. 1954-TT'),
        h('span.tt-patent-title', 'ELECTRO-MECHANICAL VOICE-CHIP CALIBRATOR')),
      h('h1.tt-title', 'Tin ', h('span', 'Tongue')),
      h('p.tt-tag', 'Your voice chip only does one-syllable words.'),
      h('div.tt-teams', teams.map((t) => h('div.tt-team', { style: { '--tc': t.color } },
        bot(t.color, 'idle'),
        h('h2', t.name),
        h('div.tt-roster', t.members.map((p) => h('span', p.name)))))),
      h('ol.tt-rules', RULES.map((r) => h('li', r)))));
    for (const t of teams) {
      ctx.show(t.members, {
        title: `You're a ${t.name.slice(0, -1)}!`,
        text: `Team ${t.name}: ${t.members.map((p) => p.name).join(', ')}\n\n${RULES.join('\n')}`,
        color: t.color, buzz: true,
      });
    }
    await ctx.sleep(12000);

    // ---------- turns ----------
    const rounds = Math.max(...teams.map((t) => t.members.length));
    for (let r = 0; r < rounds; r++) {
      for (const t of teams) {
        const giver = nextGiver(t);
        if (!giver) continue;
        await playTurn(t, giver, `Turn ${r + 1} of ${rounds}`);
      }
    }

    // ---------- final ----------
    const [a, b] = teams;
    const tie = a.score === b.score;
    const win = a.score > b.score ? a : b;
    const stars = teams.map((t) => t.best).filter(Boolean).sort((x, y) => y.pts - x.pts);
    ctx.show('all', { title: 'Game over!', wait: tie ? 'A tie! Back to the lobby soon…' : `The ${win.name} win! Back to the lobby soon…` });
    ctx.el.replaceChildren(h('div.tt-final',
      h('h1', tie ? 'A dead heat!' : `The ${win.name} win!`),
      h('div.tt-teams', teams.map((t) => h('div.tt-team' + (!tie && t === win ? '.tt-win' : ''), { style: { '--tc': t.color } },
        bot(t.color, tie || t === win ? 'happy' : 'glitch'),
        h('h2', t.name), h('div.tt-big', t.score)))),
      stars[0] && stars[0].pts > 0 && h('p.tt-star', `Smoothest talker: ${stars[0].p.name}, ${stars[0].pts} points in one turn`)));
    playSfx('tin_chime', 0.9);
    ctx.sfx?.('win');
    await ctx.sleep(10000);

    function nextGiver(t) {
      for (let k = 0; k < t.members.length; k++) {
        const p = t.members[t.next++ % t.members.length];
        if (ctx.player(p.id)?.connected) return p;
      }
      return null;
    }

    async function playTurn(team, giver, label) {
      const other = teams[1 - team.i];
      const guessers = team.members.filter((p) => p.id !== giver.id);

      // Get ready
      playSfx('windup_ratchet', 0.85);
      ctx.el.replaceChildren(h('div.tt-ready', { style: { '--tc': team.color } },
        h('p.tt-label', label),
        bot(team.color, 'idle'),
        h('h1', h('span', giver.name), ' is up for the ', team.name),
        h('p.tt-sub', `${other.name}: you'll see the word too. Listen for slips!`),
        scoreRow()));
      ctx.show(team.members.filter((p) => p.id !== giver.id), { title: 'Get ready to guess!', wait: `${giver.name} is about to give clues.`, color: team.color });
      ctx.show(other.members, { title: 'Get ready to listen', wait: `You'll see ${giver.name}'s word. Hit BZZT on any slip.`, color: other.color });
      await ctx.ask(giver, {
        title: 'You\'re up!',
        text: `Hide your screen from your team. You have ${TURN_TIME} seconds.\n\n${RULES[0]}`,
        choices: ['Start'], color: team.color, buzz: true,
      }, { timeout: READY_TIME, clock: false, after: { wait: 'Here we go…', color: team.color } });

      // TV layout with Interlocking Brass Gears and Solari Display
      const timer = h('div.tt-timer');
      const ring = h('div.tt-ring');
      ring.innerHTML = gearsSvg();
      ring.append(timer);

      const tally = h('div.tt-tally');
      const last = h('div.tt-last');
      const face = h('div.tt-face');
      const setFace = (mood) => { face.replaceChildren(bot(team.color, mood)); };
      const scores = h('div.tt-scorewrap', scoreRow());
      ctx.el.replaceChildren(h('div.tt-turn', { style: { '--tc': team.color } },
        h('div.tt-turnhead', h('p.tt-label', label), h('h2', h('span', giver.name), ' clues for the ', team.name)),
        h('div.tt-mid', face, ring, h('div.tt-side', tally, last)),
        scores));
      setFace('talk');

      const log = [];
      let card = null, dealtAt = 0, moodTimer = null;
      const endAt = Date.now() + TURN_TIME * 1000;
      const mood = (m) => { setFace(m); clearTimeout(moodTimer); moodTimer = ctx.setTimeout(() => setFace('talk'), 1300); };
      const refresh = () => {
        const got = log.filter((c) => c.result === 'got');
        const net = log.reduce((s, c) => s + (c.result === 'got' ? c.points : c.result === 'glitch' ? -1 : 0), 0);
        tally.replaceChildren(
          h('div.tt-odometer-box',
            h('span.tt-odometer-label', 'NET TALLY'),
            h('div.tt-odometer', h('b', net), ` point${Math.abs(net) === 1 ? '' : 's'}`)),
          h('div.tt-small', `✓ ${got.length}   ↷ ${log.filter((c) => c.result === 'skip').length}   ⚡ ${log.filter((c) => c.result === 'glitch').length}`));
        scores.replaceChildren(scoreRow());
      };
      const showLast = (c) => {
        const txt = c.result === 'got' ? [`✓ ${c.word}`, `+${c.points}`]
          : c.result === 'skip' ? [`↷ ${c.word}`, 'skipped']
            : [`⚡ ${c.word}`, `BZZT from ${c.by.name}  −1`];
        const cardEl = h('div.tt-solari.tt-lastcard.tt-' + c.result,
          h('div.tt-solari-flap.tt-solari-top', h('span', txt[0])),
          h('div.tt-solari-hinge'),
          h('div.tt-solari-flap.tt-solari-bottom', h('span', txt[0])),
          h('div.tt-solari-sub', txt[1]));
        cardEl.classList.add('flip-in');
        last.replaceChildren(cardEl);
      };
      const views = (flash) => {
        const left = Math.max(1, Math.round((endAt - Date.now()) / 1000));
        ctx.show(giver, {
          tt: 'give', word: card.word, points: card.points, syllables: card.syllables, card: card.id, left, flash,
          team: team.name, color: team.color, buzz: !!flash,
          title: card.word.toUpperCase(), text: `${card.points} point${card.points > 1 ? 's' : ''}. One-syllable words only!`,
          choices: [{ label: '✅ Got it', value: { tt: 'got', card: card.id } }, { label: '↷ Skip', value: { tt: 'skip', card: card.id } }],
        });
        ctx.show(other.members, {
          tt: 'watch', word: card.word, points: card.points, card: card.id, left, giver: giver.name, color: other.color,
          title: `${giver.name} is cluing: ${card.word.toUpperCase()}`, text: 'Tap BZZT on any word with 2+ syllables, or any part of the word.',
          choices: [{ label: '⚡ BZZT!', value: { tt: 'glitch', card: card.id } }],
        });
        ctx.show(guessers, { tt: 'guess', left, giver: giver.name, title: 'Guess out loud!', wait: `${giver.name} is giving clues.`, color: team.color });
      };
      const deal = (flash) => {
        card = { id: (card?.id || 0) + 1, ...draw() };
        dealtAt = Date.now();
        playSfx('split_flap_clatter', 0.65);
        views(flash);
      };

      turn = (p, d) => {
        if (!p || !d || !d.tt || !card || Date.now() >= endAt) return;
        const now = Date.now();
        if (d.tt === 'got' || d.tt === 'skip') {
          if (p.id !== giver.id || d.card !== card.id) return;
          const c = { ...card, result: d.tt, at: now };
          log.push(c);
          if (c.result === 'got') {
            team.score += c.points;
            mood('happy');
            playSfx('tin_chime', 0.8);
            ctx.sfx?.('ding');
          } else {
            ctx.sfx?.('whoosh');
          }
          showLast(c); refresh(); deal();
        } else if (d.tt === 'glitch') {
          if (teamOf.get(p.id) !== other) return;
          const prev = log.at(-1);
          if (d.card === card.id && now - dealtAt >= GLITCH_GRACE) {
            // A slip on the card in play: it's lost.
            const c = { ...card, result: 'glitch', by: p, at: now };
            log.push(c);
            team.score -= 1;
            mood('glitch');
            playSfx('spring_boing_klaxon', 0.9);
            ctx.sfx?.('glitch');
            showLast(c); refresh(); deal({ by: p.name });
          } else if (prev && prev.result !== 'glitch' && now - prev.at < GLITCH_GRACE + 1500
            && (d.card === prev.id || d.card === card.id)) {
            // They slipped right before Got it / Skip: the card before loses its points.
            if (prev.result === 'got') team.score -= prev.points;
            prev.result = 'glitch'; prev.by = p;
            team.score -= 1;
            mood('glitch');
            playSfx('spring_boing_klaxon', 0.9);
            ctx.sfx?.('glitch');
            showLast(prev); refresh(); views({ by: p.name, late: true });
          }
        }
      };

      ctx.sfx?.('start');
      deal();
      refresh();
      let lastS = TURN_TIME + 1;
      while (Date.now() < endAt) {
        const s = Math.ceil((endAt - Date.now()) / 1000);
        if (s !== lastS && s <= 10) ctx.sfx?.(s % 2 ? 'tick' : 'tock');
        lastS = s;
        timer.textContent = s;
        ring.style.setProperty('--p', `${(s / TURN_TIME) * 100}%`);
        ring.classList.toggle('tt-urgent', s <= 10);
        await ctx.sleep(100);
      }
      turn = null;
      clearTimeout(moodTimer);
      ctx.sfx?.('timeup');
      if (card) log.push({ ...card, result: 'timeout' });

      // Recap screen with Solari cards
      const pts = log.reduce((s, c) => s + (c.result === 'got' ? c.points : c.result === 'glitch' ? -1 : 0), 0);
      const gotPts = log.filter((c) => c.result === 'got').reduce((s, c) => s + c.points, 0);
      if (!team.best || gotPts > team.best.pts) team.best = { p: giver, pts: gotPts };
      ctx.show('all', { title: 'Time!', wait: 'Look at the TV for the recap.', buzz: true });
      ctx.el.replaceChildren(h('div.tt-recap', { style: { '--tc': team.color } },
        h('h1', 'Time!'),
        h('p.tt-sub', `${giver.name} scored ${pts >= 0 ? '+' : ''}${pts} for the ${team.name}`),
        h('div.tt-cards', log.length ? log.map((c, i) => h('div.tt-rcard.tt-' + c.result, { style: { '--i': i } },
          h('div.tt-rword', c.word),
          h('div.tt-small', c.result === 'got' ? `+${c.points}` : c.result === 'skip' ? 'skipped'
            : c.result === 'glitch' ? `⚡ ${c.by.name} −1` : 'out of time')))
          : h('p.tt-sub', 'No cards. The robot froze up!')),
        scoreRow()));
      await ctx.sleep(Math.min(14000, 6000 + log.length * 700));
    }

    function scoreRow() {
      return h('div.tt-scores', teams.map((t) => h('div.tt-score', { style: { '--tc': t.color } },
        h('span.tt-odometer-name', t.name),
        h('div.tt-odometer-drum', h('b', t.score)))));
    }
  } finally {
    if (bgm) {
      bgm.pause();
      bgm.removeAttribute('src');
      bgm = null;
    }
  }
}

const CSS = `
  /* Prussian Cyanotype Blueprint Drafting Grid */
  .tt-intro, .tt-ready, .tt-turn, .tt-recap, .tt-final {
    width: 100%;
    max-width: 1500px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2.2vh;
    background: #09233b;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px),
      linear-gradient(rgba(100, 200, 255, 0.12) 2px, transparent 2px),
      linear-gradient(90deg, rgba(100, 200, 255, 0.12) 2px, transparent 2px);
    background-size: 20px 20px, 20px 20px, 100px 100px, 100px 100px;
    border: 4px solid #1a4f78;
    box-shadow: inset 0 0 100px rgba(0, 10, 25, 0.8), 0 10px 40px rgba(0, 0, 0, 0.6);
    border-radius: 12px;
    padding: 3vh 2vw;
    position: relative;
    box-sizing: border-box;
    font-family: 'Share Tech Mono', 'Oswald', monospace;
  }

  .tt-draft-header {
    display: flex;
    justify-content: space-between;
    width: 100%;
    border-bottom: 2px dashed rgba(100, 200, 255, 0.35);
    padding-bottom: 8px;
    font-size: 0.85em;
    color: #64b5f6;
    letter-spacing: 0.15em;
  }

  .tt-title {
    font-family: 'Oswald', sans-serif;
    font-size: 4.8em;
    font-weight: 900;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin: 0;
    color: #faf5eb;
    text-shadow: 3px 3px 0 #0d1f30, 0 0 20px rgba(255, 184, 77, 0.4);
  }
  .tt-title span { color: var(--accent); }

  .tt-tag, .tt-sub {
    color: #90caf9;
    font-size: 1.3em;
    letter-spacing: 0.04em;
    margin: 0;
  }
  .tt-label {
    color: #64b5f6;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    font-weight: 700;
    margin: 0;
  }

  .tt-teams { display: flex; gap: 4vw; justify-content: center; flex-wrap: wrap; }

  /* Brushed Tin-Plate Cards with Stamped Brass Rivets */
  .tt-team {
    background: linear-gradient(135deg, #abb5bf 0%, #dbe3eb 45%, #929ea9 80%, #c4cbd3 100%);
    border: 4px solid #6b7784;
    border-radius: 14px;
    box-shadow:
      inset 2px 2px 0 rgba(255, 255, 255, 0.7),
      inset -2px -2px 0 rgba(0, 0, 0, 0.5),
      0 12px 24px rgba(0, 0, 0, 0.5);
    position: relative;
    color: #121e29;
    padding: 2.5vh 3vw;
    min-width: 16em;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6em;
  }

  /* Stamped Brass Corner Rivets */
  .tt-team::before, .tt-team::after {
    content: '';
    position: absolute;
    width: 12px;
    height: 12px;
    background: radial-gradient(circle at 35% 35%, #fff1a8, #d4af37 60%, #735914 100%);
    border-radius: 50%;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  }
  .tt-team::before { top: 10px; left: 10px; }
  .tt-team::after { top: 10px; right: 10px; }

  .tt-team h2 {
    font-family: 'Oswald', sans-serif;
    color: #121e29;
    font-size: 2em;
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    text-shadow: 1px 1px 0 rgba(255, 255, 255, 0.8);
  }
  .tt-team.tt-win {
    box-shadow: 0 0 60px rgba(255, 184, 77, 0.8);
    border-color: #d4af37;
  }
  .tt-roster {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4em 0.8em;
    justify-content: center;
    font-weight: 700;
    color: #1a2632;
  }
  .tt-botwrap .tt-bot { width: 8.5em; height: auto; }

  .tt-rules {
    text-align: left;
    font-size: 1.18em;
    max-width: 48em;
    margin: 0;
    padding: 18px 24px 18px 40px;
    background: rgba(10, 35, 60, 0.7);
    border: 2px dashed rgba(100, 200, 255, 0.4);
    border-radius: 8px;
    color: #e0f2fe;
  }
  .tt-rules li { margin: 0.4em 0; }

  .tt-ready h1, .tt-turnhead h2 { margin: 0; }
  .tt-ready h1 span, .tt-turnhead h2 span { color: var(--tc); }
  .tt-ready h1 { font-size: 2.6em; color: #faf5eb; }
  .tt-turnhead h2 { font-size: 2em; color: #faf5eb; }

  .tt-mid {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 4vw;
    width: 100%;
  }
  .tt-face { justify-self: end; }
  .tt-face .tt-bot { width: 11.5em; height: auto; }

  /* Interlocking Gear Timer Ring */
  .tt-ring {
    --p: 100%;
    width: 15em;
    height: 15em;
    border-radius: 50%;
    display: grid;
    place-items: center;
    position: relative;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8);
  }
  .tt-timer {
    width: 72%;
    height: 72%;
    border-radius: 50%;
    background: #09233b;
    border: 4px solid #d4af37;
    box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.9);
    display: grid;
    place-items: center;
    font-family: 'Share Tech Mono', monospace;
    font-size: 4.8em;
    font-weight: 900;
    color: #faf5eb;
    z-index: 2;
    font-variant-numeric: tabular-nums;
  }
  .tt-ring.tt-urgent .tt-timer {
    color: #ff3344;
    border-color: #ff3344;
    text-shadow: 0 0 20px #ff3344;
  }

  .tt-side {
    justify-self: start;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 1.2em;
    min-width: 14em;
  }

  /* Rotary Drum Odometer Tally */
  .tt-tally { font-size: 1.2em; }
  .tt-odometer-box {
    background: #061828;
    border: 3px solid #d4af37;
    border-radius: 6px;
    padding: 10px 16px;
    box-shadow: inset 0 6px 12px rgba(0, 0, 0, 0.9), 0 4px 8px rgba(0, 0, 0, 0.5);
  }
  .tt-odometer-label {
    display: block;
    font-size: 0.65em;
    letter-spacing: 0.15em;
    color: #90caf9;
  }
  .tt-odometer b {
    font-family: 'Share Tech Mono', monospace;
    font-size: 2.2em;
    color: var(--tc);
    font-variant-numeric: tabular-nums;
  }
  .tt-small {
    font-size: 0.85em;
    color: #90caf9;
    font-weight: 700;
    margin-top: 6px;
    white-space: pre;
  }

  /* Solari Split-Flap Last Card Display */
  .tt-lastcard {
    min-width: 12em;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.8);
  }
  .tt-solari-sub {
    font-size: 0.75em;
    color: #90caf9;
    text-align: center;
    padding: 4px;
    background: #091a2a;
    border-bottom-left-radius: 6px;
    border-bottom-right-radius: 6px;
  }
  .tt-lastcard.tt-got .tt-solari-flap { color: #5df08a; }
  .tt-lastcard.tt-glitch .tt-solari-flap { color: #ff3344; }

  /* Scores Row: Rotary Odometers */
  .tt-scores { display: flex; gap: 3vw; justify-content: center; }
  .tt-score {
    display: flex;
    align-items: center;
    gap: 12px;
    background: linear-gradient(135deg, #abb5bf 0%, #dbe3eb 50%, #929ea9 100%);
    border: 3.5px solid #6b7784;
    border-radius: 8px;
    padding: 8px 18px;
    box-shadow: inset 1px 1px 0 #fff, 0 6px 16px rgba(0, 0, 0, 0.6);
    color: #121e29;
  }
  .tt-odometer-name {
    font-family: 'Oswald', sans-serif;
    font-size: 1.4em;
    font-weight: 700;
    text-transform: uppercase;
    color: #121e29;
  }
  .tt-odometer-drum {
    background: #061828;
    border: 2px solid #d4af37;
    border-radius: 4px;
    padding: 4px 12px;
    box-shadow: inset 0 4px 8px rgba(0, 0, 0, 0.9);
  }
  .tt-odometer-drum b {
    font-family: 'Share Tech Mono', monospace;
    font-size: 1.8em;
    color: var(--tc);
    font-variant-numeric: tabular-nums;
  }

  /* Recap Screen */
  .tt-recap h1 {
    font-family: 'Oswald', sans-serif;
    font-size: 3.8em;
    margin: 0;
    color: var(--tc);
    text-transform: uppercase;
  }
  .tt-cards { display: flex; flex-wrap: wrap; gap: 14px; justify-content: center; max-width: 1300px; }
  .tt-rcard {
    background: #121820;
    border: 2.5px solid #2d3b48;
    border-radius: 6px;
    padding: 10px 16px;
    min-width: 7.5em;
    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.7);
    animation: tt-solari-drop 0.4s cubic-bezier(0.2, 0.8, 0.3, 1) backwards;
    animation-delay: calc(var(--i, 0) * 70ms);
  }
  .tt-rword {
    font-family: 'Share Tech Mono', monospace;
    font-size: 1.4em;
    font-weight: 900;
    text-transform: uppercase;
    color: #faf5eb;
  }
  .tt-rcard.tt-got { border-color: #5df08a; }
  .tt-rcard.tt-got .tt-rword { color: #5df08a; }
  .tt-rcard.tt-glitch { border-color: #ff3344; }
  .tt-rcard.tt-glitch .tt-rword { color: #ff3344; }
  .tt-rcard.tt-skip, .tt-rcard.tt-timeout { opacity: 0.55; }

  .tt-final h1 {
    font-family: 'Oswald', sans-serif;
    font-size: 4em;
    margin: 0;
    color: #faf5eb;
    text-transform: uppercase;
  }
  .tt-big {
    font-family: 'Share Tech Mono', monospace;
    font-size: 3.2em;
    font-weight: 900;
    color: #061828;
  }
  .tt-star {
    font-size: 1.3em;
    color: #90caf9;
    margin: 0;
  }
`;
