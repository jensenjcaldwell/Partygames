// The host screen (the TV). Picks a game, runs the lobby, then loads the game's
// host.js and hands it a `ctx` with everything a game needs. See GAMES.md.
import { h, esc, sleep, shuffle, pick, socket, colorOf, keepAwake } from './common.js';
import * as audio from './audio.js';
import { playTutorial } from './tutorial.js?v=2';

function muteButton(cls = '') {
  const b = h('button.ghost.sm' + cls, {
    title: 'Sound on/off',
    onclick: () => {
      audio.setMuted(!audio.isMuted());
      b.textContent = audio.isMuted() ? '🔇' : '🔊';
      if (lobbyAudio) lobbyAudio.muted = audio.isMuted();
    },
  }, audio.isMuted() ? '🔇' : '🔊');
  const mSlider = h('input', {
    type: 'range', min: '0', max: '1', step: '0.05', value: String(audio.getMusicVol()),
    title: 'Music volume', style: { width: '4.5em', accentColor: 'var(--accent, #7d8cff)', cursor: 'pointer' },
    oninput: (e) => {
      const v = parseFloat(e.target.value);
      audio.setMusicVol(v);
      if (lobbyAudio) lobbyAudio.volume = v * 0.7;
    },
  });
  const sSlider = h('input', {
    type: 'range', min: '0', max: '1', step: '0.05', value: String(audio.getSfxVol()),
    title: 'SFX volume', style: { width: '4.5em', accentColor: 'var(--accent, #7d8cff)', cursor: 'pointer' },
    oninput: (e) => audio.setSfxVol(parseFloat(e.target.value)),
  });
  return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '0.45em' } },
    b,
    h('span', { title: 'Music volume', style: { fontSize: '0.85em', opacity: 0.85 } }, '🎵'), mSlider,
    h('span', { title: 'SFX volume', style: { fontSize: '0.85em', opacity: 0.85 } }, '🔔'), sSlider);
}

const app = document.getElementById('app');
const SAVE = 'partyhall.host';
const players = new Map(); // id -> { id, name, connected, color }
let sock = null, room = null, games = [], game = null, run = null;

const joinUrl = () => location.host;

// Keep every screen inside the 16:9 frame: if what's showing is taller or
// wider than the frame, zoom it down until it fits.
function fitScreen() {
  const el = [...app.children].find((c) => !c.classList.contains('t-overlay'));
  if (!el || el.classList.contains('picker')) return;
  el.style.zoom = '';
  const cs = getComputedStyle(app);
  const availH = app.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const availW = app.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  let needH = el.scrollHeight, needW = el.scrollWidth;
  // A game screen fills the frame; what matters is whether its stage overflows.
  const stage = el.classList.contains('game') && el.querySelector(':scope > .stage');
  if (stage) {
    stage.style.zoom = '';
    const over = stage.scrollHeight - stage.clientHeight;
    const overW = stage.scrollWidth - stage.clientWidth;
    if (over > 1 || overW > 1) {
      stage.style.zoom = String(Math.max(0.35, Math.min(stage.clientHeight / stage.scrollHeight, stage.clientWidth / stage.scrollWidth)));
    }
    return;
  }
  const z = Math.min(1, availH / needH, availW / needW);
  if (z < 0.995) el.style.zoom = String(Math.max(0.35, z));
}
let fitQueued = false;
const queueFit = () => { if (!fitQueued) { fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fitScreen(); }); } };
new MutationObserver(queueFit).observe(app, { childList: true, subtree: true, characterData: true });
addEventListener('resize', queueFit);

// ---------- game picker ----------
async function picker(err) {
  keepAwake(false);
  audio.music(null);
  try { games = await (await fetch('/api/games')).json(); } catch { games = []; }
  app.replaceChildren(h('div.picker',
    h('h1.logo', 'Party', h('span', 'Hall')),
    err && h('p.err', err),
    h('p.sub', 'Pick a game. Everyone else joins on their phone.'),
    h('div.grid', games.map((g) => h('button.gcard', {
      onclick: () => { audio.unlock(); create(g); },
      style: { '--accent': g.color || '#7d8cff' },
    }, h('div.gicon', g.icon || '🎲'), h('h3', g.name || g.id, g.inspiredBy && h('span.inspired', ` (${g.inspiredBy})`)), h('p', g.description || ''),
      h('span.tag', `${g.minPlayers || 1}–${g.maxPlayers || 16} players`)))),
    !games.length && h('p', 'No games found. Add a folder to the games directory.'),
  ));
}

function create(g) {
  game = g;
  players.clear();
  sock?.close();
  sock = socket({
    hello: () => (room ? { t: 'resume', code: room.code, token: room.token } : { t: 'create', game: g.id }),
    onMsg,
    onState: (open) => document.body.classList.toggle('offline', !open),
  });
}

function onMsg(m) {
  switch (m.t) {
    case 'created':
      room = { code: m.code, token: m.token, game: m.game };
      try { sessionStorage.setItem(SAVE, JSON.stringify(room)); } catch {}
      lobby();
      break;
    case 'resumed':
      players.clear();
      for (const p of m.players) players.set(p.id, { ...p, color: colorOf(p.id) });
      if (!run) lobby(); else run.resync();
      break;
    case 'join': {
      const p = players.get(m.id) || { id: m.id, color: colorOf(m.id) };
      Object.assign(p, { name: m.name, connected: true });
      players.set(m.id, p);
      if (!m.rejoin) audio.sfx('join');
      run ? run.emit('join', p, m.rejoin) : lobby();
      break;
    }
    case 'leave': {
      const p = players.get(m.id);
      if (p) p.connected = false;
      run ? run.emit('leave', p) : lobby();
      break;
    }
    case 'removed': players.delete(m.id); run ? run.emit('leave', null) : lobby(); break;
    case 'msg':
      if (run) run.message(players.get(m.from), m.data);
      else if (m.data?.kind === 'answer' && m.data.ask === '__lobby' && m.data.value === '__lobby_start') {
        const first = [...players.values()].find((p) => p.connected);
        const count = [...players.values()].filter((p) => p.connected).length;
        if (first?.id === m.from && count >= (game?.minPlayers || 1)) start();
      }
      break;
    case 'error':
      sock?.close(); sock = null; room = null; run = null;
      try { sessionStorage.removeItem(SAVE); } catch {}
      picker(m.msg[0].toUpperCase() + m.msg.slice(1) + '.');
      break;
  }
}

// ---------- lobby ----------
let lobbyAudio = null, lobbyAudioId = null;
function stopLobbyAudio() {
  if (lobbyAudio) { lobbyAudio.pause(); lobbyAudio = null; lobbyAudioId = null; }
}
function startLobbyAudio(g) {
  if (!g?.id) { stopLobbyAudio(); audio.music('lobby'); return; }
  if (lobbyAudioId === g.id) {
    if (lobbyAudio) lobbyAudio.muted = audio.isMuted();
    return;
  }
  stopLobbyAudio();
  lobbyAudioId = g.id;
  const a = new Audio(`/games/${g.id}/audio/bg_main.ogg?v=${g.version || ''}`);
  a.loop = true;
  a.volume = audio.getMusicVol() * 0.7;
  a.muted = audio.isMuted();
  a.onerror = () => { if (lobbyAudio === a) { stopLobbyAudio(); audio.music('lobby'); } };
  const tryPlay = () => {
    if (lobbyAudio !== a) return;
    a.play().then(() => { if (lobbyAudio === a) audio.music(null); }).catch(() => {});
  };
  tryPlay();
  for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, tryPlay, { once: true, capture: true });
  lobbyAudio = a;
}

function lobby() {
  if (!room) return;
  keepAwake(true);
  startLobbyAudio(game);
  const list = [...players.values()];
  const min = game?.minPlayers || 1;
  const enough = list.filter((p) => p.connected).length >= min;
  app.replaceChildren(h('div.lobby' + (game?.id ? `.lobby-${game.id}` : ''), { style: { '--accent': game?.color || '#7d8cff' } },
    h('div.lobby-head',
      h('div.qr', h('img', { src: '/qr.svg?text=' + encodeURIComponent(`${location.origin}/?code=${room.code}`), alt: 'Scan to join' }),
        h('p.sub', 'Scan to join')),
      h('div', h('p.sub', 'Join on your phone at'), h('div.url', joinUrl())),
      h('div', h('p.sub', 'Room code'), h('div.roomcode', room.code))),
    h('h2', `${game?.icon || ''} ${game?.name || ''}`, game?.inspiredBy && h('span.inspired', ` (${game.inspiredBy})`)),
    h('div.chips', list.length ? list.map((p) => h('div.chip' + (p.connected ? '' : '.away') + (shown.has(p.id) ? '' : '.new'), { style: { '--c': p.color } },
      p.name, h('button.x', { title: 'Remove', onclick: () => sock.send({ t: 'kick', id: p.id }) }, '×')))
      : h('p.sub', 'Waiting for players…')),
    h('div.row',
      h('button.big', { disabled: !enough, onclick: start }, enough ? 'Everybody\'s in!' : `Need ${min}+ players`),
      game?.hasTutorial && h('button.ghost', { onclick: () => playTutorial(app, game) }, '▶ How to play'),
      h('button.ghost', { onclick: quit }, 'Pick another game'),
      muteButton())));
  list.forEach((p) => shown.add(p.id));
  const first = list.find((p) => p.connected);
  const others = list.filter((p) => p.connected && p.id !== first?.id).map((p) => p.id);
  const title = `${game?.icon || ''} ${game?.name || 'Lobby'}`.trim();
  if (first) {
    sock.send({
      t: 'send', to: [first.id],
      data: {
        kind: 'view',
        view: enough
          ? { lobby: true, ask: '__lobby', title, text: `${list.filter((p) => p.connected).length} players ready. You’re first in — tap below to start!`, color: game?.color, choices: [{ label: "Everybody's in! (Start Game)", value: '__lobby_start' }] }
          : { lobby: true, title, color: game?.color, wait: `Waiting for ${min - list.filter((p) => p.connected).length} more player(s)…` },
      },
    });
  }
  if (others.length) {
    sock.send({
      t: 'send', to: others,
      data: { kind: 'view', view: { lobby: true, title, color: game?.color, wait: `Waiting for ${first?.name || 'the host'} to start…` } },
    });
  }
}
const shown = new Set();

function quit() {
  stopLobbyAudio();
  sock?.send({ t: 'close' });
  sock?.close(); sock = null; room = null; run = null;
  try { sessionStorage.removeItem(SAVE); } catch {}
  picker();
}

// ---------- running a game ----------
async function start() {
  if (!game.lateJoin) sock.send({ t: 'lock', locked: true });
  // Re-read the list so an edited game is picked up without a page reload.
  try { game = (await (await fetch('/api/games')).json()).find((g) => g.id === game.id) || game; } catch {}
  let mod;
  try {
    mod = await import(`/games/${game.id}/host.js?v=${game.version}`);
  } catch (e) {
    console.error(e);
    sock.send({ t: 'lock', locked: false });
    lobby();
    app.prepend(h('p.err', `${game.name} failed to load: ${e.message}`));
    return;
  }
  run = makeRun();
  audio.sfx('start');
  audio.music(game.music || 'party');
  stopLobbyAudio();
  const fn = mod.default || mod.host;
  try {
    await fn(run.ctx);
  } catch (e) {
    if (e !== ENDED) {
      console.error(e);
      run.ctx.el.append(h('p.err', 'The game crashed: ' + e.message));
      await sleep(4000);
    }
  }
  if (!run || run.ended) return;
  run.finish();
}

const ENDED = new Error('game ended');

function makeRun() {
  const handlers = {};
  const views = new Map(); // id -> last view
  const asks = new Map();
  const timers = new Set();
  let askSeq = 0;
  const stage = h('div.stage');
  const bar = h('div.hostbar',
    h('span.roomcode-sm', room.code),
    h('span.timer'),
    muteButton(),
    h('button.ghost.sm', { onclick: () => r.finish() }, 'End game'));
  app.replaceChildren(h('div.game', { style: { '--accent': game.color || '#7d8cff' } }, bar, stage));

  const ids = (to) => (to === 'all' || to == null ? [...players.keys()]
    : Array.isArray(to) ? to.map((x) => (typeof x === 'object' ? x.id : x))
    : [typeof to === 'object' ? to.id : to]);
  const live = () => { if (r.ended) throw ENDED; };

  const ctx = {
    el: stage,
    game,
    room: room.code,
    h, esc, sleep: async (ms) => { live(); await sleep(ms); live(); }, shuffle, pick,
    get players() { return [...players.values()]; },
    get connected() { return [...players.values()].filter((p) => p.connected); },
    player: (id) => players.get(id),
    asset: (p) => `/games/${game.id}/${p}`,
    /** Play a sound effect: tick, tock, pop, join, ding, whoosh, start, win, lose, buzz, glitch, timeup. */
    sfx: (name, delay) => audio.sfx(name, delay),
    /** Background music: 'lobby', 'party', 'think', 'tense', or null for silence. */
    music: (mood) => audio.music(mood),
    on(ev, fn) { (handlers[ev] ||= []).push(fn); },
    send(to, data) { live(); sock.send({ t: 'send', to: to === 'all' ? 'all' : ids(to), data }); },
    broadcast(data) { ctx.send('all', data); },
    /** Show a view on phones. `to` = 'all', a player, an id, or a list. */
    show(to, view) {
      live();
      if (to === 'all') views.clear(), views.set('*', view);
      for (const id of ids(to)) views.set(id, view);
      ctx.send(to, { kind: 'view', view });
    },
    /**
     * Ask players something and wait. Resolves to a Map(playerId -> answer)
     * when everyone asked has answered (disconnected players are skipped), or
     * when `timeout` seconds pass. Options: timeout, after (view shown once a
     * player has answered), onAnswer(player, value, answers).
     */
    ask(to, view, opts = {}) {
      live();
      const id = ++askSeq;
      const who = ids(to);
      const answers = new Map();
      const after = opts.after || { wait: 'Got it! Look at the big screen.' };
      return new Promise((resolve, reject) => {
        const a = {
          who, answers, after, opts,
          done: () => {
            asks.delete(id); clearTimeout(a.timer); if (a.stopClock) a.stopClock();
            resolve(answers);
          },
          check: () => {
            if (who.every((pid) => answers.has(pid) || !players.get(pid)?.connected)) a.done();
          },
          reject,
        };
        asks.set(id, a);
        for (const pid of who) views.set(pid, { ...view, ask: id });
        sock.send({ t: 'send', to: who, data: { kind: 'view', view: { ...view, ask: id } } });
        if (opts.timeout) {
          if (opts.clock !== false) a.stopClock = clock(opts.timeout);
          a.timer = setTimeout(a.done, opts.timeout * 1000);
        }
        if (!who.length) a.done();
      });
    },
    /** Show a countdown in the top bar without waiting; returns a stop function. */
    clock(seconds) { live(); return clock(seconds); },
    /** Show a countdown in the top bar; resolves when it reaches zero. */
    async countdown(seconds) {
      live();
      const stop = clock(seconds);
      try { await sleep(seconds * 1000); } finally { stop(); }
      live();
    },
    /** Big centred text on the TV, optionally for `ms` before resolving. */
    async say(title, sub, ms) {
      live();
      stage.replaceChildren(h('div.say', h('h1', title), sub && h('p', sub)));
      audio.sfx('whoosh');
      if (ms) await ctx.sleep(ms);
    },
    /** End the game and go back to the lobby. */
    end() { r.finish(); throw ENDED; },
  };

  function clock(seconds) {
    const el = bar.querySelector('.timer');
    const endAt = Date.now() + seconds * 1000;
    let last = null;
    const tick = () => {
      const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      if (left !== last && last !== null) {
        if (left === 0) audio.sfx('timeup');
        else if (left <= 10) audio.sfx(left % 2 ? 'tick' : 'tock');
      }
      last = left;
      el.textContent = left;
      el.classList.toggle('urgent', left <= 5);
    };
    tick();
    const t = setInterval(tick, 250);
    timers.add(t);
    return () => { clearInterval(t); timers.delete(t); el.textContent = ''; };
  }

  const r = {
    ctx, ended: false,
    emit(ev, ...args) {
      if (ev === 'join') {
        const p = args[0];
        const v = views.get(p.id) || views.get('*');
        if (v) sock.send({ t: 'send', to: [p.id], data: { kind: 'view', view: v } });
      }
      for (const a of asks.values()) a.check();
      for (const f of handlers[ev] || []) try { f(...args); } catch (e) { console.error(e); }
    },
    message(p, data) {
      if (!p) return;
      if (data && data.kind === 'answer' && asks.has(data.ask)) {
        const a = asks.get(data.ask);
        if (!a.who.includes(p.id) || a.answers.has(p.id)) return;
        a.answers.set(p.id, data.value);
        views.set(p.id, a.after);
        audio.sfx('pop');
        sock.send({ t: 'send', to: [p.id], data: { kind: 'view', view: a.after } });
        try { a.opts.onAnswer?.(p, data.value, a.answers); } catch (e) { console.error(e); }
        a.check();
        return;
      }
      for (const f of handlers.message || []) try { f(p, data); } catch (e) { console.error(e); }
    },
    resync() {
      for (const [id, v] of views) sock.send({ t: 'send', to: [id], data: { kind: 'view', view: v } });
    },
    finish() {
      if (r.ended) return;
      r.ended = true;
      for (const a of asks.values()) { clearTimeout(a.timer); a.stopClock?.(); a.reject(ENDED); }
      asks.clear();
      timers.forEach(clearInterval);
      sock.send({ t: 'send', to: 'all', data: { kind: 'view', view: { wait: 'Back in the lobby…' } } });
      sock.send({ t: 'lock', locked: false });
      run = null;
      lobby();
    },
  };
  return r;
}

// Resume a room after a refresh of the host screen.
(async () => {
  // /host?tutorial=<id> plays just that tutorial (used to record videos).
  const tut = new URLSearchParams(location.search).get('tutorial');
  if (tut) {
    document.body.classList.add('recording');
    games = await (await fetch('/api/games')).json();
    const g = games.find((x) => x.id === tut);
    if (g) {
      await playTutorial(app, g, { controls: false });
      app.replaceChildren(h('div.say.t-end', { style: { '--accent': g.color || '#7d8cff' } },
        h('div.t-icon', g.icon || '🎲'), h('h1', `Let's play ${g.name}!`),
        h('p', `Open ${location.host}/host on the TV, then join on your phone.`)));
      await sleep(3000);
    }
    document.title = 'tutorial-done';
    return;
  }
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(SAVE)); } catch {}
  if (saved?.code) {
    try { games = await (await fetch('/api/games')).json(); } catch {}
    game = games.find((g) => g.id === saved.game);
    if (game) { room = saved; create(game); return; }
  }
  picker();
})();
