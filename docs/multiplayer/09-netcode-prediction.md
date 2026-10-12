# 09 — Prediction and rollback

The first lockstep implementation (docs 01–08) waited for the server's input
bundle before advancing the local seat, so *your* movement and turning lagged by
a full round trip. This document replaces that with **client-side prediction and
rollback** (the "GGPO" model), while keeping the deterministic shared world from
doc 01.

## 1. The idea

Every client still runs the same deterministic `SimWorld`. To hide latency it
simulates **ahead of the server**:

- the **local seat** is driven by the input just sampled — it takes effect the
  instant you move, with no round trip;
- every other seat is driven by its **most recent authoritative input** (hold
  last value);
- the server broadcasts the authoritative input vector for each tick;
- when a bundle arrives the client **rewinds** to a recent keyframe and replays
  forward with the corrected inputs, so everyone converges on the identical
  world.

There is no snapshot replication of entities: the wire still carries only inputs.
The server stays a dumb lobby + tick master.

## 2. Tick numbering

`tick` is the server's tick, zero-based and reset by every `levelStart`. Clients
start their predictor at tick 0 when the level begins (the `s.loaded` barrier,
doc 03, means the server is not ticking yet).

`s.input` carries the tick the input applies to:

```json
{ "t": "input", "tick": 137, "keys": 8, "mouseXRel": 3, "mouseButtons": 1 }
```

The server emits tick *T* using the input **stamped** *T* (or a zero input if it
has not arrived; inputs for already-emitted or implausibly-far ticks are
dropped). Tick-stamped inputs are what make rollback exact: a given input is
applied at the same tick on every client and on the server.

## 3. Pacing

The client runs its local tick up to `newestServer + lead`, where `newestServer`
is the highest authoritative tick received and `lead` is about one round trip:

```
lead = clamp(ceil(rttMs / 10) + 2, 1, 40)      // ping/pong rounds the RTT
target = newestServer + lead
```

`update()` advances toward `target`, at most `maxStepsPerUpdate` ticks per app
tick (initial catch-up / after a stall). Running a round trip ahead is what lets
an input be stamped for a tick the server has not reached yet, so it is applied
where it was predicted instead of being corrected a round trip later.

## 4. Reconciliation

`receive(tick, inputs)` records the authoritative vector and remembers the
earliest unreconciled tick. On the next `update()`:

1. find the keyframe at or before that tick (`base`);
2. `loadState(base)`;
3. replay `base .. present`, using the authoritative vector where one exists and
   the previously predicted vector otherwise;
4. discard the per-tick output (sounds/messages) produced by the replay
   (`discardOutput`) so corrections are silent.

Keyframes are taken every `keyframeInterval` ticks (default 4) and history is
retained for `maxHistory` ticks (default 90). Tuning: smaller keyframe interval
means cheaper replays but more snapshot cost; a far deeper history is
unnecessary because rollback depth is bounded by `lead + keyframeInterval`.

## 5. What is snapshotted

A rollback snapshot must cover **everything the sim mutates**, or a replay
double-applies it:

- `SimWorld.saveState()` — players, bullets, effects, new/old effects, body
  parts, enemies, crates, dead enemies, the config flags and the RNG state;
- `GameSession` counters — `timerCounter`, `completeTime`, `nextLevel`;
- `GameStatistics` — the sim records shots/hits/kills into it every tick.

Invariant data (level, sprites, fonts, mode, options) is shared, not copied.
Player objects are restored **in place** so the session/app references to
`players[i]` keep working.

## 6. Failure modes and bounds

- **`lead` too small** (RTT under-estimated): the server emits a tick before the
  input arrives, uses zeros, and the client corrects its own seat — a small
  stutter. `lead = RTT + 2` avoids it; the ping estimate is smoothed.
- **Remote prediction is "hold last input"** — remote players are rendered about
  a round trip in the past and corrected on arrival. That is inherent; making
  local movement instant costs remote latency.
- **Snapshot cost** is ~0.4 µs/entity; keyframing every 4 ticks is a few ms/s
  even for busy scenes.
- **A dropped/corrupt bundle** cannot permanently desync: the next bundle
  reconciles to the authoritative timeline.

## 7. Non-goals (v1)

- No render interpolation/extrapolation of remote entities.
- No snapshot-delta compression (input-only transport is already tiny).
- No server-side simulation.

## 8. Tests

- `src/net/__test__/lockstep.test.ts` — the driver against a trivial world:
  immediate local effect, convergence under latency, rewinding a wrong
  prediction.
- `src/net/__test__/rollback-sim.test.ts` — two clients at **different latencies
  and seats** against the real `SimWorld`, both byte-identical to an in-order
  reference (players, bullets, enemies, crates and statistics).
- `src/sim/__test__/world.test.ts` — per-seat-mouse determinism regardless of
  each client's `mouseOwner`.
