/**
 * `CGraphicsFader` — the palette fades and the sine-warp "phase" transition the
 * original plays between states.
 *
 * `DrawPhase` shifts every pixel by a slowly varying sine offset (the wavy
 * dissolve), `DrawZoom` scales the current frame down for the zoom-out
 * transition, and the three `fade*` methods drive them from `TimerCounter`
 * while also reporting the palette multiplier the caller should apply.
 *
 * All arithmetic mirrors the C++ `int`/`float` behaviour: 32-bit float rounding
 * via `Math.fround`, truncating casts, and `>> 8` as an arithmetic shift.
 */

import type { Palette } from "../data/palette";

const f32 = Math.fround;
// oxlint-disable-next-line oxc/approx-constant -- must match the C++ `float` pi
const PI = f32(3.14159265358979);

/** Minimal flat index surface the fader reads/writes (`CGraphicsBuffer`). */
export interface Surface {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

/** `iSine[a] = (int)(255 * sin((float)a / 256 * pi * 2))`. */
function makeSineTable(): Int32Array {
  const sine = new Int32Array(256);
  for (let a = 0; a < 256; a++) {
    const arg = f32(f32(f32(a / 256) * PI) * 2);
    sine[a] = Math.trunc(255 * Math.sin(arg));
  }
  return sine;
}

/** Arithmetic `x >> 8` (matching C++ on the negative sine products). */
function shr8(x: number): number {
  return x >> 8;
}

export class GraphicsFader {
  private readonly sine = makeSineTable();

  /** `CGraphicsFader::DrawPhase`. `image` and `dest` must share dimensions. */
  drawPhase(phase: number, image: Surface, dest: Surface): void {
    const targetWidth = dest.width;
    const targetHeight = dest.height;
    const srcWidth = image.width;
    const src = image.pixels;
    const dst = dest.pixels;
    const l = (phase * 30) >> 8;

    for (let y = 0; y < dest.height; y++) {
      const yfix = shr8(l * this.sine[(y + phase) & 0xff]);
      const rowBase = y * targetWidth;
      if (yfix + y < 0 || yfix + y >= targetHeight) {
        dst.fill(0, rowBase, rowBase + targetWidth);
      } else {
        const srcRow = (y + yfix) * srcWidth;
        for (let x = 0; x < targetWidth; x++) {
          const xfix = x + shr8(l * this.sine[(x + phase) & 0xff]);
          dst[rowBase + x] = xfix > 0 && xfix < targetWidth ? src[srcRow + xfix] : 0;
        }
      }
    }
  }

  /** `CGraphicsFader::DrawZoom` — `mul` in `[0, 1]`. */
  drawZoom(mulIn: number, image: Surface, dest: Surface): void {
    const mul = f32(mulIn);
    const dstw = dest.width;
    const dsth = dest.height;
    const srcw = image.width;
    const dst = dest.pixels;
    const src = image.pixels;

    let yoffs = f32(f32(dsth * f32(1 - mul)) / 2);
    let d = 0;
    for (let y = 0; y < dsth; y++) {
      let xoffs = f32(f32(dstw * f32(1 - mul)) / 2);
      const iyo = Math.trunc(yoffs);
      for (let x = 0; x < dstw; x++) {
        const ixo = Math.trunc(xoffs);
        dst[d] = src[iyo * srcw + ixo];
        d++;
        xoffs = f32(xoffs + mul);
      }
      yoffs = f32(yoffs + mul);
    }
  }

  /** `CGraphicsFader::FadeIn`; returns the palette multiplier (0..256). */
  fadeIn(
    image: Surface,
    dest: Surface,
    startTime: number,
    lastingTime: number,
    time: number,
  ): number {
    if (time >= startTime + lastingTime) return 256;
    if (time >= startTime) {
      const mul = Math.max(Math.trunc(((time - startTime) * 256) / lastingTime), 0);
      this.drawPhase(255 - mul, image, dest);
      return mul;
    }
    return 0;
  }

  /** `CGraphicsFader::FadeOut`; returns the palette multiplier (0..255). */
  fadeOut(
    image: Surface,
    dest: Surface,
    startTime: number,
    lastingTime: number,
    time: number,
  ): number {
    if (time >= startTime + lastingTime) return 0;
    if (time >= startTime) {
      const phase = Math.trunc(((time - startTime) * 256) / lastingTime);
      this.drawPhase(phase, image, dest);
      return Math.max(255 - phase, 0);
    }
    return 255;
  }

  /** `CGraphicsFader::FadeZoomOut`; returns the palette multiplier (0..255). */
  fadeZoomOut(
    image: Surface,
    dest: Surface,
    startTime: number,
    lastingTime: number,
    time: number,
  ): number {
    if (time >= startTime + lastingTime) return 0;
    if (time >= startTime) {
      const phase = Math.trunc(((time - startTime) * 256) / lastingTime);
      this.drawZoom(f32(1 - f32(phase * f32(0.95 / 255))), image, dest);
      return 255 - phase;
    }
    return 255;
  }
}

/**
 * `CGraphicsDevice::SetPalette(pal, mul)`: scales every channel by `mul / 256`.
 * Writes into `out` (which may alias the input for an in-place fade).
 */
export function scalePalette(pal: Palette, mul: number, out: Palette): void {
  const m = mul <= 0 ? 0 : mul > 256 ? 256 : mul;
  for (let i = 0; i < 768; i++) out[i] = (pal[i] * m) >> 8;
}
