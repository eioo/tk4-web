# 05 — Game flow

How an online match walks the existing single-player/coop flow, and what changes
to keep every client on the same path.

## 1. Phase overview

```
        ┌──────────┐  start hosting / join
        │  MENU    │──────────────────────────►┌────────┐
        └──────────┘                            │ LOBBY  │◄────────────┐
             ▲                                  └───┬────┘             │
             │ leave / error                        │ roster full      │ matchEnded
             │                                      ▼                  │
             │                                 ┌──────────┐            │
             │                                 │ PLAYING  │            │
             │                                 └────┬─────┘            │
             │                        level end     │   frag limit      │
             │                                      ▼                  │
             │                              ┌──────────────┐           │
             │                              │ INTERMISSION │           │
             │                              │ stats · shop │           │
             │                              └──────┬───────┘           │
             │                          all ready  │  last level       │
             │                                     ▼        └──────────┘
             │                              (next PLAYING)  → victory
             └──────────────────────────────────────────────────────────
                              quit / error / host ends
```

`LOBBY`, `PLAYING` and `INTERMISSION` are server phases (03). On the client they
map to menu screens (`LOBBY`) and the existing `MainState.Game` sub-states
(`PLAYING` = `OnGoing`, `INTERMISSION` = `Statistics` + `Shop`).

## 2. Lobby

- Host: after "start hosting", the client sends `s.host{settings}` and enters the
  lobby screen (06). Shows the join code, the roster, and `n/players`.
- Joiner: enters a code, sends `s.join`; on `c.joined` enters the same lobby.
- Everyone sees `c.lobby` updates live.
- **Auto-start:** the server starts the moment the roster is full; clients react
  to `c.levelStart` and leave the lobby.
- **Cancel:** Esc → `s.leave` → back to the online menu (host: room closes if
  empty; if others remain, host migration picks a new host).

## 3. Playing (coop)

- `c.levelStart` builds the session from server state (04 §5) and enters
  `OnGoing`. From here the flow is the existing port flow with three online
  deltas:
  1. the sim is stepped from server bundles, not local free-running input;
  2. only the local seat's view is rendered (01 §4.1 / 04 §5);
  3. `objectiveFulfilled`/`gameOver` are detected identically everywhere.

- On completion (the sim reaches the same tick everywhere):
  - the first client to notice sends `s.levelEnd{last}`; the server stops the
    tick loop and broadcasts `c.levelEnded{last}`;
  - every client runs `Statistics` locally with the level's data — a straggler
    that had not reached the objective leaves the sim on `c.levelEnded`.

### 3.1 Statistics online

- Statistics uses the shared `GameStatistics` (already fed by the sim), so the
  table, kills, shots and hits are identical everywhere.
- `givePlayerPrize` is applied to **every** seat (not just seat 0) so each
  player's cash/state used for the next level is consistent. (Port today applies
  it to seat 0 only — online generalises it to all seats; single-player keeps
  the existing seat-0 behaviour.)
- The screen is a local view; each client presses continue independently.

### 3.2 Shop online (coop, level ≥ 2)

- Each client shops for **its own seat only**. The existing `DynShopData` and
  `shopBuy`/`shopSell` are reused, with the target player being the local seat.
- `updatePrices` is seeded from `levelStart.shopSeed` so displayed prices match
  across clients (cosmetic consistency; not required for determinism because only
  the resulting state is shared).
- When done, the client sends `s.ready{state: packNetPlayerState(myPlayer)}`.

### 3.3 Ready barrier

- The server waits for `ready` from every seat. Disconnected seats are auto-ready
  with their last known state.
- All seats ready ⇒ server broadcasts the next `c.levelStart`:
  - `states[seat]` = the `ready` payload for each seat (the authoritative
    cross-level state); a seat the server never saw ready (it left early) is
    `null` and the client substitutes a fresh loadout;
  - fresh `seed` and `shopSeed`;
  - `index+1`. Whether it is the last level is derived by each client from the
    episode length, not carried on the message.
- If the last `s.levelEnd` had `last:true`, the server instead sends
  `c.matchEnded{reason:"victory"}`.

## 4. Playing (deathmatch)

- Same level-start/playing mechanics, but:
  - no shop, no level progression; the match is a single level;
  - frag limit is `settings.fragLimit` (host-configurable, default 20).
- The sim tracks per-seat frags (`GameStatistics` / `FragText` accounting from
  M12). Every client detects `frags(seat) >= fragLimit` on the same tick.
- The detecting client sends `s.matchEnd{reason:"fragLimit"}`; the server stops
  ticks and broadcasts `c.matchEnded{reason:"fragLimit"}`.
- The host may also end the match early (`s.matchEnd{reason:"quit"}`) from the
  in-game quit prompt.

## 5. End of match → lobby

- On `c.matchEnded`, clients:
  1. stop the session, clear the level;
  2. return to the room's **lobby screen** with the roster intact (players who
     left remain as idle slots until they leave the lobby or the room closes);
  3. the host may change settings (03 §5) and a new `levelStart` can follow.
- The socket is never recreated for this.

## 6. Disconnects and host migration

- Non-host leaver:
  - lobby: seat removed, `c.lobby`.
  - playing/intermission: seat kept as idle, `c.peerLeft{seat}`; zero input,
    auto-ready. Roster on clients is unchanged.
- Host leaver: promote the lowest connected seat, `c.hostChanged`, `c.lobby`.
  Host-only actions transfer to the new host.
- Room with no connected seats: destroyed after 30 s.

## 7. In-game quit prompt

- `CGameSubStateQuit` (Esc) still works locally.
- Online, confirming quit:
  - coop: acts like `s.matchEnd{reason:"quit"}`; the server returns everyone to
    the lobby.
  - deathmatch: same.
- Online, cancelling quit resumes.

## 8. Interaction with the existing state machine

- `MainState.Menu` hosts the lobby and the host/join screens (new `MenuState`s,
  see 06). No change to the logo/quit/menu machinery itself.
- `MainState.Game` runs `OnGoing`/`Statistics`/`Shop`/`Victory` exactly as today,
  with the online deltas above. `NextLevel` is **not** used online: the server
  barrier drives the next level via a fresh `levelStart`, so the client goes
  `Statistics → (Shop) → ready → (wait) → levelStart → OnGoing` instead of the
  local `NextLevel` sub-state.
- `Victory` is replaced by `c.matchEnded{reason:"victory"}` → lobby, so the
  local victory banner is only used in single-player.
