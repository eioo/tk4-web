/**
 * Standalone development netplay server.
 *
 *   bun run net [--port <n>] [--host <addr>]
 *
 * Serves only the `/ws` WebSocket endpoint; the game itself is served by Vite
 * in development, which proxies `/ws` here (`vite.config.ts`). The production
 * host (`tools/serve.ts`) serves both the static build and `/ws` on one port.
 */

import { RoomManager } from "../src/net/room";
import { createWebSocket, startRoomTicker } from "./net-common";

const DEFAULT_PORT = 4174;
const DEFAULT_HOST = "0.0.0.0";

function flag(name: string, env: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  if (i >= 0) return process.argv[i + 1];
  return process.env[env];
}

function parsePort(): number {
  const raw = flag("--port", "NET_PORT") ?? flag("-p", "NET_PORT");
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid port: ${raw}`);
    process.exit(1);
  }
  return port;
}

const port = parsePort();
const hostname = flag("--host", "NET_HOST") ?? DEFAULT_HOST;

const manager = new RoomManager();
const net = createWebSocket(manager);
startRoomTicker(manager);

const server = Bun.serve({
  port,
  hostname,
  development: false,
  fetch(req, srv) {
    const pathname = new URL(req.url).pathname;
    if (pathname === "/ws") return net.upgrade(req, srv);
    return new Response("tk4 netplay server", { status: 200 });
  },
  websocket: net.websocket,
});

const displayHost = hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;
console.log(`tk4 netplay server`);
console.log(`  ws://${displayHost}:${server.port}/ws  (bound to ${hostname}:${server.port})`);
