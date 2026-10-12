# 07 — Implementation plan

Ordered milestones, each independently testable. "Done" = acceptance criteria
pass, gates green (`bun test`, `bun run typecheck`, `bun run lint`,
`bun run fmt:check`), committed.

Legend: 🎯 deliverable · ✅ acceptance · ⚠️ risk.

---

## Status

- ✅ **N1** — protocol, rooms, Bun servers (`f65fd04`).
- ✅ **N2** — client transport + multiplayer menus/lobby (`18ca70f`).
- ✅ **N3** — online game: per-seat mouse, single-view session, `levelStart`
  start, lockstep stepping, statistics/shop ready barrier, match endings,
  disconnect/host migration.
- ✅ **N4** — polish, docs, deployment.
- ✅ **N5** — client-side prediction + rollback (docs 09, `e1cc77a`); protocol
  v2 (tick-stamped inputs, ping/pong).

Implementation notes vs. the design docs: `levelStart` no longer carries `last`
(clients derive it from the episode length); `states` may be `null` or contain
per-seat `null` entries; `NetPlayerState` gained `curWeapon`/`secWeapon`; the
lobby re-indexes seats on a leave and resyncs peers with `c.seat`; malformed
messages are dropped rather than closing the socket. N5 supersedes the
"no prediction" stance of docs 01/04 — see **09**.

---

## N1 — Protocol, rooms, server

🎯 Shared protocol types, a pure `RoomManager`, the Bun WS servers, and wiring.

### N1a — protocol
- `src/net/protocol.ts`: constants, `ClientMessage`/`ServerMessage` unions,
  `SimInput`/`Settings`/`PlayerSlot`/`RoomInfo`/`NetPlayerState`, `parse`/`encode`.
- Unit test: round-trip encode/parse for every message; malformed input rejected.

### N1b — room manager
- `src/net/room.ts`: `RoomManager` + `Room` over a `Peer` interface; no Bun/DOM.
- Behaviours: code generation/uniqueness, create/join/leave, capacity, seat
  order, auto-start, 100 Hz tick sampling (fake clock), `levelEnd`/`ready`
  barrier, `matchEnd`, host migration, idle seats, empty-room cleanup.
- Unit tests drive the room with fake peers and a fake timer; assert the exact
  `ServerMessage` stream (including `tick` input vectors).

### N1c — transports
- `tools/net-server.ts`: standalone `Bun.serve` WS host (`bun run net`, port from
  `NET_PORT`, default 4174); `package.json` script `"net"`.
- `tools/serve.ts`: add `GET /ws` upgrade + `websocket` handlers using a
  `RoomManager`; keep the static behaviour byte-for-byte for non-WS requests.
- `vite.config.ts`: `server.proxy["/ws"] = { target: "ws://localhost:4174", ws: true }`.
- `src/net/url.ts` (or in `client.ts`): resolve `?net=` override else same-origin.

✅ `bun test` covers N1a/N1b. A two-client `Bun` integration test (or a script)
can host a room, join it, and observe `levelStart` + `tick` broadcasts.

⚠️ Verify Cloudflare/Caddy pass the WebSocket `Upgrade` through to `tools/serve.ts`
(same-port so no extra DNS/TLS). Test on the production host before announcing.

---

## N2 — Client transport + menus (lobby, no game yet)

🎯 Real client, new menu screens, host/join/lobby working end-to-end.

### N2a — NetClient
- `src/net/client.ts`: connect, typed send/receive, status, event queue,
  reconnect-free lifecycle, `s.input` sender (tick-stamped in N5), RTT ping.
- `src/net/state.ts`: `NetPlayerState` ⇄ `SimPlayer` (persistent fields only).

### N2b — menus
- `MenuState` additions + trees: `MultiplayMode`, `Online`, `HostSetup`, `Join`
  (06). `MultiplayMenu.prevMenu()` → `MultiplayMode`.
- New items: `PlayerCountItem`, `FragLimitItem`, `JoinCodeItem`,
  `StartHostingItem`, `JoinGameItem`.
- `OptionsData.dmFragLimit` (+ storage parse/clamp/validate).

### N2c — lobby
- `LobbyMenu` (rebuilds items on draw), `MenuHost` net methods, App polling
  (§06.4–5).
- Host settings edits in the lobby broadcast `c.lobby`.

✅ Two browser clients (or one browser + one scripted WS client) can: host → get a
5-char code → second client joins by code → both see a live roster → host edits
settings → both see the update → a client leaves → roster updates. Auto-start is
**not** exercised until N3 (use `players > current` to stay in the lobby).

⚠️ Lobby item rebuild vs active selection; keep the exit item selected.

---

## N3 — Online game

🎯 The actual networked match.

### N3a — sim per-seat mouse
- `SimWorld.perSeatMouse` flag; when set, apply each seat's mouse input (same
  clamping as the `mouseOwner` block). Default off ⇒ parity unchanged.
- Test: two `SimWorld`s fed identical per-seat bundles stay byte-identical over
  N ticks; the flag does not change single-mouse behaviour when off.

### N3b — single-view session
- `GameSession` takes a `visibleSeats: number[]` (default all) and an explicit
  draw-rect assignment. Online: every seat gets the same full-screen rect,
  `visibleSeats = [mySeat]`; render one view + global HUD once.
- Test: draw loop visits only the visible seats; v1 single-player/split-screen
  behaviour unchanged (existing viewport tests still pass).

### N3c — start from `levelStart`
- Generalise `App.startGame`/`enterOngoing` with an origin; online builds
  players from `states[]`, uses `seed`/`shopSeed`.
- `packNetPlayerState`/`fromNetPlayerState` round-trip test.

### N3d — lockstep stepping
- Gate `runOngoing`'s sim step on a bundle; sample+send own input each tick while
  playing.

### N3e — progression
- `s.levelEnd{last}` → `Statistics` (prizes for **all** seats) → coop `Shop`
  per **own** seat → `s.ready{state}`.
- Server barrier → next `levelStart`; `last` → `matchEnded{victory}`.
- Deathmatch: frag-limit detection, `s.matchEnd{fragLimit}`, `matchEnded`.
- `c.matchEnded` → lobby.

### N3f — disconnects
- `c.peerLeft` → idle seat; `c.hostChanged` → host UI; room cleanup.

✅ Two clients play an online coop level start-to-finish and a second level via
the shop/ready barrier; positions/angles/enemies/crates stay identical (dev
hash or side-by-side screenshots). A two-client deathmatch ends at the frag limit.
A mid-match disconnect leaves the other client running with an idle seat; killing
the host migrates host and the match continues.

⚠️ Determinism is the whole ballgame; see 08 §2. Frag-limit derivation (where
per-seat frags live) and `givePlayerPrize` generalisation are the two riskiest
sub-tasks.

---

## N4 — Polish, docs, deployment

🎯 Hardening and shipping.

- Surface `c.error` codes as readable messages; connection status/ping in the
  lobby.
- Dev hooks `window.tk4Net` + `src/globals.d.ts`.
- Lobby status/roster edge cases (name length, duplicate names).
- Update `docs/09`, `docs/12` (M13 → done), `docs/13` (netplay hazards), root
  `README.md`, and this directory's status line.
- Production: confirm `tools/serve.ts` WS works behind Caddy/Cloudflare; document
  `bun run start` serving both static and WS.
- Tests: room manager edge cases, protocol fuzz, lockstep determinism,
  `NetPlayerState` round-trip, menu trees.

✅ Full flow works on `tk4.space` between two real machines: host, code, join,
coop level(s), DM frag limit, host migration, back to lobby.

---

## Cross-cutting

- Keep every netplay behaviour behind an explicit online origin so single-player
  and split-screen stay byte-identical (parity unaffected).
- Commit per sub-milestone (N1a, N1b, …) with the gates green.
- No new runtime dependency: Bun + the existing toolchain only.
