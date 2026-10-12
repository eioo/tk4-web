/**
 * Client-side prediction with rollback (netplay).
 *
 * Every client runs the same deterministic {@link SimWorld}. To hide the round
 * trip we simulate *ahead* of the server: the local seat's input is applied the
 * instant it is sampled, while other seats reuse their most recent authoritative
 * input. When the server's authoritative bundle for a tick arrives we restore a
 * recent keyframe, replay forward with the corrected inputs, and continue — so
 * the world converges to exactly what every other client computed, while your
 * own movement never waits on the network.
 *
 * `tick` numbers are the server's (see `docs/multiplayer/netcode-prediction.md`). `docs/multiplayer/architecture.md` has the
 * determinism requirements this preserves.
 */

import type { SimInput } from "./protocol";

const ZERO_INPUT: SimInput = { keys: 0, mouseXRel: 0, mouseButtons: 0 };

/** The simulation the client predicts: `GameSession` (see `saveState`/`loadState`). */
export interface LockstepSession<S> {
  saveState(): S;
  loadState(state: S): void;
  step(inputs: readonly SimInput[]): void;
  /** Drop per-tick output (sounds/messages) produced while replaying. */
  discardOutput(): void;
}

export interface LockstepOptions {
  /** Total seats in the match. */
  seats: number;
  /** This client's seat. */
  localSeat: number;
  /** Snapshot every N ticks (rollback replay cost vs. snapshot cost). */
  keyframeInterval?: number;
  /** How many ticks of history to retain. */
  maxHistory?: number;
  /** Max ticks simulated per `update` (catch-up cap). */
  maxStepsPerUpdate?: number;
  /** Called for every forward-predicted tick, so the transport can send input. */
  onPredict?: (tick: number, input: SimInput) => void;
}

/** Most ticks the client will predict before the first server bundle arrives. */
const KMAX_PREROLL = 4;

export class LockstepClient<S> {
  /** Next tick to simulate. */
  tick = 0;
  /** Highest authoritative tick received, or -1 before the match starts. */
  newestServer = -1;
  private lead = 4;
  private started = false;
  private dirtyFrom = Number.POSITIVE_INFINITY;

  private readonly keyframes = new Map<number, S>();
  private readonly predicted = new Map<number, SimInput[]>();
  private readonly authoritative = new Map<number, SimInput[]>();
  private readonly lastSeen: SimInput[];

  private readonly K: number;
  private readonly maxHistory: number;
  private readonly maxSteps: number;
  private readonly onPredict?: (tick: number, input: SimInput) => void;

  constructor(
    private readonly session: LockstepSession<S>,
    private readonly opts: LockstepOptions,
  ) {
    this.K = Math.max(1, opts.keyframeInterval ?? 4);
    this.maxHistory = opts.maxHistory ?? 90;
    this.maxSteps = opts.maxStepsPerUpdate ?? 8;
    this.onPredict = opts.onPredict;
    this.lastSeen = Array.from({ length: opts.seats }, () => ZERO_INPUT);
  }

  /** Target prediction lead, in ticks (~ one round trip). */
  setLead(ticks: number): void {
    this.lead = Math.max(1, Math.min(Math.round(ticks), 40));
  }

  /** Record an authoritative input bundle (all seats, seat-ordered). */
  receive(tick: number, inputs: SimInput[]): void {
    this.started = true;
    if (tick > this.newestServer) this.newestServer = tick;
    this.authoritative.set(tick, inputs);
    for (let i = 0; i < inputs.length && i < this.lastSeen.length; i++) {
      this.lastSeen[i] = inputs[i];
    }
    if (tick < this.dirtyFrom) this.dirtyFrom = tick;
  }

  /** Simulate toward the predicted present (call once per app tick). */
  update(localInput: SimInput): void {
    this.reconcile(localInput);
    const target = this.started
      ? this.newestServer + this.lead
      : Math.min(this.tick + this.maxSteps, KMAX_PREROLL);
    let steps = 0;
    while (this.tick < target && steps < this.maxSteps) {
      this.forward(localInput);
      steps++;
    }
    this.prune();
  }

  /**
   * Roll back to the keyframe at or before the earliest unreconciled bundle and
   * replay to the present with authoritative inputs where known.
   */
  private reconcile(localInput: SimInput): void {
    const from = this.dirtyFrom;
    this.dirtyFrom = Number.POSITIVE_INFINITY;
    if (from === Number.POSITIVE_INFINITY || from >= this.tick) return; // nothing predicted past it yet

    let base = Math.floor(from / this.K) * this.K;
    while (base > 0 && !this.keyframes.has(base)) base -= this.K;
    const state = this.keyframes.get(base);
    if (state === undefined) return;

    const end = this.tick;
    this.session.loadState(state);
    this.session.discardOutput();
    for (let t = base; t < end; t++) {
      const vector =
        this.authoritative.get(t) ?? this.predicted.get(t) ?? this.predictedVector(t, localInput);
      this.predicted.set(t, vector);
      if (t % this.K === 0) this.keyframes.set(t, this.session.saveState());
      this.session.step(vector);
      this.session.discardOutput();
    }
  }

  /** One predicted tick; forwards the local input so the transport can send it. */
  private forward(localInput: SimInput): void {
    const t = this.tick;
    const vector = this.authoritative.get(t) ?? this.predictedVector(t, localInput);
    this.predicted.set(t, vector);
    if (t % this.K === 0) this.keyframes.set(t, this.session.saveState());
    this.onPredict?.(t, localInput);
    this.session.step(vector);
    this.tick++;
  }

  private predictedVector(_t: number, localInput: SimInput): SimInput[] {
    const vector: SimInput[] = [];
    for (let i = 0; i < this.opts.seats; i++) {
      vector.push(i === this.opts.localSeat ? localInput : this.lastSeen[i]);
    }
    return vector;
  }

  private prune(): void {
    const floor = this.tick - this.maxHistory;
    for (const map of [this.keyframes, this.predicted, this.authoritative]) {
      for (const key of map.keys()) if (key < floor) map.delete(key);
    }
  }
}
