import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSession, act, presenter, reporter, presence, phoneView, publicView } from '../games/press-conference/model.js';
import { PREMISES } from '../games/press-conference/premises.js';

const session = (n = 4) => createSession(Array.from({ length: n }, (_, i) => ({
  id: i + 1, name: `Player ${i + 1}`, connected: true
})), PREMISES, 'test-match');
const action = (s, id, a) => act(s, id, a, s.revision, 10000);
const live = (s) => { action(s, 1, 'start'); action(s, 1, 'ready'); };

test('the deck contains exactly 600 distinct premises', () => {
  assert.equal(PREMISES.length, 600);
  assert.equal(new Set(PREMISES).size, PREMISES.length);
});

test('secrets stay off the public screen and presenter phone, including wrong guesses', () => {
  const s = session();
  assert.equal(phoneView(s, 2).premise, undefined);
  action(s, 1, 'start');
  for (const phase of ['ready', 'live', 'guess', 'live']) {
    assert.equal(s.phase, phase);
    assert.equal(phoneView(s, 1).premise, undefined);
    assert.equal(publicView(s).premise, null);
    for (let id = 2; id <= 4; id++) assert.equal(phoneView(s, id).premise, PREMISES[0]);
    if (phase === 'ready') action(s, 1, 'ready');
    else if (phase === 'guess') action(s, 2, 'miss');
    else action(s, 1, 'guess');
  }
  action(s, 2, 'correct');
  assert.equal(s.phase, 'reveal');
  assert.equal(phoneView(s, 1).premise, PREMISES[0]);
  assert.equal(publicView(s).premise, PREMISES[0]);
});

test('only the active reporter passes the mic; turns cycle without a deadline', () => {
  const s = session(); live(s);
  assert.equal(action(s, 3, 'next'), false);
  for (let i = 0; i < 30; i++) {
    assert.equal(reporter(s).id, 2 + i % 3);
    assert.ok(action(s, reporter(s).id, 'next'));
  }
  assert.equal(s.questions, 31);
  assert.equal(s.phase, 'live');
});

test('stale clicks, unknown players, unauthorized verdicts and malformed actions have no effect', () => {
  const s = session(); live(s);
  const revision = s.revision;
  assert.ok(action(s, 2, 'next'));
  assert.equal(act(s, 2, 'next', revision), false);
  assert.equal(action(s, 99, 'guess'), false);
  assert.equal(action(s, 2, 'reveal'), false);
  assert.equal(action(s, 2, 'continue'), false);
  assert.equal(action(s, 3, '__proto__'), false);
  action(s, 1, 'guess');
  assert.equal(action(s, 2, 'correct'), false);
  assert.equal(action(s, 1, 'correct'), false);
  assert.equal(action(s, 3, 'correct'), true);
});

test('reporter disconnect skips their seat; presenter reconnect restores their secret-free view', () => {
  const s = session(); live(s);
  presence(s, 2, false);
  assert.equal(reporter(s).id, 3);
  presence(s, 1, false);
  assert.equal(phoneView(s, 3).paused, true);
  assert.equal(action(s, 3, 'next'), false);
  presence(s, 1, true);
  assert.equal(phoneView(s, 1).premise, undefined);
  assert.equal(phoneView(s, 1).paused, false);
  action(s, 3, 'next');
  assert.equal(reporter(s).id, 4);
  presence(s, 2, true);
  action(s, 4, 'next');
  assert.equal(reporter(s).id, 2);
});

test('all reporters offline pauses safely and rejoining resumes the briefing', () => {
  const s = session(); live(s);
  for (let i = 2; i <= 4; i++) presence(s, i, false);
  assert.equal(phoneView(s, 1).paused, true);
  assert.equal(action(s, 1, 'guess'), false);
  presence(s, 3, true);
  assert.equal(reporter(s).id, 3);
  assert.equal(phoneView(s, 1).paused, false);
});

test('every seat presents exactly once in full 4–12 player games; each new presenter loses access to the next secret', () => {
  for (let n = 4; n <= 12; n++) {
    const s = session(n); action(s, 1, 'start');
    for (let i = 1; i <= n; i++) {
      assert.equal(presenter(s).id, i);
      assert.equal(phoneView(s, i).premise, undefined);
      action(s, i, 'ready');
      if (i % 2) { action(s, i, 'guess'); action(s, reporter(s).id, 'correct'); }
      else action(s, i, 'reveal');
      assert.equal(s.phase, 'reveal');
      action(s, 1, 'continue');
    }
    assert.equal(s.phase, 'finished');
    assert.equal(s.results.length, n);
  }
});

test('away presenters are skipped and captain privileges transfer on disconnect', () => {
  const s = session(); live(s); presence(s, 2, false);
  action(s, 1, 'reveal'); presence(s, 1, false);
  assert.equal(action(s, 4, 'continue'), false);
  assert.ok(action(s, 3, 'continue'));
  assert.equal(presenter(s).id, 3);
  assert.equal(s.results[1].outcome, 'away');
});
