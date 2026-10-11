import { defineConfig } from "vite";

// Dev server + production bundling. Bun provides the runtime and package
// management; Vite provides HMR in development and the static build.
// See docs/10-web-port-architecture.md.
export default defineConfig({
  base: "./",
  server: { host: true, port: 5173 },
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
  },
});
