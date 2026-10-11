import { createLoop } from "./core/loop";
import { drawTestPattern } from "./render/test-pattern";

/** Internal (video-mode) resolution. Matches the original's default 640×480. */
const INTERNAL_WIDTH = 640;
const INTERNAL_HEIGHT = 480;

/**
 * Scale the canvas to the largest integer multiple that fits the window,
 * falling back to a fractional scale when the window is smaller than the
 * internal resolution. Nearest-neighbour keeps pixels crisp.
 */
function fitCanvas(canvas: HTMLCanvasElement): void {
  const sx = window.innerWidth / INTERNAL_WIDTH;
  const sy = window.innerHeight / INTERNAL_HEIGHT;
  const fit = Math.min(sx, sy);
  const scale = fit >= 1 ? Math.floor(fit) : fit;
  canvas.style.width = `${Math.round(INTERNAL_WIDTH * scale)}px`;
  canvas.style.height = `${Math.round(INTERNAL_HEIGHT * scale)}px`;
}

function boot(): void {
  const root = document.getElementById("app");
  if (!root) throw new Error("#app element not found");

  const canvas = document.createElement("canvas");
  canvas.id = "screen";
  canvas.width = INTERNAL_WIDTH;
  canvas.height = INTERNAL_HEIGHT;
  root.appendChild(canvas);

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.imageSmoothingEnabled = false;

  const image = ctx.createImageData(INTERNAL_WIDTH, INTERNAL_HEIGHT);

  fitCanvas(canvas);
  window.addEventListener("resize", () => fitCanvas(canvas));

  const loop = createLoop({
    tick: () => {
      // M0: no simulation yet. The 100 Hz game tick is wired in here at M3.
    },
    render: (info) => {
      drawTestPattern(image, info);
      ctx.putImageData(image, 0, 0);
    },
  });

  loop.start();
}

boot();
