# Same Frequency

A Wavelength-inspired game for 3–12 players. A warm analog radio lounge, a shared semicircular dial, private phone controls and an original synthesized soundtrack.

Each player DJs once. The DJ gets a spectrum and a private target from 5–95, then writes an example that fits that position. Everyone else saves a guess from 0–100. Guesses stay private until everyone connected has submitted, when discussion opens. Players can update their guesses during discussion. The DJ or host reveals when the room is ready.

Distance from target | Points
--- | ---
0–5 | 4
6–10 | 3
11–15 | 2
16–25 | 1
26+ | 0

The DJ earns the rounded average of submitted guesses’ points. Missing guesses earn zero. A host-skipped round awards no points. The highest total wins, with shared wins for ties.

There are 500 original spectrums covering everyday dilemmas, food, home, relationships, work, entertainment, travel, nature, design, technology, imagination, senses, celebrations, skills and public life. The target and scoring bands never appear in public views or other players’ messages before reveal. After reconnect, each phone gets its own role and saved guess back. Away DJs are skipped when advancing; the host can skip a current round if its DJ is away. Controls are untimed, and the host can open discussion if someone cannot submit.

The soundtrack uses Web Audio: quiet electric-piano chords, bass and soft percussion at 82 BPM. Music ducks during clue-writing, guessing and discussion. Tuning clicks and reveal chimes punctuate play. The collection’s mute button controls all audio. All audio stops when leaving the game. Animations respect reduced-motion preferences, and the phone slider supports touch and keyboard input.

Run checks with `node --test tools/test-same-frequency.mjs`. The browser check requires Playwright and the running Party Hall server: `node tools/test-same-frequency-browser.cjs http://localhost:8080`.
