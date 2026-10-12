/**
 * `palette.tab` — the pre-baked colour tables (`CColorTable`).
 *
 * Layout (86016 bytes = 65536 + 5 × 4096):
 *   transparency[256][256], shadow[256][16],
 *   normalLight[256][16], redLight[256][16], yellowLight[256][16],
 *   explosionLight[256][16].
 * See docs/rendering-pipeline.md.
 */

export const TRANSPARENCY_SIZE = 256 * 256;
export const SHADOW_SIZE = 256 * 16;
export const LIGHT_SIZE = 256 * 16;
export const PALETTE_TAB_SIZE = TRANSPARENCY_SIZE + SHADOW_SIZE + 4 * LIGHT_SIZE;

export interface ColorTables {
  /** 50/50 blend of two palette indices: `transparency[a * 256 + b]`. */
  transparency: Uint8Array;
  /** Per-index lightness shadow ramp: `shadow[a * 16 + level]`. */
  shadow: Uint8Array;
  normalLight: Uint8Array;
  redLight: Uint8Array;
  yellowLight: Uint8Array;
  explosionLight: Uint8Array;
}

export function decodePaletteTab(bytes: Uint8Array): ColorTables {
  if (bytes.length !== PALETTE_TAB_SIZE) {
    throw new Error(`decodePaletteTab: expected ${PALETTE_TAB_SIZE} bytes, got ${bytes.length}`);
  }
  let o = 0;
  const slice = (n: number): Uint8Array => {
    const s = bytes.slice(o, o + n);
    o += n;
    return s;
  };
  return {
    transparency: slice(TRANSPARENCY_SIZE),
    shadow: slice(SHADOW_SIZE),
    normalLight: slice(LIGHT_SIZE),
    redLight: slice(LIGHT_SIZE),
    yellowLight: slice(LIGHT_SIZE),
    explosionLight: slice(LIGHT_SIZE),
  };
}
