/**
 * Production static host for the Vite build output (`dist/`).
 *
 *   bun run serve [--port <n>] [--host <addr>]
 *
 * `bun run start` builds first (`tsc --noEmit` + `vite build`) and then runs this.
 *
 * Compared with `vite preview`, this server also gives the game's custom asset
 * extensions sensible MIME types, marks Vite's content-hashed bundles as
 * immutable, and falls back to `index.html` for navigations. Bind address and
 * port come from `--host`/`--port`, then `HOST`/`PORT`, then defaults
 * (`0.0.0.0:4173`).
 */

import { statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

const DEFAULT_PORT = 4173;
const DEFAULT_HOST = "0.0.0.0";
const DIST = resolve(import.meta.dir, "..", "dist");

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ini": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  // Original game data (docs 06/07/11) — served as opaque bytes.
  ".efp": "application/octet-stream",
  ".pcx": "application/octet-stream",
  ".lev": "application/octet-stream",
  ".fnt": "application/octet-stream",
  ".tab": "application/octet-stream",
};

/** Vite hashes bundle filenames (`index-<hash>.js`, `.css`, `.js.map`). */
const HASHED = /-[0-9A-Za-z_-]{8,}\.(?:js|css)(?:\.map)?$/;

function flag(name: string, env: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  if (i >= 0) return process.argv[i + 1];
  return process.env[env];
}

function parsePort(): number {
  const raw = flag("--port", "PORT") ?? flag("-p", "PORT");
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid port: ${raw}`);
    process.exit(1);
  }
  return port;
}

if (!statSync(DIST, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(
    `No build found at ${DIST}.\nRun \`bun run build\` first, or use \`bun run start\`.`,
  );
  process.exit(1);
}

const port = parsePort();
const hostname = flag("--host", "HOST") ?? DEFAULT_HOST;
const BASE_HEADERS = { "X-Content-Type-Options": "nosniff" };

function cacheControl(pathname: string, ext: string): string {
  if (HASHED.test(pathname)) return "public, max-age=31536000, immutable";
  if (ext === ".html") return "no-cache";
  return "public, max-age=3600";
}

const server = Bun.serve({
  port,
  hostname,
  development: false,
  fetch(req: Request): Response {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { ...BASE_HEADERS, Allow: "GET, HEAD" },
      });
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url).pathname);
    } catch {
      return new Response("Bad Request", { status: 400, headers: BASE_HEADERS });
    }
    if (pathname.endsWith("/")) pathname += "index.html";

    const target = normalize(join(DIST, pathname));
    if (target !== DIST && !target.startsWith(DIST + sep)) {
      return new Response("Not Found", { status: 404, headers: BASE_HEADERS });
    }

    let filePath = target;
    if (!statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
      // Single-page fallback for navigations; a missing asset stays a 404.
      if (extname(pathname) !== "") {
        return new Response("Not Found", { status: 404, headers: BASE_HEADERS });
      }
      filePath = join(DIST, "index.html");
    }

    const ext = extname(filePath).toLowerCase();
    const file = Bun.file(filePath);
    const headers: Record<string, string> = {
      ...BASE_HEADERS,
      "Content-Type": MIME[ext] ?? (file.type || "application/octet-stream"),
      "Cache-Control": cacheControl(pathname, ext),
    };
    return new Response(req.method === "HEAD" ? null : file, { status: 200, headers });
  },
});

const displayHost = hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;
console.log(`tk4-web serving ${DIST}`);
console.log(`  http://${displayHost}:${server.port}/  (bound to ${hostname}:${server.port})`);
