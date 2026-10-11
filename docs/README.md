# Tapan Kaikki 4 — Reverse-Engineering & Web Port Docs

Documentation for porting **Tapan Kaikki 4: Bloodshed** (a top-down "kill everything
that moves" shooter, 1–4 players, C++/SDL 1.2) to the browser with **Bun** and a
**custom canvas/WebGL renderer** (no game framework), as close to a 1:1 reproduction as
practical.

The original source lives in [`../tapankaikki4/`](../tapankaikki4/). This `docs/`
tree captures how the original engine works, what every data format contains, and how
the web port is planned and built.

## Purpose

These docs are the **shared reference** for the port. Read them before touching code.
They are intentionally detailed: the port aims for pixel- and physics-level parity, and
that requires exact knowledge of the original's constants, draw order, formats and
random-number behaviour.

## Reading order

| # | Doc | What it covers |
|---|-----|----------------|
| 01 | [Game Overview](01-game-overview.md) | What the game is, modes, campaign, controls, content inventory |
| 02 | [Engine Architecture](02-engine-architecture.md) | Class map, main loop, fixed 100 Hz tick, state machine, lifetimes |
| 03 | [Simulation & Physics](03-simulation-and-physics.md) | Tick model, coordinates, movement, collision, bullets, explosions, effects, body parts, crates, RNG |
| 04 | [Enemy AI](04-enemy-ai.md) | Enemy states, senses, targeting, shooting, reactions, per-type stats |
| 05 | [Rendering Pipeline](05-rendering-pipeline.md) | Palette, 8-bit software renderer, light tables, draw order, sprite sheets, camera, HUD |
| 06 | [Asset Formats](06-asset-formats.md) | EFP/EFP2, PCX, SCI, BMP, FNT, WAV, OGG, `palette.tab`, ini/cfg |
| 07 | [Level Format](07-level-format.md) | Old + new `.lev` formats, chunks, block heights, derived maps, spawn rules |
| 08 | [Game Data Tables](08-game-data-tables.md) | Every weapon/bullet/enemy/effect/body-part/body-part type value from `types.cpp` |
| 09 | [UI, Flow & Controls](09-ui-flow-and-controls.md) | Menus, options, game sub-states, shop, statistics, HUD, message board, controls |
| 10 | [Web Port Architecture](10-web-port-architecture.md) | Bun + custom renderer design, module layout, rendering strategy, audio, input, persistence |
| 11 | [Asset Pipeline](11-asset-pipeline.md) | Converting original data into web-ready assets, deterministically |
| 12 | [Implementation Plan](12-implementation-plan.md) | Incremental milestones with deliverables and acceptance criteria |
| 13 | [Parity, Testing & Risks](13-parity-testing-and-risks.md) | Determinism, glibc `rand()`, reference capture, pixel diffing, known hazards |
| 14 | [Tooling & Environment](14-tooling-and-environment.md) | What must be installed (Bun, SDL 1.2, Xvfb, ffmpeg, …) and why |

## TL;DR of the plan

- **No game framework — custom renderer.** The original is an 8-bit palette-indexed
  *software* rasteriser with per-pixel light tables. A framework's sprite pipeline
  cannot reproduce it exactly, and its other features (scenes, tilemaps, physics) are
  unused. The port implements the original's software framebuffer in TypeScript, then
  blits that single framebuffer to a plain `<canvas>` each frame. The loop, input, audio
  and asset loading are owned directly; Bun handles packaging, bundling and tests. See
  [ADR-0001](adr/0001-rendering-stack.md).
- **Fixed 100 Hz simulation.** The original ticks at `KTimerFreq = 100`; all physics
  constants are per-tick. The port runs the exact same tick loop with a catch-up
  accumulator.
- **Formats are decoded, not guessed.** EFP sprite sheets, `.lev` levels (old *and*
  new), `.fnt` fonts, `palette.tab` etc. are decoded by build-time scripts.
- **Determinism is a feature.** The original uses libc `rand()` seeded with
  `time(NULL)`. The port ships a seedable, glibc-compatible `rand()` so a seed
  reproduces the identical run.

## Glossary

- **Tick / frame** — one simulation step at 100 Hz. Used interchangeably; "frame"
  below always means a simulation frame, not a rendered display frame.
- **Block** — one 20×20 px level tile (`KBlockSpriteSize`).
- **Block height** — pseudo-3D wall height 0–5; 0 = floor-level, >0 renders as a wall.
- **EFP** — the game's indexed sprite format (`"EF pic"` magic).
- **Global palette** — the single 256-colour palette taken from `efps/walls1.efp`,
  used for *all* in-game pixels.
- **SSIM/pixel diff** — automated image comparison used for parity testing (doc 13).
