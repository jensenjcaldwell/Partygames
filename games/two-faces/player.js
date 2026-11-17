// Two Faces phone screen: your two masks (tap to peek) and gold sit above the
// standard view, which carries the move, challenge and block buttons.
import { ROLES } from './roles.js';

export default function (ctx) {
  const { h } = ctx;
  let hand = null, peek = false, peekTimer = null, help = false;
  const panel = h('div.tfp');

  function drawHand() {
    if (!hand) { panel.replaceChildren(); return; }
    const card = (m) => {
      const show = m.open || peek;
      return h('div.tfp-card' + (m.open ? '.lost' : ''),
        h('img', { src: ctx.asset(`${show ? m.role : 'back'}.svg`), alt: show ? ROLES[m.role].name : 'Hidden mask' }),
        m.open && h('span.tfp-lost', 'DROPPED'));
    };
    panel.replaceChildren(...[
      h('div.tfp-cards', { onclick: togglePeek }, hand.masks.map(card)),
      h('div.tfp-bar',
        h('span.tfp-gold', hand.out ? 'Out of the ball' : `🪙 ${hand.gold} gold`),
        h('button.tfp-btn', { onclick: togglePeek }, peek ? 'Hide' : 'Peek'),
        h('button.tfp-btn', { onclick: () => { help = !help; drawHand(); } }, help ? 'Close' : 'Cards?')),
      help && h('div.tfp-help', Object.values(ROLES).map((r) => h('div',
        h('b', { style: { color: r.color } }, `${r.icon} ${r.name}`), ' ', [r.does, r.blocks].filter(Boolean).join(' ')))),
      help && h('p.tfp-small', 'Anyone: Income +1 coin · Foreign Aid +2 coins · Coup: pay 7, a rival loses a card (must at 10 coins).'),
    ].filter(Boolean));
  }

  function togglePeek() {
    peek = !peek;
    clearTimeout(peekTimer);
    if (peek) peekTimer = setTimeout(() => { peek = false; drawHand(); }, 5000);
    drawHand();
  }

  // Preload the art so peeking is instant.
  for (const r of [...Object.keys(ROLES), 'back']) new Image().src = ctx.asset(`${r}.svg`);

  ctx.on('message', (m) => { if (m?.kind === 'hand') { hand = m; drawHand(); } });
  ctx.on('view', (v) => { ctx.renderView(v); ctx.el.prepend(panel); });
  ctx.el.prepend(panel);
  ctx.send({ kind: 'hello' });

  document.getElementById('two-faces-phone-css')?.remove();
  const css = Object.assign(document.createElement('style'), { id: 'two-faces-phone-css' });
  css.textContent = `
    .tfp { display: flex; flex-direction: column; gap: 10px; margin-bottom: 18px; }
    .tfp-cards { display: flex; gap: 10px; justify-content: center; cursor: pointer; user-select: none; }
    .tfp-card { position: relative; width: 42%; max-width: 170px; }
    .tfp-card img { width: 100%; aspect-ratio: 240 / 336; display: block; border-radius: 12px; box-shadow: 0 6px 18px #0008; }
    .tfp-card.lost img { filter: grayscale(.8) brightness(.55); }
    .tfp-lost { position: absolute; inset: 42% 0 auto; text-align: center; font-weight: 900; letter-spacing: .15em;
      background: #000a; color: #ff7f6e; padding: 4px 0; }
    .tfp-bar { display: flex; gap: 8px; align-items: center; }
    .tfp-gold { flex: 1; font-weight: 900; font-size: 1.2em; }
    .tfp-btn { background: var(--card); border: 2px solid var(--line); border-radius: 12px; padding: 8px 12px; font-weight: 800; cursor: pointer; }
    .tfp-help { display: flex; flex-direction: column; gap: 6px; background: var(--bg2); border-radius: 12px; padding: 10px 12px; font-size: .9em; }
    .tfp-small { color: var(--dim); font-size: .85em; margin: 0; }
  `;
  document.head.append(css);
}
