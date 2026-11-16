export default function (ctx) {
  const { h } = ctx;
  if (!document.getElementById('pc-phone-css')) {
    document.head.append(h('link#pc-phone-css', { rel: 'stylesheet', href: ctx.asset('player.css') }));
  }
  ctx.on('view', (view) => {
    const v = view?.pc;
    if (!v) return ctx.renderView(view);
    const title = v.phase === 'setup' ? 'Your press pass.' : v.phase === 'finished' ? 'And we’re clear.' :
      v.phase === 'reveal' ? 'The full story.' : v.presenting ? 'You’re the story.' : 'Your secret brief.';
    let instruction;
    if (v.phase === 'setup') instruction = 'One person takes the podium. Everyone else knows their silly secret. Ask questions aloud, take turns, and help them figure it out without saying the answer.';
    else if (v.phase === 'finished') instruction = 'Thanks for joining the press corps. The host can return everyone to the lobby.';
    else if (v.phase === 'reveal') instruction = 'The secret is out! Get ready to rotate the spotlight.';
    else if (v.paused) instruction = 'Broadcast on hold. Waiting for the presenter or reporters to reconnect.';
    else if (v.phase === 'ready') instruction = v.presenting ? 'You don’t know who you are or what you did. Reporters do. Answer confidently, then guess both parts when you have a theory.' : `${v.presenter} is about to take the podium. Prepare a question that hints at this story. Keep your screen private!`;
    else if (v.phase === 'guess') instruction = v.presenting ? 'Say your guess out loud: who are you, and what did you do? The reporter will confirm.' : v.active ? 'Listen to their spoken guess. Did they get both who they are and what they did? Be generous with wording.' : `${v.presenter} is guessing. ${v.reporter} will confirm. Keep your secret private.`;
    else instruction = v.presenting ? `${v.reporter} has the microphone. Answer their question aloud, however ridiculous it sounds. You can guess anytime.` : v.active ? 'You have the microphone! Ask a revealing question aloud. Wait for the answer, then tap below to pass to the next reporter.' : `${v.reporter} has the microphone. Listen and plan your next question. Hint at the secret without saying it outright.`;
    ctx.el.replaceChildren(h('section.pc-phone',
      h('div.pc-pass-top', h('b', 'CPN'), h('span', 'CITY HALL / PRESS OFFICE')),
      h('p.pc-phone-kicker', v.phase === 'setup' ? 'Broadcast briefing' : v.presenting ? 'Official spokesperson' : 'Accredited reporter'),
      h('h1', title),
      !['setup', 'finished'].includes(v.phase) && h('div.pc-phone-round', `BRIEFING ${v.round} / ${v.total} · QUESTION ${v.questions}`),
      v.premise && h('div.pc-secret', h('b', v.phase === 'reveal' ? 'CONFIRMED STORY' : 'FOR REPORTERS’ EYES ONLY'), h('p', v.premise)),
      v.presenting && !['setup', 'reveal', 'finished'].includes(v.phase) && h('div.pc-mystery', h('span', '?'), h('p', 'Identity: classified', h('br'), 'Confidence: mandatory')),
      h('p.pc-phone-instruction', { 'aria-live': 'polite' }, instruction),
      v.phase === 'live' && v.active && h('div.pc-your-turn', '● YOUR QUESTION · YOU’RE ON'),
      h('div.pc-phone-actions', v.actions.map(([action, label], i) => h('button.pc-phone-button' + (i > 0 ? '.secondary' : ''), {
        onclick: (event) => {
          for (const b of ctx.el.querySelectorAll('.pc-phone-button')) b.disabled = true;
          event.currentTarget.textContent = 'Sending…';
          ctx.send({ type: 'pc-action', match: v.match, revision: v.revision, action });
        }
      }, label))),
      h('p.pc-pass-footer', 'PRESS CONFERENCE · CIVIC PUBLIC NETWORK')));
  });
}
