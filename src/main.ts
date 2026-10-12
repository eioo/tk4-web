import { App } from "./app/app";

/**
 * Entry point. Loads every asset the game needs (through `loadBytes`), starts
 * the loop, then removes the boot overlay from `index.html`. On failure it
 * surfaces the message in that overlay instead of leaving a black screen.
 */

const bootEl = document.getElementById("boot");
const statusEl = document.getElementById("boot-status");

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

let assetCount = 0;

async function loadBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(`assets/${path}`);
  const type = res.headers.get("content-type") ?? "";
  // Vite's dev server serves index.html (HTTP 200) for unknown paths; reject it
  // so a missing binary asset fails loudly instead of decoding garbage.
  if (!res.ok || type.includes("text/html")) {
    throw new Error(`missing asset "assets/${path}" — run "bun run assets" first`);
  }
  assetCount++;
  setStatus(`Loading… (${assetCount} files)`);
  return new Uint8Array(await res.arrayBuffer());
}

async function boot(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) throw new Error("#app element not found");
  const app = new App(loadBytes);
  await app.boot(root);
  app.installDevHooks();
  // The first frame is present; fade the overlay out and drop it.
  bootEl?.classList.add("boot--done");
  window.setTimeout(() => bootEl?.remove(), 300);
}

boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  window.tk4Error = message;
  bootEl?.classList.add("boot--error");
  setStatus(`Boot failed: ${message}`);
  console.error(err);
});
