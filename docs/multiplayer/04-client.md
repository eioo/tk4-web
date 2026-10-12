# 04 — Client

The client owns transport, its own input, and lockstep stepping. Everything else
reuses the existing `App` state machine and `SimWorld`.

## 1. Files

| File | Purpose |
| --- | --- |
| `src/net/client.ts` | `NetClient`: WebSocket wrapper, typed send/receive, connection status, event queues. |
| `src/net/protocol.ts` | Shared message types/constants (with the server). |
| `src/net/state.ts` | `NetPlayerState` ⇄ `SimPlayer` conversion (persistent fields only). |

`NetClient` has no DOM UI; `App` reads its state each tick and drives menu
transitions.

## 2. Connection

- URL resolution: `?net=` query override, else `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`.
- On open: send `s.host` or `s.join` (whichever the user chose) with `PROTOCOL_VERSION`.
- Status: `idle | connecting | lobby | playing | intermission | error | closed`.
- On `c.error`: surface the message via the message board (or a small dialog) and
  return to the online menu.
- On unexpected `close`: if in a match/lobby, show "Connection lost" and return to
  the online menu. (Host migration means only the host's own client needs to
  react to its own loss, but a lost connection is lost for that client either
  way.)

## 3. Input sampling

While `playing`, once per local tick:

```
keys        = seatKeyMask(heldCodes, opts.data.keys[0])   // the client IS player 1
mouseXRel   = accumulated mouse movement this tick
mouseButtons= left/right/wheel bits
send s.input { keys, mouseXRel, mouseButtons }
```

Reuse `App.gameInput`'s existing helpers: the online client is a single seat, so
it uses `options.data.keys[0]` and its own mouse, exactly like single-player.
`mouseXRel`/buttons are already accumulated in `App.mouseDX`/`rawButtons`/
`wheelTicks`, reset in `tick()`.

> Key difference from split-screen: online has one mouse per machine, so
> `perSeatMouse` applies each seat's own vector (see 01 §4.1). The client still
> only ever fills its own seat's vector; the server fills the rest.

## 4. Bundle buffer and lockstep stepping

`NetClient` queues received `c.tick` bundles. In `App.tick()` while online and
`gameState === OnGoing`:

```
net.sendInput(myInput)                  // sample + send each app tick
let steps = 0
while (steps < KMaxOnlineCatchUp && (bundle = net.takeTick())) {
    session.step(bundle.inputs)         // apply bundles in order
    steps++
}
if (steps === 0) return                 // lockstep wait: nothing arrived yet
```

- Non-sim per-frame work (message board age, fades, FPS) still runs; only the sim
  step is gated.
- Applying several bundles per app tick lets a briefly-stalled client (a slow
  frame, the `core/loop.ts` catch-up cap, a tab hiccup) drain the backlog while
  preserving the exact `(tick, inputs)` sequence, so worlds stay identical; a
  cap (`KMaxOnlineCatchUp = 5`) bounds the work per frame.
- A deep buffer (64 bundles) absorbs jitter; when it is empty the client stalls
  (renders the last frame) rather than invent input.
- Because the server broadcasts every bundle to every client, the *sequence* a
  client steps is the same everywhere, so worlds stay identical regardless of
  local timing.

## 5. Starting a level

On `c.levelStart`:

1. `App` builds `players[]` from `states[]` via `playerFromNetState` (cash,
   weapons, bullets, shield, cur/secondary weapon, name) — **not**
   `makeStartPlayer` when a state is present. A `null` state (first level or an
   unknown seat) uses the fresh start loadout.
2. Resolve the episode/level for `settings` (already cached by the host flow) and
   `ensureLevelIngame`.
3. Construct `GameSession` with:
   - `seed = levelStart.seed` (replaces the `Date.now()` seed),
   - `players` in seat order,
   - online mode options: single full-screen draw rect for every seat,
     `visibleSeats = [mySeat]`, `perSeatMouse = true`,
   - `stats` rebuilt/continued from the states (kills/frags).
4. `shopSeed` seeds the shop RNG used by `updatePrices`.
5. Enter `GameState.OnGoing` (a local fade is fine: it doesn't touch the sim).
   When the session is built, send `s.loaded` — the server holds the tick loop
   until every seat is loaded, so all clients start at tick 0 together (§4).

The existing `startGame`/`enterOngoing` path is generalised to accept an origin:
`"single" | "splitscreen" | "online"`, plus (for online) the seed, states, seat
and online flags.

## 6. Level end, statistics, shop, ready

- The sim deterministically reaches `objectiveFulfilled` / `gameOver` /
  frag-limit at the same tick on every client.
- On coop completion: the first client to notice sends `s.levelEnd{last}` (all
  will notice on the same tick; the server ignores duplicates). Clients then run
  the normal statistics screen locally. `last` is computed from the episode's
  level count.
- Coop shop: from level 2, each client's own player shops on its own machine
  (only its own seat). Because online is one player per machine, the shop's
  existing "seat 0 only" assumption is replaced by "my seat only".
- When statistics (and shop) are done, the client sends `s.ready{state}` with its
  seat's final `NetPlayerState`.
- Deathmatch: on frag limit, a client sends `s.matchEnd{reason:"fragLimit"}`;
  clients stop the sim.

`packNetPlayerState(player, frags)` is the inverse of §5's conversion.

## 7. Return to lobby

On `c.matchEnded`, all clients return to the room's lobby (roster retained) using
the same `NetClient`/socket. The host may edit settings; `c.lobby` re-renders.
Clients never recreate the socket for this.

## 8. App integration points

- `App` gains a nullable `net: NetClient | null`.
- `App.tick()`: call `net.poll()` (drain events) before `runState()`; when online
  and ongoing, gate the sim step on a bundle (§4).
- `App` exposes `MenuHost` net methods used by the new menus (06):
  `startHosting`, `joinGame`, `leaveNet`, `netLobby`, `netStatus`, `netSeat`.
- Dev hooks: `window.tk4Net(action, arg)` exposes host/join/leave plus a state
  snapshot (status, seat, room, main/sub state) for headless/loopback
  verification. Typed in `src/globals.d.ts`.
