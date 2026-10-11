/**
 * The 8-bit palette-indexed framebuffer (`CGraphicsBuffer`).
 *
 * Pixels are palette indices (`Uint8Array`, row-major). Conversion to RGBA for
 * presentation uses the global in-game palette; index 0 is transparent only
 * where a primitive says so, it is a normal (usually black) index in the
 * framebuffer itself.
 */

import type { Palette } from "../data/palette";
import { rectHeight, rectWidth, type Rect } from "./rect";

export class Framebuffer {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
  }

  /** `CRect` covering the whole buffer. */
  rect(): Rect {
    return { left: 0, top: 0, right: this.width, bottom: this.height };
  }

  /** Fill everything with `color`. */
  clear(color = 0): void {
    this.pixels.fill(color);
  }

  /** `CGraphicsBuffer::FillRectangle`. */
  fillRect(r: Rect, color: number): void {
    for (let y = r.top; y < r.bottom; y++) {
      this.pixels.fill(color, y * this.width + r.left, y * this.width + r.right);
    }
  }

  /** `CGraphicsBuffer::PutPixelClip`. */
  putPixelClip(x: number, y: number, color: number, clip: Rect): void {
    if (x < clip.left || x >= clip.right || y < clip.top || y >= clip.bottom) return;
    this.pixels[y * this.width + x] = color;
  }

  /**
   * Converts the index buffer to RGBA bytes using `palette`. `out` may be
   * reused between frames; it must be `width * height * 4` bytes.
   */
  toRgba(palette: Palette, out?: Uint8ClampedArray): Uint8ClampedArray {
    const n = this.width * this.height;
    const dst = out ?? new Uint8ClampedArray(n * 4);
    const words = new Uint32Array(dst.buffer, dst.byteOffset, n);
    const src = this.pixels;
    for (let i = 0; i < n; i++) {
      const p = src[i] * 3;
      // Little-endian RGBA word: 0xAABBGGRR.
      words[i] = 0xff000000 | (palette[p + 2] << 16) | (palette[p + 1] << 8) | palette[p];
    }
    return dst;
  }
}

export { rectHeight, rectWidth };
