// The standard phone screen. A game's host code sends a "view" (plain JSON)
// and this draws it, so most games never need phone code of their own.
//
// view = {
//   title, text,               headings / body text
//   image,                     url (e.g. ctx.asset('cat.png') on the host)
//   wait,                      "Look at the TV!" style message with a spinner
//   color,                     accent colour for this screen
//   input:   { placeholder, max, multiline, submit },          answer = string
//   choices: [ 'A', 'B' ] or [{ label, value, disabled }],      answer = value
//   multi:   { min, max, submit }   with choices: pick several, answer = [values]
//   number:  { min, max, step, value, submit },                 answer = number
//   draw:    { submit, prompt },                                answer = PNG data URL
//   ask                        set by ctx.ask(); answers go back to that ask
// }
import { h } from './common.js';

const IDEAS = [
  'A raccoon in a tuxedo', 'Extra-spicy pickles', 'Three-legged disco', 'Soggy cereal',
  'An overly polite ghost', 'Microwave burrito', 'A tiny inflatable crown', 'Emergency glitter',
  'Suspiciously loud slippers', 'A confused pigeon', 'Pocket spaghetti', 'Reverse gravity',
];

export function renderView(el, view, send) {
  el.replaceChildren();
  if (!view) { el.append(waiting('Waiting for the host…')); return; }
  const answer = (value) => {
    if (view.ask) send({ kind: 'answer', ask: view.ask, value });
    else send({ kind: 'choice', value });
  };
  const box = h('div.view');
  if (view.color) box.style.setProperty('--accent', view.color);
  if (view.title) box.append(h('h2', view.title));
  if (view.image) box.append(h('img.view-img', { src: view.image, alt: '' }));
  if (view.text) box.append(h('p.view-text', view.text));

  if (view.input) {
    const i = view.input;
    const field = h(i.multiline ? 'textarea' : 'input', {
      placeholder: i.placeholder || 'Type here', maxLength: i.max || 120,
      autocomplete: 'off', autocapitalize: 'sentences', enterKeyHint: 'send',
    });
    const go = () => { const v = field.value.trim(); if (v) answer(v); };
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !i.multiline) { e.preventDefault(); go(); } });
    const ideaBtn = i.suggest === false ? null : h('button.ghost.sm', {
      type: 'button',
      onclick: () => {
        field.value = IDEAS[Math.floor(Math.random() * IDEAS.length)];
        field.focus();
      },
    }, '🎲 Need an idea?');
    box.append(h('form.stack', { onsubmit: (e) => { e.preventDefault(); go(); } },
      field, h('button.big', { type: 'submit' }, i.submit || 'Send'), ideaBtn));
    setTimeout(() => field.focus(), 50);
  }

  if (view.number) {
    const n = view.number;
    const out = h('div.num-val');
    const r = h('input', { type: 'range', min: n.min ?? 0, max: n.max ?? 100, step: n.step ?? 1, value: n.value ?? n.min ?? 0 });
    const upd = () => out.textContent = r.value; upd();
    r.addEventListener('input', upd);
    box.append(out, r, h('button.big', { onclick: () => answer(Number(r.value)) }, n.submit || 'Lock in'));
  }

  if (view.choices) {
    const opts = view.choices.map((c) => (typeof c === 'object' ? c : { label: String(c), value: c }));
    if (view.multi) {
      const chosen = new Set();
      const btn = h('button.big', { disabled: true, onclick: () => answer([...chosen]) }, view.multi.submit || 'Done');
      const check = () => {
        btn.disabled = chosen.size < (view.multi.min ?? 1) || chosen.size > (view.multi.max ?? opts.length);
      };
      box.append(h('div.choices', opts.map((o) => h('button.choice', {
        disabled: o.disabled,
        onclick: (e) => {
          chosen.has(o.value) ? chosen.delete(o.value) : chosen.add(o.value);
          e.currentTarget.classList.toggle('on'); check();
        },
      }, o.label))), btn);
    } else {
      box.append(h('div.choices', opts.map((o) => h('button.choice', {
        disabled: o.disabled, onclick: () => answer(o.value),
      }, o.label))));
    }
  }

  if (view.draw) box.append(drawPad(view.draw, answer));
  if (view.wait) box.append(waiting(view.wait));
  el.append(box);
}

function waiting(text) {
  return h('div.wait', h('div.spinner'), h('p', text));
}

function drawPad(opts, answer) {
  const colors = opts.colors || ['#111111', '#ff5d73', '#4dd8ff', '#5df08a', '#ffe14d', '#ffffff'];
  const c = h('canvas.pad', { width: 600, height: 600 });
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 600);
  g.lineCap = g.lineJoin = 'round';
  let color = colors[0], width = 10, last = null;
  const pos = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * 600 / r.width, (e.clientY - r.top) * 600 / r.height]; };
  c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); last = pos(e); dot(last); });
  c.addEventListener('pointermove', (e) => {
    if (!last) return; const p = pos(e);
    g.strokeStyle = color; g.lineWidth = width; g.beginPath(); g.moveTo(...last); g.lineTo(...p); g.stroke(); last = p;
  });
  const end = () => (last = null);
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  const dot = (p) => { g.fillStyle = color; g.beginPath(); g.arc(p[0], p[1], width / 2, 0, 7); g.fill(); };
  const swatches = h('div.swatches', colors.map((col, i) => h('button.swatch' + (i ? '' : '.on'), {
    style: { background: col },
    onclick: (e) => { color = col; width = col === '#ffffff' ? 30 : 10; swatches.querySelectorAll('.on').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); },
  })));
  return h('div.stack', opts.prompt && h('p.view-text', opts.prompt), c, swatches,
    h('button.big', { onclick: () => answer(c.toDataURL('image/png')) }, opts.submit || 'Done'));
}
