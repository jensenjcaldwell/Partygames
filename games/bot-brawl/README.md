# Bot Brawl

A scrapyard robot programming game for 2–8 players, with optional computer
opponents (eight total bots). Select **Bot Brawl** in Party Hall, join on phones,
then choose the mode, arena, computer count and planning time on the TV or the
first connected player's phone.

Each round, secretly queue four cards, with repeats allowed. Tapping a filled
slot removes it; a locked program can be edited until resolution starts. Each
beat resolves movement in the displayed rotating priority order, then belts,
then factory lasers. Walls block movement and lasers. Movement pushes whole
chains of bots; pits and the arena boundary wreck bots instantly. Three laser
damage also wrecks a bot. Wrecked bots reboot next round with full hull if they
have lives remaining. Disconnected and timed-out players receive a computer
program. Computer opponents plan from the public board and cannot see other
players' programs.

- **Flag race:** one claimable flag per round, moving between five pads. First
  to three flags, or most flags after ten rounds. Unlimited reboots. Ties use
  knockouts, remaining hull, then fewest wrecks; exact ties share the win.
- **Factory survival:** three lives. The outer rings collapse after rounds 2,
  4 and 6; orange outlines warn players during planning. Last bot with lives
  wins. At eight rounds, compare lives, remaining hull (or latest elimination
  for bots with no lives), then knockouts. Exact ties share the win.

Six arenas offer different layouts: The Rustworks, Crossfire Alley, The
Spillway, Crusher Yard, Magnetron and The Furnace. Factory events are announced
before planning and can reverse or accelerate belts, double factory laser
damage, or turn factory lasers off.

Edge-mounted cannons show firing direction. Moving red dashes and red-striped
tiles preview potential factory laser paths; bright beams and the **FIRING NOW**
banner show actual shots. The first bot or wall blocks each beam. The status
banner and hazard guide update for blackouts, overdrive, reversed belts and
double-speed belts. Yellow-rimmed **×** pits mean instant wrecks; orange-striped
**!** tiles collapse after beat four. Tile and emitter tooltips explain their
effects, and phones show the same event-specific hazard rules below the controls.

Power-up crates first appear in **round 2** and replenish to five each round.
Each bot can store one power-up. Toggle **Use** on the phone before locking in
to activate it before the first move:

| Power-up | Benefit | Risk |
| --- | --- | --- |
| Volatile shield | Blocks one hit, shove or magnet pull this round | An unused armed shield overloads for one hull at round end |
| Rocket boots | The next Forward travels three tiles | One hull of rocket heat afterward; cannot skip or brake before pits |
| Junk magnet | Pulls the nearest aligned bot up to two tiles, within range four | One hull of recoil, even if the pull finds no target |

Stored power-ups persist. Unspent boosts expire at round end. Environmental
knockouts and self-inflicted damage do not award a knockout to another bot.
Incident replays use saved state copies and do not change the live game.

Audio uses the shared synthesized `factory` soundtrack and `bb-*` effects in
`web/audio.js`, so it follows the TV mute control and needs no downloaded media.

Validation:

```sh
node --test tools/test-bot-brawl.mjs
# With Party Hall running and Playwright available:
node tools/test-bot-brawl-browser.cjs http://localhost:8080
```

The rules suite covers all six arenas, both modes, risky power-ups and 168
complete seeded games. The browser check covers two real multiplayer matches,
including eight human controllers, computer opponents, phone reloads, private
programs, settings, replays, layout, results and returning to the lobby.
