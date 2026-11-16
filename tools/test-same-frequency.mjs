import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSession, act, presence, publicView, phoneView, accuracy, giver } from '../games/same-frequency/model.js';
import { SPECTRUMS } from '../games/same-frequency/spectrums.js';

const session = (n = 3) => createSession(Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Player ${i + 1}`, connected: true })), SPECTRUMS, 'test', () => .5);
const action = (s, id, name, value, host = false) => act(s, id, { match: s.match, round: s.round, phase: s.phase, action: name, value }, host);
const start = (s) => action(s, 1, 'start');
const clue = (s) => action(s, giver(s).id, 'clue', 'Your wedding cake arrives frozen.');

test('500 distinct spectra and all inclusive scoring boundaries', () => {
  assert.equal(SPECTRUMS.length, 500);
  const normalized = SPECTRUMS.map((pair) => {
    assert.equal(pair.length, 2);
    for (const label of pair) {
      assert.equal(typeof label, 'string');
      assert.ok(label.trim().length > 0 && label.length <= 40, label);
    }
    assert.notEqual(pair[0].toLowerCase(), pair[1].toLowerCase());
    return JSON.stringify(pair.map((label) => label.trim().toLowerCase()).sort());
  });
  assert.equal(new Set(normalized).size, 500, 'No duplicate or reversed spectra');
  for (const [d, expected] of [[0,4],[5,4],[6,3],[10,3],[11,2],[15,2],[16,1],[25,1],[26,0],[50,0]]) {
    assert.equal(accuracy(50 + d, 50), expected);
    assert.equal(accuracy(50 - d, 50), expected);
  }
});

test('target stays private throughout clue, guessing and discussion; reveal is public', () => {
  const s = session(); start(s);
  for (const phase of ['clue', 'guess', 'debate']) {
    assert.equal(s.phase, phase);
    assert.equal(publicView(s).target, undefined);
    assert.equal(publicView(s).result, undefined);
    assert.equal(phoneView(s, 1).target, s.target);
    for (const id of [2, 3]) assert.equal(phoneView(s, id).target, undefined);
    if (phase === 'clue') clue(s);
    else if (phase === 'guess') { action(s, 2, 'guess', 55); action(s, 3, 'guess', 70); }
  }
  assert.ok(action(s, 1, 'reveal'));
  assert.equal(publicView(s).target, 50);
  assert.equal(phoneView(s, 3).target, 50);
  assert.equal(s.seats[0].score, 3); // rounded average of 4 and 1
});

test('guesses stay hidden from others until discussion; revisions are allowed', () => {
  const s = session(); start(s); clue(s);
  assert.ok(action(s, 2, 'guess', 20));
  assert.equal(phoneView(s, 2).mine, 20);
  assert.equal(phoneView(s, 3).players.find((p) => p.id === 2).guess, undefined);
  action(s, 3, 'guess', 80);
  assert.equal(s.phase, 'debate');
  assert.equal(publicView(s).players.find((p) => p.id === 2).guess, 20);
  assert.ok(action(s, 2, 'guess', 50));
  action(s, 1, 'reveal');
  assert.equal(s.seats[1].score, 4);
  assert.equal(action(s, 2, 'guess', 0), false);
});

test('malformed, unauthorized, duplicate and stale messages cannot advance or score twice', () => {
  const s = session(); start(s);
  assert.equal(action(s, 2, 'clue', 'Cheating'), false);
  assert.equal(action(s, 1, 'clue', ' '.repeat(2)), false);
  assert.equal(action(s, 1, 'clue', 'x'.repeat(121)), false);
  clue(s);
  for (const value of [null, '', '50', NaN, Infinity, {}, [], -1, 101, 2.5]) assert.equal(action(s, 2, 'guess', value), false);
  assert.equal(action(s, 1, 'guess', 50), false);
  assert.equal(action(s, 999, 'guess', 50), false);
  assert.equal(action(s, 2, 'skip'), false);
  action(s, 2, 'guess', 50); action(s, 3, 'guess', 50);
  assert.equal(action(s, 2, 'reveal'), false);
  const old = { match: s.match, round: s.round, phase: s.phase, action: 'reveal' };
  assert.ok(act(s, 1, old));
  assert.equal(act(s, 1, old), false);
  assert.deepEqual(s.seats.map((p) => p.score), [4,4,4]);
  action(s, 1, 'next');
  assert.equal(act(s, 1, old), false);
  assert.equal(act(s, 2, { match: 'other', round: s.round, phase: s.phase, action: 'clue', value: 'wrong match' }), false);
});

test('every seat DJs exactly once in full games for all supported player counts', () => {
  for (let n = 3; n <= 12; n++) {
    const s = session(n); start(s);
    for (let round = 0; round < n; round++) {
      assert.equal(giver(s).id, round + 1); clue(s);
      // Concurrent inputs use the same phase envelope and all are accepted.
      const envelope = { match: s.match, round, phase: 'guess', action: 'guess', value: 50 };
      for (const p of s.seats.filter((p) => p.id !== giver(s).id)) assert.ok(act(s, p.id, envelope));
      action(s, giver(s).id, 'reveal'); action(s, 1, 'next');
    }
    assert.equal(s.phase, 'finished');
    assert.deepEqual(s.seats.map((p) => p.score), Array(n).fill(4 * n));
  }
});

test('disconnects preserve guesses and secrets; away seats and host skip cannot stall the game', () => {
  const s = session(4); start(s); clue(s);
  action(s, 2, 'guess', 42); action(s, 3, 'guess', 50);
  presence(s, 4, false);
  assert.equal(s.phase, 'debate');
  presence(s, 2, false); presence(s, 2, true);
  assert.equal(phoneView(s, 2).mine, 42);
  assert.equal(phoneView(s, 2).target, undefined);
  presence(s, 1, false);
  assert.equal(action(s, 1, 'reveal'), false);
  assert.ok(action(s, 2, 'skip', undefined, true));
  assert.deepEqual(s.seats.map((p) => p.score), [0,0,0,0]);
  action(s, 2, 'next'); assert.equal(giver(s).id, 2);
  action(s, 2, 'skip', undefined, true); action(s, 2, 'next');
  action(s, 2, 'skip', undefined, true); action(s, 2, 'next');
  assert.equal(s.phase, 'finished');
});

test('host can open discussion for missing guesses; missing submissions earn zero', () => {
  const s = session(); start(s); clue(s);
  assert.equal(action(s, 1, 'discuss'), false);
  action(s, 2, 'guess', 50);
  assert.ok(action(s, 1, 'discuss', undefined, true));
  action(s, 1, 'reveal');
  assert.deepEqual(s.seats.map((p) => p.score), [4,4,0]);
});
