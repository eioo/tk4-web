# 03 — Server

Bun WebSocket server. One process shares rooms across all connections; it never
runs the simulation.

## 1. Files

| File | Purpose |
| --- | --- |
| `src/net/protocol.ts` | Message types, constants, `parse`/`encode` helpers. Shared by client and server. |
| `src/net/room.ts` | `RoomManager` + `Room`: pure room/lobby/tick logic, no Bun APIs → unit-testable. |
| `tools/net-server.ts` | Standalone dev server (`bun run net`), binds a port and wires `Bun.serve` to an `RoomManager`. |
| `tools/serve.ts` | Production: same static host, plus `fetch` upgrade on `/ws` and the `websocket` handler using an `RoomManager`. |

`src/net/room.ts` deliberately imports no Bun/DOM types. The transport adapters
(`net-server.ts`, `serve.ts`) translate `Bun.ServerWebSocket` events into plain
calls and write outbound messages through a small `Peer` interface:

```ts
interface Peer { id: string; send(message: ServerMessage): void; close(): void }
```

so the room manager can be driven from tests with fake peers.

## 2. Room lifecycle

```
create(code, hostPeer, settings)
  → phase "lobby", players [slot0(host)]
  → auto-start when connected players == settings.players

join(code, peer, name)
  → reject unless phase "lobby", not full, name/code valid
  → append slot(seat = players.length), broadcast lobby
  → auto-start when connected players == settings.players

leave/disconnect(peer)
  → lobby: remove slot, compact seats (re-index), send c.seat to shifted peers,
           broadcast lobby, close room after the grace period if empty
  → playing/intermission: keep slot as idle (connected=false)
      · if it was the host → promote lowest connected seat, broadcast hostChanged
      · broadcast peerLeft
      · if no connected seats remain → close room after grace period (30 s)

destroy
  → stop tick loop, drop inputs, remove from the global map
```

### 2.1 Codes

- 5 uppercase `A–Z`, generated from `crypto.getRandomValues` (rejection-free by
  mapping bytes mod 26; ~11.9 M combinations).
- Must not collide with a live room (retry on collision).
- Case-insensitive on join (normalised to uppercase).
- Freed when the room closes.

### 2.2 Seat order

Seats are assigned in join order and are stable while a match is running. Seat 0
is the initial host. `RoomInfo.players` is always dense and seat-ordered; a
disconnected seat stays in the array with `connected:false` (idle). In the
**lobby**, a leaver is removed and the remaining seats are re-indexed to stay
dense, with each shifted peer notified by `c.seat`.

## 3. Tick master

`startLevel` broadcasts `c.levelStart` and enters `playing`, but the tick loop
stays **paused until every connected seat sends `s.loaded`** (a 15 s timeout
starts it anyway). This is the lockstep start barrier: if clients began ticking
at different server ticks they would apply different input sequences and
diverge. Once all seats are loaded, the loop starts at `tick = 0`:

While `phase === "playing"` the room runs an interval of **10 ms** (100 Hz):

```
for each slot in seat order:
    input = tickBuffer[seat][tick]        // stamped for this tick, if arrived
    inputs.push(input ?? ZERO_INPUT)      // idle / late / disconnected
broadcast tick{ tick, inputs }
tick++
```

- Clients predict ahead (docs 09) and stamp each `s.input` with the tick it
  applies to, so an input normally arrives before its tick. The server never
  waits: a seat with no stamped input for this tick contributes `ZERO_INPUT`.
- Inputs for already-emitted ticks or more than `KMAX_INPUT_LOOKAHEAD` ahead are
  dropped; stale entries are pruned periodically.
- `tick` starts at 0 for each `levelStart` and increments monotonically. It is
  the shared timeline: clients index their prediction and rollback by it.
- The tick loop is cleared on `levelEnd`, `matchEnd`, host migration is a no-op
  for the loop, and on room close.

Interval drift is fine: every client applies the same *sequence* of input
vectors, and rollback corrects any local timing difference.

## 4. Phases and barriers

Server-side phase machine (`RoomInfo.phase`):

| Phase | Entered by | What the server does |
| --- | --- | --- |
| `lobby` | create / after `matchEnded` | accept joins/leaves, apply settings changes, roster broadcast, auto-start |
| `playing` | `levelStart` | 100 Hz tick loop, accept `input` |
| `intermission` | `levelEnd` | tick loop stopped, collect `ready` from every seat |

- **Auto-start:** in `lobby`, when `connectedCount === settings.players`, the
  server sends `levelStart` to all and enters `playing`. If a player leaves the
  lobby before that, no start.
- **Coop level end:** first `levelEnd` ⇒ stop ticks, `intermission`, remember
  `last`. Each seat sends `ready{state}`; disconnected seats are auto-ready with
  their last known state. When all seats are in:
  - `last === true` ⇒ `matchEnded{reason:"victory"}`, → `lobby`.
  - else ⇒ `levelStart{index+1, seed, shopSeed, states}` where `states` is the
    consolidated per-seat states, → `playing`.
- **Deathmatch end:** first `matchEnd{reason:"fragLimit"|"quit"}` ⇒ stop ticks,
  `matchEnded{reason}`, → `lobby`.
- Settings changes are only accepted in `lobby`, from the host seat.

## 5. Settings changes

In `lobby`, the host may send `s.host`-style settings updates (reuse `s.host`
with `update:true`, or a dedicated `s.settings` — see 02/06). The server
validates:

- `players` in 2..4 and `>=` current connected count (shrinking below the seated
  count is rejected).
- `gameMode` ∈ {0,1}; `episode`/`level` ≥ 0 (the *client* clamps against its own
  episode list before sending).
- `fragLimit` in 5..50.

On success, broadcast `c.lobby` so every client re-renders.

## 6. Host migration

If the host's socket closes (or it sends `leave`) while the room has other
connected seats:

1. Pick the lowest-seat **connected** player.
2. Set `hostSeat` to that seat.
3. Broadcast `c.hostChanged{seat}` and `c.lobby`.

The old host becomes a normal idle slot if the room is playing, or is removed if
still in lobby. Host-only actions (settings, and sending `matchEnd`/starting the
next level) are now accepted from the new host.

## 7. Idle seats

- Only used during `playing`/`intermission` (a lobby leaver is removed).
- The roster never changes mid-level on clients: the seat keeps its position and
  identity, and the sim keeps a `SimPlayer` for it.
- Input is always `ZERO_INPUT`.
- It counts as `ready` (with its last known state) at every barrier, so a match
  can finish with idle seats.

## 8. Cleanup & limits

- An empty room (no connected seats) is destroyed after a 30 s grace period.
- Per-connection message rate is capped (e.g. 300 messages/s) to avoid abuse;
  exceeding it closes the socket.
- Max message size ~4 KB (a `ready` with two 15-element arrays is well under).
- No persistence: rooms live only in memory; a server restart drops them.

## 9. Production topology

- **Dev:** `bun run net` starts `tools/net-server.ts` on `NET_PORT` (default
  4174). Vite proxies `/ws` to it (`vite.config.ts`), so the client always uses a
  same-origin `ws://<host>/ws` URL.
- **Prod:** `tools/serve.ts` already serves `dist/`; it gains
  `fetch → server.upgrade(req)` for `GET /ws` and the `websocket` handlers. One
  process, one origin, no extra port.
- `?net=ws://host:port/ws` query override exists for debugging against another
  host; otherwise the client derives the URL from `location`.
