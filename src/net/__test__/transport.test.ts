import { describe, expect, test } from "bun:test";

import { createWebSocket } from "../../../tools/net-common";
import { encodeMessage, type ServerMessage } from "../protocol";
import { RoomManager } from "../room";

/**
 * Integration test for the Bun adapter (`tools/net-common.ts`) over real
 * WebSocket sockets: upgrade, JSON round-trip, the host/join handshake and the
 * auto-start broadcast. Tick sampling is covered deterministically in
 * `room.test.ts`, so the real timer is not exercised here.
 */

class WsClient {
  readonly messages: ServerMessage[] = [];

  constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const text = typeof event.data === "string" ? event.data : String(event.data);
      try {
        this.messages.push(JSON.parse(text) as ServerMessage);
      } catch {
        // The adapter never sends non-JSON; ignore for the test's purposes.
      }
    });
  }

  static async connect(url: string): Promise<WsClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("connect failed")));
    });
    return new WsClient(ws);
  }

  send(message: Parameters<typeof encodeMessage>[0]): void {
    this.ws.send(encodeMessage(message));
  }

  async wait<T extends ServerMessage["t"]>(
    t: T,
    timeoutMs = 2000,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const start = Date.now();
    for (;;) {
      const found = this.messages.find((m) => m.t === t);
      if (found) return found as Extract<ServerMessage, { t: T }>;
      if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${t}`);
      await Bun.sleep(5);
    }
  }
}

async function withServer<T>(fn: (url: string, manager: RoomManager) => Promise<T>): Promise<T> {
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
  try {
    return await fn(`ws://localhost:${server.port}/ws`, manager);
  } finally {
    server.stop(true);
  }
}

describe("Bun websocket adapter", () => {
  test("host, join and auto-start pass over a real socket", async () => {
    await withServer(async (url, manager) => {
      const a = await WsClient.connect(url);
      a.send({
        t: "host",
        v: 1,
        name: "John",
        settings: { gameMode: 0, episode: 1, level: 0, players: 2, fragLimit: 20 },
      });
      const hosted = await a.wait("hosted");
      expect(hosted.seat).toBe(0);
      expect(manager.roomCount()).toBe(1);

      const b = await WsClient.connect(url);
      b.send({ t: "join", v: 1, name: "Paul", code: hosted.code });
      expect((await b.wait("joined")).seat).toBe(1);

      const start = await a.wait("levelStart");
      expect(start.index).toBe(0);
      expect(start.states).toBeNull();
      expect(start.roster.map((r) => r.name)).toEqual(["John", "Paul"]);
      expect((await b.wait("levelStart")).roster).toHaveLength(2);

      // The tick loop is gated on both seats reporting the level loaded.
      manager.advance(Date.now() + 5);
      await Bun.sleep(10);
      expect(a.messages.some((m) => m.t === "tick")).toBe(false);
      a.send({ t: "loaded" });
      b.send({ t: "loaded" });
      await Bun.sleep(25); // let the server process the loaded frames
      manager.advance(Date.now() + 20);
      expect((await a.wait("tick")).inputs).toHaveLength(2);

      a.ws.close();
      b.ws.close();
    });
  });

  test("drops an unparseable frame without closing the socket", async () => {
    await withServer(async (url) => {
      const a = await WsClient.connect(url);
      a.ws.send("this is not json");
      a.send({
        t: "host",
        v: 1,
        name: "John",
        settings: { gameMode: 0, episode: 1, level: 0, players: 2, fragLimit: 20 },
      });
      expect((await a.wait("hosted")).seat).toBe(0);
      expect(a.ws.readyState).toBe(WebSocket.OPEN);
      a.ws.close();
    });
  });

  test("rejects a version mismatch", async () => {
    await withServer(async (url) => {
      const a = await WsClient.connect(url);
      a.send({
        t: "host",
        v: 999,
        name: "John",
        settings: { gameMode: 0, episode: 1, level: 0, players: 2, fragLimit: 20 },
      });
      expect((await a.wait("error")).code).toBe("bad-version");
      a.ws.close();
    });
  });
});
