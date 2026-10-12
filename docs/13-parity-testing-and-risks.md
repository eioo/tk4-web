# 13 — Parity, Testing & Risks

The goal is "same physics, same sounds, same art". This doc describes how we verify that
and enumerates the things most likely to break it.

## Ground truth: build the original

The single most valuable tool is a **working reference build** of the C++ game
(doc 14). From it we can:

- capture reference **screenshots** at fixed levels/cameras (pixel diff vs. port),
- capture reference **state traces** for seeds (entity positions, angles, HP, counts),
- resolve format ambiguities (e.g. the `RotateSprites` question),
- listen to reference audio for panning/volume.

Run it under `Xvfb` with deterministic input injection, or with a small scripted harness.

### Lightweight oracles (no SDL)

Building the whole game needs SDL 1.2/mixer/image/net. For the **asset** and **drawing**
layers we instead keep small standalone C++ oracles that copy the original algorithms
near-verbatim and need only libm (build them all with `bun run reference`):

- `tools/reference/tkreference.h` — shared copies of `CPalette`, `CGraphicsGenerator`,
  `CLevel` (heights + derived maps + collision/reachability), `CGameDrawer` and the static
  `CGameDrawManager` draws.
- `tools/reference/rotate_gen.cpp` — `RotateSprites` / `MakeFloors` / `ZoomWall`.
- `tools/reference/render_gen.cpp` — static level frame (floor, shadows, camera-cone black
  parts, pseudo-3D walls) from a raw block dump produced by `tools/reference/dump-level.ts`.
  It also emits the light oracle: `render_gen lightmap <out.raw>` writes the ten
  `CLightMap` strength maps (`15 + a*5`), and `render_gen lightrender <palette.tab> <out.raw>`
  applies eight synthetic lights (all four light tables, sizes 0..9, edge clipping) to a
  deterministic buffer. The font/HUD oracle is `render_gen fontwrite <datadir> <out.raw>`
  (a fixed set of strings through `CFonts::Write`, both fonts, all alignments + scaling),
  `render_gen hud <leveldump> <datadir> <out.raw>` (the `CGameDrawManager` HUD primitives —
  hit flash, target laser, energy, weapon/ammo text, frag list, crate texts, minimap, FPS,
  timer, "mission completed" — composed for a synthetic player) and
  `render_gen messageboard <datadir> <out.raw>` (the `CMessageBoard` ring/truncation rules and
  the `Draw` blit at draw offset 16), `render_gen pcx <file> <out.raw>`
  (`CGraphicsBuffer::LoadPCX`: width/height + decoded indices + trailing palette) and
  `render_gen fader <out.raw>` (`CGraphicsFader::DrawPhase` and `DrawZoom` on a
  deterministic buffer). `SimFont`/`SimFontWrite` (a verbatim `CFonts` copy) live
  in `simreference.h`.
- `tools/reference/simreference.h` + `tools/reference/sim_gen.cpp` — the **simulation**:
  `CMath`, glibc `rand()`, the weapon/bullet/effect/body-part/enemy tables, `CCharacter::Move`,
  `CPlayer` (input, movement, shooting, damage), `CEnemy` (AI, shooting), `CEffect` (roll),
  `CBodyPart` (move/kick/push), `CCrate` (placement/pickup/text), `CLevelRuntimeData::Explo`
  and the per-tick `RunFrame` order.
  `sim_gen replay <leveldump> <script> <out.trace> <datadir>` writes a per-tick state trace
  (players, bullets, enemies, body parts, effects, crates, dead enemies); the script is
  produced by `tools/reference/dump-script.ts` from `src/sim/replay.ts#buildScript` (the same
  script the TS test uses). `<datadir>` is the original `data/` dir, used to load
  `fnts/menu15x18dark.fnt` for the crate pickup-text counter.

The TypeScript tests hash the port's output and compare against the oracle's output
(`sha256` over the pixel buffer / trace), giving byte-exact verification without a
screenshot workflow. These have validated `RotateSprites`/`ZoomWall`/`MakeFloors`, the
static render path across old- and new-format levels, the `CMath` tables, glibc `rand()`,
the ten light maps and `CGameDrawer::DrawLight`, the `CFonts` font writer and the HUD
primitives, and a 400-tick player/bullet/enemy/effect replay. The full reference build is
still needed for audio and menu parity.

## Determinism

### glibc `rand()`

The original calls `srand((unsigned)time(NULL))` then libc `rand()`. To reproduce:

- Implement glibc's **TYPE_3** additive-feedback generator:
  `r[i] = r[i-31] + r[i-3]` (mod 2^32, stored signed), output `r[i] >> 1`;
  `srand(seed)` sets `state[0]=seed`, fills `state[1..30]` with the Park–Miller LCG
  (`16807·lo − 2836·hi`, mod `2^31−1`), points `fptr=3/rptr=0`, then discards the first
  310 outputs.
- Expose explicit seeding for tests/replays; default to `Date.now()` at runtime.

Confirmed byte-for-byte against glibc in `src/core/__test__/rng.test.ts`
(`srand(1); rand()` = 1804289383, …), so type-3 parity across platforms holds wherever
the process uses glibc. (Other libc `rand()` implementations differ; the port always uses
glibc's, matching the original's Linux build.)

### RNG call sites (order matters)

Setup: players → fixed enemies (`rand()%360`) → random enemies (`rand()%(W-2)`,
`rand()%(H-2)`, `rand()%360` per try) → random crates (`rand()%(W*20)`,
`rand()%(H*20)`) → DM random player placement.

Per tick (from doc 03/04 call inventory): `CheckBurning` (`rand()%8`), `ShowSteam`
(`rand()%6`), `DecideAndMove` (`rand()%125`, `rand()%40`, `rand()%50`, `rand()%360`),
`Move` (`rand()%3`), `GetDamage` (`rand()%7`, `rand()%360`, `rand()%2`), `Shoot`
(`rand()%AngleAdd`), `CBullet::Move` (`rand()%8`, `rand()%360`, `rand()%2`, `rand()%6`,
`rand()%30`), `CEffect::Roll` (`rand()%(mul*3)`), `CBodyPart::Move` (`rand()%2`),
`Explo` (`rand()%5`, `rand()%2`, `rand()%360`, `rand()%pushDist`), rocket/ray effects
(`rand()%180`, `rand()%2`), player kick/blood/fire (`rand()%40`, `rand()%3`, `rand()%2`,
`rand()%10`), frag/suicide text (`rand()%size`).

### Known hazards

- **Argument evaluation order.** Multiple `rand()` calls inside one expression (e.g.
  `Explo`, bullet blood FX, `CheckBurning`) are unspecified in C++; g++ evaluates
  arguments **right-to-left**. The oracle makes that order explicit (assigns temporaries
  in the observed order) so it does not depend on the compiler, and `src/sim/world.ts`
  reproduces the same order. Any new multi-`rand()` expression must do the same.
- **Rendering consumes RNG.** The original's `DrawSpots` (and some effects) call `rand()`
  while drawing, so a real run's RNG stream is intertwined with rendering — and because
  the original's catch-up loop runs a variable number of sim ticks per drawn frame, its
  RNG stream is *timing-dependent* and not reproducible anyway. The port keeps the
  simulation on a deterministic stream and gives `DrawSpots` a separate `GlibcRandom`
  (`ActorScene.renderRng`, seeded from the same value); spot flicker is therefore
  cosmetic-only and does not perturb the sim. Parity tests check the sim trace and the
  light rasteriser independently.
- **Non-local players are static.** In the M3 replay a non-local player receives damage
  and push but is never moved (the original would move it on its own client). Fine for
  single-machine traces; multiplayer (split-screen and WebRTC/WebSocket netplay) is
  deferred to a later milestone.
- **`std::sort` not stable.** Enemies/body parts are sorted by X each tick; ties can
  reorder. The oracle uses `std::stable_sort` and the port uses `Array.prototype.sort`
  (stable per spec), so the two agree with each other regardless of ties; this may still
  differ from the original's (unstable) `std::sort` for exact X ties — pin a reference
  where ties are absent when comparing against a real build.
- **Catch-up ticks.** When a display frame is slow, the original runs multiple ticks,
  consuming more RNG per frame. Parity tests should use the deterministic fixed-tick mode.
- **`time(NULL)` seeds.** A runtime seed means two live runs differ (as in the original).
  Parity testing always seeds explicitly.

## Testing layers

1. **Unit tests** (`bun test`)
   - Decoders: EFP/FNT/PCX/lev/palette round-trips and known sizes.
   - Math: `CMath` sin/cos table hash + `GetAngle`/`GetDist` vs. the C++ oracle.
   - RNG: `GlibcRandom` outputs vs. glibc `rand()` golden sequence.
   - `RotateSprites` etc. vs. reference images.
2. **Golden state traces**
   - Seeded scenario scripts (spawn, run N ticks, issue inputs) produce a trace:
     entity positions/angles/HP, bullet/enemy/body-part/effect/crate state, money.
   - Compare port trace to a reference trace; assert equality (or a pinned, documented
     acceptable difference). M4: `tools/reference/fixtures/replay1.{script,trace}` and
     `src/sim/__test__/replay.test.ts` (400 ticks, byte-identical: enemy spawn/AI/shooting,
     effect roll, steam, bullets vs enemies, crates placed). Enemy death/body parts/crate
     pickup are exercised interactively in the browser; a dedicated kill/pickup scenario is
     planned.
3. **Golden frames**
   - At fixed scenarios, diff the presented framebuffer against a reference screenshot
     using pixel-diff/SSIM. Allow tolerance only for documented non-determinism.
4. **Reference build oracle** — see above.

## Suggested scenarios

- Level load/spawn parity (entity placement from a seed).
- Player movement + camera pan on an open level.
- Firing each weapon type; bullet travel, bounce, collision, explosion.
- Enemy engagement: sight, approach, shooting, damage, death (each enemy type).
- Body-part physics and pickup text.
- Crate pickup of each type; DM crate respawn.
- Full level completion → statistics (money/time bonus).
- Screen transitions (fade/zoom) and menu rendering.

## Performance budget

- Index buffer: 640×480 = 307 200 bytes; RGBA conversion 1 228 800 bytes/frame.
- Target 60 fps. If `putImageData` + `refresh()` is too slow on low-end devices, switch
  to the index-texture + palette-shader presenter (doc 10, approach B) behind the same
  interface.

## Risk register

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `RotateSprites` interpretation wrong | Wrong character art everywhere | Reference build the same bytes; compare sheets |
| RNG eval order mismatch | Simulation diverges quickly | Pin reference compiler behaviour; match order |
| `std::sort` instability | Rare divergence | Replicate sort; pin scenarios |
| Light math approximation | Visible art drift | Port tables/light maps exactly; pixel diff |
| Canvas texture/present cost too high | Low FPS | WebGL index-texture + palette-shader presenter |
| Audio autoplay policy | Silent until gesture | Require a click/key to start |
| Large music payload (~40 MB) | Slow load | Lazy-load themes; manifest-driven |
| Old `.lev` format edge cases | Levels fail to load | Test all bundled maps; port all version branches |
