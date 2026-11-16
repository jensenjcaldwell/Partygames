export function createSession(players, deck, match, random = Math.random) {
  if (players.length < 3 || players.length > 12) throw new Error('Same Frequency needs 3–12 players.');
  return {
    match, phase: 'setup', round: 0, total: players.length, deck: [...deck],
    seats: players.map((p) => ({ ...p, connected: p.connected !== false, score: 0 })),
    clue: '', guesses: {}, results: [], random,
  };
}

export const giver = (s) => s.seats[s.round];
export const captain = (s) => s.seats.find((p) => p.connected)?.id;
export const accuracy = (guess, target) => {
  const d = Math.abs(guess - target);
  return d <= 5 ? 4 : d <= 10 ? 3 : d <= 15 ? 2 : d <= 25 ? 1 : 0;
};

function begin(s) {
  s.spectrum = s.deck[s.round % s.deck.length];
  s.target = 5 + Math.floor(s.random() * 91);
  s.clue = ''; s.guesses = {}; s.phase = 'clue'; s.skipped = false;
}

function readyToDebate(s) {
  const guessers = s.seats.filter((p) => p.connected && p.id !== giver(s).id);
  if (guessers.length && guessers.every((p) => Object.hasOwn(s.guesses, p.id))) s.phase = 'debate';
}

function reveal(s, skipped = false) {
  s.skipped = skipped;
  const points = s.seats.filter((p) => p.id !== giver(s).id).map((p) => ({
    id: p.id, guess: s.guesses[p.id] ?? null,
    gain: skipped || !Object.hasOwn(s.guesses, p.id) ? 0 : accuracy(s.guesses[p.id], s.target),
  }));
  const submitted = points.filter((p) => p.guess !== null);
  const bonus = skipped || !submitted.length ? 0 : Math.round(submitted.reduce((sum, p) => sum + p.gain, 0) / submitted.length);
  points.push({ id: giver(s).id, guess: null, gain: bonus });
  for (const p of s.seats) p.score += points.find((x) => x.id === p.id).gain;
  s.results.push({ giver: giver(s).id, target: s.target, points, skipped });
  s.phase = 'reveal';
}

// Envelopes identify a match, round and phase. Guesses in the same phase may
// arrive together; one player's input must never invalidate another's input.
export function act(s, id, message, host = false) {
  if (!message || message.match !== s.match || message.round !== s.round || message.phase !== s.phase) return false;
  const p = s.seats.find((x) => x.id === id);
  if (!host && !p?.connected) return false;
  const lead = host || captain(s) === id;
  const giving = giver(s)?.id === id;
  switch (message.action) {
    case 'start':
      if (s.phase !== 'setup' || !lead || s.seats.filter((p) => p.connected).length < 3) return false;
      begin(s); break;
    case 'clue': {
      if (s.phase !== 'clue' || !giving || typeof message.value !== 'string') return false;
      const clue = message.value.trim().replace(/\s+/g, ' ');
      if (!clue || clue.length > 120) return false;
      s.clue = clue; s.phase = 'guess'; break;
    }
    case 'guess':
      if (!['guess', 'debate'].includes(s.phase) || giving || typeof message.value !== 'number' || !Number.isInteger(message.value) || message.value < 0 || message.value > 100) return false;
      s.guesses[id] = message.value;
      if (s.phase === 'guess') readyToDebate(s);
      break;
    case 'discuss':
      if (s.phase !== 'guess' || !(host || giving) || !Object.keys(s.guesses).length) return false;
      s.phase = 'debate'; break;
    case 'reveal':
      if (s.phase !== 'debate' || !(host || giving)) return false;
      reveal(s); break;
    case 'skip':
      if (!host || !['clue', 'guess', 'debate'].includes(s.phase)) return false;
      reveal(s, true); break;
    case 'next':
      if (s.phase !== 'reveal' || !lead) return false;
      s.round++;
      // Seats that are away when their turn comes are skipped without points.
      while (s.round < s.total && !giver(s).connected) s.round++;
      if (s.round >= s.total) s.phase = 'finished';
      else begin(s);
      break;
    default: return false;
  }
  return true;
}

export function presence(s, id, connected) {
  const p = s.seats.find((p) => p.id === id);
  if (p) p.connected = connected;
  if (s.phase === 'guess') readyToDebate(s);
}

export function publicView(s) {
  const revealed = s.phase === 'reveal';
  const markers = ['debate', 'reveal'].includes(s.phase);
  return {
    match: s.match, phase: s.phase, round: s.round, total: s.total,
    giver: giver(s) ? { id: giver(s).id, name: giver(s).name, connected: giver(s).connected } : null,
    spectrum: s.spectrum, clue: s.clue, skipped: s.skipped,
    ...(revealed ? { target: s.target, result: s.results.at(-1) } : {}),
    players: s.seats.map((p) => ({ ...p, submitted: Object.hasOwn(s.guesses, p.id),
      ...(markers && Object.hasOwn(s.guesses, p.id) ? { guess: s.guesses[p.id] } : {}) })),
  };
}

export function phoneView(s, id) {
  const v = publicView(s);
  const giving = giver(s)?.id === id;
  return { ...v, giving, captain: captain(s) === id,
    ...(giving && ['clue', 'guess', 'debate'].includes(s.phase) ? { target: s.target } : {}),
    ...(Object.hasOwn(s.guesses, id) ? { mine: s.guesses[id] } : {}),
  };
}
