# Tapan Kaikki 4 — Reverse-Engineering & Web Port Docs

Documentation for porting **Tapan Kaikki 4: Bloodshed** (a top-down "kill everything
that moves" shooter, 1–4 players, C++/SDL 1.2) to the browser with **Bun** and a
**custom canvas/WebGL renderer** (no game framework), as close to a 1:1 reproduction as
practical.

The original source lives in [`../tapankaikki4/`](../tapankaikki4/). This `docs/`
tree captures how the original engine works, what every data format contains, and how
the web port is built.

## Purpose

These docs are the **shared reference** for the port. Read them before touching code.
They are intentionally detailed: the port aims for pixel- and physics-level parity, and
that requires exact knowledge of the original's constants, draw order, formats and
random-number behaviour.

## Contents

### The original game (reference)

| Doc | What it covers |
|-----|----------------|
| [Game Overview](game-overview.md) | What the game is, modes, campaign, controls, content inventory |
| [Engine Architecture](engine-architecture.md) | Class map, main loop, fixed 100 Hz tick, state machine, lifetimes |
| [Simulation & Physics](simulation-and-physics.md) | Tick model, coordinates, movement, collision, bullets, explosions, effects, body parts, crates, RNG |
| [Enemy AI](enemy-ai.md) | Enemy states, senses, targeting, shooting, reactions, per-type stats |
| [Rendering Pipeline](rendering-pipeline.md) | Palette, 8-bit software renderer, light tables, draw order, sprite sheets, camera, HUD |
| [Asset Formats](asset-formats.md) | EFP/EFP2, PCX, SCI, BMP, FNT, WAV, OGG, `palette.tab`, ini/cfg |
| [Level Format](level-format.md) | Old + new `.lev` formats, chunks, block heights, derived maps, spawn rules |
| [Game Data Tables](game-data-tables.md) | Every weapon/bullet/enemy/effect/body-part value from `types.cpp` |
| [UI, Flow & Controls](ui-flow-and-controls.md) | Menus, options, game sub-states, shop, statistics, HUD, message board, controls |

### The web port

| Doc | What it covers |
|-----|----------------|
| [Web Port Architecture](web-port-architecture.md) | Bun + custom renderer design, module layout, rendering strategy, audio, input, persistence |
| [Asset Pipeline](asset-pipeline.md) | Converting original data into web-ready assets, deterministically |
| [Parity, Testing & Risks](parity-testing-and-risks.md) | Determinism, glibc `rand()`, reference capture, pixel diffing, known hazards |
| [Tooling & Environment](tooling-and-environment.md) | What must be installed (Bun, SDL 1.2, Xvfb, ffmpeg, …) and why |
| [Implementation Plan](implementation-plan.md) | Incremental milestones with deliverables and acceptance criteria |
| [Online Multiplayer](multiplayer/README.md) | Netplay: deterministic shared world over Bun WebSockets with prediction + rollback, lobby, coop progression, DM frag limit |
| [ADR-0001: Rendering Stack](adr/0001-rendering-stack.md) | Why a custom software renderer instead of a game framework |

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
- **SSIM/pixel diff** — automated image comparison used for parity testing
  ([Parity, Testing & Risks](parity-testing-and-risks.md)).
