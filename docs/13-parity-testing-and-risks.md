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
near-verbatim and need only libm:

- `tools/reference/tkreference.h` — shared copies of `CPalette`, `CGraphicsGenerator`,
  `CLevel` (heights + derived maps), `CGameDrawer` and the static `CGameDrawManager`
  draws.
- `tools/reference/rotate_gen.cpp` — `RotateSprites` / `MakeFloors` / `ZoomWall`.
- `tools/reference/render_gen.cpp` — static level frame (floor, shadows, camera-cone black
  parts, pseudo-3D walls) from a raw block dump produced by `tools/reference/dump-level.ts`.

The TypeScript tests hash the port's output and compare against the oracle's output
(`sha256` over the pixel buffer), giving byte-exact verification without a screenshot
workflow. These have validated `RotateSprites`/`ZoomWall`/`MakeFloors` and the static
render path across old- and new-format levels. The full reference build is still needed
for simulation, audio and menu parity.

## Determinism

### glibc `rand()`

The original calls `srand((unsigned)time(NULL))` then libc `rand()`. To reproduce:

- Implement glibc's **TYPE_3** additive-feedback generator:
  `r[i] = (r[i-3] + r[i-31]) >> 1`, output `r[i] >> 1` (with the first-output
  adjustment), `srand` seeding `r[0]=seed`, and the discard of the first 310 outputs.
- Expose explicit seeding for tests/replays; default to `Date.now()` at runtime.

If exact libc parity proves hard across platforms, alternative: define the reference run
using the port's RNG and compare *internal consistency* (same seed → same run) plus
visual parity; but the strong claim of "same physics" is best served by matching glibc.

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
  `Explo`, bullet blood FX, `CheckBurning`) are unspecified in C++. The reference build's
  compiler fixes an order; the port must match the order observed in the reference.
- **`std::sort` not stable.** Enemies/body parts are sorted by X each tick; ties can
  reorder. Either replicate the exact algorithm or pin a reference where ties are absent.
- **Catch-up ticks.** When a display frame is slow, the original runs multiple ticks,
  consuming more RNG per frame. Parity tests should use the deterministic fixed-tick mode.
- **`time(NULL)` seeds.** A runtime seed means two live runs differ (as in the original).
  Parity testing always seeds explicitly.

## Testing layers

1. **Unit tests** (`bun test`)
   - Decoders: EFP/FNT/PCX/lev/palette round-trips and known sizes.
   - Math: `CMath` sin/cos/GetAngle/GetDist vs. C++ values.
   - RNG: `GlibcRandom` outputs vs. glibc `rand()` golden sequence.
   - `RotateSprites` etc. vs. reference images.
2. **Golden state traces**
   - Seeded scenario scripts (spawn, run N ticks, issue inputs) produce a trace:
     entity positions/angles/HP, bullet counts, RNG draw count, money.
   - Compare port trace to a reference trace; assert equality (or a pinned, documented
     acceptable difference).
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
