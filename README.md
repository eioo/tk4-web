# tk4-web

Browser port of **Tapan Kaikki 4: Bloodshed** — Bun + a custom canvas/WebGL
renderer (no game framework).

The original C++/SDL 1.2 source and data live in `tapankaikki4/` (reference
checkout of the upstream repo, not part of this repository's history).

Start here: [`docs/README.md`](docs/README.md).

## Scripts

| Command             | Purpose                                      |
| ------------------- | -------------------------------------------- |
| `bun install`       | Install dependencies                         |
| `bun run dev`       | Vite dev server (HMR)                        |
| `bun run build`     | Type-check + production build to `dist/`     |
| `bun run typecheck` | TypeScript only                              |
| `bun run lint`      | Lint with oxlint (`lint:fix` to apply fixes) |
| `bun run fmt`       | Format with oxfmt (`fmt:check` to verify)    |
| `bun test`          | Unit tests                                   |

## Status

**M0 — scaffolding.** Canvas boot, fixed 100 Hz-tick loop (catch-up capable) and
a diagnostic test pattern. See
[`docs/12-implementation-plan.md`](docs/12-implementation-plan.md).
