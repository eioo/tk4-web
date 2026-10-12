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
bun run dev           # http://localhost:5173/
```

`bun run dev` starts Vite (HMR) and the netplay WebSocket server in parallel, and
fetches the game data on first run: it clones
[`suomipelit/tapankaikki4`](https://github.com/suomipelit/tapankaikki4) into
`tapankaikki4/` (kept out of this repo's history) and mirrors `tapankaikki4/data`
into `public/assets/`. Later runs skip both; `bun run assets` forces a refresh.

## Production

```sh
bun run start         # ensure assets + type-check + build to dist/, then host it
```

`bun run start` runs `bun run assets:ensure` (which builds `public/assets/` only if
missing), then `bun run build` followed by `bun run serve`. The server
(`tools/serve.ts`, built on `Bun.serve`) serves `dist/` with correct MIME types for the
game's custom asset extensions, long-lived caching for Vite's hashed bundles, and an
`index.html` fallback. Port and bind come from `--port`/`--host` (or `PORT`/`HOST`),
defaulting to `0.0.0.0:4173`:

```sh
bun run serve --port 8080 --host 127.0.0.1   # host an existing dist/ without rebuilding
```

`dist/` is a plain static site (`base: "./"`), so it can also be hosted anywhere.

## Online multiplayer (development)

Online play uses a Bun WebSocket server. `bun run dev` runs it alongside Vite,
which proxies `/ws` to it, so there is nothing extra to start:

```sh
bun run dev           # http://localhost:5173/ (Vite) + ws://localhost:4174/ws (netplay)
```

In production `tools/serve.ts` serves both the static build **and** `/ws` on the
same origin (no extra port/DNS/TLS): behind a reverse proxy, make sure the
WebSocket `Upgrade` is passed through (Caddy needs no special config; Cloudflare
proxies WebSockets by default).

Online match flow: main menu → _start multiplayer game_ → _online multiplayer_ →
host (5-letter code) or join (enter the code). Names come from Options → Player 1.

## Scripts

| Command                     | Purpose                                                             |
| --------------------------- | ------------------------------------------------------------------- |
| `bun run dev`               | Ensure assets, then Vite (HMR) + netplay WS server in parallel      |
| `bun run dev:app`           | Vite dev server only (`http://localhost:5173/`)                     |
| `bun run dev:net`           | Netplay WebSocket server only (same as `bun run net`)               |
| `bun run net`               | Standalone netplay WebSocket server (`--port`/`NET_PORT`, 4174)     |
| `bun run build`             | `tsc --noEmit` + `vite build` → `dist/`                             |
| `bun run start`             | Ensure assets, build, then serve `dist/` + `/ws` (production)       |
| `bun run serve`             | Serve an existing `dist/` + `/ws` (`--port`/`--host`, default 4173) |
| `bun run assets`            | Rebuild `public/assets` (clones `tapankaikki4/` if missing)         |
| `bun run assets:ensure`     | Build `public/assets` only if it is missing                         |
| `bun test`                  | Unit tests (Bun's runner)                                           |
| `bun run typecheck`         | TypeScript only                                                     |
| `bun run lint` / `lint:fix` | Lint with oxlint                                                    |
| `bun run fmt` / `fmt:check` | Format with oxfmt                                                   |
| `bun run reference`         | Build the standalone C++ oracles (`/tmp/{rotate,render,sim}_gen`)   |
| `bun run parity`            | Rebuild the oracles and diff scenarios + static frames (doc 13)     |
| `bun run perf`              | Time the presentation path against its 60 fps budget                |

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
audio, and the parity harness). M10 (polish/deployment), M11 (local split-screen for up to
four players on one keyboard + mouse) and M12 (deathmatch: frags, respawn, kill texts) are
in. M13 (greenfield WebSocket netplay) is implemented: the protocol, pure room manager,
Bun servers, online menus/lobby, the online match flow, and client-side prediction with
rollback so local movement is instant (see
[`docs/multiplayer/09-netcode-prediction.md`](docs/multiplayer/09-netcode-prediction.md));
cross-machine play still wants a manual pass. See
[`docs/12-implementation-plan.md`](docs/12-implementation-plan.md) for details.
