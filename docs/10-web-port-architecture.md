# 10 — Web Port Architecture (Bun + custom canvas/WebGL renderer)

## Decision

**No game framework. Custom renderer + own loop.** See
[ADR-0001](adr/0001-rendering-stack.md) for the full reasoning.

The original is an **8-bit indexed software rasteriser** with per-pixel light tables
(doc 05). A general-purpose game framework (sprites, scenes, tilemaps, batch renderer,
built-in physics) adds nothing here and cannot reproduce the pipeline. The port therefore:

- implements the original's **software framebuffer in TypeScript** (`Uint8Array` of
  palette indices, sized to the video mode),
- converts the finished index buffer to RGBA and blits it to a single `<canvas>` each
  display frame,
- owns its own `requestAnimationFrame` loop, input handling, audio and asset loading.

Everything is written across Bun (package manager, bundler, runtime, test runner).

## Why not a framework

Only four concerns touch an engine: present a framebuffer, read input, play audio, drive
the loop. The original already provides its own state machine, physics, animation and
rendering. A framework would contribute a tiny used surface (canvas creation, input
events, audio decode) at the cost of a large dependency and, for Phaser 4 specifically,
release-candidate API churn. These four concerns are small and straightforward to own,
and owning them keeps the port deterministic and dependency-light. Full rationale in the
ADR.

## Presentation

The renderer produces a `Uint8Array` of palette indices. Presenting it has two
implementations behind one `Presenter` interface:

| Implementation | Speed | Fidelity | Use when |
|----------------|-------|----------|----------|
| **A. Canvas2D + `putImageData`** | Good (640×480 ≈ 1.2 MB/frame) | Exact | Default; simplest, works everywhere |
| **B. WebGL palette shader** | Best | Exact | If A misses the frame budget, or for large video modes |

Both are implemented (`src/render/presenters/`), and `createPresenter` picks Canvas2D by
default or the WebGL path with `?presenter=webgl` (falling back to Canvas2D if WebGL is
unavailable). The WebGL output is byte-identical to the `toRgba` conversion.

**A (Canvas2D):** keep one `ImageData` sized to the video mode; once per display frame,
translate the index buffer into its RGBA bytes using the global palette
(`Uint32Array` view for speed), then `ctx.putImageData`. Cheap, no dependencies.

**B (WebGL):** upload the index buffer (≈ 0.3 MB at 640×480) as a single-channel
`LUMINANCE`/`R8` texture and a 256×1 RGB palette LUT texture; a fragment shader does
`color = texture(palette, vec2(index, 0.5))`, with `NEAREST` filtering for both the LUT
and upscaling. Fastest and still exact. Same palette source as A.

The presenter also handles integer upscaling to the window (NEAREST, no smoothing),
letterboxing if the window aspect differs, and exposing the raw framebuffer for parity
screenshots/tests.

## Loop

```ts
// src/render/loop.ts (concept)
const TICK_MS = 1000 / 100;               // KTimerFreq = 100
let last = performance.now();
let acc = 0;
function frame(now: number) {
  const dt = now - last; last = now;
  acc += dt;
  let ticks = 0;
  while (acc >= TICK_MS && ticks < MAX_CATCHUP) { sim.tick(); acc -= TICK_MS; ticks++; }
  if (ticks >= MAX_CATCHUP) acc = 0;      // drop the backlog (mirror LowFramerate clamp)
  draw.frame();                            // compose the index buffer
  presenter.present(fb);                   // -> canvas
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- `TICK_MS = 10`. Every gameplay rule runs at this rate, exactly as the original.
- Mirror the original's "low framerate" catch-up so RNG consumption per displayed frame
  matches when running behind.
- Provide a **deterministic replay mode**: fixed tick count, seeded RNG, no wall-clock
  coupling — used by parity tests (doc 13).

## Deterministic RNG

Implement glibc `rand()` (TYPE_3, `r[i] = r[i-3] + r[i-31]`, `>>1`, with the standard
seed/initialisation) so a given seed reproduces the reference exactly.

```ts
class GlibcRandom { constructor(seed?: number); rand(): number; srand(s: number): void }
```

Default seed = `Date.now()` (as the original uses `time(NULL)`); tests/replays override.

## Input

Own the DOM events; funnel into an `InputState` that mirrors `CEventHandler`:

- per-player 9 key booleans (from the configurable bindings, doc 09),
- mouse buttons + right-press edge,
- mouse X-delta for rotation.

Mouse rotation uses **Pointer Lock** (request on canvas click) to get unbounded, reliable
relative movement; clamp per-tick rotation to `KMaxMouseRotationPerFrame = 15`. Mouse
owner = `mouseMode - 1`. Keyboard events are captured on the window; prevent default for
game keys. Add gamepad as an **optional extra** (not part of parity).

Because input feeds `InputState` and the simulation only reads `InputState`, the sim stays
engine-free and unit-testable.

## Audio

Own WebAudio, mirroring `CSoundPlayer::PlayPosSample`:

- Decode all `wavs/*.wav` once into `AudioBuffer`s.
- Play through a pool of sources (`AudioBufferSourceNode → GainNode → StereoPannerNode →
  destination`); pan derives from the source X offset relative to the player
  (`PAN_MIDDLE` = centre).
- Volume from options; multiple concurrent channels allowed.
- Music: looping `AudioBufferSourceNode` (or `MediaElementSource`) per theme; lazy-load
  tracks via the asset manifest (doc 11); `ForceSoundTrack`/`ForceSongNumber` honoured.
- Audio requires a user gesture before playback under browser autoplay policy — gate on
  the first key/click (the logo/menu screens naturally provide one).

## Module layout

```
tk4-web/
  docs/                        # these documents
  tapankaikki4/                # original C++ source + data (reference)
  tools/                       # build-time asset extraction (Bun/TS)
    extract-efp.ts
    extract-font.ts
    extract-palette.ts
    rotate-sprites.ts          # exact port of CGraphicsGenerator::RotateSprites
    build-assets.ts
  public/assets/               # generated web assets + manifest.json
  src/
    main.ts                    # bootstrap: canvas, loop, scene switch
    core/
      clock.ts                 # fixed 100 Hz tick + catch-up
      rng.ts                   # glibc-compatible seedable rand()
      math.ts                  # CMath: sin/cos tables, GetAngle/GetDist
      coord.ts, rect.ts        # CCoord / CRect equivalents
    data/
      types.ts                 # all tables from types.cpp (doc 08)
      palette.ts               # global palette + palette.tab tables + light maps
      ingame-data.ts           # default.ini + per-level overrides + sheet generation
      level.ts                 # .lev decoder (old + new) + derived maps
      fonts.ts                 # .fnt decoder + text rasteriser
    render/
      fb.ts                    # index framebuffer + RGBA conversion
      drawer.ts                # CGameDrawer primitives (blocks, sprites, lights, polys)
      draw-manager.ts          # CGameDrawManager::DrawFrame port (draw order)
      presenters/canvas2d.ts   # Presenter A
      presenters/webgl.ts      # Presenter B
      presenter.ts             # Presenter interface + selection
      fader.ts                 # CGraphicsFader port
    sim/
      dyn-data.ts              # CDynGameData port
      level-runtime.ts         # CLevelRuntimeData port
      character.ts, player.ts, enemy.ts, bullet.ts, effect.ts, bodypart.ts, crate.ts
      ai.ts                    # enemy AI
    audio/
      sound.ts                 # positional sample playback (pan/volume, channels)
      music.ts                 # ogg track selection/looping
    input/
      input-state.ts           # mirrors CEventHandler
      dom-input.ts             # DOM keyboard/mouse + pointer lock
    ui/
      hud.ts, message-board.ts, menus/*.ts, sub-states/*.ts
    options/
      options.ts               # COptionsData + localStorage persistence
    scenes/                    # our own states, not a framework concept
      boot.ts, logo.ts, menu.ts, game.ts
  index.html
  package.json
  tsconfig.json
  vite.config.ts               # dev server; bun build for prod
```

Unit tests live in a `__test__/` directory next to the code they cover (e.g.
`src/core/__test__/loop.test.ts`) and run with `bun test`.

## Bun usage

- **Package manager + runtime + test runner**: `bun install`, `bun test`, `bun run`.
- **Dev**: Vite via Bun (`bunx vite`) for HMR, **or** `bun build --watch` + `Bun.serve`.
- **Prod**: `bun run build` (`tsc --noEmit` + `vite build`) → static `dist/` (HTML + JS +
  `assets/`); `bun run start` builds and then hosts it with `tools/serve.ts` (a small
  `Bun.serve` static server — correct MIME types for the game's custom extensions,
  immutable caching for Vite's hashed bundles, `index.html` fallback). `bun run serve`
  hosts an existing `dist/` without rebuilding. Port/bind come from `--port`/`--host`
  (or `PORT`/`HOST`), defaulting to `0.0.0.0:4173`.
- **Build-time tools**: asset extraction scripts under Bun/TS (doc 11).

## Persistence

`options.cfg` becomes a JSON blob in `localStorage` under a versioned key. Campaign
progress is not saved in the original, so the port need not save it either (optional
non-parity extra).

## Boot & error handling

Boot is asynchronous: `main.ts` fetches every asset the game needs (root config,
`palette.tab`, menu/ingame data, fonts, `manifest.json`) before starting the loop. While
that runs, `index.html` shows a full-screen overlay (`#boot`) with a progress bar and a
running file count; `main.ts` removes it once the first frame is on the canvas. If boot
throws — most often because `public/assets/` is missing (`bun run assets` not run) — the
overlay switches to an error state showing the message and a reload button, and the
message is mirrored to `window.tk4Error` for scripts. This replaces the original's silent
black screen.

## Explicit non-goals / stubs

- Playable network multiplayer (original is non-functional anyway). Drop it.
- Online version checker (HTTP to `www.errorfree.eu.org`). Drop or stub.
- Level editor. Drop (formats are documented instead).
- DirectX/Win32/GTK specifics. Drop.

## Deployment

Static site: `bun run build` → `dist/`, host anywhere. To build **and** host locally with
the bundled server, run `bun run start` (`--port`/`--host`, default `0.0.0.0:4173`); host
only, without rebuilding, with `bun run serve`. Watch for audio autoplay (require a user
gesture) and canvas focus/keyboard capture.

Serve `dist/` behind HTTPS in real deployments so Pointer Lock and WebAudio behave
normally. No server-side state is needed — the whole game is static files.
