import { describe, expect, test } from "bun:test";

import { createWebSocket, startRoomTicker } from "../../../tools/net-common";
import { NetClient } from "../client";
import { type NetSettings, type ServerMessage } from "../protocol";
import { RoomManager } from "../room";

/**
 * Full transport path with the real `NetClient`: protocol v2 host/join, ping/pong
 * and tick-stamped inputs echoed at the right tick over real sockets.
 */

const SETTINGS: NetSettings = {
  gameMode: 0,
  episode: 1,
  level: 0,
  players: 2,
  fragLimit: 20,
  enemies: true,
  dmSpeed: 1,
  targetSystem: false,
};

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await Bun.sleep(5);
  }
}

describe("NetClient against a real room", () => {
  test("hosts, joins, probes RTT and echoes tick-stamped inputs", async () => {
    const manager = new RoomManager();
    const net = createWebSocket(manager);
    const server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        if (new URL(req.url).pathname === "/ws") return net.upgrade(req, srv);
        return new Response("ok");
      },
      websocket: net.websocket,
    });
    const ticker = startRoomTicker(manager);
    const url = `ws://localhost:${server.port}/ws`;

    const a = new NetClient();
    const b = new NetClient();
    const aMsgs: ServerMessage[] = [];
    const bMsgs: ServerMessage[] = [];
    const pump = (): void => {
      aMsgs.push(...a.drain());
      bMsgs.push(...b.drain());
    };

    try {
      await a.connect(url);
      await b.connect(url);
      a.host("John", SETTINGS);
      await waitFor(() => {
        pump();
        return aMsgs.some((m) => m.t === "hosted");
      });
      const code = aMsgs.find((m) => m.t === "hosted")?.code;
      expect(code).toMatch(/^[A-Z]{5}$/);

      b.join("Paul", code!);
      await waitFor(() => {
        pump();
        return aMsgs.some((m) => m.t === "levelStart") && bMsgs.some((m) => m.t === "levelStart");
      });
      a.sendLoaded();
      b.sendLoaded();

      for (let t = 0; t < 40; t++) {
        a.sendInput(t, { keys: t % 2 ? 1 : 0, mouseXRel: 2, mouseButtons: 0 });
        b.sendInput(t, { keys: 0, mouseXRel: -2, mouseButtons: 0 });
        await Bun.sleep(5);
      }
      a.maybePing();
      await waitFor(() => a.rttMs > 0, 1500);
      await waitFor(() => {
        pump();
        return aMsgs.filter((m) => m.t === "tick").length > 5;
      });
      pump();

      const ticksA = aMsgs.flatMap((m) => (m.t === "tick" ? [m] : []));
      const ticksB = bMsgs.flatMap((m) => (m.t === "tick" ? [m] : []));
      // Both clients see the identical tick sequence.
      expect(ticksA.map((m) => m.tick)).toEqual(ticksB.map((m) => m.tick));
      // A stamped input is applied at its own tick, on both clients.
      const stamped = ticksA.find((m) => m.inputs[0].mouseXRel === 2);
      expect(stamped).toBeDefined();
      expect(stamped!.inputs[1].mouseXRel).toBe(-2);
      // RTT probing works.
      expect(a.rttMs).toBeGreaterThan(0);
    } finally {
      a.disconnect();
      b.disconnect();
      clearInterval(ticker);
      server.stop(true);
    }
  });
});
