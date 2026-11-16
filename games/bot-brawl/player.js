import { ARENAS, CARDS, POWERS, ARROWS } from './engine.js';
import { installStyle } from './render.js';
import { artElement } from './art.js';
import { hazardRules } from './hazards.js';

export default async function (ctx) {
  await installStyle(ctx);
  const { h } = ctx;
  let latest = null, cards = [], usePower = false, token = '', pending = false, ticker = null;
  const storageKey = `bot-brawl:${ctx.me.code}:${ctx.me.id}`;
  const send = (data) => ctx.send({ ...data, match: latest.match, round: latest.round });
  function save() { try { sessionStorage.setItem(storageKey, JSON.stringify({ token, cards, usePower })); } catch {} }
  function clearTicker() { clearInterval(ticker); ticker = null; }
  ctx.on('view', (view) => {
    clearTicker();
    if (!view?.botBrawl) { latest = null; ctx.renderView(view); return; }
    const next = view.botBrawl;
    const nextToken = `${next.match}:${next.round}`;
    if (nextToken !== token) {
      cards = []; usePower = false; token = nextToken;
      try {
        const old = JSON.parse(sessionStorage.getItem(storageKey));
        if (old?.token === token && Array.isArray(old.cards)) {
          cards = old.cards.filter((c) => Object.hasOwn(CARDS, c)).slice(0, 4); usePower = !!old.usePower;
        }
      } catch {}
    }
    if (next.locked && next.program) { cards = [...next.program.cards]; usePower = next.program.power; }
    latest = next; pending = false; draw();
  });

  function draw() {
    clearTicker();
    const a = latest;
    if (!a) return;
    if (a.phase === 'setup') return setup(a);
    const b = a.bot;
    const panel = h('div.bb-phone');
    panel.append(h('div.bb-phone-head', artElement(h, b.number, b.color), h('div',
      h('b', `#${b.number} · ${b.name}`), h('p', `Round ${a.round}/${a.maxRounds} · ${a.mode === 'race' ? 'Flag race' : 'Survival'}`),
      h('p', a.arena.name),
      h('p', `${b.alive ? `${b.hp}/3 hull · Facing ${ARROWS[b.dir]}` : 'Bot wrecked'} · ${a.mode === 'race' ? `${b.flags}/3 flags` : `${b.lives} lives left`}`))));
    if (a.phase === 'results') {
      panel.append(h('h2', a.winner ? 'Employee of the month!' : 'Shift survived. Dignity uncertain.'), h('p', a.winnerText),
        h('div.bb-phone-status', `${b.kos} knockouts · ${b.falls} spectacular wrecks`));
    } else if (a.phase === 'program' && b.alive) programming(panel, a);
    else {
      panel.append(h('h2', a.phase === 'replay' ? 'Instant regret replay' : !b.alive ? b.lives || a.mode === 'race' ? 'Rebooting…' : 'You’re in the scrap heap' : `Beat ${Math.max(1, a.beat + 1)} of 4`),
        h('p', !b.alive ? b.lives || a.mode === 'race' ? 'You return next round with fresh hull. Watch the chaos on TV.' : 'Your shift is over. Cheer on the remaining bots!' : 'Watch the factory on TV. Your program is running.'),
        slots(a.program?.cards || cards, false, a.beat));
    }
    ctx.el.replaceChildren(panel);
  }

  function slots(program, editable, beat = -1) {
    return h('div.bb-slots', [0, 1, 2, 3].map((i) => h(`button.bb-slot${program[i] ? '.filled' : ''}`, {
      type: 'button', disabled: !editable || !program[i],
      style: i === beat ? { outline: '3px solid #8af4eb' } : {},
      'aria-label': `Slot ${i + 1}: ${CARDS[program[i]]?.label || 'empty'}${editable && program[i] ? '. Tap to remove.' : ''}`,
      onclick: () => { cards.splice(i, 1); save(); draw(); },
    }, h('small', `${i + 1}`), h('b', CARDS[program[i]]?.icon || '+'), h('small', CARDS[program[i]]?.label || 'Empty'))));
  }

  function programming(panel, a) {
    const clock = h('span.bb-phone-timer');
    const tick = () => {
      const left = Math.max(0, Math.ceil((a.endsAt - Date.now()) / 1000));
      clock.textContent = `${left}s`;
      if (!ctx.el.isConnected) clearTicker();
      if (left === 0) { clearTicker(); if (!pending) { pending = true; draw(); } }
    };
    panel.append(h('div.bb-phone-status', h('b', a.locked ? '✓ Program locked' : 'Queue your four moves'), ' · ', clock),
      h('div.bb-note', h('strong', a.event.label), a.event.help),
      a.collapse ? h('div.bb-note.warning', h('strong', '! Floor collapse after beat 4'), 'Orange-striped tiles become instant-wreck pits. Move inward!') : h('p', `You move ${a.priority}${a.priority === 1 ? 'st' : a.priority === 2 ? 'nd' : a.priority === 3 ? 'rd' : 'th'} in priority this round.`),
      slots(cards, !a.locked && !pending));
    const expired = Date.now() >= a.endsAt;
    if (a.locked) {
      panel.append(h('h2', 'Plan committed. Probably fine.'), h('p', 'Your cards stay secret until everyone is ready.'),
        h('button.bb-edit', { disabled: pending || expired, onclick: () => { pending = true; send({ type: 'unlock' }); draw(); } }, 'Edit program'));
    } else {
      panel.append(h('p', 'Tap cards in order. Repeats are allowed. Tap a filled slot to remove it.'),
        h('div.bb-palette', Object.entries(CARDS).map(([id, c]) => h('button.bb-card', {
          disabled: cards.length === 4 || pending || expired, title: c.help, 'data-card': id,
          onclick: () => { if (cards.length < 4) { cards.push(id); save(); draw(); } },
        }, h('b', c.icon), h('span', c.label)))));
    }
    if (a.bot.power) {
      const p = POWERS[a.bot.power];
      panel.append(h(`button.bb-power-toggle${usePower ? '.on' : ''}`, { disabled: a.locked || pending || expired,
        'aria-pressed': usePower, onclick: () => { usePower = !usePower; save(); draw(); },
      }, h('b', p.icon), h('div', h('b', `${usePower ? 'Use' : 'Save'} ${p.label.toLowerCase()}`), h('span', p.help))));
    }
    if (!a.locked) panel.append(h('button.bb-lock', {
      disabled: cards.length !== 4 || pending || expired,
      onclick: () => { pending = true; send({ type: 'program', cards: [...cards], power: usePower }); draw(); },
    }, expired ? 'Autopilot is taking over…' : pending ? 'Locking…' : cards.length < 4 ? `Choose ${4 - cards.length} more card${cards.length === 3 ? '' : 's'}` : 'Lock in program'));
    panel.append(h('div.bb-hazard-guide', { 'aria-label': 'Factory hazard rules' },
      hazardRules(a.event).map((rule) => h(`div.bb-hazard-row.${rule.kind}`, h('span.bb-hazard-icon', rule.icon),
        h('div', h('b', rule.label), h('span', rule.text))))),
      h('details.bb-help', h('summary', 'Movement & power-up guide'),
      h('p', 'Each beat: bots act in priority order, belts carry bots, then factory lasers fire. Priority rotates each round. Walls block movement and lasers; bots can shove whole chains into pits.'),
      h('dl', Object.values(CARDS).map((c) => [h('dt', `${c.icon} ${c.label}`), h('dd', c.help)])),
      h('p', 'Crates arrive in round 2 and give one volatile power-up. Toggle Use before locking in. Stored power-ups last until used.'),
      h('dl', Object.values(POWERS).map((p) => [h('dt', `${p.icon} ${p.label}`), h('dd', p.help)]))));
    tick(); if (!expired) ticker = setInterval(tick, 500);
  }

  function setup(a) {
    const config = (extra) => send({ type: 'settings', ...extra });
    const option = (label, field, value) => h(`button.bb-option${a.settings[field] === value ? '.selected' : ''}`, {
      'aria-pressed': a.settings[field] === value, onclick: () => config({ [field]: value }),
    }, label);
    const panel = h('div.bb-phone', h('h2', 'Bot Brawl'), h('p', 'Welcome to the scrapyard. Your warranty has already expired.'));
    if (a.captain) panel.append(
      h('p.bb-label', 'Choose the job'), h('div.bb-options', option('⚑ Flag race', 'mode', 'race'), option('ϟ Survival', 'mode', 'survival')),
      h('p', a.settings.mode === 'race' ? 'First to three moving flags. Unlimited reboots. Ten-round limit.' : 'Three lives. Shrinking floor. Last bot with lives wins. Eight-round limit.'),
      h('p.bb-label', 'Choose an arena'),
      h('div.bb-arena-options', ARENAS.map((arena) => h(`button.bb-arena-option${a.settings.arena === arena.id ? '.selected' : ''}`, {
        'aria-pressed': a.settings.arena === arena.id, onclick: () => config({ arena: arena.id }),
      }, h('b', `${arena.icon} ${arena.name}`), h('span', arena.description)))),
      h('p', 'No power-ups in round 1. From round 2, crates contain risky upgrades: rocket heat, magnet recoil and shields that can overload.'),
      h('div.bb-stepper', 'Computer bots', h('button', { disabled: a.settings.bots === 0, 'aria-label': 'Remove computer opponent', onclick: () => config({ bots: a.settings.bots - 1 }) }, '−'),
        h('b', String(a.settings.bots)), h('button', { disabled: a.settings.bots === 8 - a.humans, 'aria-label': 'Add computer opponent', onclick: () => config({ bots: a.settings.bots + 1 }) }, '+')),
      h('p.bb-label', 'Planning time'), h('div.bb-options', ...[25, 35, 50].map((s) => option(`${s}s`, 'seconds', s))),
      h('button.bb-lock', { onclick: () => config({ start: true }) }, `Clock in · ${a.humans + a.settings.bots} bots`));
    else panel.append(h('div.bb-phone-status', `${a.captainName} is choosing the shift settings. You can also use the TV controls.`),
      h('h2', ARENAS.find((arena) => arena.id === a.settings.arena)?.name),
      h('p', ARENAS.find((arena) => arena.id === a.settings.arena)?.description));
    ctx.el.replaceChildren(panel);
  }
}
