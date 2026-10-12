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
  (players, bullets, enemies, body parts, effects, crates, dead enemies). The scripts
  come from `src/sim/replay.ts#SCENARIOS` (the same scripts the TS test uses) and are
  serialised by `serializeScript`; `<datadir>` is the original `data/` dir, used to load
  `fnts/menu15x18dark.fnt` for the crate pickup-text counter. The oracle also models
  `CEnemy::SoundHeard` (positional samples make nearby hostile enemies assault), so a
  weapons/death scenario exercises the hearing path. Running it all is one command:
  `bun run parity` (below).

The TypeScript tests hash the port's output and compare against the oracle's output
(`sha256` over the pixel buffer / trace), giving byte-exact verification without a
screenshot workflow. These have validated `RotateSprites`/`ZoomWall`/`MakeFloors`, the
static render path across old- and new-format levels, the `CMath` tables, glibc `rand()`,
the ten light maps and `CGameDrawer::DrawLight`, the `CFonts` font writer and the HUD
primitives, and the M9 scenario replays below. The full reference build is still needed
for audio and menu parity.

### The parity task (`bun run parity`)

`tools/parity.ts` is the CI-style task: it rebuilds the oracles, regenerates every
scenario's trace and each static frame from the reference, runs the identical inputs
through the port, and reports the first differing byte per case (exiting non-zero on any
drift). The two committed fixture families are `tools/reference/fixtures/<name>.{script,trace}`
and the frame hashes in `src/render/frames.ts`; `--update` rewrites them, and
`bun test` re-checks them without a compiler.

Scenarios (`src/sim/replay.ts#SCENARIOS`) and what they cover:

| Scenario | Level | Covers |
|----------|-------|--------|
| `replay1` | `default/level1` | movement/camera, weapon switch, bullet physics, bouncing, two players |
| `weapons` | `small` | every weapon and bullet type, explosions, wall bouncing, sprite spin |
| `combat` | `jailbreak/level1` | placed enemies, `SoundHeard`, AI assault/shooting, enemy death + body parts |
| `crates` | `jailbreak/level1` | walking over a placed crate (pickup text and stats) |

Static frames (`src/render/frames.ts`) cover six levels' first start points.

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
- **Local split-screen is in (M11); the trace still has one input row.** `SimWorld::tick`
  now takes one `SimInput` per seat and the engine renders 1–4 viewports, but the M3
  replay/oracle script still stores a single input row per tick that is fed to every local
  seat, and the replay fixture keeps its second player non-local (never moved). There is
  therefore no per-seat parity trace yet; adding one means extending the script format and
  `simreference.h` together. Non-local players remain static on the client side by design
  until netplay (M13); the original's network code is compiled-out dead code
  (`network.cpp` `Send`/`Available` are empty), so there is no wire format to match.
- **`CEnemy::SoundHeard` is modelled.** The oracle now mirrors `CEnemy::SoundHeard`
  (positional samples make nearby hostile enemies with line of sight start an assault),
  and the `combat` scenario exercises it; `SimWorld.hearSounds` is on for both sides.
  Note the original clamps `iWalkCounter` to `>= 0`; the port does too.
- **Float32 storage.** The C++ tables store `float` (32-bit), and libc/`g++` arithmetic
  rounds each operation to `float`. The port keeps the same values, so table float fields
  are rounded with `f32()` (see `src/sim/types.ts`) and every mixed-constant expression
  must round its literals (e.g. `f32(x - f32(0.075))`, not `f32(x - 0.075)`), or the two
  drift after a few hundred ticks. M9 found and fixed several such sites
  (`pushPower` decay, `spriteAngleAdd` decay, crate text speed, bullet `slow`/`approxDistance`).
- **Vector reallocation in the oracle.** `SimMoveBullet` can append bullets (an explosion's
  rays), which reallocates `SimWorld::bullets`; iterating it by reference dangled and gave
  nondeterministic (even hanging) traces. `SimPerFrameCalc` now copies the bullet, runs it,
  and writes it back, matching the port's stable object reference.
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
     acceptable difference). M9: `src/sim/replay.ts#SCENARIOS` drives
     `src/sim/__test__/replay.test.ts` and `bun run parity` over
     `tools/reference/fixtures/<name>.{script,trace}` — `replay1` (400 ticks),
     `weapons`, `combat` (enemy death/body parts/hearing) and `crates` (pickup).
3. **Golden frames**
   - At fixed scenarios, diff the presented framebuffer against a reference screenshot
     using pixel-diff/SSIM. Allow tolerance only for documented non-determinism.
   - M9: `src/render/frames.ts` lists six levels' first start points; the static-frame
     test and `bun run parity` both hash them against the oracle's bytes.
4. **Reference build oracle** — see above.

## Suggested scenarios

Covered by the M9 parity task (`src/sim/replay.ts#SCENARIOS`): movement + camera pan,
weapon switching, every weapon/bullet type (travel, bounce, collision, explosion), enemy
engagement (sight, assault from hearing, shooting, damage, death, body parts), and crate
pickup. Static-frame parity covers level load/spawn rendering on six levels.

Still to add as needed: body-part pickup text parity, crate pickup of each type and DM
crate respawn, full level completion → statistics (money/time bonus), and screen
transitions (fade/zoom) / menu rendering (needs the full SDL reference build).

## Performance budget

- Index buffer: 640×480 = 307 200 bytes; RGBA conversion 1 228 800 bytes/frame.
- Target 60 fps (16.67 ms/frame). `bun run perf` (`tools/perf.ts`) times the CPU work the
  port owns — index→RGBA conversion at 640×480…1280×960 and the 640×480 static compose —
  and exits non-zero over budget. Measured on the dev machine: convert 640×480 ≈ 0.3 ms,
  1280×960 ≈ 1.1 ms, compose 640×480 ≈ 2 ms, leaving ample room for the display blit.
- Two presenters share the `Presenter` interface (doc 10): Canvas2D `putImageData`
  (default) and the WebGL index-texture + palette shader (`src/render/presenters/webgl.ts`,
  selectable with `?presenter=webgl`). The WebGL path produces byte-identical pixels
  (verified against `Framebuffer.toRgba`) and is the fallback for large modes or low-end
  devices that miss the CPU budget.

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
