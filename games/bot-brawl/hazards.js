import { ARROWS, DIRS, tileAt } from './engine.js';

export function factoryLanes(s) {
  return s.emitters.map((emitter) => {
    const [dx, dy] = DIRS[emitter.dir];
    const cells = [];
    for (let x = emitter.x + dx, y = emitter.y + dy; x >= 0 && y >= 0 && x < s.size && y < s.size; x += dx, y += dy) {
      if (tileAt(s, x, y).type === 'wall') break;
      cells.push({ x, y });
    }
    return { emitter, cells };
  });
}

export function hazardRules(event) {
  const off = event.id === 'blackout';
  const damage = event.id === 'overdrive' ? 2 : 1;
  const steps = event.id === 'double' ? 2 : 1;
  return [
    { icon: 'ϟ', kind: 'laser', label: off ? 'Factory lasers OFF' : `Lasers: −${damage} hull`, text: off ? 'Robot lasers still work.' : 'after belts, each beat.' },
    { icon: '➜', kind: 'belt', label: `Belts: ${steps} tile${steps > 1 ? 's' : ''}`, text: event.id === 'reverse' ? 'REVERSED; follow arrows.' : 'after bot moves.' },
    { icon: '×', kind: 'pit', label: 'Pits + edges', text: 'instant wreck.' },
    { icon: '▥', kind: 'wall', label: 'Walls', text: 'stop bots + laser beams.' },
  ];
}

export function tileDescription(tile, event, { doomed = false, lane = false } = {}) {
  let text = tile.type === 'pit' ? 'PIT: entering instantly wrecks your bot.'
    : tile.type === 'wall' ? 'WALL: blocks movement, push chains and laser beams.'
    : tile.type === 'belt' ? `CONVEYOR ${ARROWS[(tile.dir + (event.id === 'reverse' ? 2 : 0)) % 4]}: carries you ${event.id === 'double' ? 2 : 1} tile${event.id === 'double' ? 's' : ''} after bot moves, every beat.`
    : 'FLOOR: safe to stand on unless a laser hits you or another bot pushes you.';
  if (lane) text += ` LASER PATH: can take ${event.id === 'overdrive' ? 2 : 1} hull per beam after belts. The first bot or wall blocks each beam.`;
  if (doomed) text += ' COLLAPSE: becomes a pit after beat 4 this round. Move inward before then.';
  return text;
}
