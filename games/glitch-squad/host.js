// Glitch Squad: CRT Vaporwave & Glitch Terminal host controller.
// Everyone gets the secret word except the Glitch. Each player gives a one-word clue,
// the squad votes on who the Glitch is, and a caught Glitch gets one last chance to guess the word.

import { CATEGORIES } from './words.js';
import { CSS, ransom, terminalText, paperCard, terminalCard, glitchReveal, crtOverlays, CRT_COLORS } from './crt.js';

const CLUE_TIME = 60;
const TALK_TIME = 40;
const VOTE_TIME = 30;
const GUESS_TIME = 25;

export default async function (ctx) {
  const { h } = ctx;
  installCss();
  const frame = ctx.el.parentElement;
  frame.classList.add('gs-crt', 'gs-paper');

  // Inject CRT HUD overlays once
  if (!frame.querySelector('.gs-crt-overlay')) {
    frame.append(...crtOverlays(h));
  }

  // --- Audio Engine ---
  let bgm = null;
  function startBgm() {
    if (bgm) return;
    try {
      ctx.music(null); // Mute generic platform synthesizer
      bgm = new Audio(ctx.asset('audio/bg_main.ogg'));
      bgm.loop = true;
      const isMuted = () => {
        try { return localStorage.getItem('partyhall.muted') === '1'; } catch { return false; }
      };
      bgm.volume = isMuted() ? 0 : 0.35;
      bgm.play().catch(() => {});
    } catch (e) {
      console.warn('BGM load error:', e);
    }
  }

  function stopBgm() {
    if (!bgm) return;
    try {
      bgm.pause();
      bgm.currentTime = 0;
      bgm = null;
    } catch {}
  }

  function playSfx(name, vol = 0.8) {
    try {
      if (localStorage.getItem('partyhall.muted') === '1') return;
      ctx.playSfx(`audio/${name}.wav`, vol);
    } catch {
      // Graceful fallback to platform synthesizer
      if (name === 'crt_degauss') ctx.sfx('whoosh');
      else if (name === 'modem_chirp') ctx.sfx('pop');
      else if (name === 'bitcrush_glitch') ctx.sfx('glitch');
      else if (name === 'terminal_click') ctx.sfx('tick');
    }
  }

  try {
    startBgm();
    playSfx('crt_degauss');

    const score = new Map(ctx.players.map((p) => [p.id, 0]));
    const add = (id, n) => score.set(id, (score.get(id) || 0) + n);
    let glitchPool = [];
    let cats = ctx.shuffle(Object.keys(CATEGORIES));
    const rounds = Math.min(3, ctx.connected.length);

    ctx.show('all', { title: 'Glitch Squad', wait: 'Look at the big screen!' });
    await title(ctx, 'Glitch Squad', 'One of you is a Glitch. Everyone else knows the secret word.', 4500);

    for (let round = 1; round <= rounds; round++) {
      const players = ctx.connected;
      if (players.length < 3) return ctx.say('Not enough players', 'Glitch Squad needs at least 3 people.', 5000);
      if (!glitchPool.length) glitchPool = ctx.shuffle(players.map((p) => p.id));
      let glitchId = glitchPool.pop();
      if (!players.some((p) => p.id === glitchId)) glitchId = ctx.pick(players).id;
      const glitch = ctx.player(glitchId);
      const squad = players.filter((p) => p.id !== glitchId);
      if (!cats.length) cats = ctx.shuffle(Object.keys(CATEGORIES));
      const category = cats.pop();
      const word = ctx.pick(CATEGORIES[category]);

      // --- secret + clues ---
      ctx.music(null);
      playSfx('crt_degauss');
      await title(ctx, `Round ${round}`, `Category: ${category}`, 3000);

      const done = new Set();
      const writing = () => ctx.el.replaceChildren(
        h('div.gs-banner', terminalText(h, `// ${category.toUpperCase()}`)),
        h('p.gs-note', '> AWAITING CLUE TRANSMISSIONS FROM SQUAD NODES... ', h('span.gs-cursor')),
        h('div.gs-board', players.map((p, i) => paperCard(h, i, p.name,
          done.has(p.id) ? '[✓ CLUE_LOCKED]' : '[...WAITING]', done.has(p.id) ? '' : '.gs-dim'))));
      writing();

      const onAnswer = (p) => {
        done.add(p.id);
        playSfx('terminal_click');
        writing();
        const cards = ctx.el.querySelectorAll('.gs-card');
        const idx = players.findIndex((q) => q.id === p.id);
        if (cards[idx]) {
          cards[idx].classList.add('gs-jitter');
          ctx.setTimeout(() => cards[idx].classList.remove('gs-jitter'), 280);
        }
      };

      const after = { title: 'Clue locked in', wait: 'Look at the big screen!' };
      const clueInput = { placeholder: 'One word', max: 24, submit: 'Lock it in' };
      const stop = ctx.clock(CLUE_TIME);
      const [sq, gl] = await Promise.all([
        ctx.ask(squad, {
          title: `Secret word: ${word}`,
          text: `Category: ${category}\nGive a clue that proves you know it, but don't make it easy for the Glitch.`,
          input: clueInput,
        }, { timeout: CLUE_TIME, clock: false, after, onAnswer }),
        ctx.ask(glitch, {
          title: '⚡ You are the GLITCH ⚡',
          text: `Category: ${category}\nYou don't know the secret word. Write a clue that blends in!`,
          color: '#7b3fe4', buzz: true,
          input: clueInput,
        }, { timeout: CLUE_TIME, clock: false, after, onAnswer }),
      ]);
      stop();
      const clues = new Map([...sq, ...gl].map(([id, c]) => [id, oneWord(c)]));

      // --- reveal clues and talk ---
      ctx.show('all', { title: 'Who is the Glitch?', wait: 'Read the clues and argue it out!' });
      const order = ctx.shuffle(players);
      const board = h('div.gs-board');
      ctx.el.replaceChildren(h('div.gs-banner', terminalText(h, `// ${category.toUpperCase()}`)), board);
      for (const [i, p] of order.entries()) {
        board.append(paperCard(h, i, clues.get(p.id) || '(silence)', p.name, '.gs-big'));
        playSfx('modem_chirp');
        ctx.sfx('pop');
        await ctx.sleep(900);
      }
      ctx.el.append(h('p.gs-note', '> ANALYZE ANOMALIES. WHOSE PACKET DOES NOT BELONG? ', h('span.gs-cursor')));
      await ctx.countdown(TALK_TIME);

      // --- vote ---
      const votes = new Map();
      const voted = new Set();
      ctx.music(null);
      const tally = h('p.gs-note', '[VOTING CHANNEL ACTIVE: SUBMIT ANOMALOUS NODE ID]');
      ctx.el.lastChild.replaceWith(tally);
      const stopVote = ctx.clock(VOTE_TIME);
      await Promise.all(players.map((p) => ctx.ask(p, {
        title: 'Who is the Glitch?',
        choices: players.filter((q) => q.id !== p.id).map((q) => ({
          label: `${q.name}: “${clues.get(q.id) || '…'}”`, value: q.id,
        })),
      }, {
        timeout: VOTE_TIME, clock: false, after: { wait: 'Vote logged. Waiting for squad...' },
        onAnswer: (_, v) => {
          votes.set(p.id, v);
          voted.add(p.id);
          playSfx('terminal_click');
          tally.textContent = `[TRANSMISSIONS: ${voted.size} / ${players.length} VOTES LOGGED]`;
          tally.classList.add('gs-jitter');
          ctx.setTimeout(() => tally.classList.remove('gs-jitter'), 250);
        },
      })));
      stopVote();

      const counts = new Map();
      for (const v of votes.values()) counts.set(v, (counts.get(v) || 0) + 1);
      const top = Math.max(0, ...counts.values());
      const leaders = [...counts].filter(([, n]) => n === top).map(([id]) => id);
      const accused = leaders.length === 1 && top > 0 ? ctx.player(leaders[0]) : null;
      const caught = accused?.id === glitchId;

      // --- verdict ---
      ctx.el.replaceChildren(
        h('div.gs-banner', terminalText(h, accused ? `Target: ${accused.name}` : 'Vote Parity Error!')),
        h('div.gs-board', players.map((p, i) => paperCard(h, i, p.name,
          `${counts.get(p.id) || 0} vote${counts.get(p.id) === 1 ? '' : 's'}`, p.id === accused?.id ? '.gs-accused' : ''))));
      playSfx('modem_chirp');
      ctx.sfx('ding');
      await ctx.sleep(3500);

      let guessed = false;
      if (caught) {
        ctx.el.replaceChildren(
          glitchReveal(h, glitch.name),
          h('p.gs-note', `Glitch caught! But the intruder attempts a decrypt override...`));
        playSfx('bitcrush_glitch', 1.0);
        ctx.sfx('glitch');
        const options = ctx.shuffle([word, ...ctx.shuffle(CATEGORIES[category].filter((w) => w !== word)).slice(0, 5)]);
        squad.forEach((p) => ctx.show(p, { title: 'Glitch caught!', wait: `${glitch.name} is guessing the word…` }));
        const g = await ctx.ask(glitch, {
          title: 'Last chance!', text: `Category: ${category}\nWhich one is the secret word?`,
          color: '#7b3fe4', choices: options,
        }, { timeout: GUESS_TIME, after: { wait: 'Guess locked in…' } });
        guessed = g.get(glitchId) === word;
        ctx.el.lastChild.replaceWith(h('p.gs-note', `${glitch.name} guessed “${g.get(glitchId) ?? 'nothing'}”`));
        await ctx.sleep(2500);
      } else {
        ctx.el.replaceChildren(
          glitchReveal(h, glitch.name),
          h('p.gs-note', accused ? `${accused.name} was innocent. The Glitch escaped!` : 'Nobody was voted out. The Glitch escaped!'));
        playSfx('bitcrush_glitch', 1.0);
        ctx.sfx('glitch');
        await ctx.sleep(3500);
      }

      // --- score ---
      let headline;
      if (caught && !guessed) {
        headline = 'Squad wins!';
        for (const p of squad) add(p.id, 100 + (votes.get(p.id) === glitchId ? 100 : 0));
      } else if (caught && guessed) {
        headline = 'The Glitch stole it!';
        add(glitchId, 250);
        for (const p of squad) if (votes.get(p.id) === glitchId) add(p.id, 50);
      } else {
        headline = 'The Glitch escaped!';
        add(glitchId, 300);
      }
      playSfx(caught && !guessed ? 'modem_chirp' : 'bitcrush_glitch');
      ctx.sfx(caught && !guessed ? 'win' : 'lose');
      ctx.show('all', { title: headline, text: `The secret word was “${word}”.`, wait: 'Next round soon…' });
      ctx.el.replaceChildren(
        h('div.gs-banner', terminalText(h, headline)),
        h('div.gs-word', h('span', 'The secret word was'), h('strong', word)));
      await ctx.sleep(4500);
      await scoreboard(ctx, score, round === rounds ? 'Final scores' : `After round ${round}`);
    }

    const best = Math.max(...score.values());
    const winners = ctx.players.filter((p) => score.get(p.id) === best).map((p) => p.name);
    ctx.show('all', { title: 'Game over!', text: `${winners.join(' & ')} won.`, wait: 'Back to the lobby soon…' });
    stopBgm();
    ctx.music('party');
    ctx.sfx('win');
    await title(ctx, `${winners.join(' & ')} wins!`, 'Thanks for playing Glitch Squad', 8000);
  } finally {
    stopBgm();
  }
}

function oneWord(s) {
  const w = String(s || '').trim().split(/\s+/)[0] || '';
  return w.slice(0, 24);
}

async function title(ctx, big, sub, ms) {
  const { h } = ctx;
  ctx.el.classList.remove('gs-beam-wipe');
  void ctx.el.offsetWidth;
  ctx.el.classList.add('gs-beam-wipe');
  ctx.el.replaceChildren(h('div.gs-title', terminalText(h, big), h('span.gs-cursor')), sub && h('p.gs-sub', `> ${sub}`));
  await ctx.sleep(ms);
}

async function scoreboard(ctx, score, heading) {
  const { h } = ctx;
  const rows = ctx.players.map((p) => ({ p, s: score.get(p.id) || 0 })).sort((a, b) => b.s - a.s);
  ctx.el.replaceChildren(
    h('div.gs-banner', terminalText(h, heading)),
    h('div.gs-scores', rows.map(({ p, s }, i) => h('div.gs-srow', {
      style: { '--paper': CRT_COLORS[i % CRT_COLORS.length] },
    },
      h('span.gs-rank', `#0${i + 1}`),
      h('span.gs-sname', p.name),
      h('span.gs-spts', `${s} PTS`)
    )))
  );
  await ctx.sleep(6500);
}

function installCss() {
  document.getElementById('glitch-squad-css')?.remove();
  document.head.append(Object.assign(document.createElement('style'), { id: 'glitch-squad-css', textContent: CSS }));
}
