// Run with: node --test tools/test-bot-brawl.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENAS, createGame, copy, beginRound, endRound, resolveBeat, moveBot, usePower, standings, planBot, validProgram, EVENTS, CARDS } from '../games/bot-brawl/engine.js';
import { buildArena, SPAWNS, FLAG_ROUTE } from '../games/bot-brawl/arenas.js';
import { factoryLanes, hazardRules, tileDescription } from '../games/bot-brawl/hazards.js';

function random(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function arena(count = 2, mode = 'race') {
  const s = createGame(Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Bot ${i + 1}` })), { mode }, random(1));
  s.tiles.forEach((row) => row.forEach((_, i) => { row[i] = { type: 'floor' }; }));
  s.emitters = []; s.crates = []; s.flag = null; s.round = 1; s.priority = s.bots.map((b) => b.id);
  s.bots.forEach((b, i) => Object.assign(b, { x: i + 1, y: 3, dir: 1 }));
  return s;
}
function beat(s, entries, index = 0) {
  const programs = new Map(entries.map(([id, card, power = false]) => [id, { cards: Array(4).fill(card), power }]));
  return [...resolveBeat(s, programs, index)];
}
function invariants(s) {
  const occupied = new Set();
  for (const b of s.bots) {
    assert.ok(b.hp >= 0 && b.hp <= 3);
    assert.ok(b.lives >= 0 && b.lives <= 3);
    assert.ok(b.dir >= 0 && b.dir < 4);
    if (!b.alive) continue;
    assert.ok(b.x >= 0 && b.x < 9 && b.y >= 0 && b.y < 9, `${b.name} out of bounds`);
    assert.ok(!['pit', 'wall'].includes(s.tiles[b.y][b.x].type));
    const key = `${b.x},${b.y}`;
    assert.ok(!occupied.has(key), `Two bots on ${key}`); occupied.add(key);
    assert.ok(b.hp > 0);
  }
}

test('programs require exactly four known cards', () => {
  assert.ok(validProgram(['forward', 'left', 'right', 'laser']));
  for (const bad of [null, [], ['laser'], ['forward', 'left', 'laser', '__proto__'], ['laser', 'laser', 'laser', {}]]) assert.equal(validProgram(bad), false);
});
test('visible factory paths match fired beams through pits and stop at walls on all six arenas', () => {
  for (const a of ARENAS) {
    const s = createGame([], { arena: a.id, bots: 2 }, random(4));
    beginRound(s); s.bots = []; s.priority = [];
    const paths = factoryLanes(s);
    for (const frame of resolveBeat(s, new Map(), 0)) { void frame; }
    assert.equal(s.beams.length, paths.length);
    paths.forEach((path, i) => {
      const end = path.cells.at(-1) || path.emitter;
      assert.equal(s.beams[i].x2, end.x); assert.equal(s.beams[i].y2, end.y);
      assert.ok(path.cells.every((c) => s.tiles[c.y][c.x].type !== 'wall'));
    });
  }
  const doubled = hazardRules(EVENTS.find((e) => e.id === 'double'));
  assert.match(doubled.find((r) => r.kind === 'belt').label, /2 tiles/);
  assert.match(hazardRules(EVENTS.find((e) => e.id === 'overdrive'))[0].label, /−2 hull/);
  assert.match(hazardRules(EVENTS.find((e) => e.id === 'blackout'))[0].label, /OFF/);
  const warning = tileDescription({ type: 'belt', dir: 1 }, EVENTS.find((e) => e.id === 'reverse'), { doomed: true, lane: true });
  assert.match(warning, /←/); assert.match(warning, /after beat 4/); assert.match(warning, /first bot or wall blocks/);
});
test('push chains move atomically, credit a knockout and never overlap', () => {
  const s = arena(3);
  s.tiles[3][4] = { type: 'pit' };
  assert.equal(moveBot(s, s.bots[0], 1), true);
  assert.deepEqual(s.bots.map((b) => b.x), [2, 3, 4]);
  assert.equal(s.bots[2].alive, false); assert.equal(s.bots[0].kos, 1);
  invariants(s);
});
test('a wall blocks the whole chain without partially moving anyone', () => {
  const s = arena(3); s.tiles[3][4] = { type: 'wall' };
  assert.equal(moveBot(s, s.bots[0], 1), false);
  assert.deepEqual(s.bots.map((b) => b.x), [1, 2, 3]); invariants(s);
});
test('a shield blocks one chain push, then is spent', () => {
  const s = arena(3); s.bots[2].shield = 1;
  assert.equal(moveBot(s, s.bots[0], 1), false);
  assert.deepEqual(s.bots.map((b) => b.x), [1, 2, 3]);
  assert.equal(s.bots[2].shield, 0);
  assert.equal(moveBot(s, s.bots[0], 1), true); invariants(s);
});
test('laser hits the first bot, and walls block the beam', () => {
  const s = arena(3);
  beat(s, [[1, 'laser'], [2, 'left'], [3, 'left']]);
  assert.equal(s.bots[1].hp, 2); assert.equal(s.bots[2].hp, 3);
  const wall = arena(); wall.tiles[3][2] = { type: 'wall' }; wall.bots[1].x = 3;
  beat(wall, [[1, 'laser'], [2, 'left']]); assert.equal(wall.bots[1].hp, 3);
});
test('three laser damage costs one survival life; reboot restores hull next round', () => {
  const s = arena(2, 'survival');
  for (let i = 0; i < 3; i++) beat(s, [[1, 'laser'], [2, 'uturn']], i);
  assert.equal(s.bots[1].alive, false); assert.equal(s.bots[1].lives, 2); assert.equal(s.bots[0].kos, 1);
  beginRound(s, random(2));
  assert.equal(s.bots[1].alive, true); assert.equal(s.bots[1].hp, 3); invariants(s);
});
test('robot laser shield absorbs exactly one hit', () => {
  const s = arena(); s.bots[1].shield = 1;
  beat(s, [[1, 'laser'], [2, 'uturn']]); assert.equal(s.bots[1].hp, 3); assert.equal(s.bots[1].shield, 0);
  beat(s, [[1, 'laser'], [2, 'uturn']], 1); assert.equal(s.bots[1].hp, 2);
});
test('turns stay put; reverse changes position without changing facing', () => {
  const s = arena(); s.bots[1].y = 7;
  beat(s, [[1, 'left'], [2, 'left']]); assert.equal(s.bots[0].dir, 0); assert.equal(s.bots[0].x, 1);
  beat(s, [[1, 'back'], [2, 'left']], 1); assert.equal(s.bots[0].y, 4); assert.equal(s.bots[0].dir, 0);
});
test('reverse belts, double belts and laser blackout honor announced events', () => {
  for (const [event, wantX] of [['normal', 3], ['reverse', 1], ['double', 4]]) {
    const s = arena(); s.bots[0].x = 2; s.bots[1].y = 7;
    for (let x = 0; x < 9; x++) s.tiles[3][x] = { type: 'belt', dir: 1 };
    s.event = EVENTS.find((e) => e.id === event);
    beat(s, [[1, 'left'], [2, 'left']]); assert.equal(s.bots[0].x, wantX);
  }
  for (const [event, hp] of [['normal', 2], ['blackout', 3], ['overdrive', 1]]) {
    const s = arena(); s.emitters = [{ x: -1, y: 3, dir: 1 }]; s.event = EVENTS.find((e) => e.id === event);
    beat(s, [[1, 'left'], [2, 'left']]); assert.equal(s.bots[0].hp, hp);
  }
});
test('rocket boots travel three tiles, cost hull and cannot skip over a pit', () => {
  const s = arena(); s.bots[1].y = 7; s.bots[0].power = 'boost';
  beat(s, [[1, 'forward', true], [2, 'left']]); assert.equal(s.bots[0].x, 4); assert.equal(s.bots[0].boost, false); assert.equal(s.bots[0].hp, 2);
  beat(s, [[1, 'forward'], [2, 'left']], 1); assert.equal(s.bots[0].x, 5);
  const pit = arena(); pit.bots[1].y = 7; pit.bots[0].power = 'boost'; pit.tiles[3][2] = { type: 'pit' };
  beat(pit, [[1, 'forward', true], [2, 'left']]); assert.equal(pit.bots[0].alive, false); assert.equal(pit.bots[0].x, 2);
});
test('magnet pulls two tiles, costs hull, respects walls and never pulls through itself', () => {
  const s = arena(); s.bots[0].power = 'magnet'; s.bots[1].x = 5;
  usePower(s, s.bots[0]); assert.equal(s.bots[1].x, 3); assert.equal(s.bots[0].hp, 2);
  s.bots[0].power = 'magnet'; s.tiles[3][2] = { type: 'wall' };
  usePower(s, s.bots[0]); assert.equal(s.bots[1].x, 3); assert.equal(s.bots[0].hp, 1);
  s.tiles[3][2] = { type: 'floor' }; s.bots[1].x = 2; s.bots[0].power = 'magnet';
  usePower(s, s.bots[0]); assert.equal(s.bots[0].x, 1); assert.equal(s.bots[1].x, 2); assert.equal(s.bots[0].alive, false); invariants(s);
});
test('unused shields overload, spent shields are safe and overload can wreck their owner', () => {
  const s = arena(); s.bots[0].power = 'shield'; usePower(s, s.bots[0]);
  endRound(s); assert.equal(s.bots[0].hp, 2); assert.equal(s.bots[0].shield, 0);
  s.bots[0].hp = 1; s.bots[0].shield = 1; endRound(s); assert.equal(s.bots[0].alive, false); assert.equal(s.bots[0].kos, 0);
  const spent = arena(); spent.bots[1].shield = 1;
  beat(spent, [[1, 'laser'], [2, 'left']]); endRound(spent); assert.equal(spent.bots[1].hp, 3);
});
test('all six arenas are distinct, preserve eight safe bays and have reachable flag pads', () => {
  const layouts = new Set();
  for (const a of ARENAS) {
    const { tiles, emitters } = buildArena(a.id); layouts.add(JSON.stringify(tiles)); assert.ok(emitters.length >= 3);
    assert.ok(tiles.flat().filter((t) => t.type === 'pit').length >= 7);
    for (const [x, y] of SPAWNS) assert.equal(tiles[y][x].type, 'floor');
    const seen = new Set(['4,4']); const queue = [[4, 4]];
    while (queue.length) {
      const [x, y] = queue.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
        if (!tiles[ny]?.[nx] || ['pit', 'wall'].includes(tiles[ny][nx].type) || seen.has(key)) continue;
        seen.add(key); queue.push([nx, ny]);
      }
    }
    for (const [x, y] of [...SPAWNS, ...FLAG_ROUTE]) assert.ok(seen.has(`${x},${y}`), `${a.id} isolates ${x},${y}`);
  }
  assert.equal(layouts.size, 6);
});
test('crates never appear in round one and arrive in round two on every arena', () => {
  for (const a of ARENAS) {
    const s = createGame([], { bots: 8, arena: a.id }, random(3)); assert.equal(s.crates.length, 0);
    beginRound(s, random(3)); assert.equal(s.crates.length, 0);
    beginRound(s, random(3)); assert.equal(s.crates.length, 5);
    for (const c of s.crates) assert.equal(s.tiles[c.y][c.x].type, 'floor');
  }
});
test('crates persist when inventory is full and flags can only be claimed once per round', () => {
  const s = arena(); s.bots[1].y = 7; s.crates = [{ x: 2, y: 3, power: 'shield' }];
  s.flag = { x: 2, y: 3 }; s.bots[0].power = 'boost';
  moveBot(s, s.bots[0], 1); assert.equal(s.crates.length, 1); assert.equal(s.bots[0].flags, 1);
  s.bots[0].power = null; moveBot(s, s.bots[0], 3); moveBot(s, s.bots[0], 1);
  assert.equal(s.bots[0].power, 'shield'); assert.equal(s.crates.length, 0); assert.equal(s.bots[0].flags, 1);
});
test('survival collapse is warned, removes crates and costs only one life', () => {
  const s = arena(2, 'survival'); s.round = 2; s.bots[0].x = 0; s.crates = [{ x: 0, y: 1, power: 'shield' }];
  endRound(s); assert.equal(s.tiles[3][0].type, 'pit'); assert.equal(s.bots[0].lives, 2);
  assert.equal(s.crates.length, 0); beginRound(s, random(3)); invariants(s); assert.equal(s.bots[0].alive, true);
});
test('priority rotates and powers expire without destroying stored inventory', () => {
  const s = arena(3); s.round = 0; beginRound(s, random(2)); assert.deepEqual(s.priority, [1, 2, 3]);
  s.bots[0].shield = 1; s.bots[0].boost = true; s.bots[0].power = 'magnet';
  beginRound(s, random(2)); assert.deepEqual(s.priority, [2, 3, 1]);
  assert.equal(s.bots[0].shield, 0); assert.equal(s.bots[0].boost, false); assert.equal(s.bots[0].power, 'magnet');
});
test('race and survival produce defined winners, including true ties', () => {
  const s = arena(); s.bots[0].flags = 3; endRound(s); assert.equal(s.done, true); assert.deepEqual(s.winnerIds, [1]);
  const tie = arena(); tie.round = 10; endRound(tie); assert.deepEqual(tie.winnerIds, [1, 2]);
  const survival = arena(2, 'survival'); survival.bots[1].lives = 0; survival.bots[1].alive = false;
  endRound(survival); assert.deepEqual(survival.winnerIds, [1]);
});
test('AI plans valid programs, does not mutate the board, and replays are independent copies', () => {
  const s = createGame([{ id: 1, name: 'Human' }, { id: 2, name: 'Other' }], { bots: 6 }, random(8));
  beginRound(s, random(8)); const before = copy(s); const saved = copy(s);
  for (const b of s.bots) assert.ok(validProgram(planBot(s, b, random(1)).cards));
  assert.deepEqual(s, before); saved.bots[0].hp = 0; assert.equal(s.bots[0].hp, 3);
});
test('complete games preserve occupancy, hull and bounded completion for all six arenas, 2–8 bots and both modes', () => {
  let completed = 0;
  for (const arena of ARENAS) for (const mode of ['race', 'survival']) for (let count = 2; count <= 8; count++) for (let seed = 1; seed <= 2; seed++) {
    const rng = random(seed * 117 + count);
    const s = createGame([], { mode, bots: count, arena: arena.id }, rng);
    while (!s.done) {
      beginRound(s, rng); invariants(s);
      const programs = new Map(s.bots.filter((b) => b.alive).map((b) => [b.id,
        seed === 1 ? planBot(s, b, rng) : { cards: Array.from({ length: 4 }, () => Object.keys(CARDS)[Math.floor(rng() * 6)]), power: !!b.power }]));
      for (let i = 0; i < 4; i++) for (const frame of resolveBeat(s, programs, i)) { void frame; invariants(s); }
      endRound(s); invariants(s);
      assert.ok(s.round <= s.maxRounds);
    }
    assert.ok(s.winnerIds.length > 0); assert.equal(standings(s).length, count); completed++;
  }
  assert.equal(completed, 168);
});
