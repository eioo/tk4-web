# Online multiplayer (netplay)

Online play for the browser port, built on **deterministic lockstep** over **Bun
WebSockets** with client-side prediction and rollback. The design keeps the parity
goal of the port intact: single-player, split-screen and the reference oracles are
untouched. Netplay is explicitly **non-parity**.

> Status: **implemented** — protocol + room manager + Bun WS servers; client
> transport and the multiplayer/host/join/lobby menus; the online match with
> prediction + rollback, per-seat mouse, single-view rendering, episode
> progression, DM frag limit and host migration. See the
> [Implementation Plan](implementation-plan.md).

## Decisions

| Topic | Decision |
| --- | --- |
| Transport | Bun WebSockets (`Bun.serve`), JSON messages (protocol v2) |
| Netcode | Deterministic shared world; server is lobby + tick master + input relay, **no simulation** |
| Latency | Client-side prediction + rollback: instant local movement, remote seats ~1 RTT behind ([Netcode Prediction](netcode-prediction.md)) |
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

1. [Architecture](architecture.md) — lockstep model, authority split, determinism requirements
2. [Protocol](protocol.md) — every client/server message and its sequencing
3. [Server](server.md) — Bun WS server, rooms, codes, tick master, host migration
4. [Client](client.md) — transport, input sampling, prediction + rollback
5. [Game Flow](game-flow.md) — phase machine from lobby through progression
6. [UI Menus](ui-menus.md) — new screens, menu states, items, lobby UI
7. [Netcode Prediction](netcode-prediction.md) — prediction, tick numbering, rollback, snapshots
8. [Testing & Risks](testing-and-risks.md) — tests, determinism checks, hazards
9. [Implementation Plan](implementation-plan.md) — milestones N1–N5 with acceptance criteria

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
so drawing never perturbs the sim
([Parity, Testing & Risks](../parity-testing-and-risks.md)). That is the single most
valuable asset here. Syncing *inputs* across clients instead of *world state* reuses it
directly: bandwidth is tiny, there is no snapshot/interpolation layer, and the
existing `SimWorld` runs unchanged for every seat.
