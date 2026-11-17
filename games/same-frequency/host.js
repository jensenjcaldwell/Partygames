import { SPECTRUMS } from './spectrums.js';
import { createSession, act, captain, presence, publicView, phoneView } from './model.js';
import { dial, waves } from './dial.js';
import { createAudio } from './audio.js';

export default async function (ctx) {
  const { h } = ctx;
  if (ctx.connected.length < 3 || ctx.connected.length > 12) return ctx.say('Find your frequency', 'Gather 3–12 players to start.', 3500);
  const s = createSession(ctx.shuffle(ctx.connected), ctx.shuffle(SPECTRUMS), crypto.randomUUID());
  const css = h('link', { rel: 'stylesheet', href: ctx.asset('style.css') });
  const loaded = new Promise((resolve, reject) => {
    css.onload = resolve; css.onerror = () => reject(new Error('Could not load the radio lounge.'));
  });
  document.head.append(css);
  ctx.el.classList.add('sf-stage');
  ctx.music(null);
  const audio = createAudio();
  let done = false;
  let phoneTimer = null, lastPhoneUpdate = 0;
  const sentViews = new Map();
  function sendPhones() {
    phoneTimer = null;
    lastPhoneUpdate = Date.now();
    const groups = new Map();
    for (const p of s.seats) {
      const view = { sf: phoneView(s, p.id), color: '#eaa25c' }, key = JSON.stringify(view);
      if (sentViews.get(p.id) === key) continue;
      sentViews.set(p.id, key);
      if (!groups.has(key)) groups.set(key, { ids: [], view });
      groups.get(key).ids.push(p.id);
    }
    for (const { ids, view } of groups.values()) ctx.show(ids, view);
  }
  function perform(id, action, value, host = false, envelope = s) {
    if (action === 'lobby' && s.phase === 'finished' && (host || captain(s) === id)) {
      done = true;
      return;
    }
    const before = s.phase;
    if (!act(s, id, { match: envelope.match, round: envelope.round, phase: envelope.phase, action, value }, host)) return;
    if (s.phase !== before) audio.effect(s.phase === 'reveal' ? 'reveal' : s.phase === 'finished' ? 'win' : 'tune');
    else audio.effect('click');
    audio.mood(['clue', 'guess', 'debate'].includes(s.phase) ? 'think' : 'lounge');
    render();
  }
  function button(label, action, secondary = false, disabled = false) {
    const envelope = { match: s.match, round: s.round, phase: s.phase };
    return h('button.sf-button' + (secondary ? '.secondary' : ''), {
      disabled, onclick: () => perform(captain(s), action, undefined, true, envelope),
    }, label);
  }
  const eyebrow = (text) => h('p.sf-eyebrow', text);
  const copy = (text) => h('p.sf-copy', text);
  function render() {
    const v = publicView(s), revealed = v.phase === 'reveal';
    let content;
    if (v.phase === 'setup') {
      content = h('div.sf-intro',
        h('section.sf-intro-copy', eyebrow('A game of reading the room'),
          h('h1.sf-title', 'Same', h('br'), h('em', 'Frequency.')),
          copy('Different minds. One hidden signal.'),
          h('ol.sf-rules', h('li', h('b', 'Give a clue.'), ' Only the DJ sees the target.'),
            h('li', h('b', 'Tune in.'), ' Place your guess, then talk it over.'),
            h('li', h('b', 'Find the signal.'), ' Closer guesses earn more points.')),
          button('Let’s tune in →', 'start', false, ctx.connected.length < 3),
          h('p.sf-fine', `${s.total} rounds · Everyone is the DJ once · No rush`)),
        h('div.sf-radio', h('div.sf-radio-top', h('span', 'FM / HUMAN CONNECTION'), waves(h)),
          dial({ target: 67, markers: [{ guess: 32, color: '#c78261' }, { guess: 64, color: '#7c9b92' }, { guess: 78, color: '#d6aa50' }], demo: true }),
          h('div.sf-endpoints', h('span', 'On different planets'), h('span', 'Reading minds')),
          h('div.sf-radio-bottom', h('span.sf-knob'), h('b', 'TUNE INTO EACH OTHER'), h('span.sf-knob'))));
    } else if (v.phase === 'finished') {
      const ranked = [...v.players].sort((a, b) => b.score - a.score);
      const winners = ranked.filter((p) => p.score === ranked[0].score).map((p) => p.name);
      content = h('div.sf-finish', eyebrow('The broadcast is complete'), h('h1.sf-title', 'Beautifully', h('em', ' in sync.')),
        copy(`${winners.join(' & ')} ${winners.length > 1 ? 'share the top spot' : 'wins'} with ${ranked[0].score} points.`),
        h('div.sf-final-grid', ranked.map((p, i) => h('div.sf-final-row',
          h('span', String(i + 1).padStart(2, '0')), h('b', p.name), h('strong', `${p.score} pts`)))),
        h('div.sf-controls',
          button('Play again (same players) →', 'replay'),
          h('button.sf-button.secondary', { onclick: () => { done = true; } }, 'New players (back to lobby)')),
        waves(h));
    } else {
      const markers = v.players.filter((p) => p.guess !== undefined);
      const submitted = v.players.filter((p) => p.id !== v.giver.id && p.submitted).length;
      const guessers = v.players.filter((p) => p.id !== v.giver.id && p.connected).length;
      const result = v.result;
      const heading = v.phase === 'clue' ? 'Find the words.' : v.phase === 'guess' ? 'Follow the clue.' : v.phase === 'debate' ? 'Talk it over.' : v.skipped ? 'Signal skipped.' : 'There’s the signal.';
      const instruction = v.phase === 'clue' ? `${v.giver.name} is finding a clue for a secret spot on this spectrum.` :
        v.phase === 'guess' ? 'Where does this clue belong? Tune the dial on your phone.' :
        v.phase === 'debate' ? 'All needles are visible. Make your case, change your mind, then reveal.' :
        v.skipped ? 'No points this round. A fresh frequency is up next.' : 'The green band pays 4 points. How close did you get?';
      content = h('div.sf-round',
        h('section.sf-main',
          h('div.sf-round-heading', eyebrow(`Track ${v.round + 1} / ${v.total}`),
            h('span.sf-status', v.phase === 'clue' ? 'FINDING A SIGNAL' : v.phase === 'guess' ? `${submitted} / ${guessers} TUNED IN` : v.phase === 'debate' ? 'OPEN FOR DISCUSSION' : 'SIGNAL FOUND')),
          h('h1.sf-heading', heading),
          h('div.sf-clue', v.clue ? [h('span.sf-quote', '“'), h('p', v.clue), h('span.sf-quote', '”')] : [waves(h), h('p.sf-clue-wait', 'A little imagination. A very specific frequency.')]),
          h('div.sf-dial-wrap', dial({ ...(revealed ? { target: v.target } : {}), markers }),
            !revealed && h('div.sf-hidden-label', 'TARGET HIDDEN'),
            revealed && h('div.sf-target-label', `TARGET ${v.target}`)),
          h('div.sf-endpoints', h('span', h('i', '← '), v.spectrum[0]), h('span', v.spectrum[1], h('i', ' →')))),
        h('aside.sf-sidebar', eyebrow('Your DJ'), h('div.sf-dj-name', v.giver.name),
          !v.giver.connected && h('p.sf-offline', 'DJ disconnected. Rejoin to continue, or skip this round.'),
          h('div.sf-rule-line'), copy(instruction),
          h('div.sf-scoring', eyebrow('Closer sounds better'),
            ...[[4, 'Within 5', 'green'], [3, 'Within 10', 'red'], [2, 'Within 15', 'orange'], [1, 'Within 25', 'gold']].map(([n, text, color]) => h('div', h('i', { className: `sf-swatch ${color}` }), h('b', `${n} pts`), h('span', text)))),
          h('p.sf-fine', 'DJ bonus: the rounded average of submitted guesses’ points.'),
          revealed && !v.skipped && h('div.sf-bonus', `DJ earned +${result.points.find((p) => p.id === v.giver.id).gain}`),
          h('div.sf-controls',
            v.phase === 'guess' && button('Discuss guesses →', 'discuss', false, !submitted),
            v.phase === 'debate' && button('Reveal the signal →', 'reveal'),
            revealed && button(v.round + 1 >= v.total ? 'Final standings →' : 'Next DJ →', 'next'),
            !revealed && button('Skip this round', 'skip', true))),
        h('div.sf-players', { style: { '--columns': Math.min(6, v.players.length) } }, v.players.map((p, i) => {
          const gain = result?.points.find((x) => x.id === p.id)?.gain;
          return h('div.sf-player', { style: { '--player': p.color, '--delay': `${i * 45}ms` } },
            h('i.sf-player-dot'), h('b', p.name),
            h('span.sf-player-state', !p.connected ? 'Away' : p.id === v.giver.id ? 'DJ' : revealed && p.guess !== undefined ? `${p.guess} · +${gain}` : p.guess !== undefined ? `Dial ${p.guess}` : p.submitted ? 'Tuned in ✓' : 'Listening…'),
            h('strong', `${p.score}`));
        })));
    }
    ctx.el.replaceChildren(h('div', { className: `sf-host sf-${v.phase}` },
      h('header.sf-topline', h('b', 'sf', h('span', ' / SAME FREQUENCY')), h('span', 'GOOD COMPANY. BETTER SIGNAL.')), content,
      h('footer.sf-footer', h('span', 'INDEPENDENT THOUGHT / SHARED FREQUENCY'), h('span', 'EST. RIGHT NOW'))));
    // Coalesce a roomful of simultaneous guesses below the relay's 20/s
    // message limit. Public rendering remains immediate; phones update <800ms.
    if (!phoneTimer) phoneTimer = setTimeout(sendPhones, Math.max(0, 800 - (Date.now() - lastPhoneUpdate)));
  }
  ctx.on('message', (p, data) => {
    if (data?.type !== 'sf-action' || data.match !== s.match) return;
    perform(p.id, data.action, data.value, false, data);
  });
  const updatePresence = (p, connected) => {
    if (p && connected) sentViews.delete(p.id);
    if (p) presence(s, p.id, connected);
    else for (const seat of s.seats) presence(s, seat.id, Boolean(ctx.player(seat.id)?.connected));
    render();
  };
  ctx.on('join', (p) => updatePresence(p, true));
  ctx.on('leave', (p) => updatePresence(p, false));
  try {
    await loaded; render();
    while (!done) await ctx.sleep(200);
  } finally {
    clearTimeout(phoneTimer);
    audio.close(); css.remove(); ctx.el.classList.remove('sf-stage');
  }
}
