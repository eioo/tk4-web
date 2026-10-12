# 12 — Incremental Implementation Plan

Milestones are ordered so each one produces something runnable/testable and reduces
risk early. "Done" means the acceptance criteria pass, not just "code written".

Legend: 🎯 deliverable · ✅ acceptance criteria · ⚠️ risk to watch.

---

## M0 — Repository & toolchain scaffolding

🎯 Bun project, TypeScript, dev server, test/lint/format setup, `docs/` present.
- `package.json` (`bun`), `tsconfig.json`, `vite.config.ts` (or `Bun.serve`), `index.html`.
- `oxlint` + `oxfmt` with `.oxlintrc.json` / `.oxfmtrc.json` and scripts.
- `main.ts` boots a 640×480 `<canvas>` and starts the RAF loop.

✅ `bun run dev` serves a 640×480 canvas showing a test pattern; `bun run build` produces
`dist/`; `bun test` runs the loop tests; `bun run lint` and `bun run fmt:check` pass.
⚠️ Verify the Canvas2D `putImageData` path and (later) the WebGL palette-shader path.

---

## M1 — Asset pipeline & decoders

🎯 Build-time extractors (doc 11) + a manifest; runtime loaders for EFP/FNT/PCX/INI/
palette.tab; raw `.lev` shipped.
- EFP decoder + global palette extraction + `palette.tab` parser.
- `RotateSprites` / `MakeFloors` / `ZoomWall` ports.
- Font decoder; ini parser; level decoder (old **and** new) with `KBlockHeights` and the
  four derived-map passes.

✅ Unit tests: every bundled `.efp` decodes with expected w×h; every `.lev` parses with a
sane width/height; `palette.tab` is 86016 bytes and round-trips; generated character
sheets are byte-identical to a Python reference (or to the reference build).
⚠️ Sprite-sheet "base strip" ambiguity (doc 05) — validate against the reference binary.

---

## M2 — Framebuffer + static level rendering

🎯 `Framebuffer` (index buffer) + `Presenter` (Canvas2D) + enough of
`CGameDrawManager` to draw a loaded level: floor, walls (all heights), static shadows,
black parts, and the camera.
- Index buffer → RGBA → `putImageData` path working at 60 fps.
- `DrawBlock`/`DrawDarkBlock`/`DrawWallShadow`/shadow-cast polygon port.
- Load one `.lev`, place a fixed camera, draw.

✅ A level renders and is visually indistinguishable from a reference screenshot of the
same level/camera (pixel diff below threshold).
⚠️ Pseudo-3D wall draw order and `perspectFixOffset` quirks.

**Status:** done. `Framebuffer`, the Canvas2D presenter, the `CGameDrawer` primitives
(blocks, wall shadows, polygons/triangle rasteriser) and the static draw order
(`DrawFloor` → `DrawShadows` → `DrawBlackPartsOfLevel` → `DrawWalls`) are ported and
verified **byte-for-byte** against `tools/reference/render_gen.cpp` on six levels
(old + new format). `src/main.ts` boots a level with a free (arrow-key) camera in the
browser.

---

## M3 — Core simulation: player, bullets, collision

🎯 Exact 100 Hz tick loop, `CMath`, `CCoord`, `GlibcRandom`; player movement/rotation/
strafe/camera; bullets and `VisibilityCheck`; weapons and firing; damage.

✅ Seeded replay reproduces expected positions/angles after N ticks; player can run
around a level, shoot, and bullets collide/bounce exactly like the reference (state diff
against a reference trace).
⚠️ RNG evaluation order (doc 13); camera `MoveScr` integer quirks.

**Status:** done. `src/core/rng.ts` (glibc TYPE_3 `rand()`), `src/core/math.ts` (`CMath`
tables + `CCoord` helpers), `src/sim/types.ts` (weapon/bullet type tables),
`src/sim/level-physics.ts` (`Collision`/`VisibilityCheck`) and `src/sim/world.ts`
(`CCharacter::Move`, `CPlayer` movement/input/shooting/damage, `CBullet::Move`, the
per-tick `RunFrame` order) are ported. A 400-tick scripted replay (movement, strafe,
key/mouse turning, weapon switching, firing, bullet bounces, two-player damage/death)
runs **byte-for-byte identical** to `tools/reference/sim_gen.cpp` — see
`src/sim/__test__/replay.test.ts` and the committed `tools/reference/fixtures/`. The
browser now runs the real sim (`src/main.ts`): WASD + mouse aim, shooting, weapon
switching, with the player sprite, its shadow, bullets and rockets drawn. Effect
rendering, enemies, crates and body parts are M4; lights/HUD are M5.

The sim does **not** yet consume RNG from rendering (the original's `DrawSpots` etc.
touch `rand()`), and non-local players are static here — both documented in doc 13.

---

## M4 — Entities: enemies, AI, effects, body parts, crates

🎯 `CLevelRuntimeData` port: enemy spawn, AI, shooting; effects roll; body parts;
crates (all 5 types) and pickup; explosions; burning; damage/death.

✅ Seeded replay of a level produces identical enemy kill order, effect lifetimes and
money/weapon changes vs. reference trace over many ticks.
⚠️ `std::sort` instability; RNG ordering in `Explo`/`GetDamage`.

**Status:** done (simulation + browser rendering). `src/sim/types.ts` gained the
effect/body-part/enemy tables; `src/sim/entities.ts` the entity records; `src/sim/world.ts`
the full `RunFrame` order (`PerFrameCalc`, `CheckBurn`, `ChkWakeUps`, `EnemyUpdate`,
`ShowSteam`, `RollEffects`), `CEnemy` AI/shooting/`GetDamage`, `CEffect::Roll`,
`CBodyPart::Move`/kick/push, `CCrate` placement/pickup/text (font width) and
`Explo` body-part push. The browser renders enemies, effects, body parts and crates
(`src/render/draw-manager.ts`). A 400-tick seeded replay is **byte-for-byte identical**
to `tools/reference/sim_gen.cpp` (sha256 `016f2b8e…`, fixtures committed). Lights/HUD
(crate text, target laser, energy) are M5.

---

## M5 — Full rendering parity (lights, HUD, fonts)

🎯 All light sources (fire/muzzle, effects, bullets, spots, crates), `iOrder` effect
layering, HUD (energy, ammo, target laser, hit flash, timer, minimap, FPS), message
board, fonts, split-screen draw rects.

✅ Reference-frame pixel diff across many scripted scenarios is within tolerance
(allowing for documented non-determinism).
⚠️ Per-pixel light math and the 10 light-map sizes.

**Status:** lights, HUD/fonts **and the message board** done; split-screen draw
rects pending. Lights were pulled forward because the flamethrower's gas
bullets have no sprite — their entire visual is a light. Added
`src/data/light-map.ts` (`CLightMap::Make`) and `GameDrawer.drawLight`
(`CGameDrawer::DrawLight`) plus the light tables from `palette.tab`.
`drawBullets`, `drawEffects` and `drawCrates` now emit their lights, and
`drawFireLights` (player/enemy muzzle flashes) and `drawSpots` (animated level
spots) are wired into `drawFrame` in the original order. Byte-exact against new
oracle modes (`render_gen lightmap` / `lightrender`); see
`src/data/__test__/light-map.test.ts` and `src/render/__test__/light.test.ts`.
`DrawSpots` uses a separate render RNG (doc 13).

HUD/fonts: `src/data/font.ts` gained `fontWrite` (a full `CFonts::Write` port
with `iOneIsZero`, scaling and all alignments) and `src/render/hud.ts` the HUD
primitives — hit flash, target laser + cross-hair (`DrawTargets`/`DrawTarget`,
using `CLevel::VisibilityCheck`), energy bar, weapon/ammo text, crate pickup
text, frag list, minimap, FPS, timer and the rotating "mission completed"
banner. `drawFrame` now calls `drawHudFrame` after the walls, mirroring
`CGameDrawManager::DrawFrame`'s post-wall order, and the browser shows the
timer/energy/ammo HUD. Byte-exact against `render_gen fontwrite` / `render_gen
hud` on level1; see `src/data/__test__/font-write.test.ts` and
`src/render/__test__/hud.test.ts`. The per-player HUD assumes one local player
(no split-screen yet).

Message board: `src/render/message-board.ts` ports `CMessageBoard` (a ring of
six lines, 80-char truncation, 500-tick auto-clear and the 16 px deathmatch
offset) and `main.ts` draws it over everything, mirroring `CGameApp::RunFrame`.
The browser wires F5 (map), F6 (FPS), PageUp/PageDown (mouse sensitivity), F10
(capture stub) and the unreachable-enemy warning. Byte-exact against `render_gen
messageboard`; see `src/render/__test__/message-board.test.ts`.

---

## M6 — Game flow, menus, sub-states

🎯 Main state machine + fade/zoom transitions; logo screens; main menu; options; episode
select; level info; shop; statistics; victory; in-game quit.

✅ Full loop playable: menu → episode → level → complete → stats → next level → victory
→ menu, with money/weapons persisting across levels.
⚠️ Matching menu layout/text against reference screenshots.

**Sub-stages:**

- **M6a — app shell.** `CState`/`CGameState` machine, `CGUIEffectData` fades
  (`CGraphicsFader`), the two logo screens, `CGameMenuContainer`/`CGameMenuBase`/
  `CGameMenuItem` and the menu item types, PCX + menu-sprite loading, and the main
  menu / options / episode-select menu trees.
- **M6b — level flow.** `CGameSubStateNextLevel`/`LevelInfo`/`OnGoing`/`Quit`,
  episode manifest, `CDynGameData` (players, levels, money/weapons), level-name
  reading, and reaching the existing simulation through the state machine.
- **M6c — economy/progress.** `CGameSubStateShop`/`Statistics`/`Victory`, the
  statistics view, shopping, and episode → episode progression to victory.

**Status:** M6a, M6b and M6c are in. The app shell (`src/app/app.ts`)
ports `CGameState` plus `CGameApp::Loop`'s effect handling, the two logo
screens, `CGUIStateQuit`, and the full in-game sub-state flow (`NextLevel`,
`LevelInfo`, `OnGoing`, `Shop`, `Statistics`, `Victory`, `Quit`).
`src/app/menu.ts` ports the menu framework and every menu tree
(`CGameMenuBase`/`Container`/`MenuItem`, `Menu.cpp`, `MenuItems.cpp`),
`src/app/options.ts` the `COptionsData` defaults and episode/music lists,
`src/app/game-session.ts` the per-level `SimWorld` + HUD, `src/app/shop.ts`
`CGameSubStateShop` + `CDynShopData` and `src/app/statistics.ts`
`CGameSubStateStatistics` + `GivePlayerPrize`; `src/sim/statistics.ts` is
`CGameStatisticsData` and `src/sim/world.ts` records shots/hits/kills into it.
Fonts/menu sprites load via `src/app/fonts.ts` and `src/data/menu-data.ts`
(new PCX path); `tools/build-assets.ts` emits the episode/manifest listing the
browser cannot `scandir`.

Players are created once per game (`makeStartPlayer`, matching
`TotalReset` + `SetupPlayers`: 500 cash, fists only) and each level resets them
in place (`resetPlayerForLevel`), so cash, weapons, ammo and statistics persist
across levels. Cooperative play shops from level 2 onward
(`GameModeCooperative::ShopEnabled`); the shop grid, pricing, buy/sell rules
and the statistics table follow the reference.

Verified by scripted browser runs (`tools.browser.*` / chrome-devtools):
EF logo → TK logo → main menu → single game → episode select → level info →
ongoing, with the level info "killing list" and the running level/HUD drawn
correctly; and (via direct state injection) the shop and statistics screens
render with their own palettes (no more level-under-shop-palette corruption).
The main menu shows the `4.09` version string in the bottom-left corner
(`src/app/version.ts`). The in-game sprite set is resolved per level from the
merged root `default.ini`, episode `<dir>/default.ini` and level `<level>.ini`
(`App::levelConfig`, matching `CIngameData::LoadIngameData`); the generated
sheets are only rebuilt when a per-level override actually changes a source
sprite path. Menu navigation is covered by `src/app/__test__/menu.test.ts`,
the shop by `src/app/__test__/shop.test.ts`, the statistics/prize maths by
`src/sim/__test__/statistics.test.ts` and the per-level config/sprite
signature by `src/data/__test__/ingame-data.test.ts`.

Deferred until later milestones (planned, not dropped): the level-select/
game-mode **multiplay** wiring, **local split-screen** (M11), **deathmatch**
frags/scoring (M12) and **netplay** (M13). The original's multiplayer is local
split-screen for up to four players (`CDynGameData::SetLocalPlayers`) plus a
compiled-out network layer; for now the game-mode/level-select menus are present
but only cooperative single-player is playable. Kill/suicide frag texts
(per-level `FragText`/`SuicideText`) are likewise unused until deathmatch lands.

---

## M7 — Audio

🎯 Positional sound (pan/volume), all 16 effects, music themes + menu music, volume
options, click sfx in menus.

✅ Sounds trigger at the correct moments with plausible panning; music loops; volumes
respect options. (Audio parity is perceptual; verify against the reference by ear and by
trigger trace.)

**Status:** in. `src/audio/sound.ts` is `CSoundPlayer` — the `StereoShaper`
pan maths (unit-tested) plus a WebAudio player (per-shot `GainNode` +
`StereoPannerNode`, 16 decoded effects). `src/audio/music.ts` is the music side
(`KMusicFilenameExtensions` resolution, `ForceSoundTrack`/song-number counter,
looping playback with the original fade times). `src/sim/types.ts` carries the
`TIngameSoundEffect` table and the per-weapon/bullet/body-part sound fields.

Every `PlayPosSample`/`PlaySample` call site in the original is mirrored in
`src/sim/world.ts`: weapon fire (player and enemy), bullet bounce and fist hit,
body-part bounce and kick, enemy/player death (and the burning woosh),
`CDynGameData::Explo` explosion sizes, and crate pickup. Positional samples also
run `CEnemy::SoundHeard` (hostile enemies within sight distance with line of
sight go to `Assault`), matching `CGameSubStateOngoing::SoundHeard`. `App`
drains `world.sounds` each tick and pans them around the local player.

Music follows the reference state machine: menu music from the first logo and
on entering Statistics, per-level game music on `OnGoing` (from the merged
level config), stopped by the menu music when a level ends. Volumes/theme/
reverse-stereo come from `COptionsData` (`applyAudioOptions`, invoked by the
audio options menu's `updateAudioChanges`), and the menu/shop play the click
sample. Effects are decoded from the merged `default.ini` at boot; music assets
are copied by `bun run assets --with-music`.

⚠️ The parity oracle does not model `CEnemy::SoundHeard` yet, so the replay
harness disables hearing to stay byte-comparable (docs/13); the shipped replay
scenario does not otherwise trigger it.

---

## M8 — Options & persistence

🎯 `COptionsData` equivalent, key rebinding, names, video mode, large text, mouse
sensitivity, DM options, audio options; persist to `localStorage`.

✅ Options survive reload; rebinding rejects duplicates; defaults match the original.
⚠️ Use a versioned storage key.

**Status:** in. `src/app/options-storage.ts` mirrors `COptions::Save`/`Load` as
versioned JSON under `tk4-web.options.v1` (the original writes the raw
`COptionsData` struct to `options.cfg`). Loading is defensive: unknown fields
are ignored, numbers are clamped to the menu ranges (`gamma` 0.1–3.0, volumes
0–1, sensitivities, DM speed, mouse mode 0–4, players 1–4), the
`multiPlay*` episode/level pair is re-sanity-checked, and a missing/malformed
entry leaves the `COptionsData::Reset` defaults. Names are trimmed and truncated
like `COptions::Save`; a saved theme that no longer exists falls back to the
first available one.

Saving follows the reference: on the reset item (`COptions::Reset`+`Save`), when
leaving the menu for a game or the quit flow (`CGameMenuContainer::ExitState`),
and additionally on `beforeunload`/tab-hide and on each option-change hook
(audio, gamma, large text, fullscreen, resolution) for robustness.

The remaining `CGameGraphicsInterface` hooks are wired plausibly:
`fullscreen` uses the Fullscreen API (syncing back on Esc), `large text` scales
the small font (`UpdateLargeTextMode`), `gamma` is approximated with a CSS
`brightness()` filter (`SDL_SetGamma` has no browser equivalent), and the
`game resolution` slider cycles `CGraphicsDevice::NextRes`/`PrevRes` over a
static mode list. The port's framebuffer stays 640×480 in-game and the presenter
scales to the window, so the resolution is a remembered preference only.

Key rebinding already matched `CGameMenuItemChangeKey` (binding a key clears the
same key elsewhere); the reset item now goes through `host.optionsReset()` so
audio/gamma/large-text are re-applied and the result is saved.

---

## M9 — Parity hardening

🎯 Reference build harness (doc 13), scripted scenario replays, automated pixel/state
diffs, performance budget for the presentation path.

✅ CI-style task compares port vs. reference traces/screenshots across N scenarios and
reports drift. Presentation path hits 60 fps at 640×480 (and higher modes).
⚠️ Any remaining RNG/sort divergence is documented and pinned to a fixed seed.

**Status:** in. `bun run parity` (`tools/parity.ts`) is the CI-style task: it rebuilds the
oracles, regenerates every scenario trace and static frame, runs the same inputs through the
port, and reports the first differing byte per case (non-zero exit on drift). Scenarios live
in `src/sim/replay.ts#SCENARIOS` — `replay1`, `weapons` (every weapon/bullet/explosion),
`combat` (enemy death, body parts, `SoundHeard`) and `crates` (pickup) — with committed
fixtures under `tools/reference/fixtures/`; static frames are pinned in
`src/render/frames.ts`. The oracle now models `CEnemy::SoundHeard`, and
`src/sim/__test__/replay.test.ts` re-checks every scenario without a compiler.

The new scenarios exposed and fixed real drift: float32 table storage and literal rounding
(`src/sim/types.ts` + several `f32(x ± f32(k))` sites in `src/sim/world.ts`), a reversed
multi-`rand()` argument order on enemy death, a missing `walkCounter` clamp in
`CEnemy::SoundHeard`, and a use-after-free in the oracle's bullet loop (an explosion appends
bullets mid-iteration). All are documented in docs/13 and covered by the replay.

`bun run perf` (`tools/perf.ts`) enforces the presentation CPU budget: index→RGBA conversion
at 640×480…1280×960 and the 640×480 static compose each run far inside a 60 fps frame. The
WebGL palette-shader presenter (docs/10, approach B) is implemented
(`src/render/presenters/webgl.ts`) and selectable with `?presenter=webgl`; its output is
byte-identical to the Canvas2D path, which remains the default.

---

## M10 — Polish, extras, deployment

🎯 Loading screen, error handling, static build, README, optional gamepad, optional
non-parity save.

✅ `bun run build` yields a deployable static site that runs the game end-to-end.

**Status (partial):** the production host is in. `bun run start` builds (`tsc --noEmit` +
`vite build`) and serves `dist/` with `tools/serve.ts` (a `Bun.serve` static server:
custom-extension MIME types, immutable caching for hashed bundles, `index.html` fallback,
`--port`/`--host`); `bun run serve` hosts an existing build. Verified: the built site
boots and plays from the server.

Loading and error surfacing are in: `index.html` carries a boot overlay that `main.ts`
dismisses once the first frame is ready, showing a live file count while assets load, and
replaces it with the failure message (plus a reload button) if boot throws — so a slow
connection or a missing `public/assets/` build no longer shows a blank canvas. The
top-level `README.md` now documents the real commands and status.

The optional extras (gamepad, non-parity campaign save) are **skipped by request**; the
original has no joystick code, and multiplayer (below) is the next workstream.

---

## M11 — Local split-screen (1–4 players)

🎯 N players share one keyboard, one mouse owned by a selectable seat, and the screen
splits into 1/2/3/4 viewports, each with its own camera and HUD.

- **M11a per-seat input**: `SimInput` becomes per-player (four `CKeys` binding sets plus
  the single mouse owner), ported from `CPlayer::CheckKeys`,
  `CDynGameData::UpdateMouseOwner` and the F4 mouse-cycle in `CGameSubStateOngoing`.
- **M11b viewports**: port `CDynGameData::GraphicsModeChanged` — the `iDrawRects` /
  `iBlackRects` tables for 1–4 players — fill the black (letterbox) rects, loop views in
  seat order and give each seat its own `drawRect` (per-view `initScr`/`moveScr`).
- **M11c session**: `CGameSystem::Init` spawns `iPlayers` players
  (`PlacePlayersForLevel`), copies per-seat keys/names, assigns colors (`KPlayerColor`)
  and registers statistics.
- **M11d wiring**: `ExecMultiplay` starts the chosen player count; renderer uses
  per-player colors (currently every player is drawn `KPlayerColor0`).

✅ `bun run dev` shows 2–4 viewports; each seat moves and shoots independently; F4 moves
the mouse; the global overlays (kills / time / map / message board) are drawn once, not
per view.

**Status:** in. Per-seat input (`SimWorld::tick` now takes a `SimInput[]`, one row per
seat, built from `OptionsData.keys[seat]` in `App.gameInput`), the
`CDynGameData::GraphicsModeChanged` viewport/letterbox tables (`src/render/viewport.ts`,
unit-tested), multi-player session setup (`PlacePlayersForLevel`, per-seat keys, names,
`KPlayerColor` colours and statistics) and the split draw loop
(`drawWorldFrame` per view → `drawPlayerHud` per view → `drawGlobalHud` once) are done.
`App.execMultiplay` starts `iPlayers` seats; F4 cycles the mouse owner
(`OptionsData.mouseMode`, 0..N). Verified in the browser for 2 and 3 players: independent
cameras and input, correct per-player colours, and the 3-player letterbox rects. Any F4
mouse mode is applied through `GameSession::setMouseOwner`.

Caveats: the replay/oracle script still feeds one input row per tick to every local seat
(no per-seat trace, so no split-screen parity scenario yet), and the shop/statistics flow
still operates on seat 0. Both are noted in docs/13.

## M12 — Deathmatch

🎯 The second `IGameMode`: frags, respawn, DM crates and the kill messages.

- Load `FragText`/`SuicideText` from the per-level config; wire
  `BulletPlayerKill`/`RandomKillText`/`RandomSuicideText` (`CPlayer`, `CIngameData`).
- `IGameMode::CharacterDied` respawn (teleport + `RandomPlace` + shield / energy / DM
  speed / target system) after `KDeadAnimationDelay`; `TotalPlayerKills` suicide
  accounting (self-kills subtract).
- DM options already staged (`dmSpeed`, `dmTargetSystem`, `iEnemiesOnGame`); `DMCrates` /
  `CrateRespawn`; DM statistics (`Frags` line, no time bonus).
- Level rotation: DM `GameOver()` / objective — one level until the player quits, matching
  the original.

✅ A deathmatch round shows frags, respawns players, applies the DM options and prints kill
texts.

**Status:** in. `GameMode` moved to `src/app/game-mode.ts` and extended with
`objectiveFulfilled` / `gameOver` / `setupPlayerEpisode` / `setupPlayerLevel`. `GameSession`
now applies the DM setup (shield 30, energy `(100+shield·10)/3`, DM speed, target system),
`placeGameCrates(DMCrates)`, `RandomPlacePlayers` and the `iEnemiesOnGame` enemy gate.
`SimWorld` ports `CPlayer::RandomPlace` / `TotalReset` / `Reset` and
`CGameModeDeathmatch::CharacterDied` (teleport effects, random respawn at 30 shield / 133
energy), `BulletPlayerKill` kill/suicide messages (`FragText`/`SuicideText` loaded from the
merged per-level config) and `TotalPlayerKills` suicide accounting. `ObjectiveFulfilled` /
`GameOver` gate level completion and the statistics screen (`Game Over` vs `Completed !`,
frags line, no time bonus). Verified in the browser: a 2-player DM scatters the players,
places DM crates, toggles enemies, prints `John punished Paul.` / a suicide line, awards and
subtracts frags and respawns on death.

Caveat: DM is not in the parity oracle — `RandomPlace` and the kill texts consume the
shared RNG, and the oracle models the cooperative path only — so DM is verified in the
browser rather than byte-for-byte (docs/13).

## M13 — Netplay (WebSocket)

> **Designed in [`docs/multiplayer/`](multiplayer/README.md).** The locked design is
> deterministic lockstep over Bun WebSockets: every client runs the full `SimWorld`
> from server-broadcast input bundles, with the server as lobby + tick master (no
> simulation). It covers host/join by 5-letter code, coop full-episode progression
> (statistics + per-player shop), online deathmatch with a host-configurable frag
> limit, idle seats and host migration. Milestones N1–N4 live in
> [07-implementation-plan.md](multiplayer/07-implementation-plan.md).

🎯 Greenfield peer sync built on the split-screen model. The original's network layer is
compiled-out dead code with empty `Send`/`Available` (docs/13), so there is no wire format
worth emulating; only its ownership split is a useful hint (server owns level, enemies,
crates and game data; each client streams its own player transform; damage is applied by
the damage-authority side). Design and implement after M11/M12.

The pieces already in place to build on: the game-mode/level-select menu trees, the
`GameMode` variant (`frags()`/`startFromAnyLevel()`/`dmEpisodes()`, …), the per-player
HUD/minimap, the split-screen draw-rect plumbing, and a simulation that already carries
non-local players (static until then). Progress is tracked above; the single-player
cooperative flow is complete without it.

---

## Cross-cutting workstreams (run continuously)

- **Reference oracle** — build and run the original early (doc 14) so every milestone can
  be checked against ground truth.
- **Golden traces** — record seeded state traces (positions, angles, counts, RNG draws)
  to enable fast regression tests without rendering.
- **Golden frames** — capture reference screenshots at fixed scenarios for pixel diffs.
- **Documentation** — update these docs whenever a port decision or discovered quirk is
  made.

## Suggested first three tasks

1. M1 `RotateSprites` + EFP decoder validated against Python, and confirm the shipped
   sheet interpretation against a reference build.
2. M0/M2 skeleton: boot the canvas + loop, render one decoded level through the framebuffer.
3. M3 `GlibcRandom` + 100 Hz tick loop with a deterministic replay harness.
