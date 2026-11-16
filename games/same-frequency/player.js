import { dial, waves } from './dial.js';

export default function (ctx) {
  const { h } = ctx;
  if (!document.getElementById('sf-phone-css')) document.head.append(h('link#sf-phone-css', { rel: 'stylesheet', href: ctx.asset('style.css') }));
  let latest = null, draft = 50, draftClue = '', lastRound = null;
  const send = (v, action, value) => ctx.send({ type: 'sf-action', match: v.match, round: v.round, phase: v.phase, action, value });
  ctx.on('view', (view) => {
    const v = view?.sf;
    if (!v) { latest = null; return ctx.renderView(view); }
    const roundKey = `${v.match}/${v.round}`;
    if (roundKey !== lastRound) { draft = v.mine ?? 50; draftClue = ''; lastRound = roundKey; }
    latest = v;
    const actionButton = (label, action) => h('button.sf-button', { onclick: () => send(latest, action) }, label);
    let body;
    if (v.phase === 'setup') {
      body = [h('h1', 'Find your people’s frequency.'), waves(h),
        h('p', 'One DJ sees a hidden target. Their clue helps everyone else find it. Guess privately, talk it over, then reveal.'),
        h('p', 'Everyone gets a turn as DJ. Closer guesses score up to 4 points. The DJ earns the group’s rounded average.'),
        v.captain ? actionButton('Let’s tune in →', 'start') : h('p.sf-phone-note', 'The host will start the broadcast.')];
    } else if (v.phase === 'finished') {
      const me = v.players.find((p) => p.id === ctx.me.id);
      body = [h('h1', 'That was a good connection.'), h('div.sf-phone-score', `${me?.score ?? 0}`, h('span', 'YOUR POINTS')),
        h('p', 'Check the TV for the final standings. Same friends, new frequencies next time.')];
    } else if (v.phase === 'reveal') {
      const result = v.result.points.find((p) => p.id === ctx.me.id);
      body = [h('h1', v.skipped ? 'Signal skipped.' : 'Signal found.'),
        h('div.sf-phone-dial', dial({ target: v.target, ...(v.mine !== undefined ? { value: v.mine } : {}) })),
        h('div.sf-phone-endpoints', h('span', v.spectrum[0]), h('span', v.spectrum[1])),
        h('div.sf-phone-score', `+${result?.gain ?? 0}`, h('span', v.giving ? 'DJ BONUS' : 'POINTS THIS ROUND')),
        h('p', `Target: ${v.target}${v.mine !== undefined ? ` · Your guess: ${v.mine} · Distance: ${Math.abs(v.mine - v.target)}` : ''}`),
        v.captain ? actionButton(v.round + 1 >= v.total ? 'Final standings →' : 'Next DJ →', 'next') : h('p.sf-phone-note', 'Next track coming up on the TV.')];
    } else if (v.giving && v.phase === 'clue') {
      const input = h('textarea', { maxLength: 120, placeholder: 'Your wedding cake arrives frozen…', value: draftClue,
        'aria-label': 'Your clue', oninput: (event) => { draftClue = event.target.value; } });
      body = [h('h1', 'You’re the DJ.'), h('p.sf-phone-note', 'PRIVATE SIGNAL · FOR YOUR EYES ONLY'),
        h('div.sf-phone-dial', dial({ target: v.target, value: v.target })),
        h('div.sf-phone-endpoints', h('span', v.spectrum[0]), h('span', v.spectrum[1])),
        h('p', h('b', `Your target: ${v.target} / 100`), '. Give an example that belongs at this exact spot. Keep the number to yourself.'),
        h('form', { onsubmit: (event) => { event.preventDefault(); if (input.value.trim()) send(latest, 'clue', input.value); } },
          input, h('button.sf-button', { type: 'submit' }, 'Send the clue →'))];
    } else if (v.phase === 'clue') {
      body = [h('h1', 'A signal is forming.'), waves(h),
        h('div.sf-phone-spectrum', h('b', v.spectrum[0]), h('span', '↔'), h('b', v.spectrum[1])),
        h('p', `${v.giver.name} is thinking of a clue. Only their phone can see the target.`)];
    } else if (v.giving) {
      body = [h('h1', v.phase === 'debate' ? 'How well do they know you?' : 'Let them tune in.'),
        h('blockquote', v.clue), h('div.sf-phone-dial', dial({ target: v.target, markers: v.players.filter((p) => p.guess !== undefined) })),
        h('p', `Your secret target is ${v.target}. Keep a poker face while everyone guesses.`),
        v.phase === 'debate' ? actionButton('Reveal the signal →', 'reveal') :
          h('p.sf-phone-note', `${v.players.filter((p) => p.submitted && p.id !== v.giver.id).length} guesses received. Waiting for the room…`)];
    } else {
      const board = h('div.sf-phone-dial', dial({ value: draft }));
      const readout = h('output.sf-readout', { id: 'sf-position' }, String(draft));
      const status = h('p.sf-phone-note', { role: 'status' }, v.mine !== undefined ? `Saved at ${v.mine}. You can change your mind.` : 'Move the needle. Trust your instincts.');
      const slider = h('input', { type: 'range', min: 0, max: 100, step: 1, value: draft,
        'aria-label': 'Your position on the spectrum', 'aria-describedby': 'sf-position', oninput: (event) => {
          draft = Number(event.target.value); readout.value = String(draft);
          board.querySelector('.sf-needle').setAttribute('transform', `rotate(${draft * 1.8 - 90} 400 320)`);
        } });
      body = [h('h1', v.phase === 'debate' ? 'Make your case.' : 'Where does it belong?'), h('blockquote', v.clue), board,
        h('div.sf-phone-endpoints', h('span', v.spectrum[0]), h('span', v.spectrum[1])),
        h('label.sf-slider-label', { htmlFor: 'sf-slider' }, 'YOUR FREQUENCY', readout),
        Object.assign(slider, { id: 'sf-slider' }),
        h('button.sf-button', { onclick: () => {
          send(latest, 'guess', draft); status.textContent = 'Sending your frequency…';
        } }, v.mine !== undefined ? 'Update my guess →' : 'Save my guess →'), status,
        v.phase === 'debate' && h('p', 'All guesses are on the TV. Talk it over and update yours if someone changes your mind. Your DJ will reveal when you’re ready.')];
    }
    ctx.el.replaceChildren(h('section.sf-phone', h('header', h('b', 'sf /'), h('span', 'SAME FREQUENCY')),
      h('p.sf-phone-kicker', ['setup', 'finished'].includes(v.phase) ? 'TUNE INTO EACH OTHER' : `TRACK ${v.round + 1} / ${v.total} · ${v.giving ? 'YOUR DJ SET' : `DJ: ${v.giver.name}`}`),
      ...body, h('footer', 'DIFFERENT MINDS. ONE HIDDEN SIGNAL.')));
  });
}
