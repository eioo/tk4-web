/**
 * 256-colour palette plus the colour conversions used by the original
 * (`CPalette`, `CLightTable::ClosestInPalette`).
 *
 * The original computes in C `float` (32-bit). To reproduce it bit-for-bit we
 * round intermediates with `Math.fround` at the same points the C++ code would
 * produce a `float`. This matters because `ClosestInPalette` truncates floats
 * to ints and can otherwise pick a neighbouring palette entry.
 */

const f32 = Math.fround;

/** Precomputed float32 constants matching the literals in `CPalette.cpp`. */
const F_1_3 = f32(1 / 3);
const F_2_3 = f32(2 / 3);

/**
 * A 256-entry RGB palette stored as a flat `Uint8Array` of length 768
 * (`r,g,b` per entry), matching `CPalette::Color`.
 */
export type Palette = Uint8Array;

export function createPalette(): Palette {
  return new Uint8Array(256 * 3);
}

export function paletteColor(pal: Palette, index: number): [number, number, number] {
  const i = index * 3;
  return [pal[i], pal[i + 1], pal[i + 2]];
}

/** Reads a 768-byte `r,g,b` palette block (`CPalette::ReadPalette`). */
export function paletteFromBytes(bytes: Uint8Array, offset = 0): Palette {
  return bytes.slice(offset, offset + 256 * 3);
}

/** Reads the trailing 768-byte palette of an EFP/PCX file (`LoadEFPPal`). */
export function paletteFromFileTail(bytes: Uint8Array): Palette {
  return paletteFromBytes(bytes, bytes.length - 768);
}

/** Multiplies every channel by 4 in place (`CPalette::FourMultiply`). */
export function fourMultiply(pal: Palette): void {
  for (let i = 0; i < pal.length; i++) pal[i] <<= 2;
}

export function rgb2hsl(r0: number, g0: number, b0: number): [number, number, number] {
  const r = f32(r0 / 255);
  const g = f32(g0 / 255);
  const b = f32(b0 / 255);
  const cmax = Math.max(r, Math.max(g, b));
  const cmin = Math.min(r, Math.min(g, b));
  const l = f32(f32(cmax + cmin) / 2);
  if (cmax === cmin) return [0, 0, l];

  const s =
    l < 0.5
      ? f32(f32(cmax - cmin) / f32(cmax + cmin))
      : f32(f32(cmax - cmin) / f32(f32(2) - cmax - cmin));
  const delta = f32(cmax - cmin);
  let h: number;
  if (r === cmax) h = f32(f32(g - b) / delta);
  else if (g === cmax) h = f32(f32(2) + f32(f32(b - r) / delta));
  else h = f32(f32(4) + f32(f32(r - g) / delta));
  h = f32(h / 6);
  if (h < 0) h = f32(h + 1);
  return [h, s, l];
}

function hue2rgb(m1: number, m2: number, h0: number): number {
  let h = h0;
  if (h < 0) h = f32(h + 1);
  if (h > 1) h = f32(h - 1);
  if (f32(f32(6) * h) < 1) return f32(m1 + f32(f32(m2 - m1) * f32(h * 6)));
  if (f32(f32(2) * h) < 1) return m2;
  if (f32(f32(3) * h) < 2) return f32(m1 + f32(f32(m2 - m1) * f32(f32(F_2_3 - h) * 6)));
  return m1;
}

export function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const m2 = l <= 0.5 ? f32(l * f32(1 + s)) : f32(f32(l + s) - f32(l * s));
    const m1 = f32(f32(2 * l) - m2);
    r = hue2rgb(m1, m2, f32(h + F_1_3));
    g = hue2rgb(m1, m2, h);
    b = hue2rgb(m1, m2, f32(h - F_1_3));
  }
  return [f32(r * 255), f32(g * 255), f32(b * 255)];
}

/** `CLightTable::ClosestInPalette` — L1 nearest colour, first match wins. */
export function closestInPalette(r: number, g: number, b: number, pal: Palette): number {
  let minv = 1000;
  let closest = 0;
  for (let a = 0; a < 256; a++) {
    const i = a * 3;
    const v = Math.abs(pal[i] - r) + Math.abs(pal[i + 1] - g) + Math.abs(pal[i + 2] - b);
    if (v < minv) {
      minv = v;
      closest = a;
    }
  }
  return closest;
}
