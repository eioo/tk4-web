import { defineConfig } from "vite";

// Dev server + production bundling. Bun provides the runtime and package
// management; Vite provides HMR in development and the static build.
// See docs/web-port-architecture.md.
export default defineConfig({
  base: "./",
  server: {
    host: true,
    port: 5173,
    // The dev netplay server (`bun run net`) owns `/ws`; Vite proxies it so the
    // client always talks to a same-origin WebSocket in dev and prod alike.
    proxy: { "/ws": { target: "ws://localhost:4174", ws: true } },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
  },
});
