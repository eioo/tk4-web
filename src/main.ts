import { App } from "./app/app";

async function loadBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(`assets/${path}`);
  const type = res.headers.get("content-type") ?? "";
  // Vite's dev server serves index.html (HTTP 200) for unknown paths; reject it
  // so a missing binary asset fails loudly instead of decoding garbage.
  if (!res.ok || type.includes("text/html")) {
    throw new Error(`missing asset "assets/${path}" — run "bun run assets" first`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function boot(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) throw new Error("#app element not found");
  const app = new App(loadBytes);
  await app.boot(root);
  app.installDevHooks();
}

boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  window.tk4Error = message;
  const root = document.getElementById("app");
  if (root) {
    root.innerHTML = `<pre style="color:#f66;font:14px/1.5 monospace;padding:16px;white-space:pre-wrap">Boot failed: ${message}</pre>`;
  }
  console.error(err);
});
