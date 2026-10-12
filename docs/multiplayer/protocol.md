# Wire protocol

JSON over one WebSocket per client. Every message is an object with a
discriminant field `t`. Binary framing is a possible later optimisation; at
100 Hz with ≤4 seats the JSON bundles are well under 1 KB/s down, so v2 stays
readable.

Clients predict ahead and roll back ([Netcode Prediction](netcode-prediction.md)), so inputs are **tick-stamped**
and the server echoes a `pong` for round-trip estimation.

`s` = client→server, `c` = server→client.

## 0. Constants

```
PROTOCOL_VERSION = 2        // bumped on any breaking message change
KROOM_CODE_LENGTH = 5       // A–Z
KMIN_PLAYERS = 2
KMAX_PLAYERS = 4
KMAX_NAME_LENGTH = 15
KDEFAULT_FRAG_LIMIT = 20
KFRAG_LIMIT_MIN = 5
KFRAG_LIMIT_MAX = 50
KTICK_MS = 10               // 100 Hz tick master
KROOM_EMPTY_GRACE_MS = 30000
KMAX_MESSAGE_BYTES = 4096   // larger frames close the socket
KMAX_INPUT_LOOKAHEAD = 120  // ignore inputs stamped further ahead than this
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
  enemies: boolean;      // host's "enemies on game" (sim-affecting)
  dmSpeed: number;       // host's DM move speed, 0.5..5 (sim-affecting)
  targetSystem: boolean; // host's DM target system (sim-affecting)
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
  curWeapon: number; // equipped weapon index
  secWeapon: number; // secondary (dual single-hand) weapon index
  frags: number;     // deathmatch score / coop kill tally
}
```

## 2. Client → server

### `s.hello`
Not a separate message: version is attached to the first `host`/`join`.

### `s.host`
```json
{ "t": "host", "v": 2, "name": "John", "settings": { ... } }
```
Creates a room; sender takes seat 0 as host. Reply: `c.hosted` or `c.error`.

### `s.join`
```json
{ "t": "join", "v": 2, "name": "Paul", "code": "KQZAB" }
```
Joins an existing lobby (code case-insensitive). Reply: `c.joined` or `c.error`
(`no-room`, `in-progress`, `bad-version`). Because the room auto-starts the
moment the roster is full, `room-full` is only a defensive error.

### `s.input`
```json
{ "t": "input", "tick": 137, "keys": 8, "mouseXRel": 3, "mouseButtons": 0 }
```
One seat's predicted input for tick `tick` ([Netcode Prediction](netcode-prediction.md)). The server emits tick *T*
with the input stamped *T*, using a zero input if none arrived; inputs for
already-emitted ticks or more than `KMAX_INPUT_LOOKAHEAD` ahead are dropped.
Because clients predict ahead by ~one RTT, an input normally arrives before the
server reaches its tick.

### `s.ping`
```json
{ "t": "ping", "id": 3 }
```
Round-trip probe. The server answers `c.pong` with the same `id` even outside a
room; the client smooths the RTT to size the prediction lead.

### `s.loaded`
```json
{ "t": "loaded" }
```
Sent once per level after the client has built its `GameSession` from the
`levelStart`. The server holds the tick loop until **every connected seat** has
sent it (idle seats are ignored, with a 15 s safety timeout), so all clients
begin at tick 0 on the same `(tick, inputs)` sequence.

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
{ "t": "ready", "state": { "name": "...", "cash": 1200, "weapons": [], "bullets": [], "shield": 0, "curWeapon": 0, "secWeapon": 0, "frags": 3 } }
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
  "states": null,
  "roster": [ { "seat": 0, "name": "John" }, { "seat": 1, "name": "Paul" } ]
}
```
`states` is in seat order and is the authority for the level's starting players.
`null` (the whole array) means the episode's first level — clients use the fresh
start loadout. Otherwise each entry is a seat's consolidated post-shop state; a
`null` entry means the server has no known state for that seat (e.g. it left
before its first `ready`), and the client substitutes a fresh loadout for it.

Whether this is the episode's final level is derived by the client from the
episode length (`index >= levelCount - 1`); the server carries no level data.
Server enters `playing` but the tick loop stays paused until every connected seat
sends `s.loaded`.

### `c.levelEnded`
```json
{ "t": "levelEnded", "last": false }
```
Broadcast when the **first** seat reports `s.levelEnd`. Clients that had not yet
reached the objective (a straggler behind on bundles) leave the sim and go to
statistics here instead of stalling once the tick stream stops.

### `c.seat`
```json
{ "t": "seat", "seat": 1 }
```
The client's seat changed (only possible while in the lobby, when another peer
leaves and the roster re-indexes). Clients update `mySeat` for host/self badges
and input routing.

### `c.tick`
```json
{ "t": "tick", "tick": 42, "inputs": [ {"keys":0,"mouseXRel":0,"mouseButtons":0}, ... ] }
```
One entry per seat, in seat order, for the stamped tick. Idle/disconnected seats
and seats whose input has not arrived get a zero input. Emitted at 100 Hz while
`playing`. Clients buffer these and reconcile their prediction against them
([Netcode Prediction](netcode-prediction.md)).

### `c.pong`
```json
{ "t": "pong", "id": 3 }
```
Reply to `s.ping`; the client uses it to size the prediction lead.

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
   │  [build session]    │                        │
   │ s.loaded ──────────►│ ◄──────── s.loaded ────│   (every seat loaded)
   │ s.input ───────────►│                        │
   │ ◄──── c.tick ───────┤──────── c.tick ───────►│  (loop @100 Hz)
   │        …            │            …           │
   │ s.levelEnd ────────►│                        │   (level objective met)
   │ ◄── c.tick stops ───┤                        │
   │  [statistics → shop locally]                 │
   │ s.ready{state} ────►│ ◄─── s.ready{state} ───│
   │ ◄── c.levelStart ───┤───── c.levelStart ────►│   (index+1, states[])
   │        …            │            …           │
   │  [final level done → levelEnd{last:true} → ready] │
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
- Unknown `t` values are ignored.
- Unparseable JSON and messages failing validation are dropped (no partial
  state kept) without closing the socket; oversized frames close it.

## 7. Bandwidth notes

- `tick` down: ≤4 seats × ~40 bytes ≈ 160 B + framing, 100 Hz ⇒ ~16 KB/s/client.
- `input` up: ~50 B, 100 Hz ⇒ ~5 KB/s/client.
- Everything else is event-driven and rare.

If that ever matters, the first optimisation is a compact binary `tick` (fixed
layout: tick u32, then 4× `{u16 keys, i8 mouseXRel clamped, u8 buttons}`) behind
the same message name; JSON stays for every other message.
