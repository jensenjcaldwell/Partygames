export default function (ctx) {
  document.body.classList.add('lcars-phone');
  if (!document.getElementById('lcars-phone-css')) {
    const style = document.createElement('style');
    style.id = 'lcars-phone-css';
    style.textContent = `
      body.lcars-phone {
        background: #05050a !important;
        color: #ffcf87 !important;
        font-family: 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif;
      }
      body.lcars-phone .card, body.lcars-phone .view {
        border: 2px solid #ff9900;
        border-radius: 18px;
        background: #0c0d16;
        box-shadow: 0 0 18px rgba(255, 153, 0, 0.16);
      }
      body.lcars-phone h1, body.lcars-phone h2, body.lcars-phone .title {
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #ff9900;
      }
      body.lcars-phone button {
        border-radius: 999px !important;
        font-weight: 700 !important;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      body.lcars-phone input, body.lcars-phone textarea {
        background: #04050a !important;
        color: #99ccff !important;
        border: 2px solid #cc99cc !important;
        border-radius: 12px !important;
      }
      .lcars-clues-form {
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 100%;
      }
      .lcars-clues-form input {
        width: 100%;
        padding: 12px 14px;
        font-size: 1.05rem;
        box-sizing: border-box;
      }
    `;
    document.head.appendChild(style);
  }

  ctx.on('message', (m) => {
    if (!m || m.mode !== 'threeClues') return;
    const h = ctx.h;
    const reqLetter = (m.reqLetter || '').toUpperCase();
    const inputs = [1, 2, 3].map((n) =>
      h('input', {
        type: 'text',
        maxlength: 24,
        placeholder: n === 1 && reqLetter
          ? `Clue 1 (MUST start with "${reqLetter}")`
          : `Clue ${n} (one word)`,
        autocomplete: 'off',
      })
    );
    const err = h('div', { style: 'color:#ff6b6b;font-size:0.9rem;min-height:1.1em;' });
    const btn = h('button', {
      style: `background:${m.color || '#ff9900'};color:#000;padding:12px 18px;border:0;font-size:1rem;cursor:pointer;`,
      onclick: () => {
        const vals = inputs.map((el) => el.value.trim().split(/\s+/)[0] || '');
        if (vals.some((v) => !v)) {
          err.textContent = 'Enter all 3 one-word clues.';
          return;
        }
        if (reqLetter && !vals[0].toUpperCase().startsWith(reqLetter)) {
          err.textContent = `Clue 1 must start with "${reqLetter}".`;
          return;
        }
        ctx.send({ clues: vals });
        ctx.renderView({
          title: 'Transmitted',
          text: 'Signal routed!',
          wait: 'Waiting for other crew...',
          color: m.color,
        });
      },
    }, 'Transmit 3 Clues');

    ctx.el.replaceChildren(
      h('div.card', { style: `border-color:${m.color || '#ff9900'};padding:16px;` },
        h('h2', { style: 'margin:0 0 6px;' }, `Secret Word: ${m.word}`),
        h('p', { style: 'margin:0 0 6px;color:#99ccff;' }, `Category: ${m.cat}`),
        reqLetter && h('p', { style: 'margin:0 0 12px;color:#ff9900;font-weight:700;' }, `Rule: Clue 1 must start with "${reqLetter}"`),
        h('div.lcars-clues-form', {}, ...inputs, err, btn)
      )
    );
  });
}
