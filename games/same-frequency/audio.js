import { isMuted } from '/sdk/audio.js';

// A quiet, original electric-piano groove and radio-inspired effects. All
// voices share one gain so the collection's mute button applies immediately.
export function createAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return { mood() {}, effect() {}, close() {} };
  const ac = new AC();
  const master = ac.createGain(); master.gain.value = isMuted() ? 0 : .3; master.connect(ac.destination);
  let mode = 'lounge', step = 0, next = ac.currentTime + .1, closed = false;
  const note = (frequency, time, duration, volume = .12, type = 'sine', end) => {
    const oscillator = ac.createOscillator(), gain = ac.createGain();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, time);
    if (end) oscillator.frequency.exponentialRampToValueAtTime(end, time + duration);
    gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(volume, time + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    oscillator.connect(gain); gain.connect(master); oscillator.start(time); oscillator.stop(time + duration + .03);
  };
  const resume = () => { if (!closed && ac.state === 'suspended') ac.resume().catch(() => {}); };
  document.addEventListener('pointerdown', resume);
  resume();
  const loop = setInterval(() => {
    if (closed) return;
    master.gain.setTargetAtTime(isMuted() ? 0 : .3, ac.currentTime, .03);
    if (ac.state !== 'running') return;
    if (next < ac.currentTime) next = ac.currentTime + .05;
    while (next < ac.currentTime + .16) {
      if (mode !== 'silent') {
        const roots = [130.81, 110, 146.83, 98];
        const root = roots[Math.floor(step / 16) % roots.length], beat = step % 16;
        const vol = mode === 'think' ? .45 : 1;
        if (beat === 0) [1, 1.1892, 1.4983, 1.8877].forEach((ratio) => note(root * ratio, next, 2.4, .09 * vol));
        if ([0, 6, 10].includes(beat)) note(root / 2, next, .4, .3 * vol, 'triangle');
        if ([3, 7, 11, 14].includes(beat)) note(root * [2.9966, 3.7754, 2.3784, 2][Math.floor(beat / 4)], next, .45, .07 * vol, 'triangle');
        if (mode !== 'think' && beat % 4 === 0) note(110, next, .12, .16, 'sine', 40);
        if (mode !== 'think' && beat % 4 === 2) note(1700, next, .035, .025, 'triangle');
      }
      step++; next += 60 / 82 / 4;
    }
  }, 80);
  return {
    mood(value) { mode = value; },
    effect(name) {
      if (closed || ac.state !== 'running' || isMuted()) return;
      const t = ac.currentTime + .01;
      if (name === 'tune') [420, 710, 510].forEach((f, i) => note(f, t + i * .06, .09, .15, 'triangle', f * .9));
      if (name === 'click') note(1200, t, .045, .16, 'triangle', 450);
      if (name === 'reveal') [261.63, 329.63, 392, 523.25].forEach((f, i) => note(f, t + i * .14, 1.1, .24, 'triangle'));
      if (name === 'win') [261.63, 329.63, 392, 523.25, 659.25, 783.99].forEach((f, i) => note(f, t + i * .12, 1.4, .2, 'triangle'));
    },
    close() { closed = true; clearInterval(loop); document.removeEventListener('pointerdown', resume); ac.close().catch(() => {}); },
  };
}
