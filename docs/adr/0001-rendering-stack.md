# ADR-0001 — Rendering stack: custom canvas/WebGL, no game framework

- Status: Accepted
- Date: 2026-10-11
- Supersedes: the earlier "Bun + Phaser 4" plan

## Context

The port must reproduce **Tapan Kaikki 4** exactly: same physics, same sounds, same art.
The original is an 8-bit palette-indexed **software rasteriser** (per-pixel light tables,
shadow tables, a pseudo-3D wall renderer, palette fades) presented to a 16-bit SDL
surface, driven by a fixed 100 Hz simulation with its own state machine ("CState"),
entity system, physics and animation. See docs 02, 03 and 05.

We build the rasteriser in TypeScript regardless. The question was whether to host it in
a general-purpose game framework such as Phaser 4, or to own the surrounding concerns
(canvas, loop, input, audio, asset loading) directly.

## Decision

Use a **custom renderer** and our **own loop/input/audio**. Do **not** use Phaser (or any
comparable framework). The stack is:

- Bun for package management, bundling, dev server and tests.
- A `Presenter` abstraction over a plain `<canvas>`:
  - A: Canvas2D `putImageData` (default) — index buffer → RGBA once per frame.
  - B: WebGL palette shader (index texture + 256×1 palette LUT) if the frame budget needs
    it.
- `requestAnimationFrame` + a fixed-step (100 Hz) accumulator mirroring the original's
  catch-up behaviour.
- DOM keyboard/mouse input (Pointer Lock for mouse rotation) funnelled into an
  `InputState` mirroring `CEventHandler`.
- WebAudio for positional sound effects and music, mirroring `CSoundPlayer::PlayPosSample`.

## Rationale

1. **The framework's value is unused.** Phaser's sprites, animations, tilemaps, scene
   graph, batch renderer, arcade/matter physics and `GameObject` pipeline play no part in
   a port that renders one indexed framebuffer and owns its own simulation and states.
2. **Exactness.** Phaser's renderer cannot reproduce per-pixel palette light tables, the
   `palette.tab` mappings, the pseudo-3D wall rasteriser or palette fades. Routing pixels
   through Phaser would require bypassing its renderer anyway, so we would ship a large
   dependency to use a small slice of it.
3. **Determinism and testability.** Owning the loop lets us offer a fixed-tick replay mode
   with a seeded glibc-compatible `rand()` (docs 03, 13). Framework loops make
   deterministic playback and frame-accurate parity harder to guarantee.
4. **Dependency and API risk.** Phaser 4 was at `4.0.0-rc.*` during research, with a new
   renderer and sparse docs. Our four engine-touching concerns (present, input, audio,
   loop) are small enough to own cheaply and to keep stable.
5. **Performance.** Canvas2D `putImageData` at 640×480 (~1.2 MB/frame) is comfortably fast;
   the WebGL palette-shader path (≈ 0.3 MB index texture) is faster still. No framework
   needed to hit the budget.

## Consequences

- We implement and maintain: canvas creation/resize/upscale, RAF loop, input mapping,
  WebAudio playback, and asset loading. All are modest and well-understood.
- The simulation is fully engine-free, so it can be unit-tested headlessly and replayed
  deterministically.
- If we ever want framework conveniences later, the `Presenter`/`InputSource`/`AudioBackend`
  interfaces keep those concerns swappable without touching the sim.
- No framework upgrade treadmill; we control our own API surface.

## Alternatives considered

- **Phaser 4 as a thin shell (input/audio/scene, custom renderer for pixels).** Feasible,
  but still a large dependency for a small used surface, and adds RC-stability risk.
  Rejected in favour of owning those concerns directly.
- **Render gameplay with Phaser sprites/GameObjects.** Rejected outright: cannot reproduce
  the palette/light/order fidelity.
- **Compile the original to WebAssembly (Emscripten).** Out of scope; the project is a
  TypeScript reimplementation, not a WASM port.
