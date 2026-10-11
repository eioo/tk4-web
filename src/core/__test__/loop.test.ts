import { describe, expect, test } from "bun:test";

import { drainTicks } from "../loop";

describe("drainTicks", () => {
  const TICK = 10;
  const CAP = 5;

  test("accumulates whole ticks and keeps the remainder", () => {
    expect(drainTicks(0, 25, TICK, CAP)).toEqual({
      ticks: 2,
      remainder: 5,
      dropped: false,
    });
  });

  test("carries the remainder into the next step", () => {
    const first = drainTicks(0, 16, TICK, CAP);
    expect(first.ticks).toBe(1);
    const second = drainTicks(first.remainder, 16, TICK, CAP);
    expect(second.ticks).toBe(2);
    expect(second.remainder).toBe(2);
  });

  test("runs no ticks when the delta is zero", () => {
    expect(drainTicks(0, 0, TICK, CAP).ticks).toBe(0);
  });

  test("does not tick before a full timestep elapses", () => {
    expect(drainTicks(0, 9.9, TICK, CAP).ticks).toBe(0);
  });

  test("drops the backlog when the catch-up cap is exceeded", () => {
    const drained = drainTicks(0, 1000, TICK, CAP);
    expect(drained.ticks).toBe(CAP);
    expect(drained.remainder).toBe(0);
    expect(drained.dropped).toBe(true);
  });

  test("treats a negative accumulator as empty", () => {
    expect(drainTicks(-100, 5, TICK, CAP).ticks).toBe(0);
  });
});
