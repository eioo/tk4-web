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

---

## M7 — Audio

🎯 Positional sound (pan/volume), all 16 effects, music themes + menu music, volume
options, click sfx in menus.

✅ Sounds trigger at the correct moments with plausible panning; music loops; volumes
respect options. (Audio parity is perceptual; verify against the reference by ear and by
trigger trace.)

---

## M8 — Options & persistence

🎯 `COptionsData` equivalent, key rebinding, names, video mode, large text, mouse
sensitivity, DM options, audio options; persist to `localStorage`.

✅ Options survive reload; rebinding rejects duplicates; defaults match the original.
⚠️ Use a versioned storage key.

---

## M9 — Parity hardening

🎯 Reference build harness (doc 13), scripted scenario replays, automated pixel/state
diffs, performance budget for the presentation path.

✅ CI-style task compares port vs. reference traces/screenshots across N scenarios and
reports drift. Presentation path hits 60 fps at 640×480 (and higher modes).
⚠️ Any remaining RNG/sort divergence is documented and pinned to a fixed seed.

---

## M10 — Polish, extras, deployment

🎯 Loading screen, error handling, static build, README, optional gamepad, optional
non-parity save.

✅ `bun run build` yields a deployable static site that runs the game end-to-end.

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
