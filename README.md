# tk4-web

Browser port of **Tapan Kaikki 4: Bloodshed** — a top-down "kill everything that
moves" shooter — rebuilt on **Bun** with a custom Canvas2D/WebGL renderer, **no game
framework**. The goal is a 1:1 reproduction: same physics, sounds and art as the original
C++/SDL 1.2 game.

The original source lives in `tapankaikki4/` (reference checkout of the upstream repo, not
part of this repository's history). The reverse-engineering notes and the port plan are in
[`docs/`](docs/README.md).

## Requirements

- [Bun](https://bun.sh) (package manager, runtime, test runner, build)
- The original data in `tapankaikki4/data/` (only needed to (re)generate assets)
- Optional, for parity testing against the reference: a C++ compiler (`g++`)

No game-framework dependency. Lint/format/type-check come from the dev dependencies.

## Quick start

```sh
bun install
bun run assets        # copy sprites/fonts/levels/sounds from tapankaikki4/ into public/assets
bun run dev           # http://localhost:5173/
```

`bun run assets --with-music` also copies the ~40 MB of music (kept out of the repo).

## Production

```sh
bun run start         # type-check + build to dist/ and host it
```

`bun run start` is `bun run build` followed by `bun run serve`. The server
(`tools/serve.ts`, built on `Bun.serve`) serves `dist/` with correct MIME types for the
game's custom asset extensions, long-lived caching for Vite's hashed bundles, and an
`index.html` fallback. Port and bind come from `--port`/`--host` (or `PORT`/`HOST`),
defaulting to `0.0.0.0:4173`:

```sh
bun run serve --port 8080 --host 127.0.0.1   # host an existing dist/ without rebuilding
```

`dist/` is a plain static site (`base: "./"`), so it can also be hosted anywhere.

## Scripts

| Command                     | Purpose                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| `bun run dev`               | Vite dev server with HMR                                          |
| `bun run build`             | `tsc --noEmit` + `vite build` → `dist/`                           |
| `bun run start`             | Build, then serve `dist/` (production)                            |
| `bun run serve`             | Serve an existing `dist/` (`--port`/`--host`, default 4173)       |
| `bun run assets`            | Regenerate `public/assets` from `tapankaikki4/data`               |
| `bun test`                  | Unit tests (Bun's runner)                                         |
| `bun run typecheck`         | TypeScript only                                                   |
| `bun run lint` / `lint:fix` | Lint with oxlint                                                  |
| `bun run fmt` / `fmt:check` | Format with oxfmt                                                 |
| `bun run reference`         | Build the standalone C++ oracles (`/tmp/{rotate,render,sim}_gen`) |
| `bun run parity`            | Rebuild the oracles and diff scenarios + static frames (doc 13)   |
| `bun run perf`              | Time the presentation path against its 60 fps budget              |

## Parity testing

The port is checked against standalone C++ oracles that re-implement the original
subsystems using the original data. `bun run parity` rebuilds those oracles, regenerates
seeded simulation traces and static frames, runs the same inputs through the port and
reports the first differing byte per case (non-zero exit on drift). See
[`docs/13-parity-testing-and-risks.md`](docs/13-parity-testing-and-risks.md).

`?presenter=webgl` selects the WebGL palette-shader presenter; Canvas2D `putImageData` is
the default and either path produces identical output.

## Status

Single-player co-op campaign is playable end-to-end at verified parity (milestones M0–M9:
scaffolding, asset pipeline, renderer, simulation, enemy AI, HUD/menus, shop/statistics,
audio, and the parity harness). M10 (polish/deployment) is in progress: the static build
and production host are done; a boot/loading overlay and error surfacing are in. Deferred
(planned, not out of scope): local split-screen for up to four players and WebRTC/WebSocket
netplay, which restore deathmatch frags/scoring. See
[`docs/12-implementation-plan.md`](docs/12-implementation-plan.md) for details.
