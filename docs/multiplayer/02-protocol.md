# 02 — Wire protocol

JSON over one WebSocket per client. Every message is an object with a
discriminant field `t`. Binary framing is a possible later optimisation; at
100 Hz with ≤4 seats the JSON bundles are well under 1 KB/s down, so v1 stays
readable.

`s` = client→server, `c` = server→client.

## 0. Constants

```
PROTOCOL_VERSION = 1        // bumped on any breaking message change
KROOM_CODE_LENGTH = 5       // A–Z
KMIN_PLAYERS = 2
KMAX_PLAYERS = 4
KDEFAULT_FRAG_LIMIT = 20
KFRAG_LIMIT_MIN = 5
KFRAG_LIMIT_MAX = 50
```

## 1. Shared types

```ts
// One seat's input for one tick — identical shape to src/sim/world.ts SimInput.
interface SimInput { keys: number; mouseXRel: number; mouseButtons: number }

interface Settings {
  gameMode: 0 | 1;   // 0 = cooperative, 1 = deathmatch
  episode: number;   // index into the client's episode list
  level: number;     // start level (coop: episode start; DM: 0)
  players: number;   // 2..4  — number of seats to fill before auto-start
  fragLimit: number; // deathmatch only
}

interface PlayerSlot {
  seat: number;      // 0-based, stable for the room's lifetime
  name: string;
  connected: boolean;
}

interface RoomInfo {
  code: string;
  hostSeat: number;
  settings: Settings;
  players: PlayerSlot[];
  phase: "lobby" | "playing" | "intermission";
}

// Everything a seat carries across levels (CDynGameData persistence).
interface NetPlayerState {
  name: string;
  cash: number;
  weapons: number[]; // len 13
  bullets: number[]; // len 12
  shield: number;
  frags: number;     // deathmatch score / coop kill tally
}
```

## 2. Client → server

### `s.hello`
Not a separate message: version is attached to the first `host`/`join`.

### `s.host`
```json
{ "t": "host", "v": 1, "name": "John", "settings": { ... } }
```
Creates a room; sender takes seat 0 as host. Reply: `c.hosted` or `c.error`.

### `s.join`
```json
{ "t": "join", "v": 1, "name": "Paul", "code": "KQZAB" }
```
Joins an existing lobby (code case-insensitive). Reply: `c.joined` or `c.error`
(`no-room`, `room-full`, `in-progress`, `bad-version`).

### `s.input`
```json
{ "t": "input", "keys": 8, "mouseXRel": 3, "mouseButtons": 0 }
```
Sent every local tick while `phase === "playing"`. The server keeps only the
latest per seat (it samples; it does not queue). No `tick` field: clients do not
predict ticks.

### `s.levelEnd`
```json
{ "t": "levelEnd", "last": false }
```
Sent by the **first** client (any seat) that deterministically reaches the end
of a coop level. `last` = this was the episode's final level. Server stops the
tick loop and enters `intermission`.

### `s.matchEnd`
```json
{ "t": "matchEnd", "reason": "fragLimit" }
```
`reason` ∈ `fragLimit | quit`. Sent by any client that detects the end of a
deathmatch (frag limit reached) or when the room decides to stop. Server accepts
the first per match and ignores the rest.

### `s.ready`
```json
{ "t": "ready", "state": { "name": "...", "cash": 1200, "weapons": [], "bullets": [], "shield": 0, "frags": 3 } }
```
Sent once per level by each client when it has finished statistics and (if any)
its shop. The `state` is this seat's final persistent state; the server
consolidates the `states[]` for the next `levelStart`.

### `s.leave`
```json
{ "t": "leave" }
```
Leaves the room (lobby: seat removed, room may close). Reply `c.left`.

## 3. Server → client

### `c.hosted` / `c.joined`
```json
{ "t": "hosted", "code": "KQZAB", "seat": 0, "room": { ... } }
{ "t": "joined", "code": "KQZAB", "seat": 2, "room": { ... } }
```
Confirms the seat and the current roster/settings.

### `c.lobby`
```json
{ "t": "lobby", "room": { ... } }
```
Roster or settings changed while in `lobby` phase: a player joined/left, the host
changed settings, or a host migration happened. Clients re-render the lobby.

### `c.error`
```json
{ "t": "error", "code": "room-full", "message": "Room is full." }
```

### `c.levelStart`
```json
{
  "t": "levelStart",
  "index": 0,
  "seed": 123456789,
  "shopSeed": 987654321,
  "last": false,
  "states": [ { ...NetPlayerState... }, ... ],
  "roster": [ { "seat": 0, "name": "John" }, { "seat": 1, "name": "Paul" } ]
}
```
`states` is in seat order and is the authority for the level's starting players
(coop episode start or the consolidated post-shop state). `last` tells clients
whether this is the episode's final level (coop). Server enters `playing` and
starts the tick loop.

### `c.tick`
```json
{ "t": "tick", "tick": 42, "inputs": [ {"keys":0,"mouseXRel":0,"mouseButtons":0}, ... ] }
```
One entry per seat, in seat order. Idle/disconnected seats get a zero input. The
server emits these at 100 Hz while `playing`.

### `c.peerLeft`
```json
{ "t": "peerLeft", "seat": 1 }
```
A non-host peer disconnected. Clients mark the seat idle (keep simulating it
with zero input) — the sim does not change roster mid-level.

### `c.hostChanged`
```json
{ "t": "hostChanged", "seat": 2 }
```
Host migration. Clients update any host-only UI (lobby "host" badge, settings
editing).

### `c.matchEnded`
```json
{ "t": "matchEnded", "reason": "fragLimit" }
```
`reason` ∈ `fragLimit | victory | quit`. Clients stop the match and return to the
room's lobby. The roster is retained.

### `c.left`
```json
{ "t": "left" }
```
Ack for `s.leave`; the client returns to the online menu.

## 4. Sequence — coop level and progression

```
client A (host)        server                 client B
   │ s.host ────────────►│                        │
   │ ◄──── c.hosted ─────│                        │
   │                     │ ◄──────── s.join ──────│
   │ ◄──── c.lobby ──────┤──────────── c.lobby ───►│
   │   (roster now full → auto start)             │
   │ ◄─── c.levelStart ──┤──── c.levelStart ─────►│
   │ s.input ───────────►│                        │
   │ ◄──── c.tick ───────┤──────── c.tick ───────►│  (loop @100 Hz)
   │        …            │            …           │
   │ s.levelEnd ────────►│                        │   (level objective met)
   │ ◄── c.tick stops ───┤                        │
   │  [statistics → shop locally]                 │
   │ s.ready{state} ────►│ ◄─── s.ready{state} ───│
   │ ◄── c.levelStart ───┤───── c.levelStart ────►│   (index+1, states[])
   │        …            │            …           │
   │  [final level done → ready with last:true]   │
   │ ◄── c.matchEnded ───┤──── c.matchEnded ─────►│  (reason: victory)
   │  [back to lobby]                             │
```

## 5. Sequence — disconnect & host migration

```
client A (host)   server              client B (new host)
   │  (socket close) │                        │
   │ ✗──────────────►│  A is host → promote B  │
   │                 │─── c.hostChanged ─────►│
   │                 │─── c.peerLeft{seat 0} ►│   (A becomes idle seat)
   │                 │─── c.lobby ───────────►│
   │                 │  ticks continue, A = zero input
```
A non-host leaving is only `c.peerLeft`. An empty room is destroyed by the
server after a short grace period.

## 6. Versioning & errors

- The server rejects `v !== PROTOCOL_VERSION` with
  `error{code:"bad-version"}`; the client shows "server/client version mismatch"
  and returns to the online menu.
- Unknown `t` values are ignored server-side (forward compatibility).
- Malformed JSON closes the socket (no partial state kept).

## 7. Bandwidth notes

- `tick` down: ≤4 seats × ~40 bytes ≈ 160 B + framing, 100 Hz ⇒ ~16 KB/s/client.
- `input` up: ~50 B, 100 Hz ⇒ ~5 KB/s/client.
- Everything else is event-driven and rare.

If that ever matters, the first optimisation is a compact binary `tick` (fixed
layout: tick u32, then 4× `{u16 keys, i8 mouseXRel clamped, u8 buttons}`) behind
the same message name; JSON stays for every other message.
