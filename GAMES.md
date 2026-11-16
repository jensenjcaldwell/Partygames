# Writing a Party Hall game

A game is a folder with two small files. Drop the folder into the server's
games directory (or upload it, see below) and it shows up on the host screen
straight away. No rebuild, no restart.

```
my-game/
  game.json     name, icon, player counts
  host.js       all the game logic; runs on the TV in the browser
  player.js     optional: a custom phone screen
  anything.png  optional assets, reachable with ctx.asset('anything.png')
```

The folder name is the game's id: lowercase letters, digits and `-`.

## game.json

```json
{
  "name": "Face-Off",
  "inspiredBy": "Quiplash",
  "description": "One line for the game picker.",
  "icon": "🥊",
  "color": "#ff7d5d",
  "minPlayers": 3,
  "maxPlayers": 12,
  "lateJoin": false,
  "hidden": false
}
```

`inspiredBy` names the well-known game it plays like, shown in brackets on the picker. `lateJoin: true` lets people join after the game starts. `hidden: true` keeps a
work-in-progress game off the picker.

## host.js

Export one async function. It gets `ctx`, runs the whole game, and when it
returns everyone goes back to the lobby.

```js
export default async function (ctx) {
  await ctx.say('Quick Poll', 'Answer on your phone', 2000);
  const answers = await ctx.ask('all', {
    title: 'Cats or dogs?',
    choices: ['Cats', 'Dogs'],
  }, { timeout: 20 });
  const cats = [...answers.values()].filter((a) => a === 'Cats').length;
  await ctx.say(`${cats} cat people`, `and ${answers.size - cats} dog people`, 5000);
}
```

### ctx reference (host)

| | |
|---|---|
| `ctx.el` | The TV's stage element. Draw anything into it. The TV is a fixed 16:9 frame (1em = 1/64 of its width, so size things in em); if your content overflows, the stage is zoomed down to fit. |
| `ctx.players` / `ctx.connected` | Arrays of `{ id, name, color, connected }`. |
| `ctx.player(id)` | One player. |
| `ctx.show(to, view)` | Put a view on phones. `to` is `'all'`, a player, an id or a list. Phones that reconnect get their last view back. |
| `ctx.ask(to, view, opts)` | Show a view and wait for answers. Resolves to `Map(playerId → answer)` once everyone asked has answered (disconnected players are skipped) or after `opts.timeout` seconds. `opts.after` is the view shown once someone answers; `opts.onAnswer(player, value, answers)` fires per answer; `opts.clock: false` hides the countdown. |
| `ctx.say(title, sub, ms)` | Big centred text on the TV, then wait `ms`. |
| `ctx.countdown(s)` | Show a countdown and wait for it. |
| `ctx.clock(s)` | Show a countdown without waiting; returns a stop function. |
| `ctx.sleep(ms)` | Wait. Throws if the host pressed End game, which ends your function cleanly. |
| `ctx.send(to, data)` / `ctx.broadcast(data)` | Raw messages for a custom `player.js`. |
| `ctx.on('join' \| 'leave' \| 'message', fn)` | `message` gets `(player, data)` for anything a phone sends that isn't an answer to `ask`. |
| `ctx.end()` | Stop now and go back to the lobby. |
| `ctx.h(tag, attrs, ...children)` | Tiny element builder: `h('div.card', { onclick }, 'text')`. |
| `ctx.shuffle(arr)`, `ctx.pick(arr)`, `ctx.esc(str)` | Helpers. |
| `ctx.asset(path)` | URL of a file in your game folder. |
| `ctx.sfx(name)` | Sound effect, synthesized (no files): `tick`, `tock`, `pop`, `join`, `ding`, `whoosh`, `start`, `win`, `lose`, `buzz`, `glitch`, `timeup`. |
| `ctx.music(mood)` | Background music: `'lobby'`, `'party'`, `'think'`, `'tense'`, `'factory'` (industrial funk), or `null`. Set `"music"` in game.json for the default. |

Built in, no code needed: countdowns tick-tock for the last 10 seconds and
buzz at zero, answers make a pop, `ctx.say` whooshes, there's a mute button on
the TV, and the TV and phones keep their screens awake while a room is open
(this needs HTTPS, so it works on the public address but not on plain LAN
http).

Your module can `import` other files from its own folder (`import { WORDS } from './words.js'`).

### Views (what phones show)

Phones draw views for you, so most games need no phone code at all.

```js
{
  title: 'Round 2',                 // heading
  text: 'Write a slogan for socks',  // body text
  image: ctx.asset('pic.png'),
  wait: 'Look at the TV!',           // waiting message with spinner
  color: '#5df08a',                  // accent colour
  buzz: true,                        // vibrate the phone

  // at most one of these inputs:
  input: { placeholder, max: 80, multiline: false, submit: 'Send' }, // answer: string
  choices: ['A', 'B'] or [{ label, value, disabled }],               // answer: value
  multi: { min: 1, max: 2, submit: 'Done' },  // with choices: pick several, answer: [values]
  number: { min: 0, max: 100, step: 1, value: 50, submit: 'Lock in' }, // answer: number
  draw: { prompt, submit: 'Done', colors: [...] },                   // answer: PNG data URL
}
```

## Make it readable from the sofa

People read the TV from across a room, so:

- Keep TV text at `.67em` or more (20px on a 1080p TV) and phone text at 14px or more.
- Keep text contrast at WCAG AA: 4.5:1, or 3:1 for big bold text. Don't fade text with `opacity`.
- Player colours are bright, so they read on the dark theme but not on light cards.
  On a light background use the built-in name tag, which puts dark text on the
  player's colour: `h('span.pname', { style: { '--pc': p.color } }, p.name)`.
- Everything must fit the 16:9 frame without the auto zoom kicking in. Cap long
  lists (show the latest few) and use columns rather than one tall stack.

`node tools/audit.js <server> [game-id…]` plays each game with bots on a TV and
phones and reports cut-off text, low contrast, small text and zoomed screens.

## tutorial.json (optional)

An animated "How to play" that the host can run from the lobby. A list of
steps; each has a `title`, a line of `text` and a `scene` of actors that
animate in left to right (`flow: true` draws arrows between them):

```json
[
  { "title": "Give a one-word clue", "text": "Write one word that proves you know the secret.",
    "scene": [
      { "phone": "Secret word: Pancakes", "type": "fluffy", "label": "Ana" },
      { "phone": "Who is the Glitch?", "buttons": ["Ana", "Cy"], "tap": 1 },
      { "card": "crunchy", "color": "#f78fb3", "back": "GLITCH!" },
      { "tv": "Big screen text", "sub": "smaller line" },
      { "icon": "🗳️", "label": "vote" },
      { "score": "+500", "label": "found it" },
      { "dice": [3, 5] }
    ] }
]
```

Any actor takes `fx` (`pop`, `shake`, `pulse`, `glow`, `float`) and `label`.
The built-in games' tutorials are generated by `tools/tutorials.py`;
`node tools/record-tutorials.js <server> <out-dir>` records them as MP4s.

## player.js (optional)

For phone screens the views can't do (a joystick, a buzzer with timing, a
canvas game), add `player.js`:

```js
export default function (ctx) {
  // ctx.el, ctx.me ({ id, name }), ctx.color, ctx.send(data), ctx.h,
  // ctx.on('message', fn), ctx.on('view', fn), ctx.renderView(view), ctx.asset(path)
  ctx.on('message', (m) => { /* from ctx.send() on the host */ });
  ctx.el.append(ctx.h('button.big', { onclick: () => ctx.send({ buzz: Date.now() }) }, 'BUZZ'));
}
```

A `player.js` can also just restyle the phone (Glitch Squad's adds a class to
`document.body` and a stylesheet) and leave the drawing to the standard views.

If `player.js` listens for `'view'`, it takes over drawing views; otherwise the
standard view screen still works alongside it.

## Getting a game onto the server

Either copy the folder into the server's games directory
(`/var/lib/partyhall/games/` on the VM), or upload each file with the admin
token from anywhere:

```sh
./tools/upload-game.sh https://hohmannsreach.duckdns.org:7777 games/my-game
```

Uploading again replaces the files; the next game started uses the new code.
Delete with `curl -X DELETE -H "Authorization: Bearer $PARTY_ADMIN_TOKEN" <server>/api/games/my-game`.

## Testing locally

```sh
cargo run -- --port 8080 --games games
```

Open `http://localhost:8080/host` in one window and `http://localhost:8080/`
in a few private windows to play every seat yourself.
