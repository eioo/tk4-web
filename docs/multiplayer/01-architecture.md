# 01 — Architecture

## 1. Model: deterministic lockstep

Every client runs the **same `SimWorld` for every seat**, advanced one tick at a
time from the same server-broadcast input bundle. Because the sim is
deterministic, the worlds stay identical without ever exchanging world state.

```
            ┌────────────── Bun WebSocket server ──────────────┐
            │ rooms · codes · roster · phase barriers           │
            │ tick master: every 10 ms, sample latest input/seat │
            │ broadcast tick{tick, inputs[]}                     │
            └───────▲───────────────────────────────┬───────────┘
                    │ input (own seat)              │ tick bundle
        ┌───────────┴──────────┐        ┌───────────┴──────────┐
        │ client A              │        │ client B              │
        │ SimWorld (all seats)  │        │ SimWorld (all seats)  │
        │ render seat A only    │        │ render seat B only    │
        └───────────────────────┘        └───────────────────────┘
```

- The **server never simulates**. It only knows the roster, the settings and the
  latest input per seat.
- A client is authoritative for **its own input only**.
- Gameplay truth is emergent: identical code + identical inputs + identical
  seeds ⇒ identical world on every machine.

## 2. Authority split

| Thing | Authority |
| --- | --- |
| Room membership, codes, roster, seat order | Server |
| Settings (game mode, episode, level, player count, frag limit, enemies, DM speed, target system) | Host → server |
| Tick clock | Server |
| Per-seat input | That seat's client (relayed by server) |
| Level/episode progression barriers | Server |
| World state | Nobody — derived deterministically by every client |
| Persistent per-seat state (cash/weapons/ammo/shield/kills) | Carried in `levelStart`; produced by statistics+shop, consolidated by server |

## 3. Why not server-authoritative

- The sim is heavy (enemies, bullets, effects, body parts, crates, lights) and
  would have to run at 100 Hz per room on the shared production host.
- Snapshot encoding/decoding and interpolation become a whole second codebase.
- It throws away the port's byte-exact determinism instead of exploiting it.

## 4. Determinism requirements

The whole scheme depends on these holding on every client. They already hold for
single-player (the parity harness proves it); netplay must not break them:

1. **Identical seed.** Server generates one 32-bit seed per level and puts it in
   `levelStart`. It replaces `App.enterOngoing`'s `Date.now()` seed. The sim RNG
   (`SimWorld.rng`) and any RNG consumed during session construction
   (`placePlayersForLevel`) must all derive from this seed.
2. **Identical roster and order.** `world.players` is built in seat order from
   `levelStart.states[]`. Names, colours (`KPlayerColor[i]`) and player count are
   the same everywhere.
3. **Identical persistent state.** Cash, `weapons[13]`, `bullets[12]`, `shield`,
   `dead`, frags and anything else carried across levels come from
   `levelStart.states[]`, not from local options.
4. **Identical viewport rects.** `SimPlayer.drawRect` feeds camera/steam-culling
   inside the sim. In online mode every client assigns the **same** single
   full-screen rect to every seat, so the sim can't diverge on it. (This is why
   online renders one view even though all seats are simulated.)
5. **No render RNG in the sim.** Already true (docs/13). `renderRng` stays a
   separate stream.
6. **Deterministic float math.** All the `f32` sites and trig tables from M9 stay
   as they are; netplay adds no new float paths to the sim except the per-seat
   mouse step (below), written the same way on every client.
7. **Identical config resolution.** `levelConfig` / `ensureLevelIngame` do not
   touch the sim, but the same build serves the same merged `.ini`, so gameplay
   constants (`FragText`, enemy gate, etc.) match by construction.
8. **Identical inputs.** The server broadcasts one identical `inputs[]` vector to
   every client; no client ever substitutes its local input for a tick.
9. **Identical sim-affecting host options.** `enemiesOnGame`, `dmSpeed` and
   `dmTargetSystem` change the sim (enemy spawning, DM move speed, target
   system), so the host's values are broadcast in `Settings` and override each
   client's local options for the match.
10. **Identical sensitivity handling.** Each client pre-scales its `mouseXRel` by
    its own `mouseSensitivity` before sending, and online sessions run the sim at
    `mouseSensitivity = 1.0`, so the same sent value yields the same angle on
    every client (per-client feel is preserved, determinism is not lost).

### 4.1 Per-seat mouse (netplay-only sim extension)

Local split-screen has a single mouse with one selectable owner
(`OptionsData.mouseMode`, F4). Online, every seat has its own mouse on its own
machine, so all seats must consume mouse input. Add a `SimWorld` flag:

```
perSeatMouse = false   // default: split-screen/single-player unchanged
```

When `true`, `SimWorld.tick` applies `mouseXRel` / wheel buttons to **every**
seat (same clamping/rotation code as the current `mouseOwner` block, just looped
over seats). The flag is set only for online sessions. It is deterministic
because every client applies the same per-seat vector. Documented here as a
deliberate, non-parity extension.

> The existing `mouseOwner` path is left intact for local play; `perSeatMouse`
> takes precedence when set.

## 5. What "in sync" means operationally

- **Within a level:** identical because of the above. We can cheaply assert it by
  having each client fold a rolling hash of a few sim fields after each tick and
  log disagreement in dev builds (not sent in v1). This is a debugging aid, not a
  protocol feature.
- **Between levels:** identity is re-established from scratch by `levelStart`.
  Any drift inside a level is *contained* to that level; the next `levelStart`
  resets it. This is a major robustness win of rebuilding each level from server
  state rather than carrying the live world across.
- **Inside statistics/shop phases:** the sim is not stepped, so there is nothing
  to desync; only the collected `ready{state}` payload matters for the next
  level.

## 6. Scope boundaries

In scope: online lobby, host/join by code, coop full-episode progression, online
deathmatch with a frag limit, host migration, idle seats.

Out of scope for v1 (documented so we don't creep):
- WebRTC / P2P (WebSocket relay only).
- Client-side prediction / rollback.
- Reconnection to an in-progress match (a leaver is idle; host migration only).
- Matchmaking, accounts, persistence beyond the room lifetime.
- Text chat (the original's Return-key network chat) — candidate for later.
- Spectators.
- Cross-version compatibility: version handshake rejects mismatched builds.
