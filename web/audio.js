// Sound for the host screen, all synthesized with Web Audio (no files).
//   sfx(name)   one-shot effects: tick, tock, pop, join, ding, whoosh, start,
//               win, lose, buzz, glitch, timeup
//   music(mood) looping background music: 'lobby', 'party', 'think', 'tense',
//               or null to stop
// Browsers only allow sound after a click, so unlock() runs on the first one.

let ac = null, master, sfxBus, musicBus, noiseBuf;
let muted = false;
let musicVol = 0.5, sfxVol = 0.7;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => { try { fn(); } catch {} });
export function onAudioChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
try { muted = localStorage.getItem('partyhall.muted') === '1'; } catch {}
try { const mv = parseFloat(localStorage.getItem('partyhall.musicVol')); if (!isNaN(mv)) musicVol = Math.max(0, Math.min(1, mv)); } catch {}
try { const sv = parseFloat(localStorage.getItem('partyhall.sfxVol')); if (!isNaN(sv)) sfxVol = Math.max(0, Math.min(1, sv)); } catch {}

function init() {
  if (ac) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ac = new AC();
  master = ac.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ac.destination);
  const comp = ac.createDynamicsCompressor(); comp.connect(master);
  sfxBus = ac.createGain(); sfxBus.gain.value = sfxVol * 0.8; sfxBus.connect(comp);
  musicBus = ac.createGain(); musicBus.gain.value = musicVol * 0.45; musicBus.connect(comp);
  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return true;
}

export function unlock() {
  if (!init()) return;
  if (ac.state === 'suspended') ac.resume().catch(() => {});
}
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, unlock, { capture: true });

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('partyhall.muted', m ? '1' : '0'); } catch {}
  if (ac) master.gain.setTargetAtTime(m ? 0 : 1, ac.currentTime, 0.05);
  notify();
}
export const getMusicVol = () => musicVol;
export function setMusicVol(v) {
  musicVol = Math.max(0, Math.min(1, Number(v)));
  try { localStorage.setItem('partyhall.musicVol', String(musicVol)); } catch {}
  if (musicBus) musicBus.gain.setTargetAtTime(musicVol * 0.45, ac.currentTime, 0.05);
  notify();
}
export const getSfxVol = () => sfxVol;
export function setSfxVol(v) {
  sfxVol = Math.max(0, Math.min(1, Number(v)));
  try { localStorage.setItem('partyhall.sfxVol', String(sfxVol)); } catch {}
  if (sfxBus) sfxBus.gain.setTargetAtTime(sfxVol * 0.8, ac.currentTime, 0.05);
  notify();
}

const ready = () => ac && ac.state === 'running';

function tone(freq, t, dur, { type = 'sine', vol = 0.5, to = null, attack = 0.005, bus = sfxBus, filter = null } = {}) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let out = g;
  if (filter) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; g.connect(f); out = f; }
  o.connect(g); out.connect(bus);
  o.start(t); o.stop(t + dur + 0.05);
}

function noise(t, dur, { vol = 0.3, from = 800, to = 4000, type = 'bandpass', bus = sfxBus, q = 1 } = {}) {
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(bus);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}

const SFX = {
  tick: (t) => { tone(2100, t, 0.05, { type: 'square', vol: 0.25 }); noise(t, 0.03, { vol: 0.2, from: 5000, to: 5000 }); },
  tock: (t) => { tone(1400, t, 0.06, { type: 'square', vol: 0.25 }); noise(t, 0.03, { vol: 0.2, from: 3000, to: 3000 }); },
  pop: (t) => tone(500, t, 0.12, { to: 1100, vol: 0.45 }),
  join: (t) => { tone(660, t, 0.12, { vol: 0.4 }); tone(990, t + 0.08, 0.2, { vol: 0.4 }); },
  ding: (t) => { tone(1318, t, 0.9, { vol: 0.35 }); tone(1976, t, 0.6, { vol: 0.15 }); },
  whoosh: (t) => noise(t, 0.45, { vol: 0.35, from: 300, to: 3500, q: 0.8 }),
  start: (t) => [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.07, 0.5, { type: 'triangle', vol: 0.35 })),
  win: (t) => {
    [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, t + i * 0.11, 0.35, { type: 'square', vol: 0.18, filter: 3000 }));
    tone(1046, t + 0.66, 1.2, { type: 'triangle', vol: 0.35 });
  },
  lose: (t) => [392, 370, 349, 330].forEach((f, i) => tone(f, t + i * 0.22, i === 3 ? 0.9 : 0.25, { type: 'sawtooth', vol: 0.15, filter: 1500 })),
  buzz: (t) => tone(110, t, 0.5, { type: 'sawtooth', vol: 0.3, to: 90, filter: 900 }),
  timeup: (t) => { tone(880, t, 0.15, { type: 'square', vol: 0.2 }); tone(660, t + 0.15, 0.4, { type: 'square', vol: 0.2 }); },
  glitch: (t) => {
    for (let i = 0; i < 9; i++) tone(200 + Math.random() * 1800, t + i * 0.035, 0.04, { type: 'square', vol: 0.18 });
    noise(t + 0.1, 0.25, { vol: 0.25, from: 6000, to: 200 });
  },
};

export function sfx(name, delay = 0) {
  if (!ready() || !SFX[name]) return;
  SFX[name](ac.currentTime + 0.01 + delay);
}

// ---------- music ----------
const N = (s) => 440 * 2 ** ((s - 69) / 12); // MIDI note -> Hz
const MOODS = {
  // chords as MIDI roots + quality; bpm; arp pattern (scale steps of the chord)
  lobby: { bpm: 96, chords: [[60, 'M'], [57, 'm'], [53, 'M'], [55, 'M']], arp: [0, 1, 2, 1, 3, 2, 1, 2], drums: 'soft' },
  party: { bpm: 118, chords: [[62, 'm'], [58, 'M'], [53, 'M'], [60, 'M']], arp: [0, 2, 1, 3, 0, 2, 3, 1], drums: 'full' },
  think: { bpm: 84, chords: [[57, 'm'], [53, 'M'], [60, 'M'], [55, 'M']], arp: [0, null, 2, null, 1, null, 3, null], drums: 'soft' },
  tense: { bpm: 128, chords: [[57, 'm'], [57, 'm'], [58, 'M'], [56, 'd']], arp: [0, 0, 2, 0, 3, 0, 2, 1], drums: 'full' },
};
const QUAL = { M: [0, 4, 7, 12], m: [0, 3, 7, 12], d: [0, 3, 6, 12] };
let mood = null, step = 0, nextT = 0, timer = null;

export function music(m) {
  if (m && !MOODS[m]) m = 'party';
  if (m === mood) return;
  mood = m;
  clearInterval(timer); timer = null;
  if (!mood) return;
  step = 0; nextT = 0;
  timer = setInterval(schedule, 50);
}
export const currentMusic = () => mood;

function schedule() {
  if (!ready() || !mood) return;
  const M = MOODS[mood];
  const eighth = 60 / M.bpm / 2;
  if (nextT < ac.currentTime) nextT = ac.currentTime + 0.05;
  while (nextT < ac.currentTime + 0.2) {
    const bar = Math.floor(step / 8) % M.chords.length, s = step % 8;
    const [root, q] = M.chords[bar];
    const iv = QUAL[q];
    const t = nextT;
    const opt = { bus: musicBus };
    if (s === 0 || s === 4) tone(N(root - 24), t, eighth * 3.5, { ...opt, type: 'triangle', vol: 0.55, attack: 0.01 });
    if (s === 0) iv.slice(0, 3).forEach((x) => tone(N(root + x), t, eighth * 7.5, { ...opt, type: 'sine', vol: 0.12, attack: 0.08 }));
    const a = M.arp[s];
    if (a != null) tone(N(root + 12 + iv[a]), t, eighth * 0.9, { ...opt, type: 'square', vol: 0.07, filter: 2200 });
    if (s % 4 === 0) tone(130, t, 0.18, { ...opt, to: 45, vol: M.drums === 'full' ? 0.8 : 0.45 });
    if (M.drums === 'full' && s % 4 === 2) noise(t, 0.12, { ...opt, vol: 0.18, from: 1800, to: 1200 });
    if (s % 2 === 1) noise(t, 0.04, { ...opt, vol: M.drums === 'full' ? 0.1 : 0.05, from: 9000, to: 9000, type: 'highpass' });
    nextT += eighth; step++;
  }
}
