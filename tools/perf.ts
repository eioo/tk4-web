/**
 * Presentation-path performance budget (docs/13). The browser does the final
 * blit (`putImageData` for Canvas2D, a palette-shader draw for WebGL), which we
 * cannot time in Bun; what we *can* time headlessly is the per-frame CPU the
 * port owns: the index→RGBA conversion and the frame compose. Budgets leave
 * room for the display blit inside a 60 fps (16.67 ms) frame.
 *
 *   bun run perf
 *
 * Exits non-zero if a budget is exceeded.
 */

import { readRef, readRefText } from "../src/data/__test__/helpers";
import { decodePaletteTab } from "../src/data/color-tables";
import { mergeIni } from "../src/data/config";
import { loadIngameData } from "../src/data/ingame-data";
import { loadLevel } from "../src/data/level";
import { createPalette } from "../src/data/palette";
import { drawStaticFrame, screenPosFor, toDrawSprites } from "../src/render/draw-manager";
import { GameDrawer } from "../src/render/drawer";
import { Framebuffer } from "../src/render/fb";

const FRAME_BUDGET_MS = 1000 / 60;

interface Case {
  label: string;
  ms: number;
  run: () => number;
}

function bench(fn: () => void, iters: number): number {
  for (let i = 0; i < Math.max(1, iters >> 2); i++) fn(); // warm up
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  return (performance.now() - t0) / iters;
}

function convertCase(width: number, height: number, budget: number): Case {
  const fb = new Framebuffer(width, height);
  for (let i = 0; i < fb.pixels.length; i++) fb.pixels[i] = (i * 31) & 0xff;
  const palette = createPalette();
  const out = new Uint8ClampedArray(width * height * 4);
  const iters = width * height > 700000 ? 40 : 120;
  return {
    label: `convert ${width}x${height}`,
    ms: budget,
    run: () => bench(() => fb.toRgba(palette, out), iters),
  };
}

const paletteTab = decodePaletteTab(await readRef("palette.tab"));
const ingame = await loadIngameData(mergeIni(await readRefText("default.ini")), readRef);
const sprites = toDrawSprites(ingame);
const level = loadLevel(await readRef("levs/default/level5.lev"));
const start = level.starts[0];
const location = { x: start.x * 20 + 10, y: start.y * 20 + 10 };

function composeCase(): Case {
  const fb = new Framebuffer(640, 480);
  const dark = new Uint8Array(640 * 480);
  const drawRect = fb.rect();
  const drawer = new GameDrawer(paletteTab);
  const screenPos = screenPosFor(location, drawRect);
  return {
    label: "compose 640x480",
    ms: 8,
    run: () =>
      bench(
        () =>
          drawStaticFrame({
            level,
            sprites,
            drawer,
            fb,
            dark,
            drawRect,
            screenPos,
            playerLocation: location,
          }),
        120,
      ),
  };
}

const cases: Case[] = [
  convertCase(640, 480, 4),
  convertCase(800, 600, 6),
  convertCase(1024, 768, 10),
  convertCase(1280, 960, 14),
  composeCase(),
];

let failures = 0;
console.log(`presentation budget (60 fps frame = ${FRAME_BUDGET_MS.toFixed(2)} ms)`);
for (const c of cases) {
  const ms = c.run();
  const ok = ms <= c.ms;
  if (!ok) failures++;
  console.log(
    `  ${c.label.padEnd(16)} ${ms.toFixed(2).padStart(7)} ms  ` +
      `(budget ${c.ms.toFixed(0)} ms)  ${ok ? "ok" : "OVER BUDGET"}`,
  );
}

console.log(failures === 0 ? "\nperf: OK" : `\nperf: ${failures} over budget`);
process.exit(failures === 0 ? 0 : 1);
