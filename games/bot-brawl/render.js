import { ARROWS, CARDS, POWERS, collapseCells } from './engine.js';
import { factoryLanes, hazardRules, tileDescription } from './hazards.js';
import { artElement, robotArt, emitterArt } from './art.js';

export function installStyle(ctx) {
  const id = 'bot-brawl-style';
  let link = document.getElementById(id);
  if (link?.sheet) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (!link) {
      link = Object.assign(document.createElement('link'), { id, rel: 'stylesheet', href: ctx.asset('style.css') });
      document.head.append(link);
    }
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', () => reject(new Error('Could not load the factory stylesheet. Please reload.')), { once: true });
  });
}

export function createArena(ctx) {
  const { h } = ctx;
  const arenaName = h('p.bb-tagline');
  const title = h('div', h('h1.bb-title', 'Bot Brawl'), arenaName);
  const round = h('div.bb-round');
  const laserStatus = h('div.bb-laser-status');
  const scores = h('div.bb-scoreboard');
  const event = h('div.bb-note.bb-event-note');
  const warning = h('div.bb-note.warning');
  const board = h('div.bb-board', { role: 'img', 'aria-label': 'Factory arena. Numbered robots, conveyors, laser lanes, pits and power-up crates.' });
  const emitters = h('div.bb-emitters');
  const factory = h('div.bb-factory-frame', board, emitters);
  const cells = [], robots = new Map();
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
    const cell = h('div.bb-cell', { style: position(x, y) });
    cells.push(cell); board.append(cell);
  }
  const props = h('div'); board.append(props);
  const paths = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  paths.classList.add('bb-laser-paths'); paths.setAttribute('viewBox', '0 0 9 9'); paths.setAttribute('aria-hidden', 'true'); board.append(paths);
  const beams = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  beams.classList.add('bb-beams'); beams.setAttribute('viewBox', '0 0 9 9'); board.append(beams);
  const replay = h('div.bb-replay', { hidden: true }, '● INSTANT REGRET · REPLAY');
  const phase = h('h2.bb-phase');
  const track = h('div.bb-beat-track');
  const programs = h('div.bb-programs');
  const feed = h('div.bb-feed', { 'aria-live': 'polite' });
  const guide = h('div.bb-hazard-guide', { 'aria-label': 'Factory hazard rules' });
  const footer = h('div.bb-footer');
  const root = h('div.bb-root',
    h('header.bb-header', title, h('div.bb-round-wrap', round, laserStatus)),
    h('div.bb-layout',
      h('aside.bb-side', h('p.bb-label', 'The shift roster'), scores, warning),
      h('div.bb-arena-wrap', factory, replay),
      h('aside.bb-side', phase, track, programs, event, h('p.bb-label', 'Incident report'), feed,
        guide)), footer);
  ctx.el.replaceChildren(root);
  return {
    root,
    draw(s, ui = {}) {
      round.replaceChildren(`${s.mode === 'race' ? 'FLAG RACE' : 'FACTORY SURVIVAL'} · ROUND ${s.round}/${s.maxRounds}`, h('br'),
        s.mode === 'race' ? 'First to 3 flags · 3 hull' : '3 lives · 3 hull per life');
      arenaName.textContent = `${s.arena.name.toUpperCase()} · ZERO DAYS WITHOUT AN INCIDENT`;
      const off = s.event.id === 'blackout';
      const firing = s.beams.some((beam) => beam.factory);
      const damage = s.event.id === 'overdrive' ? 2 : 1;
      laserStatus.className = `bb-laser-status${off ? ' is-off' : firing ? ' is-firing' : ''}`;
      laserStatus.textContent = off ? 'ϟ FACTORY LASERS OFF' : firing ? `ϟ FIRING NOW · −${damage} HULL / BEAM` : `ϟ LASERS ARMED · AFTER BELTS · −${damage} HULL`;
      factory.classList.toggle('is-firing', firing);
      factory.classList.toggle('is-off', off);
      const doomed = new Set(collapseCells(s).map((c) => `${c.x},${c.y}`));
      const rays = factoryLanes(s);
      const lanes = new Set(off ? [] : rays.flatMap((ray) => ray.cells.map((c) => `${c.x},${c.y}`)));
      for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
        const tile = s.tiles[y][x], cell = cells[y * 9 + x];
        cell.className = `bb-cell ${tile.type}${doomed.has(`${x},${y}`) ? ' doom' : ''}${lanes.has(`${x},${y}`) ? ' lane' : ''}`;
        cell.title = tileDescription(tile, s.event, { doomed: doomed.has(`${x},${y}`), lane: lanes.has(`${x},${y}`) });
        cell.replaceChildren(...(tile.type === 'belt' ? [h('span.bb-belt-arrow', ARROWS[(tile.dir + (s.event.id === 'reverse' ? 2 : 0)) % 4]),
          ...(s.event.id === 'double' ? [h('span.bb-belt-speed', '×2')] : [])] : tile.type === 'pit' ? [h('span.bb-pit-symbol', '×')] : []));
      }
      paths.replaceChildren(...(off ? [] : rays.filter((ray) => ray.cells.length).map(({ emitter, cells }) => {
        const end = cells[cells.length - 1];
        const line = document.createElementNS(paths.namespaceURI, 'line');
        for (const [key, value] of Object.entries({ x1: emitter.x + .5, y1: emitter.y + .5, x2: end.x + .5, y2: end.y + .5 })) line.setAttribute(key, value);
        return line;
      })));
      emitters.replaceChildren(...s.emitters.map((emitter, i) => {
        const label = off ? `Laser ${i + 1}: OFF this round. Robot lasers still work.`
          : `Laser ${i + 1} fires ${['up', 'right', 'down', 'left'][emitter.dir]} after belts on every beat: ${damage} hull damage to the first bot. Walls stop the beam.`;
        const gun = h('div.bb-emitter', { style: emitterPosition(emitter), title: label, role: 'img', 'aria-label': label });
        gun.innerHTML = emitterArt();
        return gun;
      }));
      props.replaceChildren(...s.crates.map((c) => h('div.bb-prop', { style: position(c.x, c.y) },
        h('span.bb-crate-mark', POWERS[c.power].icon))),
      s.flag && !s.flagClaimed ? h('div.bb-prop', { style: position(s.flag.x, s.flag.y) }, h('span.bb-flag-mark', '⚑')) : h('span'));
      for (const b of s.bots) {
        if (!robots.has(b.id)) {
          const bot = h('div.bb-bot', { style: { '--bot-color': b.color } });
          bot.innerHTML = robotArt(b.number);
          bot.append(h('span.bb-bot-number', String(b.number)), h('span.bb-heading', '↑'));
          robots.set(b.id, bot); board.append(bot);
        }
        const bot = robots.get(b.id);
        Object.assign(bot.style, position(Math.max(0, Math.min(8, b.x)), Math.max(0, Math.min(8, b.y))));
        bot.classList.toggle('is-down', !b.alive);
        bot.classList.toggle('has-shield', !!b.shield);
        bot.classList.toggle('is-active', ui.active === b.id);
        bot.querySelector('.bb-heading').style.rotate = `${b.dir * 90}deg`;
      }
      beams.replaceChildren(...s.beams.map((beam) => {
        const line = document.createElementNS(beams.namespaceURI, 'line');
        for (const [key, val] of Object.entries({ x1: beam.x1 + .5, y1: beam.y1 + .5, x2: beam.x2 + .5, y2: beam.y2 + .5 })) line.setAttribute(key, val);
        return line;
      }));
      // Keep beams above the robots even after their first insertion.
      board.append(beams);
      scores.replaceChildren(...s.bots.map((b) => h(`div.bb-score${ui.active === b.id ? '.is-active' : ''}${!b.alive ? '.is-out' : ''}`,
        artElement(h, b.number, b.color),
        h('div', h('div.bb-name', `${b.number}. ${b.name}`), h('span.bb-meta',
          `${b.cpu ? 'CPU · ' : ''}${s.mode === 'race' ? `${b.flags}/3 flags` : `${b.lives} lives`} · ${b.alive ? `${b.hp} hull` : b.lives || s.mode === 'race' ? 'reboot next round' : 'scrapped'}`)),
        h('div.bb-score-value', ui.planning ? ui.locked?.has(b.id) || b.cpu || !b.alive ? '✓' : '…' : b.power ? POWERS[b.power].icon : `${b.kos} KO`))));
      event.replaceChildren(h('strong', s.event.label));
      event.title = s.event.help;
      warning.hidden = !doomed.size;
      warning.replaceChildren(h('strong', '! COLLAPSE AFTER BEAT 4'), 'Orange-striped tiles become pits. Move inward this round.');
      phase.textContent = ui.replay ? 'Instant regret' : ui.planning ? 'Program your bot' : ui.phase || `Beat ${s.beat + 1} of 4`;
      track.replaceChildren(...[0, 1, 2, 3].map((i) => h(`div.bb-beat${!ui.planning && i === s.beat ? '.on' : !ui.planning && i < s.beat ? '.done' : ''}`, String(i + 1))));
      programs.replaceChildren(...s.priority.map((id) => {
        const b = s.bots.find((p) => p.id === id);
        if (!b.alive && s.mode === 'survival' && !b.lives) return null;
        const cards = ui.programs?.get(id)?.cards;
        return h('div.bb-program-row', h('b', `#${b.number}`), [0, 1, 2, 3].map((i) => h(`span${!ui.planning && i === s.beat ? '.current' : ''}`,
          ui.planning ? '▰' : CARDS[cards?.[i]]?.icon || '·')));
      }).filter(Boolean));
      const entries = ui.feed?.length ? ui.feed.slice(-1) : [{ text: ui.planning ? 'Four cards. One questionable plan. Lock in on your phone.' : 'Everything is probably under control.' }];
      feed.replaceChildren(...entries.map((e) => h(`p${['fall', 'flag', 'collapse'].includes(e.type) ? '.spicy' : ''}`, e.text)));
      guide.replaceChildren(...hazardRules(s.event).map((rule) => h(`div.bb-hazard-row.${rule.kind}`,
        h('span.bb-hazard-icon', rule.icon), h('div', h('b', rule.label), h('span', rule.text)))));
      replay.hidden = !ui.replay;
      footer.replaceChildren(h('span', `Move priority: ${s.priority.map((id) => `#${s.bots.find((b) => b.id === id).number}`).join(' → ')}`),
        h('span', ui.planning ? 'Dashed red = potential laser path. First bot blocks each beam.' : 'Moves → belts → factory lasers. First bot blocks each beam.'));
    },
  };
}

function position(x, y) { return { left: `${x / 9 * 100}%`, top: `${y / 9 * 100}%` }; }

function emitterPosition(emitter) {
  const along = (n) => { const f = (n + .5) / 9; return `calc(${f * 100}% + ${1.08 * (1 - 2 * f)}em)`; };
  return {
    left: emitter.x < 0 ? '.45em' : emitter.x > 8 ? 'calc(100% - .45em)' : along(emitter.x),
    top: emitter.y < 0 ? '.45em' : emitter.y > 8 ? 'calc(100% - .45em)' : along(emitter.y),
    '--gun-angle': `${(emitter.dir - 1) * 90}deg`,
  };
}
