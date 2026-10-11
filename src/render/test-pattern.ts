import type { LoopInfo } from "../core/loop";

/**
 * Placeholder M0 render: a diagnostic test pattern drawn straight into the
 * video-mode-sized `ImageData` that the presenter blits.
 *
 * Once the real renderer exists (M2+) this is replaced by the ported
 * `CGameDrawManager`. Two motion indicators are deliberate:
 *
 *  - the white square is driven by `tickCount` (simulation time),
 *  - the magenta square and the scanline are driven by `frame` (display time),
 *
 * so the fixed 100 Hz tick and the display refresh can be told apart at a
 * glance.
 */

const BAR_COLORS: readonly (readonly [number, number, number])[] = [
  [235, 235, 235],
  [235, 235, 16],
  [16, 235, 235],
  [16, 235, 16],
  [235, 16, 235],
  [235, 16, 16],
  [16, 16, 235],
  [24, 24, 24],
];

function fillRect(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
): void {
  for (let yy = y; yy < y + h; yy++) {
    let i = (yy * width + x) * 4;
    for (let xx = 0; xx < w; xx++) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
      i += 4;
    }
  }
}

export function drawTestPattern(image: ImageData, info: LoopInfo): void {
  const w = image.width;
  const h = image.height;
  const data = image.data;

  const readoutH = 12;
  const barsH = h - readoutH;

  // Vertical colour bars.
  const barW = w / BAR_COLORS.length;
  for (let y = 0; y < barsH; y++) {
    let i = y * w * 4;
    for (let x = 0; x < w; x++) {
      const c = BAR_COLORS[Math.min(BAR_COLORS.length - 1, (x / barW) | 0)];
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
      i += 4;
    }
  }

  // Display-time scanline (frame driven).
  const scanY = (info.frame * 3) % barsH;
  fillRect(data, w, 0, scanY, w, 2, 255, 255, 255);

  // Simulation-time bouncing square (tick driven).
  const sq = 28;
  const margin = 8;
  const span = w - sq - margin * 2;
  const period = 150;
  const phase = info.tickCount % (period * 2);
  const t = phase < period ? phase : period * 2 - phase;
  const sqx = margin + Math.round((t / period) * span);
  fillRect(data, w, sqx, 40, sq, sq, 0, 0, 0);
  fillRect(data, w, sqx + 2, 42, sq - 4, sq - 4, 255, 255, 255);

  // Display-time square (frame driven).
  const fsq = 24;
  const fspan = barsH - 80 - fsq;
  const fphase = (info.frame * 4) % (fspan * 2);
  const fy = 80 + (fphase < fspan ? fphase : fspan * 2 - fphase);
  fillRect(data, w, w - 40, fy, fsq, fsq, 255, 0, 255);

  // Bottom readout: 16 bits of the tick counter.
  fillRect(data, w, 0, barsH, w, readoutH, 0, 0, 0);
  const bits = 16;
  const bw = 8;
  for (let b = 0; b < bits; b++) {
    const on = (info.tickCount >>> (bits - 1 - b)) & 1;
    const v = on ? 235 : 40;
    fillRect(data, w, 4 + b * bw, barsH + 2, bw - 2, readoutH - 4, v, v, v);
  }
}
