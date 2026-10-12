# 01 — Game Overview

## What the game is

**Tapan Kaikki 4: Bloodshed** is a top-down single-screen-per-player shooter. The only
goal is to "kill everything that moves". It is a fork of the open-source release of
Tapan Kaikki 4, ported to Linux/macOS and converted to CMake. Version `4.09`
(`CMakeLists.txt`), game type/bullet data in `src/common/types.cpp`.

- Camera: top-down, follows the player lazily (see doc 05).
- Presentation: 8-bit indexed software rendering, 16-bit SDL surface (`KBitDepth=16`).
- Simulation: fixed **100 Hz** tick (`KTimerFreq=100`).
- Levels: hand-authored 20 px grid maps with pseudo-3D walls of height 0–5, spots,
  steam vents, crates and enemies (doc 07).
- Players: 1–4 local, split-screen up to 4 viewports; up to 16 players exist internally.

## Game modes

Two modes exist (`IGameMode`, `CGameModeCooperative`, `CGameModeDeathmatch`):

| Mode | Objective | Crate respawn | Enemies | Random player placement | Shield on start |
|------|-----------|---------------|---------|-------------------------|-----------------|
| **Cooperative** | Kill all enemies → level complete | No | Yes | No | 0 |
| **Deathmatch** | Fight other players | Yes (12.5 s) | Optional (`iEnemiesOnGame`) | Yes | 30 |

Deathmatch specifics: on death a character is teleported and `RandomPlace()`d; energy
is `(100 + 30*10)/3` at spawn; player speed comes from `iDMSpeed` (default
`KPlayerRunSpeed=1.0`); the target system can be enabled (`iDMTargetSystem`).
DM uses its own episodes/crates (`dm.lev` and `DMEpisodes`).

**Gameplay networking is not implemented in the original.** `network.cpp` only wraps
`SDLNet_Init`/`SDLNet_Quit` and an HTTP GET client used by the version checker; the
IPX/NetWare code is commented out and all send/receive functions are no-ops. "Multiplayer"
in practice = local split-screen. The web port implements that split-screen (up to four
players) and deathmatch (docs/12 M11/M12); playable netplay is a **greenfield** addition
(WebRTC/WebSocket, M13), not a port of the dead code.

## Campaign flow (cooperative)

1. Main menu → **single game** → episode select → game.
2. Each level: `NextLevel` → `LevelInfo` → (`Shop` if enabled) → `OnGoing`.
3. Kill all enemies → "MISSION COMPLETED" (940-tick = 9.4 s countdown) → `Statistics`.
4. Statistics screen per player → next level, or `Victory` if last level of episode.
5. Money, weapons, bullets and shield persist **in memory across levels** only; there
   is **no save/load of campaign progress**. Only options are written to disk
   (`options.cfg`).

Starting cash is `500` (`50000` in debug builds).

## Content inventory (bundled `data/`)

- **Episodes** (`data/levs/`): `default`, `blanket`, `blanket2`, `fiendis`,
  `jailbreak`, `mothafux` (10 levels each, `jailbreak` has 8). Plus loose test maps
  `cave.lev`, `dm.lev`, `seacastle.lev`, `small.lev`.
  - Important: bundled maps use the **old** `.lev` format (versions 1–9); `dm.lev`,
    `seacastle.lev`, `small.lev` use version 11 (new format). Both must be supported.
- **Sprites** (`data/efps/*.efp`): floors, walls (6 pseudo-heights), rambo (4 player
  skins), enemies (10), effects, crates, body parts, shadows, bullets, target,
  menu/shop/statistics screens, logos.
- **Fonts** (`data/fnts/*.fnt`): 8×8 small, menu 15×18 and 25×30 (light/dark/gray),
  shop numbers.
- **Sounds** (`data/wavs/*.wav`): 16 effects, 8-bit mono PCM (e.g. `pistol.wav`).
- **Music** (`data/music/`): menu theme + 4 themes (`default`, `heavy`, `oldskool`,
  `techno`) × 5 OGG tracks.
- **Tables**: `palette.tab` (pre-baked transparency/shadow/light tables),
  `default.ini`, `options.cfg`, `palette` reference art.

## Control scheme (defaults)

Default bindings (`COptions.cpp`), key order
`LEFT, RIGHT, UP, DOWN, SHOOT, SHIFT, STRAFE, LSTRAFE, RSTRAFE`:

| Action | P1 | P2 |
|--------|----|----|
| Turn counter-clockwise | (unbound) | `J` |
| Turn clockwise | (unbound) | `L` |
| Walk forward | `W` | `I` |
| Walk backward | `S` | `K` |
| Fire | `Space` | `Y` |
| Change weapon | (unbound) | `T` |
| Strafe | (unbound) | `H` |
| Strafe left | `A` | `U` |
| Strafe right | `D` | `O` |

Mouse (owner = `iMouseMode-1`, default player 1): X movement rotates (sensitivity,
clamped to 15°/tick max), left button fires, right button changes weapon, wheel
changes weapon. In-game global keys: `Esc` quit-confirm, `F4` cycle mouse owner,
`F5` map, `F6` FPS, `PAGEUP/PAGEDOWN` mouse sensitivity. Debug-only (not in release
builds): `6` no-damage, `7` grant weapons, `1`–`5` toggle draw layers.
**No gamepad support.**

## Why "1:1" is achievable

- The original is open source, so exact constants and algorithms are available.
- The simulation is integer/pixel based at a fixed tick, making it naturally
  deterministic and portable.
- Randomness comes from libc `rand()`; a compatible generator reproduces runs exactly.
- Presentation is a software framebuffer with a single palette — reproducible pixel
  for pixel by porting the rasteriser (see [ADR-0001](adr/0001-rendering-stack.md))
  rather than approximating it with generic sprite rendering.
