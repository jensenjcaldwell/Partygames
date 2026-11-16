// Every layout preserves eight starting bays and five reachable flag pads.
export const SPAWNS = [[0, 2, 1], [8, 6, 3], [2, 8, 0], [6, 0, 2], [0, 6, 1], [8, 2, 3], [2, 0, 2], [6, 8, 0]];
export const FLAG_ROUTE = [[4, 4], [4, 2], [6, 4], [4, 6], [2, 4]];
export const ARENAS = [
  { id: 'rustworks', name: 'The Rustworks', icon: '⚙', description: 'A conveyor loop, exposed pits and a three-way laser crossing.' },
  { id: 'crossfire', name: 'Crossfire Alley', icon: 'ϟ', description: 'Four laser emitters rake narrow lanes between scrap islands.' },
  { id: 'spillway', name: 'The Spillway', icon: '⇊', description: 'Belts feed straight into open drains. Turn before the drop.' },
  { id: 'crusher', name: 'Crusher Yard', icon: '▥', description: 'Cramped scrap walls and outward belts make every shove count.' },
  { id: 'magnetron', name: 'Magnetron', icon: '⊂', description: 'Opposing conveyor rings orbit a pit-studded laser chamber.' },
  { id: 'furnace', name: 'The Furnace', icon: '♨', description: 'A broken floor and four hot laser lanes leave little room to hide.' },
];

export function buildArena(id) {
  const arena = ARENAS.find((a) => a.id === id) || ARENAS[0];
  const tiles = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => ({ type: 'floor' })));
  const put = (type, points) => { for (const [x, y] of points) tiles[y][x] = { type }; };
  const belt = (x, y, dir) => { tiles[y][x] = { type: 'belt', dir }; };
  const ring = (lo, hi, reverse = false) => {
    for (let i = lo; i <= hi; i++) { belt(i, lo, reverse ? 3 : 1); belt(hi, i, reverse ? 0 : 2); belt(hi - i + lo, hi, reverse ? 1 : 3); belt(lo, hi - i + lo, reverse ? 2 : 0); }
    belt(lo, lo, reverse ? 2 : 1); belt(hi, lo, reverse ? 3 : 2);
    belt(hi, hi, reverse ? 0 : 3); belt(lo, hi, reverse ? 1 : 0);
  };
  let emitters;
  if (arena.id === 'rustworks') {
    ring(2, 6);
    put('wall', [[1, 1], [7, 1], [1, 7], [7, 7]]);
    put('pit', [[1, 3], [7, 5], [3, 7], [5, 1], [0, 4], [8, 4], [4, 8]]);
    emitters = [{ x: -1, y: 4, dir: 1 }, { x: 9, y: 4, dir: 3 }, { x: 4, y: -1, dir: 2 }];
  } else if (arena.id === 'crossfire') {
    for (let x = 1; x < 8; x++) { belt(x, 3, 1); belt(x, 5, 3); }
    put('wall', [[1, 1], [7, 7], [3, 1], [5, 7], [1, 5], [7, 3]]);
    put('pit', [[7, 1], [1, 7], [3, 3], [5, 5], [5, 3], [3, 5], [8, 3], [0, 5]]);
    emitters = [{ x: -1, y: 2, dir: 1 }, { x: 9, y: 6, dir: 3 }, { x: 4, y: -1, dir: 2 }, { x: 4, y: 9, dir: 0 }];
  } else if (arena.id === 'spillway') {
    for (let x = 0; x < 9; x++) { belt(x, 1, 2); belt(x, 7, 0); }
    for (let y = 2; y <= 6; y++) { belt(1, y, 2); belt(7, y, 0); }
    for (let x = 2; x <= 6; x++) { belt(x, 3, 3); belt(x, 5, 1); }
    put('pit', [[1, 6], [7, 2], [1, 4], [7, 4], [3, 0], [5, 8], [0, 1], [8, 7]]);
    put('wall', [[3, 6], [5, 2], [3, 2], [5, 6]]);
    emitters = [{ x: -1, y: 4, dir: 1 }, { x: 9, y: 4, dir: 3 }, { x: 4, y: 9, dir: 0 }];
  } else if (arena.id === 'crusher') {
    for (let x = 1; x <= 7; x++) belt(x, 4, x < 4 ? 3 : 1);
    for (let y = 2; y <= 6; y++) { belt(3, y, 0); belt(5, y, 2); }
    put('wall', [[1, 1], [3, 1], [5, 1], [7, 1], [1, 7], [3, 7], [5, 7], [7, 7], [3, 3], [5, 5]]);
    put('pit', [[3, 2], [5, 6], [1, 4], [7, 4], [4, 0], [4, 8], [0, 4], [8, 4]]);
    emitters = [{ x: -1, y: 2, dir: 1 }, { x: 9, y: 6, dir: 3 }, { x: 4, y: -1, dir: 2 }];
  } else if (arena.id === 'magnetron') {
    ring(1, 7); ring(2, 6, true);
    put('pit', [[3, 3], [5, 3], [3, 5], [5, 5], [1, 2], [7, 6], [2, 7], [6, 1]]);
    put('wall', [[0, 0], [8, 8], [0, 8], [8, 0]]);
    emitters = [{ x: -1, y: 3, dir: 1 }, { x: 9, y: 5, dir: 3 }, { x: 3, y: -1, dir: 2 }, { x: 5, y: 9, dir: 0 }];
  } else {
    for (let y = 1; y < 8; y++) { belt(2, y, 2); belt(6, y, 0); }
    for (let x = 1; x < 8; x++) { belt(x, 2, 1); belt(x, 6, 3); }
    put('pit', [[1, 1], [3, 1], [5, 1], [7, 1], [1, 3], [7, 3], [1, 5], [7, 5], [1, 7], [3, 7], [5, 7], [7, 7], [2, 5], [6, 3]]);
    put('wall', [[3, 3], [5, 5]]);
    emitters = [{ x: -1, y: 2, dir: 1 }, { x: 9, y: 6, dir: 3 }, { x: 2, y: -1, dir: 2 }, { x: 6, y: 9, dir: 0 }];
  }
  // Starting bays must be safe. Flag pads are kept open and can sit on belts.
  for (const [x, y] of SPAWNS) tiles[y][x] = { type: 'floor' };
  for (const [x, y] of FLAG_ROUTE) if (['pit', 'wall'].includes(tiles[y][x].type)) tiles[y][x] = { type: 'floor' };
  return { arena, tiles, emitters };
}
