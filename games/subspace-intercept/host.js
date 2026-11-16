import { OVERRIDE_CODES, TRANSMISSIONS } from './words.js';

const VOICE_GROUPS = {
  sf_start: ['sf_start_1.wav', 'sf_start_2.wav', 'sf_start_3.wav', 'sf_start_4.wav', 'sf_start_5.wav'],
  sf_transmit: ['sf_transmit_1.wav', 'sf_transmit_2.wav', 'sf_transmit_3.wav', 'sf_transmit_4.wav', 'sf_transmit_5.wav'],
  sf_decode: ['sf_decode_1.wav', 'sf_decode_2.wav', 'sf_decode_3.wav', 'sf_decode_4.wav', 'sf_decode_5.wav'],
  sf_correct: ['sf_correct_1.wav', 'sf_correct_2.wav', 'sf_correct_3.wav', 'sf_correct_4.wav', 'sf_correct_5.wav'],
  sf_wrong: ['sf_wrong_1.wav', 'sf_wrong_2.wav', 'sf_wrong_3.wav', 'sf_wrong_4.wav', 'sf_wrong_5.wav'],
  sf_attempt: ['sf_attempt_1.wav', 'sf_attempt_2.wav'],
  sf_win: ['sf_attempt_win.wav', 'sf_attempt_win_2.wav', 'sf_attempt_win_3.wav'],
  borg_assimilate: [
    'borg_assimilate_1.wav',
    'borg_assimilate_2.wav',
    'borg_assimilate_3.wav',
    'borg_assimilate_4.wav',
    'borg_assimilate_5.wav',
    'borg_assimilate_6.wav',
    'borg_assimilate_7.wav',
    'borg_assimilate_8.wav',
  ],
  borg_round: ['borg_win_round_1.wav', 'borg_win_round_2.wav', 'borg_win_round_3.wav', 'borg_win_round_4.wav'],
  borg_win: ['borg_victory.wav'],
};

function injectStyles() {
  if (document.getElementById('lcars-host-css')) return;
  const s = document.createElement('style');
  s.id = 'lcars-host-css';
  s.textContent = `
    .lcars-root {
      width: 100%;
      height: 100%;
      background: #000;
      color: #ffcf87;
      font-family: 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif;
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr) auto;
      gap: 0.42em;
      padding: 0.55em 1.0em;
      box-sizing: border-box;
      position: relative;
      overflow: hidden;
    }
    .lcars-root.borg-alert {
      box-shadow: inset 0 0 60px rgba(57, 255, 20, 0.35);
    }
    .lcars-top {
      display: grid;
      grid-template-columns: 7em 1fr auto;
      align-items: center;
      gap: 0.6em;
    }
    .lcars-elbow-tl {
      height: 1.85em;
      background: #ff9900;
      border-radius: 1.2em 0 0 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #000;
      font-weight: 900;
      font-size: 0.9em;
      letter-spacing: 0.08em;
    }
    .lcars-bar {
      height: 1.85em;
      background: linear-gradient(90deg, #ffaa66 0%, #ffaa66 58%, #cc99cc 58%, #cc99cc 100%);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 1em;
      color: #000;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-size: 0.9em;
      position: relative;
      overflow: hidden;
    }
    .lcars-bar::after {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      width: 5em;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.45), transparent);
      animation: barSweep 3.2s linear infinite;
    }
    @keyframes barSweep {
      0% { left: -6em; }
      100% { left: 105%; }
    }
    .lcars-pill-status {
      height: 1.85em;
      padding: 0 1.0em;
      border-radius: 0 1.2em 1.2em 0;
      background: #99ccff;
      color: #000;
      font-weight: 900;
      display: flex;
      align-items: center;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-size: 0.85em;
      transition: background 0.3s, color 0.3s;
    }
    .lcars-pill-status.borg {
      background: #39ff14;
      color: #021402;
      animation: borgPulse 0.7s infinite alternate;
    }
    @keyframes borgPulse {
      from { box-shadow: 0 0 6px #39ff14; }
      to { box-shadow: 0 0 24px #39ff14; }
    }

    .lcars-teams {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1em;
    }
    .team-panel {
      background: #0a0c14;
      border: 2px solid #ff9900;
      border-left: 1.0em solid #ff9900;
      border-radius: 0.8em;
      padding: 0.42em 0.85em;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.7em;
      transition: transform 0.25s, box-shadow 0.25s, border-color 0.25s;
    }
    .team-panel.beta {
      border-color: #cc99cc;
      border-left-color: #cc99cc;
    }
    .team-panel.active {
      box-shadow: 0 0 22px rgba(255, 153, 0, 0.35);
      transform: translateY(-2px);
    }
    .team-panel.beta.active {
      box-shadow: 0 0 22px rgba(204, 153, 204, 0.35);
    }
    .team-meta {
      display: flex;
      flex-direction: column;
      gap: 0.2em;
    }
    .team-name {
      font-size: 1.15em;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .team-roster {
      font-size: 0.8em;
      color: #99ccff;
      opacity: 0.9;
    }
    .team-pips {
      display: flex;
      gap: 0.3em;
      margin-top: 0.2em;
    }
    .team-pip {
      width: 1.5em;
      height: 0.55em;
      border-radius: 999px;
      background: #1e293b;
      border: 1px solid #475569;
    }
    .team-pip.done {
      background: #ff9900;
      border-color: #fff3d6;
      box-shadow: 0 0 8px rgba(255, 153, 0, 0.7);
    }
    .team-panel.beta .team-pip.done {
      background: #cc99cc;
      box-shadow: 0 0 8px rgba(204, 153, 204, 0.7);
    }
    .cipher-row {
      display: flex;
      gap: 0.35em;
    }
    .cipher-cell {
      width: 2.0em;
      height: 2.3em;
      border-radius: 0.35em;
      border: 2px solid #334155;
      background: #05070e;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2em;
      font-weight: 900;
      color: #475569;
      letter-spacing: 0;
      position: relative;
      overflow: hidden;
      animation: cipherIdle 2.4s ease-in-out infinite;
    }
    .cipher-cell:nth-child(2) { animation-delay: 0.25s; }
    .cipher-cell:nth-child(3) { animation-delay: 0.5s; }
    .cipher-cell:nth-child(4) { animation-delay: 0.75s; }
    .cipher-cell:nth-child(5) { animation-delay: 1.0s; }
    @keyframes cipherIdle {
      0%, 100% { border-color: #334155; }
      50% { border-color: #475569; color: #64748b; }
    }
    .cipher-cell.unlocked {
      border-color: #ff9900;
      background: rgba(255, 153, 0, 0.16);
      color: #fff3d6;
      animation: cellPop 0.45s cubic-bezier(0.2, 1.4, 0.4, 1);
    }
    .team-panel.beta .cipher-cell.unlocked {
      border-color: #cc99cc;
      background: rgba(204, 153, 204, 0.18);
    }
    @keyframes cellPop {
      0% { transform: scale(0.5); }
      70% { transform: scale(1.18); }
      100% { transform: scale(1); }
    }

    .lcars-stage {
      background: #070910;
      border: 2px solid #334155;
      border-radius: 1.0em;
      padding: 0.65em 1.2em;
      min-height: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.55em;
      position: relative;
      overflow: hidden;
    }
    .stage-kicker {
      font-size: 0.88em;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #99ccff;
      font-weight: 700;
    }
    .stage-title {
      font-size: 1.6em;
      line-height: 1.1;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #ff9900;
      text-align: center;
    }
    .stage-sub {
      font-size: 1.0em;
      color: #ffcf87;
      text-align: center;
      max-width: 44em;
      line-height: 1.25;
    }

    .clue-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(10em, 1fr));
      gap: 0.9em;
      width: 100%;
      max-width: 44em;
    }
    .clue-card {
      background: #0d1220;
      border: 2px solid #ff9900;
      border-top: 0.5em solid #ff9900;
      border-radius: 0.7em;
      padding: 0.75em 0.7em;
      text-align: center;
      position: relative;
      animation: cardSlideIn 0.4s ease-out both;
    }
    .clue-card:nth-child(2) { animation-delay: 0.1s; }
    .clue-card:nth-child(3) { animation-delay: 0.2s; }
    @keyframes cardSlideIn {
      from { opacity: 0; transform: translateY(14px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .clue-label {
      font-size: 0.75em;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #99ccff;
      margin-bottom: 0.35em;
    }
    .clue-word {
      font-size: 1.7em;
      font-weight: 900;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #fff;
      word-break: break-word;
    }
    .clue-card.encrypted .clue-word {
      color: #ffaa66;
      letter-spacing: 0.2em;
    }
    .clue-card.assimilated {
      border-color: #39ff14;
      border-top-color: #39ff14;
      background: #051607;
      box-shadow: 0 0 26px rgba(57, 255, 20, 0.35);
      animation: borgGlitch 0.5s ease-in-out;
    }
    .clue-card.assimilated .clue-word {
      color: #39ff14;
    }
    .clue-orig {
      margin-top: 0.45em;
      font-size: 0.8em;
      color: #94a3b8;
      text-decoration: line-through;
    }
    .borg-tag {
      display: inline-block;
      margin-top: 0.35em;
      padding: 0.15em 0.55em;
      border-radius: 999px;
      background: #39ff14;
      color: #021402;
      font-size: 0.7em;
      font-weight: 900;
      letter-spacing: 0.1em;
    }
    @keyframes borgGlitch {
      0%, 100% { transform: translate(0); }
      20% { transform: translate(-4px, 2px) skewX(-4deg); }
      40% { transform: translate(4px, -2px) skewX(4deg); }
      60% { transform: translate(-3px, 0); }
      80% { transform: translate(3px, 1px); }
    }

    .scanline-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: linear-gradient(
        180deg,
        transparent 0%,
        rgba(57, 255, 20, 0.18) 50%,
        transparent 100%
      );
      height: 35%;
      animation: borgSweep 1.1s linear infinite;
    }
    @keyframes borgSweep {
      0% { transform: translateY(-100%); }
      100% { transform: translateY(320%); }
    }

    .subspace-wave {
      display: flex;
      align-items: center;
      gap: 0.35em;
      height: 2.2em;
    }
    .subspace-wave span {
      width: 0.35em;
      height: 0.6em;
      border-radius: 999px;
      background: #99ccff;
      animation: waveBar 0.9s ease-in-out infinite;
    }
    .subspace-wave span:nth-child(2) { animation-delay: 0.12s; background: #ff9900; }
    .subspace-wave span:nth-child(3) { animation-delay: 0.24s; }
    .subspace-wave span:nth-child(4) { animation-delay: 0.36s; background: #cc99cc; }
    .subspace-wave span:nth-child(5) { animation-delay: 0.48s; background: #ff9900; }
    .subspace-wave span:nth-child(6) { animation-delay: 0.60s; }
    .subspace-wave span:nth-child(7) { animation-delay: 0.72s; background: #cc99cc; }
    @keyframes waveBar {
      0%, 100% { height: 0.5em; opacity: 0.45; }
      50% { height: 2.1em; opacity: 1; }
    }

    .borg-reticle {
      width: 4.2em;
      height: 4.2em;
      border: 3px dashed #39ff14;
      border-radius: 0.6em;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #39ff14;
      font-weight: 900;
      font-size: 0.9em;
      letter-spacing: 0.1em;
      box-shadow: 0 0 22px rgba(57, 255, 20, 0.35);
      animation: reticleSpin 3.5s linear infinite;
    }
    @keyframes reticleSpin {
      0% { transform: rotate(0deg) scale(0.95); }
      50% { transform: rotate(180deg) scale(1.06); }
      100% { transform: rotate(360deg) scale(0.95); }
    }

    .lcars-telemetry-dots {
      display: flex;
      gap: 0.35em;
      margin-left: auto;
    }
    .lcars-telemetry-dots span {
      width: 1.4em;
      height: 0.75em;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.45);
      animation: dotBlink 1.6s infinite;
    }
    .lcars-telemetry-dots span:nth-child(2) { animation-delay: 0.35s; }
    .lcars-telemetry-dots span:nth-child(3) { animation-delay: 0.7s; }
    @keyframes dotBlink {
      0%, 100% { background: rgba(0, 0, 0, 0.3); }
      50% { background: #fff; }
    }

    .lcars-bottom {
      display: grid;
      grid-template-columns: auto 1fr 7em;
      gap: 0.6em;
      align-items: center;
    }
    .lcars-bottom-pill {
      height: 1.5em;
      padding: 0 0.9em;
      border-radius: 0.9em 0 0 0.9em;
      background: #cc99cc;
      color: #000;
      font-weight: 900;
      font-size: 0.8em;
      display: flex;
      align-items: center;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .lcars-bottom-bar {
      height: 1.5em;
      background: #ff9900;
      display: flex;
      align-items: center;
      padding: 0 0.9em;
      color: #000;
      font-weight: 800;
      font-size: 0.8em;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .lcars-elbow-br {
      height: 1.5em;
      background: #99ccff;
      border-radius: 0 0 1.0em 0;
    }
  `;
  document.head.appendChild(s);
}

function parseClues(raw) {
  const parts = String(raw || '')
    .split(/[\s,;/]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const out = parts.slice(0, 3);
  while (out.length < 3) out.push('REDACTED');
  return out;
}

export default async function (ctx) {
  injectStyles();
  const h = ctx.h;

  const lastVoice = new Map();
  let currentAudio = null;
  function playVoice(group) {
    const list = VOICE_GROUPS[group];
    if (!list || !list.length) return;
    let pick = list[Math.floor(Math.random() * list.length)];
    if (list.length > 1 && lastVoice.get(group) === pick) {
      pick = list[(list.indexOf(pick) + 1) % list.length];
    }
    lastVoice.set(group, pick);
    try {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      }
      currentAudio = new Audio(ctx.asset(`audio/${pick}`));
      currentAudio.volume = 0.95;
      currentAudio.play().catch(() => {});
    } catch {}
  }

  const players = ctx.shuffle([...ctx.players]);
  const mid = Math.ceil(players.length / 2);
  const codes = ctx.shuffle([...OVERRIDE_CODES]);
  let codeIdx = 0;
  function nextCode() {
    if (codeIdx >= codes.length) codeIdx = 0;
    return codes[codeIdx++];
  }

  const teams = [
    {
      id: 'alpha',
      name: 'Team Alpha',
      color: '#ff9900',
      members: players.slice(0, mid),
      code: nextCode(),
      revealed: [false, false, false, false, false],
      codesCracked: 0,
    },
    {
      id: 'beta',
      name: 'Team Beta',
      color: '#cc99cc',
      members: players.slice(mid),
      code: nextCode(),
      revealed: [false, false, false, false, false],
      codesCracked: 0,
    },
  ];

  const deck = ctx.shuffle([...TRANSMISSIONS]);
  let deckIdx = 0;
  function nextWord() {
    if (deckIdx >= deck.length) deckIdx = 0;
    return deck[deckIdx++];
  }

  function revealNextLetter(team) {
    const locked = [];
    team.revealed.forEach((r, i) => {
      if (!r) locked.push(i);
    });
    if (!locked.length) return -1;
    const pick = locked[Math.floor(Math.random() * locked.length)];
    team.revealed[pick] = true;
    return pick;
  }

  function isCodeCracked(team) {
    return team.revealed.every(Boolean);
  }

  function formatCode(team) {
    return team.code
      .split('')
      .map((ch, i) => (team.revealed[i] ? ch : '_'))
      .join(' ');
  }

  let round = 0;
  let activeTeamIdx = 0;
  let borgAlert = false;
  let statusText = 'SUBSPACE LINK ACTIVE';
  let footerText = 'LCARS TELEMETRY ONLINE';

  function renderScreen(stageChildren) {
    ctx.el.innerHTML = '';
    const root = h('div', { class: `lcars-root${borgAlert ? ' borg-alert' : ''}` },
      h('div.lcars-top', {},
        h('div.lcars-elbow-tl', {}, 'LCARS 47'),
        h('div.lcars-bar', {},
          h('span', {}, 'SUBSPACE INTERCEPT // STARFLEET COMMAND'),
          h('span', {}, `CYCLE ${round || 1}`)
        ),
        h('div', { class: `lcars-pill-status${borgAlert ? ' borg' : ''}` }, statusText)
      ),
      h('div.lcars-teams', {},
        ...teams.map((t, idx) =>
          h('div', { class: `team-panel ${t.id}${idx === activeTeamIdx ? ' active' : ''}` },
            h('div.team-meta', {},
              h('div.team-name', { style: `color:${t.color}` }, `${t.name} (${t.codesCracked}/3)`),
              h('div.team-roster', {}, t.members.map((m) => m.name).join(' • ')),
              h('div.team-pips', {},
                ...[0, 1, 2].map((p) => h('div', { class: `team-pip${p < t.codesCracked ? ' done' : ''}` }))
              )
            ),
            h('div.cipher-row', {},
              ...t.code.split('').map((ch, ci) =>
                h('div', { class: `cipher-cell${t.revealed[ci] ? ' unlocked' : ''}` },
                  t.revealed[ci] ? ch : '?'
                )
              )
            )
          )
        )
      ),
      h('div.lcars-stage', {},
        h('div.lcars-stage-inner', { style: 'width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.55em;' }, ...stageChildren)
      ),
      h('div.lcars-bottom', {},
        h('div.lcars-bottom-pill', {}, 'OVERRIDE'),
        h('div.lcars-bottom-bar', {},
          h('span', {}, footerText),
          h('div.lcars-telemetry-dots', {}, h('span', {}), h('span', {}), h('span', {}))
        ),
        h('div.lcars-elbow-br', {})
      )
    );
    ctx.el.appendChild(root);
    requestAnimationFrame(() => {
      const st = root.querySelector('.lcars-stage');
      const inner = root.querySelector('.lcars-stage-inner');
      if (st && inner && inner.scrollHeight > st.clientHeight - 8) {
        inner.style.zoom = String(Math.max(0.55, (st.clientHeight - 8) / inner.scrollHeight));
      }
    });
  }

  // Intro
  ctx.sfx('start');
  playVoice('sf_start');
  renderScreen([
    h('div.stage-kicker', {}, 'INCOMING STARFLEET BRIEFING'),
    h('div.stage-title', {}, 'SUBSPACE INTERCEPT'),
    h('div.stage-sub', {}, 'Everyone writes 3 clues at once, everyone assimilates an enemy clue at once, then teams decode! Crack 3 five-letter override codes to win.'),
  ]);
  await ctx.sleep(4500);

  let winner = null;
  let winReason = '';

  async function handleCodeCracked(team, reason) {
    team.codesCracked += 1;
    if (team.codesCracked >= 3) {
      winner = team;
      winReason = reason;
      return true;
    }
    const oldCode = team.code;
    team.code = nextCode();
    team.revealed = [false, false, false, false, false];
    ctx.sfx('win');
    renderScreen([
      h('div.stage-kicker', {}, `OVERRIDE CODE ${team.codesCracked} OF 3 CRACKED`),
      h('div.stage-title', { style: `color:${team.color}` }, `${team.name}: "${oldCode}" DECRYPTED!`),
      h('div.stage-sub', {}, `Loading next 5-letter override cipher (${3 - team.codesCracked} remaining).`),
    ]);
    await ctx.sleep(3200);
    return false;
  }

  while (!winner) {
    round += 1;

    // 1. SIMULTANEOUS TRANSMIT PHASE (everyone writes 3 clues for their own word)
    borgAlert = false;
    statusText = 'ALL TRANSMITTING';
    footerText = `CYCLE ${round} • ALL CREW ENCODING CLUES`;
    playVoice('sf_transmit');
    renderScreen([
      h('div.stage-kicker', {}, `CYCLE ${round} • SIMULTANEOUS TRANSMISSION`),
      h('div.stage-title', {}, 'EVERYONE: ENCODE 3 CLUES'),
      h('div.subspace-wave', {},
        h('span', {}), h('span', {}), h('span', {}), h('span', {}), h('span', {}), h('span', {}), h('span', {})
      ),
      h('div.stage-sub', {}, 'Check your phone! Everyone has a secret word—enter 3 one-word clues at the same time.'),
      h('div.clue-grid', {},
        h('div.clue-card.encrypted', {}, h('div.clue-label', {}, 'MARKER 01'), h('div.clue-word', {}, '•••')),
        h('div.clue-card.encrypted', {}, h('div.clue-label', {}, 'MARKER 02'), h('div.clue-word', {}, '•••')),
        h('div.clue-card.encrypted', {}, h('div.clue-label', {}, 'MARKER 03'), h('div.clue-word', {}, '•••'))
      ),
    ]);

    const targetByPlayer = new Map();
    const cluesByPlayer = new Map();
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, 65000);
      const unsub = ctx.on('message', (p, data) => {
        if (done || !data || !Array.isArray(data.clues)) return;
        const clean = data.clues.slice(0, 3).map((w) => String(w || '').trim().split(/\s+/)[0] || 'REDACTED');
        while (clean.length < 3) clean.push('REDACTED');
        cluesByPlayer.set(p.id, clean);
        if (cluesByPlayer.size >= players.length) {
          unsub?.();
          finish();
        }
      });
      players.forEach((p) => {
        const target = nextWord();
        targetByPlayer.set(p.id, target);
        const t = teams.find((tm) => tm.members.some((m) => m.id === p.id));
        ctx.send(p, { mode: 'threeClues', word: target.word, cat: target.cat, color: t.color });
      });
    });
    players.forEach((p) => {
      if (!cluesByPlayer.has(p.id)) cluesByPlayer.set(p.id, ['REDACTED', 'REDACTED', 'REDACTED']);
    });

    // 2. SIMULTANEOUS BORG ASSIMILATION PHASE (everyone sabotages an opposing player's clues)
    borgAlert = true;
    statusText = 'BORG INTERCEPT';
    footerText = `CYCLE ${round} • ALL BORG ASSIMILATING`;
    ctx.sfx('glitch');
    renderScreen([
      h('div.scanline-overlay', {}),
      h('div.borg-reticle', {}, 'BORG'),
      h('div.stage-kicker', { style: 'color:#39ff14' }, 'WARNING // MASS SUBSPACE INTRUSION'),
      h('div.stage-title', { style: 'color:#39ff14' }, 'EVERYONE: ASSIMILATE AN ENEMY CLUE'),
      h('div.stage-sub', {}, 'Pick 1 clue on your phone and overwrite it with a misleading decoy word!'),
    ]);

    const assignments = new Map();
    teams[0].members.forEach((p, idx) => {
      assignments.set(p.id, teams[1].members[idx % teams[1].members.length]);
    });
    teams[1].members.forEach((p, idx) => {
      assignments.set(p.id, teams[0].members[idx % teams[0].members.length]);
    });

    const saboBySender = new Map();
    await Promise.all(players.map(async (borgP) => {
      const victim = assignments.get(borgP.id);
      const vTarget = targetByPlayer.get(victim.id);
      const vClues = cluesByPlayer.get(victim.id);

      const pickAns = await ctx.ask(borgP, {
        title: `BORG INTERCEPT (${victim.name})`,
        text: `Category: ${vTarget.cat}\nPick ONE clue to assimilate:`,
        color: '#39ff14',
        buzz: true,
        choices: vClues.map((c, i) => ({ label: `${i + 1}. ${c}`, value: i })),
      }, { timeout: 35 });

      const chosenIdx = Number.isInteger(pickAns.get(borgP.id)) ? pickAns.get(borgP.id) : 0;
      const originalWord = vClues[chosenIdx];

      const replaceAns = await ctx.ask(borgP, {
        title: 'ASSIMILATE CLUE',
        text: `Replacing "${originalWord}" — enter 1 misleading word:`,
        color: '#39ff14',
        input: { placeholder: 'Misleading word...', max: 24, submit: 'Assimilate' },
      }, {
        timeout: 35,
        after: { title: 'Assimilated', text: 'Disinformation injected.', wait: 'Waiting for other Borg...' },
      });

      const fakeWord = (replaceAns.get(borgP.id) || 'CUBE').trim().split(/\s+/)[0] || 'CUBE';
      const finalClues = [...vClues];
      finalClues[chosenIdx] = fakeWord;
      saboBySender.set(victim.id, { borgP, chosenIdx, originalWord, fakeWord, finalClues });
    }));

    ctx.sfx('glitch');
    playVoice('borg_assimilate');
    renderScreen([
      h('div.scanline-overlay', {}),
      h('div.borg-reticle', {}, 'BORG'),
      h('div.stage-kicker', { style: 'color:#39ff14' }, 'RESISTANCE IS FUTILE'),
      h('div.stage-title', { style: 'color:#39ff14' }, 'ALL TRANSMISSIONS ASSIMILATED'),
      h('div.stage-sub', {}, 'Every signal now contains one Borg decoy. Preparing in-person decode!'),
    ]);
    await ctx.sleep(3000);

    // 3. ALTERNATING IN-PERSON DECODE FOR EACH TRANSMISSION
    const queue = [];
    const maxLen = Math.max(teams[0].members.length, teams[1].members.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < teams[0].members.length) queue.push({ team: teams[0], opp: teams[1], sender: teams[0].members[i] });
      if (i < teams[1].members.length) queue.push({ team: teams[1], opp: teams[0], sender: teams[1].members[i] });
    }

    for (const turn of queue) {
      if (winner) break;
      const { team, opp, sender } = turn;
      activeTeamIdx = team.id === 'alpha' ? 0 : 1;
      const guessers = team.members.filter((m) => m.id !== sender.id);
      const target = targetByPlayer.get(sender.id);
      const sabo = saboBySender.get(sender.id);
      const { chosenIdx, originalWord, fakeWord, finalClues } = sabo;

      borgAlert = false;
      statusText = 'DECODE SIGNAL';
      footerText = `${team.name.toUpperCase()} • ${sender.name.toUpperCase()} → ${guessers.map((g) => g.name.toUpperCase()).join(' & ')}`;
      playVoice('sf_decode');
      renderScreen([
        h('div.stage-kicker', {}, `${team.name} • CATEGORY: ${target.cat.toUpperCase()}`),
        h('div.stage-title', {}, `${guessers.map((g) => g.name).join(' & ')}: DECODE ${sender.name}'S WORD`),
        h('div.stage-sub', {}, 'Say your guess out loud! One of these three clues was overwritten by the Borg.'),
        h('div.clue-grid', {},
          ...finalClues.map((c, i) =>
            h('div.clue-card', {},
              h('div.clue-label', {}, `MARKER 0${i + 1}`),
              h('div.clue-word', {}, c)
            )
          )
        ),
      ]);

      ctx.show(guessers, {
        title: `Decode ${sender.name}'s Word (${target.cat})`,
        text: `Clues: ${finalClues.join('  •  ')}\n\nSay your guess out loud to ${sender.name}!`,
        color: team.color,
        buzz: true,
      });
      ctx.show(opp.members, {
        title: `${team.name} Decoding`,
        text: `Listen to ${guessers.map((g) => g.name).join(' & ')} guess "${target.word}"!`,
        wait: 'Waiting for result...',
        color: opp.color,
      });

      const judgeAns = await ctx.ask(sender, {
        title: `Answer: ${target.word}`,
        text: `Clues shown: ${finalClues.join(' • ')}\nDid your crewmate say "${target.word}" out loud?`,
        color: team.color,
        choices: [
          { label: '✓ Confirmed (Correct!)', value: 'hit' },
          { label: '✕ Signal Lost (Wrong)', value: 'miss' },
        ],
      }, { timeout: 90, clock: false });

      const isHit = judgeAns.get(sender.id) === 'hit';

      const revealedCards = finalClues.map((c, i) =>
        h('div', { class: `clue-card${i === chosenIdx ? ' assimilated' : ''}` },
          h('div.clue-label', {}, `MARKER 0${i + 1}`),
          h('div.clue-word', {}, c),
          ...(i === chosenIdx
            ? [
                h('div.clue-orig', {}, `Original: ${originalWord}`),
                h('div.borg-tag', {}, 'ASSIMILATED'),
              ]
            : [])
        )
      );

      if (isHit) {
        ctx.sfx('ding');
        playVoice('sf_correct');
        statusText = 'CONFIRMED';
        renderScreen([
          h('div.stage-kicker', { style: 'color:#99ccff' }, `TARGET IDENTIFIED: ${target.word.toUpperCase()}`),
          h('div.stage-title', {}, 'TRANSMISSION CONFIRMED!'),
          h('div.stage-sub', {}, `${team.name} may reveal 1 override letter—or risk it all to guess the full 5-letter code!`),
          h('div.clue-grid', {}, ...revealedCards),
        ]);

        const choiceAns = await ctx.ask(sender, {
          title: `Code ${team.codesCracked + 1}/3: ${formatCode(team)}`,
          text: 'Reveal 1 letter, or skip the letter to attempt the whole 5-letter override code?',
          color: team.color,
          choices: [
            { label: '🔓 Reveal 1 Letter', value: 'letter' },
            { label: '⚡ Attempt Full 5-Letter Code', value: 'full' },
          ],
        }, { timeout: 45 });

        const choice = choiceAns.get(sender.id) || 'letter';

        if (choice === 'full') {
          playVoice('sf_attempt');
          const fullAns = await ctx.ask(sender, {
            title: `Attempt Full Code (${formatCode(team)})`,
            text: 'Enter the exact 5-letter Starfleet override code:',
            color: team.color,
            input: { placeholder: '5-LETTER CODE', max: 12, submit: 'Execute Override' },
          }, { timeout: 45 });

          const attempt = (fullAns.get(sender.id) || '').trim().toUpperCase();
          if (attempt === team.code) {
            team.revealed = [true, true, true, true, true];
            await handleCodeCracked(team, `${team.name} cracked all 3 override codes (finishing with "${team.code}")!`);
          } else {
            ctx.sfx('buzz');
            renderScreen([
              h('div.stage-kicker', { style: 'color:#cc4444' }, 'OVERRIDE REJECTED'),
              h('div.stage-title', { style: 'color:#cc4444' }, `INVALID CODE: "${attempt || '---'}"`),
              h('div.stage-sub', {}, 'No cipher letter unlocked this turn.'),
            ]);
            await ctx.sleep(2800);
          }
        } else {
          revealNextLetter(team);
          ctx.sfx('pop');
          if (isCodeCracked(team)) {
            await handleCodeCracked(team, `${team.name} decrypted all 3 override codes!`);
          } else {
            renderScreen([
              h('div.stage-kicker', {}, `CODE ${team.codesCracked + 1}/3 • FRAGMENT DECRYPTED`),
              h('div.stage-title', {}, `${team.name}: ${formatCode(team)}`),
              h('div.stage-sub', {}, 'Advancing Starfleet override sequence.'),
            ]);
            await ctx.sleep(2400);
          }
        }
      } else {
        ctx.sfx('buzz');
        borgAlert = true;
        statusText = 'SIGNAL LOST';
        playVoice(Math.random() < 0.5 ? 'sf_wrong' : 'borg_round');
        revealNextLetter(opp);

        renderScreen([
          h('div.scanline-overlay', {}),
          h('div.stage-kicker', { style: 'color:#39ff14' }, `TARGET WAS: ${target.word.toUpperCase()}`),
          h('div.stage-title', { style: 'color:#39ff14' }, 'SIGNAL LOST — BORG ADVANCE'),
          h('div.stage-sub', {}, `${opp.name} decrypts 1 override letter!`),
          h('div.clue-grid', {}, ...revealedCards),
        ]);
        await ctx.sleep(3200);

        if (isCodeCracked(opp)) {
          await handleCodeCracked(opp, `${opp.name} completed all 3 override codes via Borg interference!`);
        }
      }
    }
  }

  // VICTORY
  borgAlert = false;
  statusText = 'OVERRIDE COMPLETE';
  footerText = `${winner.name.toUpperCase()} VICTORIOUS`;
  ctx.sfx('win');
  playVoice('sf_win');

  renderScreen([
    h('div.stage-kicker', {}, 'STARFLEET OVERRIDE ACCEPTED'),
    h('div.stage-title', { style: `color:${winner.color}; font-size:2.6em;` }, `${winner.name} WINS!`),
    h('div.stage-sub', {}, winReason),
  ]);

  ctx.show(winner.members, {
    title: 'Victory!',
    text: winReason,
    color: winner.color,
    buzz: true,
  });
  const losers = teams.find((t) => t.id !== winner.id).members;
  ctx.show(losers, {
    title: `${winner.name} Cracked the Code`,
    text: winReason,
    color: '#94a3b8',
  });

  await ctx.sleep(8000);
}
