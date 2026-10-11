/**
 * Port of `CGraphicsGenerator`: sprite rotation and the generated wall/floor
 * variants.
 *
 * The rotation reproduces the original's quirks exactly, including:
 *  - the buffer is resized *before* it is sampled (only the leftmost
 *    `cell` columns are ever read, i.e. the "single-angle" base strip),
 *  - reads and writes alias the same (resized) buffer,
 *  - all intermediate maths is 32-bit float.
 * Verified byte-for-byte against `tools/reference/rotate_gen.cpp`.
 */

import { KBlockSpriteSize } from "./constants";
import type { IndexedImage } from "./efp";
import { closestInPalette, hsl2rgb, rgb2hsl, paletteColor, type Palette } from "./palette";

const f32 = Math.fround;
// Must match the original's 32-bit float literal (`#define pi ...f`), not Math.PI.
// oxlint-disable-next-line oxc/approx-constant
const PI = f32(3.14159265358979);

function sinTable(angles: number): { sini: Float32Array; cosi: Float32Array } {
  const sini = new Float32Array(angles);
  const cosi = new Float32Array(angles);
  for (let a = 0; a < angles; a++) {
    const t = f32(f32(f32(a / angles) * PI) * 2);
    sini[a] = f32(Math.sin(t));
    cosi[a] = f32(Math.cos(t));
  }
  // Forced exact values (as in the original).
  sini[0] = 0;
  cosi[0] = 1;
  sini[angles / 4] = 1;
  cosi[angles / 4] = 0;
  sini[angles / 2] = 0;
  cosi[angles / 2] = -1;
  sini[(angles / 4) * 3] = -1;
  cosi[(angles / 4) * 3] = 0;
  return { sini, cosi };
}

/**
 * `CGraphicsGenerator::RotateSprites`. Produces `angles` direction columns of
 * `(cell+1) × (cell+1)` cells from the base strip of each `cell`-tall row band.
 */
export function rotateSprites(src: IndexedImage, cell: number, angles: number): IndexedImage {
  const xSprs = angles;
  const ySprs = Math.trunc(src.height / cell);
  const { sini, cosi } = sinTable(angles);

  const outWidth = xSprs * (cell + 1);
  const outHeight = ySprs * (cell + 1);
  const buf = new Uint8Array(outWidth * outHeight);

  // Emulate CGraphicsBuffer::Resize: preserve the overlapping top-left region.
  const copyW = Math.min(outWidth, src.width);
  const copyH = Math.min(outHeight, src.height);
  for (let y = 0; y < copyH; y++) {
    buf.set(src.pixels.subarray(y * src.width, y * src.width + copyW), y * outWidth);
  }

  const half = Math.trunc(cell / 2) + 1;
  const quarterAngle = Math.trunc(angles / 4);
  const width = outWidth;

  for (let column = 1; column < xSprs; column++) {
    for (let row = 0; row < ySprs; row++) {
      let xx2 = f32(-half * cosi[(column + quarterAngle) % angles]);
      let yy2 = f32(-half * sini[(column + quarterAngle) % angles]);

      for (let a = 0; a < cell + 1; a++) {
        let xx = f32(-half * cosi[column]);
        let yy = f32(-half * sini[column]);

        xx2 = f32(xx2 + cosi[(column + quarterAngle) % angles]);
        yy2 = f32(yy2 + sini[(column + quarterAngle) % angles]);

        for (let b = 0; b < cell + 1; b++) {
          xx = f32(xx + cosi[column]);
          yy = f32(yy + sini[column]);

          const ax = Math.trunc(f32(f32(xx + xx2) + half));
          const ay = Math.trunc(f32(f32(f32(row * (cell + 1) + yy) + yy2) + half));

          let col = 0;
          if (ay > row * cell && ax > 0 && ay < row * cell + cell && ax < cell) {
            col = buf[ay * width + ax];
          }
          buf[(a + row * (cell + 1)) * width + b + column * (cell + 1)] = col;
        }
      }
    }
  }

  return { width: outWidth, height: outHeight, pixels: buf };
}

/**
 * `CGraphicsGenerator::ZoomWall` — upscales a wall sheet into a taller
 * height-variant sheet. `level` is 0-based (0 → +1px, as `CIngameData` passes).
 */
export function zoomWall(src: IndexedImage, level: number): IndexedImage {
  const add = level + 1;
  const blocksW = Math.trunc(src.width / KBlockSpriteSize);
  const blocksH = Math.trunc(src.height / KBlockSpriteSize);
  const size = KBlockSpriteSize + add;
  const outWidth = blocksW * size;
  const outHeight = blocksH * size;
  const dst = new Uint8Array(outWidth * outHeight);

  for (let by = 0; by < blocksH; by++) {
    for (let bx = 0; bx < blocksW; bx++) {
      zoomBlock(src.pixels, src.width, dst, outWidth, bx, by, add);
    }
  }
  return { width: outWidth, height: outHeight, pixels: dst };
}

function zoomBlock(
  src: Uint8Array,
  srcWidth: number,
  dst: Uint8Array,
  dstWidth: number,
  bx: number,
  by: number,
  add: number,
): void {
  const size = KBlockSpriteSize + add;
  const step = Math.trunc(size / (add + 1)) + 1;
  let c = 0;
  for (let y = 0; y < size; y++) {
    let d = 0;
    for (let x = 0; x < size; x++) {
      dst[(y + by * size) * dstWidth + x + bx * size] =
        src[(c + by * KBlockSpriteSize) * srcWidth + d + bx * KBlockSpriteSize];
      if ((x + 1) % step !== 0) d++;
      if (d >= KBlockSpriteSize) d = KBlockSpriteSize - 1;
    }
    if ((y + 1) % step !== 0) c++;
    if (c >= KBlockSpriteSize) c = KBlockSpriteSize - 1;
  }
}

/**
 * `CGraphicsGenerator::MakeFloors` — the darkened floor variant. Uses the game
 * palette and the original HSL round-trip.
 */
export function makeFloors(src: IndexedImage, palette: Palette): IndexedImage {
  const count = src.width * src.height;
  const dst = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const [r, g, b] = paletteColor(palette, src.pixels[i]);
    const [h, s0, l0] = rgb2hsl(r, g, b);
    const s = f32(s0 / 3);
    const l = f32(l0 / 3);
    const [rr, gg, bb] = hsl2rgb(h, s, l);
    dst[i] = closestInPalette(Math.trunc(rr), Math.trunc(gg), Math.trunc(bb), palette);
  }
  return { width: src.width, height: src.height, pixels: dst };
}
