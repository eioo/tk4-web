/**
 * Fixed-timestep animation loop.
 *
 * Mirrors the original game's clock: a fixed 100 Hz simulation tick
 * (`KTimerFreq = 100` in the original) driven from display frames, with a
 * catch-up loop when a display frame is slow.
 *
 * See docs/02-engine-architecture.md and docs/10-web-port-architecture.md.
 */

/** Default simulation tick rate, in Hz (`KTimerFreq` in the original). */
export const DEFAULT_TICK_HZ = 100;

/** Default maximum number of simulation ticks run per rendered frame. */
export const DEFAULT_MAX_CATCH_UP = 5;

export interface TickDrain {
  /** Number of whole ticks that fit in the elapsed time. */
  ticks: number;
  /** Remaining accumulator time, in ms, after consuming the ticks. */
  remainder: number;
  /** Whether the catch-up cap was hit and the backlog was dropped. */
  dropped: boolean;
}

/**
 * Pure accumulator step: given the leftover accumulator, an elapsed delta and a
 * tick length, return how many ticks to run and what accumulator remains.
 *
 * Kept free of timers and DOM so it can be unit-tested headlessly.
 */
export function drainTicks(
  accMs: number,
  dtMs: number,
  tickMs: number,
  maxCatchUp: number,
): TickDrain {
  let acc = accMs + dtMs;
  if (!(acc > 0)) return { ticks: 0, remainder: 0, dropped: false };

  let ticks = Math.floor(acc / tickMs);
  if (ticks > maxCatchUp) {
    // Frame took too long: run the cap and drop the backlog, the same way the
    // original's low-framerate handling clamps how far it catches up.
    return { ticks: maxCatchUp, remainder: 0, dropped: true };
  }
  if (ticks < 0) ticks = 0;
  acc -= ticks * tickMs;
  return { ticks, remainder: acc, dropped: false };
}

export interface LoopInfo {
  /** Monotonic display frame counter, starting at 1. */
  frame: number;
  /** Simulation ticks run during this display frame. */
  ticks: number;
  /** Total simulation ticks since `start()`. */
  tickCount: number;
  /** Milliseconds elapsed since the previous display frame. */
  deltaMs: number;
  /** Smoothed display frames per second. */
  fps: number;
}

export interface LoopOptions {
  /** Advance the simulation by exactly one fixed timestep. */
  tick: () => void;
  /** Compose and present one display frame. */
  render: (info: LoopInfo) => void;
  /** Simulation tick rate in Hz. Defaults to {@link DEFAULT_TICK_HZ}. */
  tickHz?: number;
  /** Maximum catch-up ticks per display frame. Defaults to {@link DEFAULT_MAX_CATCH_UP}. */
  maxCatchUp?: number;
}

export interface Loop {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

export function createLoop(options: LoopOptions): Loop {
  const tickMs = 1000 / (options.tickHz ?? DEFAULT_TICK_HZ);
  const maxCatchUp = options.maxCatchUp ?? DEFAULT_MAX_CATCH_UP;

  let acc = 0;
  let last = 0;
  let frame = 0;
  let tickCount = 0;
  let running = false;
  let raf = 0;

  // Smoothed FPS, recomputed roughly twice a second.
  let fps = 0;
  let fpsMs = 0;
  let fpsFrames = 0;

  const step = (now: number): void => {
    if (!running) return;

    const deltaMs = last === 0 ? tickMs : now - last;
    last = now;

    const drained = drainTicks(acc, deltaMs, tickMs, maxCatchUp);
    acc = drained.remainder;
    for (let i = 0; i < drained.ticks; i++) {
      options.tick();
      tickCount++;
    }

    fpsMs += deltaMs;
    fpsFrames++;
    if (fpsMs >= 500) {
      fps = Math.round((fpsFrames * 1000) / fpsMs);
      fpsMs = 0;
      fpsFrames = 0;
    }

    frame++;
    options.render({ frame, ticks: drained.ticks, tickCount, deltaMs, fps });
    raf = requestAnimationFrame(step);
  };

  return {
    get running(): boolean {
      return running;
    },
    start(): void {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(step);
    },
    stop(): void {
      running = false;
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
