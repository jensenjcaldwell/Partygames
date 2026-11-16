// The rules are independent of the TV, networking and animation. Replays use
// copies of state; they never run the simulation a second time.
import { SPAWNS, FLAG_ROUTE, buildArena } from './arenas.js';
export { ARENAS } from './arenas.js';
export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const ARROWS = ['↑', '→', '↓', '←'];
export const CARDS = {
  forward: { label: 'Forward', icon: '↑', help: 'Move one tile in the direction you face.' },
  left: { label: 'Turn left', icon: '↶', help: 'Rotate left. Stay on your tile.' },
  right: { label: 'Turn right', icon: '↷', help: 'Rotate right. Stay on your tile.' },
  back: { label: 'Reverse', icon: '↓', help: 'Move one tile backward. Keep facing the same way.' },
  uturn: { label: 'U-turn', icon: '⤵', help: 'Turn around. Stay on your tile.' },
  laser: { label: 'Laser', icon: 'ϟ', help: 'Hit the first robot ahead for one damage.' },
};
export const POWERS = {
  shield: { label: 'Volatile shield', icon: '⬡', help: 'Block one laser hit or shove. If unused at round end, it overloads for 1 hull damage.' },
  boost: { label: 'Rocket boots', icon: '»', help: 'Your next Forward rockets three tiles, then burns 1 hull. You cannot brake before a pit.' },
  magnet: { label: 'Junk magnet', icon: '⊂', help: 'Pull the nearest aligned bot up to two tiles toward you (range 4). Recoil costs 1 hull, even if nothing is caught.' },
};
export const EVENTS = [
  { id: 'normal', label: 'Regularly scheduled chaos', help: 'Belts move once. Factory lasers fire after every beat.' },
  { id: 'reverse', label: 'Wrong-way Wednesday', help: 'All conveyor belts run backward this round.' },
  { id: 'double', label: 'Overtime!', help: 'Conveyor belts move twice after every beat.' },
  { id: 'overdrive', label: 'Laser inspection', help: 'Factory lasers deal two damage instead of one.' },
  { id: 'blackout', label: 'Someone unplugged it', help: 'Factory lasers are off. Robot lasers still work.' },
];
const BOT_NAMES = ['Clank Sinatra', 'Rusty Business', 'Sir Scrap-a-Lot', 'Beep Trouble', 'Tin Diesel', 'Wheely Bad', 'Nuts & Bolts', 'Oops.exe'];
const COLORS = ['#ffb547', '#54d8d0', '#f17ca5', '#a9b9ff', '#bce466', '#ff895c', '#db9cff', '#77caff'];
export const copy = (value) => JSON.parse(JSON.stringify(value));
export const validProgram = (cards) => Array.isArray(cards) && cards.length === 4 && cards.every((c) => Object.hasOwn(CARDS, c));
export const tileAt = (s, x, y) => s.tiles[y]?.[x] ?? { type: 'pit' };
export const botAt = (s, x, y) => s.bots.find((b) => b.alive && b.x === x && b.y === y);
export const activeBots = (s) => s.bots.filter((b) => s.mode === 'race' || b.lives > 0);
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function createGame(players, options = {}, random = Math.random) {
  const mode = options.mode === 'survival' ? 'survival' : 'race';
  const humans = players.slice(0, 8);
  const count = Math.max(2, Math.min(8, humans.length + (Number(options.bots) || 0)));
  const { arena, tiles, emitters } = buildArena(options.arena);
  const s = {
    mode, size: 9, round: 0, beat: -1, maxRounds: mode === 'race' ? 10 : 8,
    arena, tiles, bots: [], crates: [], flag: null, flagIndex: 0, flagClaimed: false,
    event: EVENTS[0], priority: [], beams: [], events: [], collapse: 0, winnerIds: [], done: false,
    emitters,
  };
  for (let i = 0; i < count; i++) {
    const p = humans[i];
    const [x, y, dir] = SPAWNS[i];
    s.bots.push({
      id: p?.id ?? `cpu-${i}`, name: p?.name ?? BOT_NAMES[i - humans.length],
      color: p?.color || COLORS[i], cpu: !p, number: i + 1, x, y, dir,
      home: { x, y, dir }, hp: 3, lives: 3, alive: true, flags: 0, kos: 0, falls: 0,
      power: null, shield: 0, boost: false, lastHit: null, deathRound: 0,
    });
  }
  return s;
}

function log(s, type, text, data = {}) { s.events.push({ type, text, ...data }); }
function fall(s, b, source, cause) {
  if (!b.alive) return;
  b.alive = false; b.hp = 0; b.falls++; b.shield = 0; b.boost = false; b.lastHit = null;
  if (s.mode === 'survival') b.lives = Math.max(0, b.lives - 1);
  b.deathRound = s.round;
  const attacker = s.bots.find((p) => p.id === source && p.id !== b.id);
  if (attacker) attacker.kos++;
  log(s, 'fall', `${b.name} ${cause}${attacker ? ` — courtesy of ${attacker.name}` : ''}!`, { bot: b.id, source, x: b.x, y: b.y });
}
function hurt(s, b, amount, source, cause = 'laser') {
  if (!b.alive) return;
  if (b.shield) {
    b.shield = 0;
    log(s, 'shield', `${b.name}'s scrap shield ate that hit.`, { bot: b.id });
    return;
  }
  b.hp = Math.max(0, b.hp - amount); b.lastHit = source;
  log(s, 'hit', `${b.name} takes ${amount} ${cause} damage.`, { bot: b.id });
  if (b.hp === 0) fall(s, b, source, cause === 'laser' ? 'became spare parts' : `was wrecked by ${cause}`);
}
function collect(s, b) {
  if (!b.alive) return;
  const crate = s.crates.findIndex((c) => c.x === b.x && c.y === b.y);
  if (crate !== -1 && !b.power) {
    b.power = s.crates.splice(crate, 1)[0].power;
    log(s, 'pickup', `${b.name} found ${POWERS[b.power].label.toLowerCase()}.`, { bot: b.id });
  }
  if (s.mode === 'race' && !s.flagClaimed && s.flag?.x === b.x && s.flag?.y === b.y) {
    s.flagClaimed = true; b.flags++;
    log(s, 'flag', `${b.name} clocks in! Flag ${b.flags}/3.`, { bot: b.id });
  }
}

// Build the whole push chain before changing positions. A wall or shield
// blocks the entire chain; no bot can partially move into another bot.
export function moveBot(s, b, dir, source = b.id) {
  if (!b.alive) return false;
  const [dx, dy] = DIRS[dir];
  const chain = [b];
  let front = b;
  while (true) {
    const x = front.x + dx, y = front.y + dy;
    if (tileAt(s, x, y).type === 'wall') {
      log(s, 'bump', `${b.name}: wall. Definitely a wall.`, { bot: b.id });
      return false;
    }
    const next = botAt(s, x, y);
    if (!next) break;
    if (next.shield) {
      next.shield = 0;
      log(s, 'shield', `${next.name}'s shield blocks the whole shove.`, { bot: next.id });
      return false;
    }
    chain.push(next); front = next;
  }
  for (const item of chain.reverse()) {
    item.x += dx; item.y += dy;
    if (item !== b) log(s, 'push', `${b.name} shoves ${item.name}!`, { bot: item.id, source });
    if (tileAt(s, item.x, item.y).type === 'pit') fall(s, item, source, 'took the express route to the scrap heap');
    else collect(s, item);
  }
  return true;
}

function fire(s, origin, damage, source) {
  const [dx, dy] = DIRS[origin.dir];
  let x = origin.x + dx, y = origin.y + dy;
  const beam = { x1: origin.x, y1: origin.y, x2: origin.x, y2: origin.y, factory: source == null };
  while (x >= 0 && y >= 0 && x < s.size && y < s.size) {
    if (tileAt(s, x, y).type === 'wall') break;
    beam.x2 = x; beam.y2 = y;
    const hit = botAt(s, x, y);
    if (hit) { hurt(s, hit, damage, source); break; }
    x += dx; y += dy;
  }
  s.beams.push(beam);
}

export function usePower(s, b) {
  if (!b.alive || !b.power) return;
  const power = b.power; b.power = null;
  log(s, 'power', `${b.name} activates ${POWERS[power].label.toLowerCase()}!`, { bot: b.id });
  if (power === 'shield') b.shield = 1;
  if (power === 'boost') b.boost = true;
  if (power === 'magnet') {
    const target = s.bots.filter((p) => p.alive && p !== b && (p.x === b.x || p.y === b.y) && distance(p, b) <= 4)
      .sort((a, c) => distance(a, b) - distance(c, b))[0];
    if (target && distance(target, b) > 1) {
      const dir = target.x === b.x ? (target.y < b.y ? 2 : 0) : (target.x < b.x ? 1 : 3);
      const [dx, dy] = DIRS[dir];
      let blocked = false;
      for (let x = target.x + dx, y = target.y + dy; x !== b.x || y !== b.y; x += dx, y += dy) {
        if (tileAt(s, x, y).type === 'wall') { blocked = true; break; }
      }
      if (!blocked && target.shield) {
        target.shield = 0;
        log(s, 'shield', `${target.name}'s shield resists the magnet.`, { bot: target.id });
      } else if (!blocked) for (let step = 0; step < 2 && target.alive && distance(target, b) > 1; step++) {
        if (!moveBot(s, target, dir, b.id)) break;
      }
    }
    hurt(s, b, 1, b.id, 'magnet recoil');
  }
}

export function beginRound(s, random = Math.random) {
  s.round++; s.beat = -1; s.events = []; s.beams = [];
  s.event = s.round === 1 ? EVENTS[0] : EVENTS[Math.floor(random() * EVENTS.length)];
  const order = s.bots.map((b) => b.id);
  const offset = (s.round - 1) % order.length;
  s.priority = [...order.slice(offset), ...order.slice(0, offset)];
  s.flagIndex = (s.round - 1) % FLAG_ROUTE.length;
  s.flag = s.mode === 'race' ? { x: FLAG_ROUTE[s.flagIndex][0], y: FLAG_ROUTE[s.flagIndex][1] } : null;
  s.flagClaimed = false;
  if (s.round >= 2) replenishCrates(s, random);
  for (const b of s.bots) {
    b.shield = 0; b.boost = false; b.lastHit = null;
    if (!b.alive && (s.mode === 'race' || b.lives > 0)) respawn(s, b);
    collect(s, b);
  }
}

function respawn(s, b) {
  const safe = [];
  for (let y = 0; y < s.size; y++) for (let x = 0; x < s.size; x++) {
    if (['floor', 'belt'].includes(tileAt(s, x, y).type) && !botAt(s, x, y)) safe.push({ x, y });
  }
  safe.sort((a, c) => distance(a, b.home) - distance(c, b.home) || distance(a, { x: 4, y: 4 }) - distance(c, { x: 4, y: 4 }));
  if (!safe.length) return;
  Object.assign(b, safe[0], { alive: true, hp: 3, dir: b.home.dir, lastHit: null });
  log(s, 'respawn', `${b.name} is back. Mostly original parts.`, { bot: b.id });
}

function replenishCrates(s, random) {
  const options = [];
  for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) {
    if (tileAt(s, x, y).type !== 'floor' || botAt(s, x, y) || s.crates.some((c) => c.x === x && c.y === y) || (x === s.flag?.x && y === s.flag?.y)) continue;
    options.push({ x, y });
  }
  while (s.crates.length < 5 && options.length) {
    const point = options.splice(Math.floor(random() * options.length), 1)[0];
    s.crates.push({ ...point, power: Object.keys(POWERS)[Math.floor(random() * 3)] });
  }
}

export function collapseCells(s) {
  if (s.mode !== 'survival' || ![2, 4, 6].includes(s.round)) return [];
  const ring = s.round / 2 - 1;
  const result = [];
  for (let y = 0; y < s.size; y++) for (let x = 0; x < s.size; x++) {
    if (Math.min(x, y, 8 - x, 8 - y) === ring && tileAt(s, x, y).type !== 'pit') result.push({ x, y });
  }
  return result;
}

// One generator yield per visible action lets the TV animate the *actual*
// rules without giving phone clients control over timing or board state.
export function* resolveBeat(s, programs, beat) {
  s.beat = beat; s.events = []; s.beams = [];
  if (beat === 0) {
    for (const id of s.priority) {
      const b = s.bots.find((p) => p.id === id);
      if (programs.get(id)?.power && b.alive) usePower(s, b);
    }
    if (s.events.length) yield { kind: 'power', active: null };
  }
  for (const id of s.priority) {
    const b = s.bots.find((p) => p.id === id);
    if (!b.alive) continue;
    s.events = []; s.beams = [];
    const program = programs.get(id)?.cards;
    const card = validProgram(program) ? program[beat] : 'laser';
    if (card === 'left') b.dir = (b.dir + 3) % 4;
    else if (card === 'right') b.dir = (b.dir + 1) % 4;
    else if (card === 'uturn') b.dir = (b.dir + 2) % 4;
    else if (card === 'laser') fire(s, b, 1, b.id);
    else {
      const dir = card === 'back' ? (b.dir + 2) % 4 : b.dir;
      const boosted = card === 'forward' && b.boost;
      const steps = boosted ? 3 : 1;
      if (card === 'forward') b.boost = false;
      for (let step = 0; step < steps && b.alive; step++) if (!moveBot(s, b, dir)) break;
      if (boosted && b.alive) hurt(s, b, 1, b.id, 'rocket heat');
    }
    collect(s, b);
    yield { kind: 'action', active: id, card };
  }
  s.events = []; s.beams = [];
  // A bot gets exactly one belt ride per belt pass, even when pushed onto a
  // later bot's tile. Belt direction is read at the start of each pass.
  for (let pass = 0; pass < (s.event.id === 'double' ? 2 : 1); pass++) {
    const rides = s.priority.map((id) => s.bots.find((b) => b.id === id)).filter((b) => b.alive && tileAt(s, b.x, b.y).type === 'belt')
      .map((b) => ({ b, dir: (tileAt(s, b.x, b.y).dir + (s.event.id === 'reverse' ? 2 : 0)) % 4 }));
    for (const { b, dir } of rides) if (b.alive) moveBot(s, b, dir);
    yield { kind: 'belts', active: null };
    s.events = [];
  }
  s.beams = []; s.events = [];
  if (s.event.id !== 'blackout') {
    for (const laser of s.emitters) fire(s, laser, s.event.id === 'overdrive' ? 2 : 1, null);
  }
  yield { kind: 'factory', active: null };
}

export function endRound(s) {
  s.events = []; s.beams = [];
  for (const b of s.bots) if (b.alive && b.shield) {
    b.shield = 0;
    hurt(s, b, 1, b.id, 'shield overload');
  }
  const collapse = collapseCells(s);
  for (const { x, y } of collapse) s.tiles[y][x] = { type: 'pit' };
  if (collapse.length) {
    s.collapse++;
    log(s, 'collapse', 'The outer floor gives way. Management regrets nothing.');
    for (const b of s.bots) if (b.alive && tileAt(s, b.x, b.y).type === 'pit') fall(s, b, null, 'missed the floor-retraction memo');
    s.crates = s.crates.filter((c) => tileAt(s, c.x, c.y).type !== 'pit');
  }
  const contenders = activeBots(s);
  if ((s.mode === 'race' && s.bots.some((b) => b.flags >= 3)) || (s.mode === 'survival' && contenders.length <= 1) || s.round >= s.maxRounds) {
    s.done = true;
    const ranking = standings(s);
    s.winnerIds = ranking.filter((b) => compareBots(s, ranking[0], b) === 0).map((b) => b.id);
  }
}

function compareBots(s, a, b) {
  return s.mode === 'race'
    ? b.flags - a.flags || b.kos - a.kos || b.hp - a.hp || a.falls - b.falls
    : b.lives - a.lives || (a.lives === 0 ? b.deathRound - a.deathRound : b.hp - a.hp) || b.kos - a.kos;
}
export function standings(s) { return [...s.bots].sort((a, b) => compareBots(s, a, b)); }

// A small beam search plans four cards against known terrain, factory effects
// and stationary opponents. It cannot see anybody else's secret program.
export function planBot(s, bot, random = Math.random) {
  let candidates = (bot.power ? [false, true] : [false]).map((power) => ({ s: copy(s), cards: [], value: 0, power }));
  const keys = Object.keys(CARDS);
  for (let beat = 0; beat < 4; beat++) {
    const next = [];
    for (const candidate of candidates) for (const card of keys) {
      const sim = copy(candidate.s);
      const b = sim.bots.find((p) => p.id === bot.id);
      sim.priority = [bot.id];
      const cards = [...candidate.cards, card];
      const program = [...cards, ...Array(4 - cards.length).fill('laser')];
      for (const frame of resolveBeat(sim, new Map([[bot.id, { cards: program, power: candidate.power }]]), beat)) { void frame; }
      if (beat === 3) endRound(sim);
      const target = sim.flag && !sim.flagClaimed ? sim.flag : { x: 4, y: 4 };
      const edge = Math.min(b.x, b.y, 8 - b.x, 8 - b.y);
      const onDoomedFloor = collapseCells(sim).some((c) => c.x === b.x && c.y === b.y);
      const survival = s.mode === 'survival';
      const value = (b.alive ? survival ? 40 : 15 : survival ? -120 : -10) + b.hp * (survival ? 4 : 1) + b.flags * 60 + b.kos * 12
        - (s.mode === 'race' ? distance(b, target) * 3 : Math.max(0, 3 - edge) * 4)
        - (onDoomedFloor ? 60 : 0) + (b.power ? 2 : 0)
        + candidate.value * 0.2 + random() * 1.5;
      next.push({ s: sim, cards, value, power: candidate.power });
    }
    candidates = next.sort((a, b) => b.value - a.value).slice(0, 7);
  }
  return { cards: candidates[0].cards, power: candidates[0].power };
}
