// The five roles and actions of Two Faces (Coup card & ability names). Shared by host.js and player.js.

export const ROLES = {
  patron:     { name: 'Duke',       icon: '👑', color: '#f6c95a', does: 'Tax: take 3 coins.',                              blocks: 'Blocks Foreign Aid.' },
  poisoner:   { name: 'Assassin',   icon: '🧪', color: '#7ef0a0', does: 'Assassinate: pay 3, a rival loses a card.',       blocks: '' },
  pickpocket: { name: 'Captain',    icon: '🗝️', color: '#c39bff', does: 'Steal: take 2 coins from a rival.',               blocks: 'Blocks Steal.' },
  seer:       { name: 'Ambassador', icon: '👁️', color: '#7fd6ff', does: 'Exchange: draw 2 cards, keep the ones you like.', blocks: 'Blocks Steal.' },
  bodyguard:  { name: 'Contessa',   icon: '🛡️', color: '#ff7f6e', does: '',                                                blocks: 'Blocks Assassinate.' },
};

// claim: card you say you have. cost: coins paid up front. target: picks a rival.
// blockedBy: cards that can block it. anyone: every rival may block (else only the target).
export const MOVES = {
  mingle:  { label: 'Income',      short: '+1 coin',                         gain: 1 },
  beg:     { label: 'Foreign Aid', short: '+2 coins (a Duke can block)',     gain: 2, blockedBy: ['patron'], anyone: true },
  unmask:  { label: 'Coup',        short: 'pay 7, a rival loses a card',     cost: 7, target: true },
  fund:    { label: 'Tax',         short: '+3 coins',                        gain: 3, claim: 'patron' },
  poison:  { label: 'Assassinate', short: 'pay 3, a rival loses a card',     cost: 3, target: true, claim: 'poisoner', blockedBy: ['bodyguard'] },
  lift:    { label: 'Steal',       short: 'take 2 coins from a rival',       target: true, claim: 'pickpocket', blockedBy: ['pickpocket', 'seer'] },
  foresee: { label: 'Exchange',    short: 'draw 2 cards, swap any',          claim: 'seer' },
};

export const START_GOLD = 2;
export const MUST_UNMASK = 10;
