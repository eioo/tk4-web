import { describe, expect, test } from "bun:test";

import { LockstepClient, type LockstepSession } from "../lockstep";
import type { SimInput } from "../protocol";

/**
 * The rollback driver has to (a) apply the local seat's input the moment it is
 * sampled and (b) still converge to exactly the authoritative world once the
 * server's bundles arrive. This uses a tiny deterministic "world" so the
 * expected state is obvious.
 */

class TestSession implements LockstepSession<number> {
  value = 0;

  step(inputs: readonly SimInput[]): void {
    let sum = 0;
    for (const input of inputs) sum += input.keys + input.mouseXRel;
    this.value = (this.value * 2 + sum) % 1_000_003;
  }

  saveState(): number {
    return this.value;
  }

  loadState(state: number): void {
    this.value = state;
  }

  discardOutput(): void {}
}

function script(t: number): SimInput[] {
  return [
    { keys: (t * 7) % 11, mouseXRel: 0, mouseButtons: 0 },
    { keys: (t * 3) % 11, mouseXRel: 0, mouseButtons: 0 },
  ];
}

function reference(ticks: number): TestSession {
  const session = new TestSession();
  for (let t = 0; t < ticks; t++) session.step(script(t));
  return session;
}

describe("lockstep rollback client", () => {
  test("converges to the authoritative world under latency", () => {
    const latency = 4;
    const ticks = 220;
    const session = new TestSession();
    const client = new LockstepClient(session, {
      seats: 2,
      localSeat: 0,
      keyframeInterval: 2,
      maxHistory: 60,
      maxStepsPerUpdate: 1,
    });
    client.setLead(1);

    // Run with `latency` ticks between the server emitting a tick and the
    // client receiving it. The local seat predicts immediately.
    for (let now = 0; now < ticks; now++) {
      const serverTick = now - latency;
      if (serverTick >= 0) client.receive(serverTick, script(serverTick));
      client.update(script(Math.min(client.tick, ticks - 1))[0]);
    }
    // Deliver the rest and let reconciliation settle.
    for (let t = Math.max(0, ticks - latency); t < ticks; t++) client.receive(t, script(t));
    for (let i = 0; i < 12; i++) {
      client.update(script(Math.min(client.tick, ticks - 1))[0]);
    }

    expect(client.tick).toBe(ticks);
    expect(session.value).toBe(reference(ticks).value);
  });

  test("the local input takes effect before any server bundle", () => {
    const session = new TestSession();
    const client = new LockstepClient(session, { seats: 2, localSeat: 0 });
    client.update({ keys: 9, mouseXRel: 0, mouseButtons: 0 });
    // tick 0 was simulated with our input, with the remote seat at zero.
    expect(client.tick).toBeGreaterThan(0);
    expect(session.value).not.toBe(0);
  });

  test("a late authoritative bundle rewinds a wrong prediction", () => {
    const session = new TestSession();
    const client = new LockstepClient(session, {
      seats: 2,
      localSeat: 0,
      keyframeInterval: 1,
      maxStepsPerUpdate: 1,
    });
    client.setLead(1);
    // Predict ticks 0..3 with a remote seat that is wrong.
    for (let i = 0; i < 4; i++) client.update({ keys: 0, mouseXRel: 0, mouseButtons: 0 });
    const wrong = session.value;
    // The real authoritative input for those ticks differs.
    for (let t = 0; t < 4; t++) client.receive(t, script(t + 10));
    client.update({ keys: 0, mouseXRel: 0, mouseButtons: 0 });

    const corrected = new TestSession();
    for (let t = 0; t < 4; t++) corrected.step(script(t + 10));
    expect(session.value).not.toBe(wrong);
    expect(session.value).toBe(corrected.value);
  });
});
