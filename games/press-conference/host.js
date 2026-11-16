import { PREMISES } from './premises.js';
import { createSession, act, presence, phoneView, publicView } from './model.js';

export default async function (ctx) {
  if (ctx.connected.length < 4 || ctx.connected.length > 12) {
    return ctx.say('Gather the press', 'Press Conference needs 4–12 players.', 4000);
  }
  const { h } = ctx;
  const s = createSession(ctx.shuffle(ctx.connected), ctx.shuffle(PREMISES), crypto.randomUUID());
  const style = h('link', { rel: 'stylesheet', href: ctx.asset('host.css') });
  const styleReady = new Promise((resolve, reject) => {
    style.addEventListener('load', resolve, { once: true });
    style.addEventListener('error', () => reject(new Error('Could not load the city hall scene.')), { once: true });
  });
  document.head.append(style);
  ctx.el.classList.add('pc-stage');
  let done = false;
  ctx.music(null);

  function perform(id, action, revision = s.revision) {
    const before = s.phase;
    if (!act(s, id, action, revision)) return;
    if (before === 'setup') ctx.sfx('pc-fanfare');
    if (s.phase === 'reveal') ctx.sfx(action === 'correct' ? 'win' : 'ding');
    render();
  }
  const captain = () => s.seats.find((p) => p.connected)?.id;
  function button(label, action, id, secondary = false, disabled = false) {
    const revision = s.revision;
    return h('button.pc-button' + (secondary ? '.secondary' : ''),
      { disabled, onclick: () => perform(id, action, revision) }, label);
  }
  function wrap() { done = true; }
  function figures() {
    return [h('div.pc-figure', { 'aria-hidden': 'true' }, h('div.pc-body'), h('div.pc-tie'), h('div.pc-head', h('span', '?'))),
      h('div.pc-mics', { 'aria-hidden': 'true' }, [1, 2, 3].map(() => h('i.pc-mic'))),
      h('div.pc-podium', { 'aria-hidden': 'true' }, h('div.pc-seal', h('span', '★')))];
  }
  function render() {
    const v = publicView(s);
    const p = v.presenter, r = v.reporter;
    let copy, lowerName, lowerSub, label = 'BREAKING NEWS';
    const queue = () => {
      const at = v.reporters.findIndex((q) => q.id === r?.id);
      const upcoming = [...v.reporters.slice(at), ...v.reporters.slice(0, at)].filter((q) => q.connected).slice(1, 3);
      return h('div.pc-queue', upcoming.map((q) => h('span', `Next: ${q.name}`)));
    };
    const eyebrow = (text) => h('p.pc-eyebrow', text);
    const sub = (text) => h('p.pc-sub', text);
    const controls = (...buttons) => h('div.pc-controls', ...buttons);
    if (v.phase === 'setup') {
      copy = [eyebrow('A completely serious situation'), h('h1.pc-title', 'Press', h('br'), 'Conference'),
        sub('You have a lot to answer for. If only you knew what it was.'),
        h('ol.pc-rules', h('li', 'Reporters: read the secret on your phones.'),
          h('li', 'Ask questions aloud, in the order shown.'),
          h('li', 'Presenter: improvise and guess your story.')),
        button('Go live →', 'start', captain(), false, ctx.connected.length < 4)];
      lowerName = 'CITY HALL · LIVE COVERAGE'; lowerSub = 'Silly stories. Serious questions. Absolutely no preparation.';
    } else if (v.phase === 'reveal') {
      const result = s.results.at(-1);
      copy = [eyebrow(result.outcome === 'solved' ? 'Story confirmed' : 'The full story'),
        h('h1.pc-title', result.outcome === 'solved' ? 'Case cracked.' : 'No comment.'),
        h('p.pc-premise', v.premise),
        sub(`${p.name} · ${result.questions} question${result.questions === 1 ? '' : 's'} · ${result.seconds}s at the podium`),
        button(s.round + 1 === s.seats.length ? 'Wrap the broadcast →' : 'Next presenter →', 'continue', captain())];
      lowerName = p.name; lowerSub = 'The secret is out. Time for a new spokesperson.'; label = 'THE REVEAL';
    } else if (v.phase === 'finished') {
      copy = [eyebrow('That’s all from city hall'), h('h1.pc-title', 'And we’re clear.'),
        sub('A remarkable day for local journalism.'),
        h('div.pc-result-grid', s.results.map((x) => h('div.pc-result-row', h('b', x.name),
          h('span', x.outcome === 'away' ? 'Away' : `${x.outcome === 'solved' ? 'Solved' : 'Revealed'} · ${x.questions} Q · ${x.seconds}s`)))),
        h('button.pc-button', { onclick: wrap }, 'Back to the lobby')];
      lowerName = 'BROADCAST COMPLETE'; lowerSub = 'Every spokesperson has had their moment.'; label = 'SIGNING OFF';
    } else {
      const waiting = v.paused;
      copy = [eyebrow(`Briefing ${v.round} / ${v.total} · Outside city hall`),
        h('h1.pc-title', ...(waiting ? ['Hold the', h('br'), 'broadcast.'] :
        v.phase === 'ready' ? ['Take the', h('br'), 'podium.'] : v.phase === 'guess' ? ['We have', h('br'), 'a theory.'] : ['Face', h('br'), 'the press.']))];
      if (waiting) {
        copy.push(sub(`${!p.connected ? p.name : 'The reporters'} disconnected. Rejoin to resume.`),
          h('button.pc-button.secondary', { onclick: () => {
            s.results.push({ name: p.name, outcome: 'away', questions: s.questions, seconds: 0 });
            s.phase = 'reveal'; s.revision++; render();
          } }, 'End this briefing & reveal'));
      } else if (v.phase === 'ready') {
        copy.push(h('p.pc-on-air', p.name), sub('Reporters, read your secret brief. Presenter, keep your phone to yourself.'),
          button('Take the podium →', 'ready', p.id));
      } else if (v.phase === 'guess') {
        copy.push(sub(`${p.name}, say your guess out loud. Include who you are AND what you did.`),
          h('p.pc-on-air', `${r.name}, did they get it?`),
          controls(button('They got it!', 'correct', r.id), button('Not quite', 'miss', r.id, true)));
      } else {
        copy.push(eyebrow(`Question ${v.questions} · Microphone goes to`), h('p.pc-on-air', r.name),
          sub('Ask your question aloud. Let the presenter answer, then pass the microphone.'), queue(),
          controls(button('Next reporter →', 'next', r.id), button('I have a guess', 'guess', p.id, true)));
      }
      lowerName = `${p.name} · AT THE PODIUM`;
      lowerSub = v.phase === 'guess' ? 'An official explanation is imminent.' : 'Identity unknown. Confidence inexplicably high.';
      label = v.paused ? 'STAND BY' : 'LIVE BRIEFING';
    }
    ctx.el.replaceChildren(h('div.pc-host', { className: `pc-host pc-${v.phase}` },
      h('img.pc-backdrop', { src: ctx.asset('city-hall.svg'), alt: '' }), h('div.pc-shade'),
      h('div.pc-channel', h('b', 'CH 01'), h('span', 'CIVIC PUBLIC NETWORK')),
      h('div.pc-status', v.phase === 'finished' ? 'OFF AIR' : v.phase === 'setup' ? 'COMING UP' : v.paused ? 'STAND BY' : 'LIVE'),
      h('div.pc-city-sign', 'CITY HALL'),
      !['reveal', 'finished'].includes(v.phase) && figures(), h('section.pc-copy', ...copy),
      h('div.pc-lower', h('div.pc-lower-main', h('b.pc-label', label),
        h('div', h('div.pc-lower-name', lowerName), h('div.pc-lower-sub', lowerSub)),
        ['live', 'guess'].includes(v.phase) && h('div.pc-counter', `QUESTION ${v.questions}`)),
      h('div.pc-ticker', 'LOCAL NEWS / ', v.phase === 'live' ? 'Reporters: hint through your questions. Never say the secret outright. Faster answers mean more questions.' : 'One presenter. An entire press corps. A deeply questionable explanation.'))));
    // Reporters waiting their turn share a view. Group identical screens to stay
    // comfortably within the relay's message budget even with twelve players.
    const groups = new Map();
    for (const seat of s.seats) {
      const view = { pc: phoneView(s, seat.id), color: '#f4be57' };
      const key = JSON.stringify(view);
      if (!groups.has(key)) groups.set(key, { ids: [], view });
      groups.get(key).ids.push(seat.id);
    }
    for (const { ids, view } of groups.values()) ctx.show(ids, view);
  }
  ctx.on('message', (p, data) => {
    if (data?.type !== 'pc-action' || data.match !== s.match) return;
    perform(p.id, data.action, data.revision);
  });
  const updatePresence = (p, connected) => {
    if (p) presence(s, p.id, connected);
    else for (const seat of s.seats) presence(s, seat.id, Boolean(ctx.player(seat.id)?.connected));
    render();
  };
  ctx.on('join', (p) => updatePresence(p, true));
  ctx.on('leave', (p) => updatePresence(p, false));
  try {
    await styleReady;
    await ctx.sleep(0);
    render();
    while (!done) await ctx.sleep(200);
  } finally {
    style.remove();
    ctx.el.classList.remove('pc-stage');
  }
}
