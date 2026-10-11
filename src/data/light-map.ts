/**
 * `CLightMap` — the radial light falloff maps used by `CGameDrawer::DrawLight`.
 *
 * `CColorTable::Init` builds `KLightAmount` maps with sizes `15 + a * 5`
 * (15, 20, … 60). Each map is a square; the stored value is a 0..15 "light
 * strength" derived from the distance to the centre. `DrawLight` adds the
 * caller's luminance to that strength and clamps it, then looks the result up
 * in one of the four pre-baked light tables (`palette.tab`).
 *
 * The maths is copied verbatim from `CLightMap::Make`, keeping `float`
 * intermediates at 32-bit (`Math.fround`) so the maps hash-match the oracle.
 */

import { f32 } from "../core/math";

/** `KLightAmount` (`CColorTable.h`). */
export const KLightAmount = 10;

/** Size of the light map at `index` (`15 + index * 5`). */
export function lightMapSize(index: number): number {
  return 15 + index * 5;
}

/** `CLightMap::Make` — returns `size * size` light-strength values. */
export function makeLightMap(size: number): Uint8Array {
  const hsize = Math.trunc(size / 2);
  const data = new Uint8Array(size * size);
  // `(float)(16 / (float)(aSize / 2))` — note the integer `aSize / 2`.
  const scale = f32(16 / f32(hsize));
  for (let a = 0; a < size; a++) {
    for (let b = 0; b < size; b++) {
      const dx = a - hsize;
      const dy = b - hsize;
      const dist = Math.trunc(Math.sqrt(f32(dx * dx + dy * dy)));
      let strength = 16 - Math.trunc(f32(dist * scale));
      if (strength > 15) strength = 15;
      if (strength < 0) strength = 0;
      data[a * size + b] = strength;
    }
  }
  return data;
}

/** All `KLightAmount` light maps, indexed by light size. */
export function makeLightMaps(): Uint8Array[] {
  const maps: Uint8Array[] = [];
  for (let a = 0; a < KLightAmount; a++) maps.push(makeLightMap(lightMapSize(a)));
  return maps;
}
