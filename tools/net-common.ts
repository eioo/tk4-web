/**
 * Bun WebSocket adapter shared by the standalone dev server (`tools/net-server.ts`)
 * and the production host (`tools/serve.ts`). Translates Bun socket events into
 * the transport-free `RoomManager` (`src/net/room.ts`).
 *
 * Design: `docs/multiplayer/03-server.md`.
 */

import type { Server, ServerWebSocket, WebSocketHandler } from "bun";

import {
  KMAX_MESSAGE_BYTES,
  KTICK_MS,
  encodeMessage,
  parseClientMessage,
  type ServerMessage,
} from "../src/net/protocol";
import type { Peer, RoomManager } from "../src/net/room";

export interface SocketData {
  readonly id: string;
}

class BunPeer implements Peer {
  constructor(
    readonly id: string,
    private readonly ws: ServerWebSocket<SocketData>,
  ) {}

  send(message: ServerMessage): void {
    try {
      this.ws.send(encodeMessage(message));
    } catch {
      // The socket closed between the room deciding to send and the write.
    }
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // Already closed.
    }
  }
}

export interface NetWebSocket {
  upgrade(req: Request, server: Server<SocketData>): Response | undefined;
  websocket: WebSocketHandler<SocketData>;
}

/** Build the `/ws` upgrade handler and Bun websocket handlers for a manager. */
export function createWebSocket(manager: RoomManager): NetWebSocket {
  const peers = new Map<string, BunPeer>();

  const upgrade = (req: Request, server: Server<SocketData>): Response | undefined => {
    const id = crypto.randomUUID();
    if (server.upgrade(req, { data: { id } })) return undefined;
    return new Response("WebSocket upgrade failed", { status: 400 });
  };

  const websocket: WebSocketHandler<SocketData> = {
    open(ws) {
      peers.set(ws.data.id, new BunPeer(ws.data.id, ws));
    },
    message(ws, raw) {
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      if (text.length > KMAX_MESSAGE_BYTES) {
        ws.close(1009, "message too large");
        return;
      }
      const peer = peers.get(ws.data.id);
      if (!peer) return;
      const message = parseClientMessage(text);
      // Drop unparseable/unknown messages; the peer keeps its connection.
      if (!message) return;
      manager.handleMessage(peer, message);
    },
    close(ws) {
      const peer = peers.get(ws.data.id);
      peers.delete(ws.data.id);
      if (peer) manager.handleClose(peer);
    },
  };

  return { upgrade, websocket };
}

/** Drive the 100 Hz room tick master. Returns the interval handle. */
export function startRoomTicker(manager: RoomManager): ReturnType<typeof setInterval> {
  return setInterval(() => manager.advance(Date.now()), KTICK_MS);
}
