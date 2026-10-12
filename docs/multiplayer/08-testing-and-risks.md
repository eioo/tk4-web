# 08 — Testing and risks

## 1. Test strategy

Netplay has two very different failure modes: protocol/room logic (deterministic,
unit-testable) and world divergence (only observable by running the sim). Cover
both.

### 1.1 Unit

- **protocol** — encode/parse round-trip for every message; unknown/malformed
  JSON rejected; version mismatch rejected.
- **room manager** — with fake peers + a fake clock:
  - code generation is 5×A–Z and collision-free;
  - create/join/leave, capacity, dense seat order;
  - auto-start exactly when `connected === settings.players`;
  - tick sampling: `ZERO_INPUT` for seats that didn't send; exact `tick` stream;
  - `levelEnd` → `intermission`; `ready` barrier consolidation; `last` → victory;
  - `matchEnd` first-wins;
  - host migration promotes the lowest connected seat;
  - idle seats after a mid-match leave; empty-room cleanup after grace.
- **NetPlayerState** ⇄ `SimPlayer` round-trip (all persistent fields).
- **menus** — new trees' navigation and `prevMenu` edges; lobby item rebuild.
- **sim** — `perSeatMouse` off = byte-identical to today; on = each seat's mouse
  applied; two worlds fed identical bundles stay identical over many ticks.
- **session** — `visibleSeats` draws only the listed seats; single-player and
  split-screen draw loops unchanged.

### 1.2 Integration / determinism

- **Two-world lockstep**: construct two `GameSession`s with the same seed/states,
  feed the same scripted `SimInput[][]` bundles, and assert field-by-field
  equality (positions, angles, energy, bullets, enemies, crates, effects,
  bodyparts, RNG draw count) over hundreds of ticks. This is the netplay
  equivalent of the M9 replay harness.
- **Room-loopback**: drive a `RoomManager` with two fake peers through a full
  level + barrier + second level, asserting both peers receive identical
  `tick`/`levelStart` messages.
- **Real WS smoke** (optional, Bun): `Bun.serve` + two `WebSocket` clients
  exercise host/join/start/tick; assert message ordering and version rejection.
- **Browser**: `window.tk4Net` lets a scripted run set up a room and start a
  match without pointer/mouse, mirroring the existing `tk4Start` dev hooks.

### 1.3 Manual (the user, in-browser)

Parity-style checks can't catch netplay feel. Manual pass:
- two real machines on `tk4.space`: host code, join, coop level(s), shop,
  deathmatch frag limit, host migration, back to lobby;
- eyeball that both players see the same enemies/crates/positions;
- check the local player's movement and turning are instant (prediction);
  remote players lag ~one RTT and correct smoothly (no rubber-banding).

## 2. Determinism hazards

Ranked by likely damage. Every one of these already holds for single-player; the
risk is netplay breaking it.

1. **Seed leakage.** Any `Date.now()`/`Math.random()`/`crypto` seed reaching the
   sim (session seed, `placePlayersForLevel`'s RNG, `shopRng`) must come from
   `levelStart`. Audited by grepping for `Date.now`/`Math.random` in the online
   path.
2. **Roster order / identity.** Players must be built strictly from
   `states[]`/`roster` in seat order; names/colours/count identical. Any local
   `options.data` fallback diverges.
3. **Viewport rects.** `SimPlayer.drawRect` feeds camera/steam-culling inside the
   sim. Online must assign the identical single full-screen rect on every client
   (01 §4.4).
4. **Per-seat mouse path.** New sim code must use the exact `f32`/`Math.trunc`
   operations of the existing `mouseOwner` block, just looped; subtle reassociation
   will drift.
5. **Float/render RNG.** Do not move any draw-time RNG into the tick, and keep the
   `f32` discipline (docs/13).
6. **Config resolution.** All clients run the same build ⇒ same merged `.ini`;
   don't add a client-local gameplay option online.
7. **Input substitution.** A client must never apply its own input to a tick the
   server didn't include it in. Step exactly the received vector.

**Debug aid (dev only):** after each stepped tick, fold a few sim fields
(positions/angles/energy counts + RNG draw count) into a rolling hash and expose
it via `tk4Net`. Two clients can compare hashes in the console without sending
anything on the wire. Not part of the protocol in v1.

## 3. Feature risks

- **Frag-limit source.** `hud.kills` is currently zeros; real per-seat frags live
  in `GameStatistics`/the DM kill accounting (M12). Define one authoritative
  "frags for seat i" read used by both the HUD and the frag-limit check, and make
  it identical everywhere.
- **`givePlayerPrize` generalisation.** Today statistics applies the prize to
  seat 0 only. Online must apply each seat's prize from identical inputs. Nail
  the ordering (seat order) so the resulting cash is identical.
- **Shop seat.** `DynShopData` assumes one shopping player; online shops only the
  local seat. Keep prices seeded and prices/selection purely cosmetic.
- **Progression barrier timing.** `NextLevel` is local in single-player; online
  it is replaced by the server barrier. Ensure the local fade/music transitions
  don't gate the `ready` send (send on the deterministic end tick, show
  statistics while the server waits).
- **Host migration UX.** Mid-match, the promoted host may not know it's host.
  Surface it (lobby badge + a message) and make host-only actions (settings,
  `matchEnd`) role-gated.
- **Cloudflare/Caddy WebSockets.** Verify the upgrade passes through and no idle
  timeout kills a quiet lobby (lobby sends little traffic; consider a periodic
  ping every ~30 s).

## 4. Non-goals / explicitly deferred

Reconnect, spectators, chat, matchmaking, binary framing, server-side simulation,
WebRTC. (Client prediction + rollback is no longer deferred — see docs 09 / N5.)
Each is a separate future milestone and should not leak into the current work
unless the plan is revised.

## 5. Gate list

Before each netplay commit:

```
bun test
bun run typecheck
bun run lint
bun run fmt:check
```

Plus, for N3+: the two-world lockstep determinism test must pass, and
single-player/split-screen snapshot tests must remain byte-identical.
