export const presenter = (s) => s.seats[s.round];
export const reporters = (s) => s.seats.filter((p) => p.id !== presenter(s)?.id);
export const reporter = (s) => reporters(s)[s.turn % Math.max(1, reporters(s).length)];
export const paused = (s) => !presenter(s)?.connected || !reporter(s)?.connected;

export function createSession(seats, premises, match) {
  return { seats: seats.map((p) => ({ ...p })), premises, match, revision: 0,
    phase: 'setup', round: 0, turn: 0, questions: 1, guesses: 0, started: 0, results: [] };
}

function advance(s) {
  s.round++;
  // Disconnected players retain their seat and can return before their briefing.
  while (s.round < s.seats.length && !presenter(s).connected) {
    s.results.push({ name: presenter(s).name, outcome: 'away', questions: 0, seconds: 0 });
    s.round++;
  }
  s.phase = s.round < s.seats.length ? 'ready' : 'finished';
  s.turn = 0; s.questions = 1; s.guesses = 0;
  selectConnectedReporter(s);
}

function selectConnectedReporter(s) {
  const count = reporters(s).length;
  for (let i = 0; i < count && !reporter(s)?.connected; i++) s.turn++;
}

export function presence(s, id, connected) {
  const p = s.seats.find((p) => p.id === id);
  if (!p) return;
  p.connected = connected;
  selectConnectedReporter(s);
  s.revision++;
}

// All actions are role checked and tied to a particular screen revision.
export function act(s, id, action, revision, now = Date.now()) {
  if (revision !== s.revision || !s.seats.some((p) => p.id === id && p.connected)) return false;
  const isPresenter = id === presenter(s)?.id;
  const isReporter = id === reporter(s)?.id;
  const captain = s.seats.find((p) => p.connected)?.id;
  if (s.phase === 'setup' && action === 'start' && id === captain && s.seats.filter((p) => p.connected).length >= 4) {
    s.phase = 'ready';
    if (!presenter(s)?.connected) { s.round = -1; advance(s); }
    selectConnectedReporter(s);
  } else if (s.phase === 'ready' && action === 'ready' && isPresenter && !paused(s)) {
    s.phase = 'live'; s.started = now;
  } else if (s.phase === 'live' && action === 'next' && isReporter && !paused(s)) {
    s.turn++; s.questions++; selectConnectedReporter(s);
  } else if (s.phase === 'live' && action === 'guess' && isPresenter && !paused(s)) {
    s.phase = 'guess'; s.guesses++;
  } else if (s.phase === 'guess' && action === 'miss' && isReporter && !paused(s)) {
    s.phase = 'live';
  } else if (((s.phase === 'guess' && action === 'correct' && isReporter) ||
      (['live', 'guess'].includes(s.phase) && action === 'reveal' && isPresenter)) && !paused(s)) {
    s.results.push({ name: presenter(s).name, outcome: action === 'correct' ? 'solved' : 'revealed',
      questions: s.questions, seconds: Math.max(0, Math.floor((now - s.started) / 1000)) });
    s.phase = 'reveal';
  } else if (s.phase === 'reveal' && action === 'continue' && id === captain) {
    advance(s);
  } else return false;
  s.revision++;
  return true;
}

export function publicView(s) {
  return { phase: s.phase, round: s.round + 1, total: s.seats.length, questions: s.questions,
    presenter: presenter(s), reporter: reporter(s), reporters: reporters(s), paused: paused(s),
    results: s.results, premise: s.phase === 'reveal' ? s.premises[s.round] : null };
}

export function phoneView(s, id) {
  const p = presenter(s), r = reporter(s), captain = s.seats.find((p) => p.connected)?.id;
  const presenting = id === p?.id;
  const v = { match: s.match, revision: s.revision, phase: s.phase,
    round: s.round + 1, total: s.seats.length, presenter: p?.name, reporter: r?.name,
    presenting, active: id === r?.id, paused: paused(s), questions: s.questions, actions: [] };
  if (s.phase === 'setup') {
    if (id === captain && s.seats.filter((p) => p.connected).length >= 4) v.actions = [['start', 'Go live']];
  } else if (s.phase === 'finished') {
    v.results = s.results;
  } else {
    // This is the only secret projection. Never send a secret to the presenter before reveal.
    if (!presenting || s.phase === 'reveal') v.premise = s.premises[s.round];
    if (s.phase === 'reveal') {
      if (id === captain) v.actions = [['continue', s.round + 1 === s.seats.length ? 'Wrap the broadcast' : 'Next presenter']];
    } else if (!v.paused) {
      if (s.phase === 'ready' && presenting) v.actions = [['ready', 'Take the podium']];
      if (s.phase === 'live' && presenting) v.actions = [['guess', 'I have a guess'], ['reveal', 'Reveal & end my briefing']];
      if (s.phase === 'live' && v.active) v.actions = [['next', 'Answer finished · next reporter']];
      if (s.phase === 'guess' && v.active) v.actions = [['correct', 'Yes! They got it'], ['miss', 'Not quite · keep going']];
    }
  }
  return v;
}
