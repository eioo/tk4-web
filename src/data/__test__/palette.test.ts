import { describe, expect, test } from "bun:test";

import { PALETTE_TAB_SIZE, decodePaletteTab } from "../color-tables";
import { decodeEfp, decodeEfpPalette } from "../efp";
import { closestInPalette, fourMultiply, paletteColor, rgb2hsl, hsl2rgb } from "../palette";
import { readRef } from "./helpers";

describe("palette", () => {
  test("walls1 tail is a valid 0..63 palette and fourMultiply scales it", async () => {
    const bytes = await readRef("efps/walls1.efp");
    const pal = decodeEfpPalette(bytes);
    expect(pal.length).toBe(768);
    for (let i = 0; i < pal.length; i++) expect(pal[i]).toBeLessThan(64);
    fourMultiply(pal);
    for (let i = 0; i < pal.length; i++) expect(pal[i] % 4).toBe(0);
    expect(paletteColor(pal, 0).length).toBe(3);
  });

  test("hsl round-trip is stable for grayscale", () => {
    for (const v of [0, 32, 128, 255]) {
      const [h, s, l] = rgb2hsl(v, v, v);
      expect(s).toBe(0);
      const [r, g, b] = hsl2rgb(h, s, l);
      expect(Math.round(r)).toBe(v);
      expect(Math.round(g)).toBe(v);
      expect(Math.round(b)).toBe(v);
    }
  });

  test("closestInPalette reproduces the exact colour it was given", async () => {
    const bytes = await readRef("efps/walls1.efp");
    const pal = decodeEfpPalette(bytes);
    fourMultiply(pal);
    for (const idx of [0, 1, 40, 200, 255]) {
      const [r, g, b] = paletteColor(pal, idx);
      // The palette may contain duplicate colours, so match the colour, not the index.
      expect(paletteColor(pal, closestInPalette(r, g, b, pal))).toEqual([r, g, b]);
    }
  });
});

describe("palette.tab", () => {
  test("is 86016 bytes with the documented table sizes", async () => {
    const bytes = await readRef("palette.tab");
    expect(bytes.length).toBe(PALETTE_TAB_SIZE);
    const tables = decodePaletteTab(bytes);
    expect(tables.transparency.length).toBe(256 * 256);
    expect(tables.shadow.length).toBe(256 * 16);
    expect(tables.normalLight.length).toBe(256 * 16);
    expect(tables.redLight.length).toBe(256 * 16);
    expect(tables.yellowLight.length).toBe(256 * 16);
    expect(tables.explosionLight.length).toBe(256 * 16);
  });
});

describe("EFP pixel sanity", () => {
  test("floor1 decodes with at least one non-zero pixel", async () => {
    const img = decodeEfp(await readRef("efps/floor1.efp"));
    let nonZero = 0;
    for (let i = 0; i < img.pixels.length; i++) if (img.pixels[i] !== 0) nonZero++;
    expect(nonZero).toBeGreaterThan(0);
  });
});
