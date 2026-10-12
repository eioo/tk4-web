/**
 * Browser WebSocket transport for netplay. Holds the socket, queues received
 * messages for the app to drain on its own tick, and buffers the incoming tick
 * bundles for lockstep stepping.
 *
 * Design: `docs/multiplayer/04-client.md`.
 */

import {
  PROTOCOL_VERSION,
  encodeMessage,
  parseServerMessage,
  type ClientMessage,
  type MatchEndReason,
  type NetPlayerState,
  type NetSettings,
  type RoomInfo,
  type ServerMessage,
  type SimInput,
} from "./protocol";

export type NetStatus = "idle" | "connecting" | "lobby" | "playing" | "closed";

/** How often to probe the round-trip time (prediction lead, docs/multiplayer/09). */
const KPING_INTERVAL_MS = 500;

/**
 * Same-origin `/ws` by default; `?net=ws://host:port/ws` overrides (debugging).
 */
export function resolveNetUrl(
  search: string = globalThis.location?.search ?? "",
  loc: { protocol: string; host: string } = globalThis.location ?? {
    protocol: "http:",
    host: "localhost",
  },
): string {
  const override = new URLSearchParams(search).get("net");
  if (override) return override;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/ws`;
}

export class NetClient {
  status: NetStatus = "idle";
  seat = -1;
  room: RoomInfo | null = null;
  lastError: { code: string; message: string } | null = null;
  /** Smoothed round-trip time in ms (0 until the first pong). */
  rttMs = 0;

  private ws: WebSocket | null = null;
  private readonly pending: ServerMessage[] = [];
  private pingId = 0;
  private lastPingAt = 0;
  private readonly pingSent = new Map<number, number>();

  /** Open the socket. Resolves on `open`, rejects if it fails before that. */
  connect(url = resolveNetUrl()): Promise<void> {
    return new Promise((resolve, reject) => {
      this.status = "connecting";
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        this.status = "closed";
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.ws = ws;
      ws.addEventListener("open", () => {
        settled = true;
        this.status = "idle";
        resolve();
      });
      ws.addEventListener("message", (event) => {
        const text = typeof event.data === "string" ? event.data : String(event.data);
        this.handleMessage(text);
      });
      ws.addEventListener("error", () => {
        if (!settled) {
          settled = true;
          this.status = "closed";
          reject(new Error("netplay connection failed"));
        }
      });
      ws.addEventListener("close", () => {
        this.status = "closed";
        if (!settled) {
          settled = true;
          reject(new Error("netplay connection closed"));
        }
      });
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.status = "closed";
  }

  get open(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // ------------------------------------------------------------------
  // send
  // ------------------------------------------------------------------

  host(name: string, settings: NetSettings): void {
    this.send({ t: "host", v: PROTOCOL_VERSION, name, settings });
  }
  join(name: string, code: string): void {
    this.send({ t: "join", v: PROTOCOL_VERSION, name, code });
  }
  sendSettings(settings: NetSettings): void {
    this.send({ t: "settings", settings });
  }
  sendInput(tick: number, input: SimInput): void {
    this.send({
      t: "input",
      tick,
      keys: input.keys,
      mouseXRel: input.mouseXRel,
      mouseButtons: input.mouseButtons,
    });
  }
  /** Send a ping if one is due; returns the (smoothed) RTT in ms. */
  maybePing(now = performance.now()): number {
    if (this.open && now - this.lastPingAt >= KPING_INTERVAL_MS) {
      this.lastPingAt = now;
      const id = ++this.pingId;
      this.pingSent.set(id, now);
      this.send({ t: "ping", id });
    }
    return this.rttMs;
  }
  /** Tell the server this seat has built its session and can start ticking. */
  sendLoaded(): void {
    this.send({ t: "loaded" });
  }
  sendLevelEnd(last: boolean): void {
    this.send({ t: "levelEnd", last });
  }
  sendReady(state: NetPlayerState): void {
    this.send({ t: "ready", state });
  }
  sendMatchEnd(reason: MatchEndReason): void {
    this.send({ t: "matchEnd", reason });
  }
  leave(): void {
    this.send({ t: "leave" });
  }

  private send(message: ClientMessage): void {
    if (this.open) this.ws?.send(encodeMessage(message));
  }

  // ------------------------------------------------------------------
  // receive
  // ------------------------------------------------------------------

  /** Drain the messages received since the last call (ticks included). */
  drain(): ServerMessage[] {
    if (this.pending.length === 0) return [];
    return this.pending.splice(0, this.pending.length);
  }

  private handleMessage(text: string): void {
    const message = parseServerMessage(text);
    if (!message) return;
    this.applyState(message);
    if (message.t === "pong") {
      const sent = this.pingSent.get(message.id);
      if (sent !== undefined) {
        this.pingSent.delete(message.id);
        const rtt = performance.now() - sent;
        this.rttMs = this.rttMs > 0 ? this.rttMs * 0.8 + rtt * 0.2 : rtt;
      }
      return;
    }
    this.pending.push(message);
  }

  private applyState(message: ServerMessage): void {
    switch (message.t) {
      case "hosted":
      case "joined":
        this.status = "lobby";
        this.seat = message.seat;
        this.room = message.room;
        break;
      case "lobby":
        this.room = message.room;
        break;
      case "seat":
        this.seat = message.seat;
        break;
      case "levelStart":
        this.status = "playing";
        break;
      case "matchEnded":
        this.status = "lobby";
        break;
      case "error":
        this.lastError = { code: message.code, message: message.message };
        break;
      default:
        break;
    }
  }
}
