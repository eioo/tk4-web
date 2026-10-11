import { createLoop } from "./core/loop";
import { decodePaletteTab } from "./data/color-tables";
import { mergeIni } from "./data/config";
import { loadIngameData } from "./data/ingame-data";
import { loadLevel } from "./data/level";
import { drawStaticFrame, screenPosFor, toDrawSprites } from "./render/draw-manager";
import { GameDrawer } from "./render/drawer";
import { Framebuffer } from "./render/fb";
import { Canvas2DPresenter } from "./render/presenters/canvas2d";

/** Internal (video-mode) resolution — the original's in-game default. */
const WIDTH = 640;
const HEIGHT = 480;

/** Level shown at boot (M2 renders a static level with a free camera). */
const LEVEL_PATH = "levs/default/level1.lev";

async function loadBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(`assets/${path}`);
  if (!res.ok) throw new Error(`missing asset "assets/${path}" — run "bun run assets" first`);
  return new Uint8Array(await res.arrayBuffer());
}

async function loadText(path: string): Promise<string> {
  const res = await fetch(`assets/${path}`);
  if (!res.ok) throw new Error(`missing asset "assets/${path}" — run "bun run assets" first`);
  return res.text();
}

async function boot(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) throw new Error("#app element not found");

  const presenter = new Canvas2DPresenter(WIDTH, HEIGHT);
  presenter.fit();
  window.addEventListener("resize", () => presenter.fit());
  root.appendChild(presenter.canvas);

  const [cfgText, paletteTabBytes, levelBytes] = await Promise.all([
    loadText("default.ini"),
    loadBytes("palette.tab"),
    loadBytes(LEVEL_PATH),
  ]);
  const level = loadLevel(levelBytes);
  const ingame = await loadIngameData(mergeIni(cfgText), loadBytes);
  const sprites = toDrawSprites(ingame);

  const fb = new Framebuffer(WIDTH, HEIGHT);
  const dark = new Uint8Array(WIDTH * HEIGHT);
  const drawer = new GameDrawer(decodePaletteTab(paletteTabBytes));
  const drawRect = fb.rect();

  // Fixed camera at the first player start; arrow keys pan it for inspection.
  const start = level.starts[0] ?? { x: level.width >> 1, y: level.height >> 1 };
  const location = { x: start.x * 20 + 10, y: start.y * 20 + 10 };

  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => {
    keys.add(e.key);
    if (e.key.startsWith("Arrow")) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key));

  const loop = createLoop({
    tick: () => {
      const step = 5;
      if (keys.has("ArrowLeft")) location.x -= step;
      if (keys.has("ArrowRight")) location.x += step;
      if (keys.has("ArrowUp")) location.y -= step;
      if (keys.has("ArrowDown")) location.y += step;
    },
    render: () => {
      fb.clear(0);
      dark.fill(0);
      drawStaticFrame({
        level,
        sprites,
        drawer,
        fb,
        dark,
        drawRect,
        screenPos: screenPosFor(location, drawRect),
        playerLocation: location,
      });
      presenter.present(fb, ingame.palette);
    },
  });
  loop.start();
  (window as unknown as Record<string, unknown>).tk4Ready = true;
}

boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  (window as unknown as Record<string, unknown>).tk4Error = message;
  const root = document.getElementById("app");
  if (root) {
    root.innerHTML = `<pre style="color:#f66;font:14px/1.5 monospace;padding:16px;white-space:pre-wrap">Boot failed: ${message}</pre>`;
  }
  console.error(err);
});
