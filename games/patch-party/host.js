// Patch Party: design embroidered jacket patches together.
//  1. Everyone draws two patch designs.
//  2. Everyone writes three short mottos.
//  3. Everyone gets a random handful of other people's designs and mottos,
//     and stitches the best combination into a patch.
//  4. All the patches go up on the TV and everyone votes for two favourites.
//   Per vote: +300 to whoever stitched it, +200 to the artist, +200 to the motto writer.

const DRAW_TIME = 100;
const MOTTO_TIME = 60;
const STITCH_TIME = 45;
const VOTE_TIME = 30;
const HAND = 3;

const MOTTO_PROMPTS = [
  'A motto for a club that meets in a cupboard',
  'Something your grandma would stitch on a jacket',
  'A slogan for the world\'s laziest sports team',
  'Words to live by, but wrong',
  'A motto for people who are always late',
  'What a pigeon would put on its jacket',
  'A warning label for yourself',
  'The motto of a very nervous pirate crew',
  'A slogan for a snack that is mostly air',
];

class PatchAudio {
  constructor(ctx) {
    this.ctx = ctx;
    this.bgm = null;
  }
  isMuted() {
    try {
      return localStorage.getItem('partyhall.muted') === '1';
    } catch {
      return false;
    }
  }
  startBgm() {
    try {
      this.ctx.music(null);
      if (!this.bgm) {
        this.bgm = new Audio(this.ctx.asset('audio/bg_main.ogg'));
        this.bgm.loop = true;
        this.bgm.volume = this.isMuted() ? 0 : 0.35;
      }
      if (!this.isMuted()) {
        this.bgm.play().catch(() => {});
      }
    } catch (e) {
      console.warn('PatchAudio BGM error:', e);
    }
  }
  stopBgm() {
    if (this.bgm) {
      try {
        this.bgm.pause();
        this.bgm.currentTime = 0;
        this.bgm = null;
      } catch {}
    }
  }
  sfx(file, vol = 0.75) {
    if (this.isMuted()) return;
    try {
      const a = new Audio(this.ctx.asset(`audio/${file}`));
      a.volume = vol;
      a.play().catch(() => {});
    } catch {}
  }
}

// Shrink a drawing so several fit in one message to a phone.
function shrink(url, size = 300) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = Object.assign(document.createElement('canvas'), { width: size, height: size });
      c.getContext('2d').drawImage(img, 0, 0, size, size);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(url);
    img.src = url;
  });
}

export default async function (ctx) {
  const { h } = ctx;
  installCss();
  const snd = new PatchAudio(ctx);

  const score = new Map(ctx.players.map((p) => [p.id, 0]));
  const add = (id, n) => score.set(id, (score.get(id) || 0) + n);
  const players = ctx.connected;
  if (players.length < 3) return ctx.say('Not enough players', 'Patch Party needs at least 3 people.', 5000);

  try {
    snd.startBgm();
    ctx.el.classList.add('pp-stage');

    await ctx.say('Patch Party', 'Draw patches, write mottos, stitch them together.', 3500);
    const done = new Set();
    const board = (title, sub) => ctx.el.replaceChildren(
      h('h1', title),
      sub && h('p.pp-dim', sub),
      h('div.chips', players.map((p) => h('div.chip' + (done.has(p.id) ? '' : '.away'),
        { style: { '--c': p.color } }, (done.has(p.id) ? '🧵 ' : '') + p.name)))
    );

    // --- 1. designs ---
    const designs = [];
    board('Step 1: draw two patch designs', 'Keep it round: the corners get trimmed off.');
    let deadline = Date.now() + DRAW_TIME * 1000;
    let stop = ctx.clock(DRAW_TIME);
    await Promise.all(players.map(async (p) => {
      for (let k = 0; k < 2 && Date.now() < deadline; k++) {
        const got = await ctx.ask(p, {
          title: `Patch design ${k + 1} of 2`, text: 'Draw a patch: an animal, a symbol, a creature, anything. No words; mottos come later!',
          draw: { submit: k ? 'Done' : 'Next design' },
        }, { timeout: (deadline - Date.now()) / 1000, clock: false, after: { wait: 'Lovely. Waiting for the others…' } });
        if (got.has(p.id)) {
          designs.push({ by: p, img: await shrink(got.get(p.id)) });
          snd.sfx('shears_snip.wav', 0.6);
        }
      }
      done.add(p.id); board('Step 1: draw two patch designs', 'Keep it round: the corners get trimmed off.');
    }));
    stop();
    snd.sfx('shears_snip.wav', 0.85);

    // --- 2. mottos ---
    const mottos = [];
    done.clear();
    board('Step 2: write three mottos', 'Short and punchy. Someone else will stitch them onto a patch.');
    deadline = Date.now() + MOTTO_TIME * 1000;
    stop = ctx.clock(MOTTO_TIME);
    await Promise.all(players.map(async (p) => {
      const prompts = ctx.shuffle(MOTTO_PROMPTS);
      for (let k = 0; k < 3 && Date.now() < deadline; k++) {
        const got = await ctx.ask(p, {
          title: `Motto ${k + 1} of 3`, text: `Idea: ${prompts[k]}`,
          input: { placeholder: 'A short motto', max: 32, submit: 'Stitch it' },
        }, { timeout: (deadline - Date.now()) / 1000, clock: false, after: { wait: 'Nice. Waiting for the others…' } });
        const v = got.get(p.id);
        if (v) {
          mottos.push({ by: p, text: v.trim() });
          snd.sfx('sewing_buzz.wav', 0.5);
        }
      }
      done.add(p.id); board('Step 2: write three mottos', 'Short and punchy. Someone else will stitch them onto a patch.');
    }));
    stop();
    snd.sfx('shears_snip.wav', 0.85);
    if (!designs.length || !mottos.length) return ctx.say('Not enough material', 'We need drawings and mottos to make patches!', 5000);

    // --- 3. stitch ---
    const handOf = (pool, p) => {
      const others = ctx.shuffle(pool.filter((x) => x.by.id !== p.id));
      const own = ctx.shuffle(pool.filter((x) => x.by.id === p.id));
      return [...others, ...own].slice(0, HAND);
    };
    const patches = [];
    done.clear();
    board('Step 3: stitch your patch', 'Pick a design and a motto from the pile you were dealt.');
    deadline = Date.now() + STITCH_TIME * 1000;
    stop = ctx.clock(STITCH_TIME);
    await Promise.all(players.map(async (p) => {
      const dh = handOf(designs, p), mh = handOf(mottos, p);
      let d = dh[0], m = mh[0];
      const g1 = await ctx.ask(p, { title: 'Pick a design', text: 'Tap the one you want on your patch.', pick: dh.map((x) => x.img) },
        { timeout: (deadline - Date.now()) / 1000, clock: false, after: { wait: '…' } });
      if (g1.has(p.id)) d = dh[g1.get(p.id)] || d;
      const g2 = await ctx.ask(p, {
        title: 'Pick a motto', image: d.img, choices: mh.map((x, i) => ({ label: x.text, value: i })),
      }, { timeout: Math.max(1, (deadline - Date.now()) / 1000), clock: false, after: { wait: 'Stitching… look at the TV soon!' } });
      if (g2.has(p.id)) m = mh[g2.get(p.id)] || m;
      patches.push({ maker: p, design: d, motto: m });
      done.add(p.id); board('Step 3: stitch your patch', 'Pick a design and a motto from the pile you were dealt.');
    }));
    stop();

    // --- 4. show and vote ---
    const shown = ctx.shuffle(patches);
    const patchEl = (pt, i, extra, opts = {}) => {
      const isSolo = opts.solo;
      const isPressed = opts.pressed;
      const badge = h('div.pp-badge' + (isPressed ? ' pp-pressed' : ''),
        h('div.pp-felt-backing'),
        h('div.pp-felt-inner', h('img', { src: pt.design.img, alt: '' })),
        h('svg.pp-stitch-svg', { viewBox: '0 0 160 160' },
          h('circle.pp-stitch-circle' + (isSolo ? ' pp-stitch-anim' : ''), { cx: '80', cy: '80', r: '74' })),
        isPressed ? h('div.pp-steam',
          h('span.pp-puff.p-left'),
          h('span.pp-puff.p-right')) : null
      );
      const ribbon = h('div.pp-ribbon',
        h('span.pp-tail.pp-tail-l'),
        h('span.pp-ribbon-text', pt.motto.text),
        h('span.pp-tail.pp-tail-r')
      );
      const pinNumber = h('div.pp-pinned.pp-n-tag',
        h('span.pp-safety-pin'),
        h('span.pp-n', `#${i + 1}`)
      );
      return h('div.pp-patch' + (isSolo ? ' pp-solo-patch' : ''),
        { style: { '--c': pt.maker.color } },
        badge, ribbon, pinNumber, extra);
    };

    ctx.show('all', { wait: 'Look at the TV!' });
    for (const [i, pt] of shown.entries()) {
      snd.sfx('sewing_buzz.wav', 0.6);
      ctx.setTimeout(() => snd.sfx('steam_press.wav', 0.8), 350);
      ctx.el.replaceChildren(
        h('h2', 'Fresh off the machine…'),
        h('div.pp-solo', patchEl(pt, i, null, { solo: true, pressed: true }))
      );
      await ctx.sleep(3000);
    }

    ctx.el.replaceChildren(h('h2', 'Vote for your two favourites'), h('div.pp-wall', shown.map((pt, i) => patchEl(pt, i))));
    const votes = new Map();
    stop = ctx.clock(VOTE_TIME);
    await Promise.all(players.map(async (p) => {
      const choices = shown.map((pt, i) => ({ label: `#${i + 1}: ${pt.motto.text}`, value: i, disabled: pt.maker.id === p.id }));
      const can = choices.filter((c) => !c.disabled).length;
      if (!can) return;
      const got = await ctx.ask(p, {
        title: 'Your two favourites', choices, multi: { min: 1, max: Math.min(2, can), submit: 'Vote' },
      }, { timeout: VOTE_TIME, clock: false, after: { wait: 'Votes in!' } });
      if (got.has(p.id)) votes.set(p.id, got.get(p.id));
    }));
    stop();

    const tally = shown.map(() => 0);
    for (const [pid, list] of votes) for (const i of new Set(list || [])) if (shown[i] && shown[i].maker.id !== pid) tally[i]++;
    shown.forEach((pt, i) => {
      add(pt.maker.id, tally[i] * 300);
      add(pt.design.by.id, tally[i] * 200);
      add(pt.motto.by.id, tally[i] * 200);
    });

    const order = shown.map((pt, i) => ({ pt, i, v: tally[i] })).sort((a, b) => b.v - a.v);
    snd.sfx('steam_press.wav', 0.9);
    ctx.sfx?.('win');
    const credit = (pt) => h('div.pp-credit',
      h('span', { style: { color: pt.maker.color } }, `stitched by ${pt.maker.name}`),
      h('span', { style: { color: pt.design.by.color } }, `art: ${pt.design.by.name}`),
      h('span', { style: { color: pt.motto.by.color } }, `motto: ${pt.motto.by.name}`));

    ctx.el.replaceChildren(
      h('h2', 'Patch of the night'),
      h('div.pp-solo', patchEl(order[0].pt, order[0].i,
        h('div.pp-pinned.pp-votes', h('span.pp-safety-pin'), h('span', `${order[0].v} vote${order[0].v === 1 ? '' : 's'}`)),
        { solo: true, pressed: true })),
      credit(order[0].pt)
    );
    await ctx.sleep(6500);

    ctx.el.replaceChildren(h('h2', 'The whole collection'), h('div.pp-wall', order.map(({ pt, i, v }) =>
      patchEl(pt, i, h('div.pp-pinned.pp-votes', h('span.pp-safety-pin'), h('span', `${v} vote${v === 1 ? '' : 's'}`))))));
    await ctx.sleep(7000);
    await scoreboard(ctx, score, 'Final scores', 6000);

    const best = Math.max(...score.values());
    const winners = ctx.players.filter((p) => score.get(p.id) === best).map((p) => p.name);
    ctx.show('all', { title: 'Game over!', wait: `${winners.join(' & ')} won.` });
    await ctx.say(`🏆 ${winners.join(' & ')}`, 'head of the stitching circle', 6000);
  } finally {
    snd.stopBgm();
    ctx.el.classList.remove('pp-stage');
  }
}

async function scoreboard(ctx, score, title, ms) {
  const { h } = ctx;
  const rows = ctx.players.map((p) => ({ p, s: score.get(p.id) || 0 })).sort((a, b) => b.s - a.s);
  const top = rows[0]?.s || 1;
  ctx.el.replaceChildren(
    h('h1', title),
    h('div.pp-scores', rows.map(({ p, s }) =>
      h('div.pp-srow',
        h('span.pp-sname', p.name),
        h('div.pp-sbar', h('div', { style: { width: `${Math.max(4, (s / top) * 100)}%`, background: p.color } })),
        h('span', s))))
  );
  await ctx.sleep(ms);
}

function installCss() {
  document.getElementById('patch-party-css')?.remove();
  document.head.append(Object.assign(document.createElement('style'), { id: 'patch-party-css', textContent: `
    /* Indigo denim twill backdrop and corner rivets */
    .pp-stage {
      position: relative;
      background-color: #16243b;
      background-image:
        radial-gradient(circle at 18px 18px, #ffd480 0%, #b8860b 4px, #3a2500 8px, transparent 9px),
        radial-gradient(circle at calc(100% - 18px) 18px, #ffd480 0%, #b8860b 4px, #3a2500 8px, transparent 9px),
        radial-gradient(circle at 18px calc(100% - 18px), #ffd480 0%, #b8860b 4px, #3a2500 8px, transparent 9px),
        radial-gradient(circle at calc(100% - 18px) calc(100% - 18px), #ffd480 0%, #b8860b 4px, #3a2500 8px, transparent 9px),
        radial-gradient(ellipse at center, rgba(30, 48, 76, 0.9) 0%, rgba(16, 25, 40, 0.98) 100%),
        repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.04) 0px, rgba(255, 255, 255, 0.04) 2px, transparent 2px, transparent 4px),
        repeating-linear-gradient(-45deg, rgba(0, 0, 0, 0.22) 0px, rgba(0, 0, 0, 0.22) 2px, transparent 2px, transparent 4px),
        repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.015) 0px, rgba(255, 255, 255, 0.015) 1px, transparent 1px, transparent 3px);
      border-radius: 16px;
      box-shadow: inset 0 0 0 3px #0f1929, inset 0 0 0 6px #d48b28, inset 0 0 30px rgba(0,0,0,0.7);
      padding: 30px 20px;
    }
    .pp-dim { color: #d48b28; font-weight: 700; font-size: 1.15em; text-shadow: 0 2px 4px #000; }
    .pp-wall { display: flex; flex-wrap: wrap; gap: 2.2vw; justify-content: center; max-width: 1600px; margin: 0 auto; }
    .pp-solo { transform: scale(1.45); margin: 6vh auto; display: flex; flex-direction: column; align-items: center; }

    /* Patches & Badges */
    .pp-patch { position: relative; display: flex; flex-direction: column; align-items: center; width: 13.5em; }
    .pp-badge {
      position: relative;
      width: 11em; height: 11em;
      border-radius: 50%;
      background: #fbf8f2;
      border: 8px solid var(--c);
      box-shadow: 0 14px 28px rgba(0,0,0,0.55), 0 4px 10px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
      overflow: visible;
    }
    .pp-felt-backing {
      position: absolute; inset: -4px;
      border-radius: 50%;
      border: 2px dashed rgba(255,255,255,0.75);
      pointer-events: none;
    }
    .pp-felt-inner {
      width: 100%; height: 100%;
      border-radius: 50%;
      overflow: hidden;
      background: radial-gradient(circle, #ffffff 40%, #f4efe6 100%);
      display: flex; align-items: center; justify-content: center;
    }
    .pp-felt-inner img { width: 100%; height: 100%; object-fit: contain; }

    /* SVG Stitching & Animations */
    .pp-stitch-svg {
      position: absolute; inset: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 3;
    }
    .pp-stitch-circle {
      fill: none; stroke: #ffd700; stroke-width: 4px;
      stroke-dasharray: 8 6; stroke-dashoffset: 500;
    }
    .pp-stitch-anim { animation: stitchRun 1.4s cubic-bezier(0.25, 1, 0.5, 1) forwards; }
    @keyframes stitchRun { from { stroke-dashoffset: 500; } to { stroke-dashoffset: 0; } }

    /* Steam Iron Press Squash & Stretch */
    .pp-pressed { animation: steamPress 0.65s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
    @keyframes steamPress {
      0% { transform: scale(0.6) translateY(-50px); opacity: 0; }
      45% { transform: scale(1.18, 0.82) translateY(10px); opacity: 1; }
      65% { transform: scale(0.95, 1.05) translateY(-3px); }
      100% { transform: scale(1) translateY(0); opacity: 1; }
    }
    .pp-steam { position: absolute; inset: 0; pointer-events: none; z-index: 4; }
    .pp-puff {
      position: absolute; top: 45%; width: 44px; height: 44px; border-radius: 50%;
      background: radial-gradient(circle, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.3) 50%, transparent 70%);
    }
    .pp-puff.p-left { left: 5%; animation: puffOutLeft 0.75s ease-out forwards; }
    .pp-puff.p-right { right: 5%; animation: puffOutRight 0.75s ease-out forwards; }
    @keyframes puffOutLeft { 0% { transform: translate(0,0) scale(0.3); opacity: 0.9; } 100% { transform: translate(-70px, -35px) scale(2.2); opacity: 0; filter: blur(6px); } }
    @keyframes puffOutRight { 0% { transform: translate(0,0) scale(0.3); opacity: 0.9; } 100% { transform: translate(70px, -35px) scale(2.2); opacity: 0; filter: blur(6px); } }

    /* Satin Ribbon Motto with Swallowtail ends */
    .pp-ribbon {
      position: relative; margin-top: -1.5em; z-index: 2;
      background: var(--c); color: #101018; font-weight: 900;
      padding: 8px 20px; border-radius: 4px;
      max-width: 90%; text-transform: uppercase; letter-spacing: .06em; font-size: .88em;
      box-shadow: 0 6px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.4);
      border-top: 2px dashed rgba(255,255,255,0.7);
      border-bottom: 2px dashed rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
    }
    .pp-ribbon-text { overflow-wrap: anywhere; text-align: center; }
    .pp-tail {
      position: absolute; top: 0; bottom: 0; width: 14px; background: inherit;
      filter: brightness(0.85); z-index: -1;
    }
    .pp-tail-l { left: -8px; clip-path: polygon(100% 0, 100% 100%, 0 100%, 40% 50%, 0 0); }
    .pp-tail-r { right: -8px; clip-path: polygon(0 0, 60% 50%, 0 100%, 100% 100%, 100% 0); }

    /* Safety Pin & Tags */
    .pp-pinned {
      display: flex; flex-direction: column; align-items: center;
      transform-origin: top center;
      animation: pinSwing 2.4s ease-in-out infinite alternate;
    }
    @keyframes pinSwing { 0% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } 100% { transform: rotate(-3deg); } }
    .pp-safety-pin {
      display: block; width: 26px; height: 10px; margin-bottom: -3px;
      background: no-repeat center / contain url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 12'%3E%3Cpath d='M2 6 C2 3, 6 2, 10 2 L24 2 C26 2, 27 4, 27 6 C27 8, 26 10, 24 10 L8 10 C5 10, 2 8, 2 6 Z' fill='none' stroke='%23ffd480' stroke-width='2'/%3E%3Ccircle cx='5' cy='6' r='2' fill='%23b8860b'/%3E%3Crect x='20' y='1' width='7' height='10' rx='2' fill='%23e5a823'/%3E%3C/svg%3E");
    }
    .pp-n { background: #222b3d; border: 2px solid #d48b28; color: #fff; border-radius: 99px; padding: 2px 10px; font-weight: 900; }
    .pp-votes { margin-top: 6px; color: #ffd700; font-weight: 900; font-size: 1.1em; text-shadow: 0 2px 4px #000; }

    /* Credits & Scores */
    .pp-credit { display: flex; gap: 24px; font-weight: 800; font-size: 1.25em; flex-wrap: wrap; justify-content: center; margin-top: 15px; }
    .pp-scores { width: min(1000px, 100%); display: flex; flex-direction: column; gap: 14px; margin: 0 auto; }
    .pp-srow {
      display: grid; grid-template-columns: 8em 1fr 4em; gap: 16px; align-items: center;
      font-weight: 800; text-align: left; background: rgba(0,0,0,0.25);
      padding: 10px 16px; border-radius: 8px; border: 1px dashed #d48b28;
    }
    .pp-sname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #fff; }
    .pp-sbar { height: 1.5em; background: #162438; border-radius: 99px; overflow: hidden; border: 1px solid #334460; }
    .pp-sbar div { height: 100%; border-radius: 99px; box-shadow: inset 0 2px 4px rgba(255,255,255,0.3); }
  ` }));
}
