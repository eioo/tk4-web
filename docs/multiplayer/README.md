# Online multiplayer (netplay)

Greenfield online play for the browser port, built on **deterministic lockstep**
over **Bun WebSockets**. This directory is the design + implementation plan.
Nothing here changes the parity goal of the port: single-player, split-screen and
the reference oracles are untouched. Netplay is explicitly **non-parity**.

> Status: **N1–N3 implemented** on branch `online-multiplayer` (protocol + room
> manager + Bun WS servers; client transport and the multiplayer/host/join/lobby
> menus; the online match: lockstep stepping, per-seat mouse, single-view
> rendering, episode progression, DM frag limit, host migration). **N4**
> (polish, docs, production WS verification) is in progress. See
> [07-implementation-plan.md](07-implementation-plan.md).

## Decisions (locked)

| Topic | Decision |
| --- | --- |
| Transport | Bun WebSockets (`Bun.serve`), JSON messages for v1 |
| Netcode | Deterministic lockstep; server is lobby + tick master + input sampler, **no simulation** |
| Latency | No prediction, no input-delay buffer (≈1 RTT) |
| Controls | Per-seat mouse: each client's mouse drives only its own player |
| Match scope | Full episode progression (coop); statistics and shop online |
| Between levels | All players "ready" barrier |
| Shop | Each player shops their own loadout; server consolidates states |
| Deathmatch | Host-configurable frag limit (default 20); one continuous level |
| Disconnects | Non-host leaver becomes an idle seat (zero input, auto-ready) |
| Host loss | Host migration (promote another player) |
| After a match | Back to the same room's lobby, players retained |
| Names | From Options → Player 1 options |
| Player count | 2–4 |

## Docs

1. [01-architecture.md](01-architecture.md) — lockstep model, authority split, determinism requirements
2. [02-protocol.md](02-protocol.md) — every client/server message and its sequencing
3. [03-server.md](03-server.md) — Bun WS server, rooms, codes, tick master, host migration
4. [04-client.md](04-client.md) — transport, input sampling, bundle buffer, lockstep stepping
5. [05-game-flow.md](05-game-flow.md) — phase machine from lobby through progression
6. [06-ui-menus.md](06-ui-menus.md) — new screens, menu states, items, lobby UI
7. [07-implementation-plan.md](07-implementation-plan.md) — milestones N1–N4 with acceptance criteria
8. [08-testing-and-risks.md](08-testing-and-risks.md) — tests, determinism checks, hazards

## Glossary

| Term | Meaning |
| --- | --- |
| **Seat** | One player slot in a room (`SimPlayer` index). Seat 0 is initially the host. |
| **Room** | A lobby + match identified by a 5-letter code. |
| **Tick** | One 100 Hz simulation step (`KTimerFreq`). Also the server's broadcast unit. |
| **Bundle** | The `tick` message: `{tick, inputs[]}` — one `SimInput` per seat. |
| **Lockstep** | Every client runs the identical sim from identical inputs; no state sync. |
| **Ready barrier** | Server waits for every seat's `ready` before starting the next level. |
| **Idle seat** | A disconnected seat that keeps being simulated with zero input. |
| **Level start** | Server broadcast carrying the seed, shop seed and per-seat persistent state. |

## Why lockstep

The port's simulation is byte-exact deterministic: glibc `rand()`, fixed 100 Hz,
`Math.fround`-pinned float sites, trig lookup tables, and a *separate* render RNG
so drawing never perturbs the sim (docs/13). That is the single most valuable
asset here. Syncing *inputs* across clients instead of *world state* reuses it
directly: bandwidth is tiny, there is no snapshot/interpolation layer, and the
existing `SimWorld` runs unchanged for every seat.
