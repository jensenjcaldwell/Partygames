// The phone: join a room, then show whatever the host's game sends.
import { h, socket, colorOf, keepAwake } from './common.js';
import { renderView } from './widgets.js';

const app = document.getElementById('app');
const SAVE = 'partyhall.session';
const load = () => { try { return JSON.parse(localStorage.getItem(SAVE)) || {}; } catch { return {}; } };
const save = (s) => { try { localStorage.setItem(SAVE, JSON.stringify(s)); } catch {} };

let sess = load();
let sock = null;
let me = null;          // { id, name, code, game }
let listeners = { message: [], view: [] };
let lastView = null;
let custom = null;      // custom player module, if the game has one
let stage, banner;

const params = new URLSearchParams(location.search);
const codeFromUrl = (params.get('code') || location.hash.slice(1) || '').toUpperCase().slice(0, 4);

function joinScreen(err) {
  keepAwake(false);
  document.body.className = 'phone';
  sock?.close(); sock = null; me = null;
  const code = h('input.code-in', { placeholder: 'ABCD', maxLength: 4, autocomplete: 'off', autocapitalize: 'characters',
    spellcheck: false, value: codeFromUrl || '', oninput: (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '')) });
  const name = h('input', { placeholder: 'Your name', maxLength: 16, autocomplete: 'nickname', value: sess.name || '' });
  const btn = h('button.big', { type: 'submit' }, 'Join');
  app.replaceChildren(h('div.join',
    h('h1.logo', 'Party', h('span', 'Hall')),
    err && h('p.err', err),
    h('form.stack', {
      onsubmit: (e) => {
        e.preventDefault();
        if (code.value.length !== 4) return code.focus();
        if (!name.value.trim()) return name.focus();
        btn.disabled = true;
        sess = { name: name.value.trim(), code: code.value };
        save(sess);
        connect();
      },
    }, h('label', 'Room code', code), h('label', 'Name', name), btn),
    h('p.small', h('a', { href: '/host' }, 'Host a game on this screen instead'))));
  (codeFromUrl ? name : code).focus();
}

function gameScreen() {
  keepAwake(true);
  banner = h('div.banner.hidden');
  stage = h('div.stage');
  app.replaceChildren(h('div.top',
    h('span.me', { style: { color: colorOf(me.id) } }, me.name),
    h('span.code', me.code),
    h('button.link', { onclick: leave }, 'Leave')), banner, stage);
}

function leave() {
  sess.token = null; save(sess);
  sock?.close(); sock = null;
  joinScreen();
}

function setBanner(text) {
  if (!banner) return;
  banner.textContent = text || '';
  banner.classList.toggle('hidden', !text);
}

async function loadCustom(game) {
  listeners = { message: [], view: [] };
  try {
    const list = await (await fetch('/api/games')).json();
    const meta = list.find((g) => g.id === game);
    if (!meta?.hasPlayer) return null;
    const mod = await import(`/games/${game}/player.js?v=${meta.version}`);
    const fn = mod.default || mod.player;
    const ctx = {
      el: stage, me, h,
      send: (data) => sock?.send({ t: 'send', data }),
      on: (ev, f) => (listeners[ev] ||= []).push(f),
      renderView: (view) => renderView(stage, view, ctx.send),
      asset: (p) => `/games/${game}/${p}`,
      color: colorOf(me.id),
    };
    await fn(ctx);
    return ctx;
  } catch (e) {
    console.error(e);
    setBanner('This game\'s phone code failed to load: ' + e.message);
    return null;
  }
}

function connect() {
  sock?.close();
  sock = socket({
    hello: () => ({ t: 'join', code: sess.code, name: sess.name, token: sess.token || null }),
    onState: (open) => { if (me) setBanner(open ? '' : 'Reconnecting…'); },
    onMsg: async (m) => {
      switch (m.t) {
        case 'joined': {
          const first = !me || me.game !== m.game;
          me = { id: m.id, name: m.name, code: m.code, game: m.game };
          sess.token = m.token; sess.code = m.code; save(sess);
          if (first) {
            gameScreen();
            renderView(stage, lastView, (d) => sock.send({ t: 'send', data: d }));
            custom = await loadCustom(m.game);
            // A view that arrived while player.js was loading goes to it now.
            if (lastView && listeners.view.length) listeners.view.forEach((f) => f(lastView));
          }
          setBanner(m.host ? '' : 'The host screen is offline…');
          break;
        }
        case 'msg': {
          const d = m.data;
          if (d && d.kind === 'view') {
            lastView = d.view;
            if (!d.view?.lobby && listeners.view.length) listeners.view.forEach((f) => f(d.view));
            else renderView(stage, d.view, (x) => sock.send({ t: 'send', data: x }));
            if (d.view?.color) document.body.style.setProperty('--accent', d.view.color);
            else document.body.style.removeProperty('--accent');
            if (navigator.vibrate && d.view?.buzz) navigator.vibrate(80);
          } else listeners.message.forEach((f) => f(d));
          break;
        }
        case 'host': setBanner(m.connected ? '' : 'The host screen is offline…'); break;
        case 'kicked': sess.token = null; save(sess); joinScreen('The host removed you from the room.'); break;
        case 'closed': sess.token = null; save(sess); joinScreen('That room has closed.'); break;
        case 'error':
          if (sess.token) { sess.token = null; save(sess); }
          joinScreen(m.msg[0].toUpperCase() + m.msg.slice(1) + '.');
          break;
      }
    },
  });
}

// Rejoin automatically after a refresh or a lost connection.
if (sess.token && sess.code && (!codeFromUrl || codeFromUrl === sess.code)) connect();
else joinScreen();
