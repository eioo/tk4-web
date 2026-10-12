# 09 — UI, Flow & Controls

Sources: `src/Menu.cpp`, `src/MenuItems.cpp`, `src/CGameMenu*.cpp`,
`src/CGameSubState*.cpp`, `src/CGUIState*.cpp`, `src/COptions.cpp`, `src/texts.cpp`,
`src/lists.cpp`, `src/CIngameData.cpp`, `src/CMessageBoard.cpp`.

## Menu framework

`CGameMenuContainer` owns one `CGameMenuBase` per menu state. Navigation:
Up/Down (or P1 `W`/`S`) moves, Left/Right adjust values, Return/Space/P1-Shoot
activates, Esc backs out. Values that are "lists" cycle with Left/Right.

### Main menu

```
main menu
  single game            -> episode select
  start multiplayer game -> multiplay dialog
  options                -> options menu
  exit                   -> quit confirm
```

A `join multiplayer game` item exists but is commented out and non-functional.

### Options menu

```
options
  game options
  network options
  player 1 options
  player 2 options
  player 3 options
  player 4 options
  deathmatch options
  audio options
  reset options to default
  previous menu
```

- **Game options**: mouse control (`iMouseMode`, 0=None, 1–4=Player N),
  mouse sensitivity (0.0–10.0, step 0.05), gamma (0.1–3.0, step 0.1; disabled on some
  platforms), in-game resolution, fullscreen, large text.
- **Audio options**: music theme (from `music/`), music volume (0–1, step 0.05),
  effects volume (0–1, step 0.05), reverse stereo.
- **Deathmatch options**: DM moving speed (0.5–5.0, step 0.1), enemies on/off,
  target system on/off.
- **Player N options**: "define keys" (9 actions), "change name" (max 15 chars;
  defaults John/Paul/George/Ringo). Key capture rejects duplicate keys across players.
- **Network options**: "Check newest TK from internet", "use HTTP proxy", proxy address,
  proxy port. (Version check only; can be dropped in the port or kept as a no-op.)
- **Reset options** → `Options()->Reset(); Save();` + message "Options reset!".

Multiplay dialog: Episode, Level (only if start-from-any-level), Game mode select,
Split screen, "Go!". Defaults: game mode 0, episode 1, network none.

Episode select: scrollable list (`KMaxEpisodeInList = 8`) of `levs/` subfolders.

## Options data (`COptionsData`)

Fields persisted to `options.cfg` (binary): `iKeys[4]`, `iName[4][15]`, `iGamma`,
`iMusicVolume`, `iEffectsVolume`, `iEnemiesOnGame`, `iMultiPlayLevel`,
`iMultiPlayGameMode`, `iMultiPlayers`, `iMultiPlayEpisode`, `iMultiPlayNetworkMode`,
`iDMSpeed`, `iDMTargetSystem`, `iStereo`, `iFullScreen`, `iMouseSensitivity`,
`iMouseMode`, `iInGameVideoMode`, `iInGameLargeText`, `iMusicTheme`, `iProxyPort`,
`iProxyEnabled`, `iWebVersionCheckingEnabled`, `iProxyAddr`.

Defaults: `iMouseMode=1`, `iMouseSensitivity=0.50`, `iGamma=1.0`, `iInGameVideoMode=640×480`,
`iFullScreen=true`, `iInGameLargeText=false`, volumes `1.0`, music theme `"Default"`,
DM speed `KPlayerRunSpeed=1.0`, `iEnemiesOnGame=true`.

`options.cfg` is written on every menu state change and on destructor.

## Game sub-states

| Sub-state | Source | Purpose / behaviour |
|-----------|--------|---------------------|
| `NextLevel` | `CGameSubStateNextLevel` | `SetupLevelStart()`; loads level, places players/enemies/crates; → `LevelInfo` (or `OnGoing` for client) |
| `LevelInfo` | `CGameSubStateLevelInfo` | Shows level number, comment, enemy kill list, time limit; any key → `Shop` if shop enabled else `OnGoing`; Esc → `Quit` |
| `OnGoing` | `CGameSubStateOngoing` | Main gameplay loop (doc 02) |
| `Shop` | `CGameSubStateShop` | Buy/sell weapons, ammo, shield, target system |
| `Statistics` | `CGameSubStateStatistics` | Per-player results, time bonus, money; → next `NextLevel`/`Victory` or menu |
| `Victory` | `CGameSubStateVictory` | Episode complete; any key → menu |
| `Quit` | `CGameSubStateQuit` | In-game "Quit?" confirm (y) |

Transitions are asserted in `CGameState.cpp` (doc 02).

**Overlays and frames.** The original never clears the draw buffer between states: it
only redraws dirty areas, so `CGUIStateQuit` (main-menu quit) and `CGameSubStateQuit`
(in-game quit) draw their box/text *over the last frame* (menu or level-info/ongoing).
Likewise a game start calls `SkipDrawOnce()` so the episode list stays on screen while
the fade-out runs — no menu redraw in between. The port redraws in full each frame, so it
keeps a snapshot of the last live frame and blits that for these overlay/frozen cases
(`App.overlayFrozen`, `MenuContainer.isSuspended`).

### Shop

`cdynshopdata`/`CGameSubStateShop`: three categories — weapons, ammo, special
(shield, target system). Keys: Up/Down ±8 items, Left/Right ±1, Return/P1-Shoot buy,
Backspace/P1-Shift sell, PageUp buy 25, PageDown sell 25, Esc done. Weapon capacity is
`SingleHand()+1` (2 for single-hand weapons → dual wield). Shield price is
`160 + shield*15`; selling returns half. Shop availability per level is
`GameMode()->ShopEnabled(level)`.

### Statistics

Per player: kills by enemy type (`CGameStatisticsData`), frags (DM), total kills,
accuracy = `100*hit/shot`, cash. Time bonus = `(timeLimit - completeTime)*5`, clamped
`>=-500`, zeroed on quit/game-over. Then `iCash += reward(type)*kills[type]` per enemy
type (rewards in doc 04), clamped ≥ 0.

## HUD, message board, texts

- **Message board**: FIFO of up to 6 messages (80 chars), auto-expire after
  `KMessageTimeOnScreen=500` ticks (5 s). Used for errors, option changes, frags,
  suicides, version-check results. Drawn top-left in the small font.
- **Frag / suicide texts**: from `default.ini` (`FragText[]`, `SuicideText[]`),
  selected with `rand()%size`. Used when a bullet kills a player.
- **HUD** elements listed in doc 05.
- **texts.cpp**: key labels (`k_text[EKeyAmount]`), music extensions, `options.cfg`
  name, `off/on`, quit-confirm text, default music theme.
- **lists.cpp**: enumerates `levs/` subfolders as episodes/DM episodes, and `music/`
  themes. Platform-split `lists_unix.cpp` / `lists_win32.cpp`.

## Full input map

Key enum (`CKeys.h`): `EKeyLEFT, EKeyRIGHT, EKeyUP, EKeyDOWN, EKeySHOOT, EKeySHIFT,
EKeySTRAFE, EKeyLSTRAFE, EKeyRSTRAFE`.

Gameplay (`CPlayer::CheckKeys`):

| Input | Effect |
|-------|--------|
| Turn L/R | rotate ∓/±3.4°/tick (unless strafe held) |
| Forward | move at `iSpeed` in facing direction |
| Backward | move at `0.75*iSpeed` reversed |
| Strafe L/R | strafe at `iSpeed` (or strafe+forward = diagonal ±45°) |
| Shoot | fire current weapon (or fist) when loaded |
| Change weapon | cycle weapons (Shift / right mouse / wheel) |
| Mouse X | rotate (owner only), clamped to 15°/tick |
| Mouse L | fire |
| Mouse R | change weapon (once per press) |

In-game global keys: `Esc` quit-confirm, `Return` network chat (only when networked),
`PageUp/PageDown` mouse sensitivity ±, `F4` cycle mouse owner, `F5` map, `F6` FPS.
Debug-only (release builds exclude): `6` no-damage, `7` grant weapons, `1`–`5` toggle
render layers.

**No joystick/gamepad support in the original** (no SDL_JOY usage). The web port may
add gamepad as an option, but it is not part of 1:1 behaviour.

## Reusable UI assets

- Menu backgrounds/logos: `efps/eflogo.pcx`, `menu.pcx`, `bslogo.pcx`, `menu.efp`,
  `tklogo.efp`, `splash.bmp`, `victory.pcx/bmp`.
- Shop backdrop: `shopback_normal/hilite/hollow.efp` (640×480), `shop.efp`, `ware.efp`.
- Statistics backdrop: `staticsback.efp` (640×480).
- Fonts in `fnts/` (doc 06).
