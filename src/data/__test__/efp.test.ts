import { describe, expect, test } from "bun:test";

import { decodeEfp, decodeEfpPalette, isEfp } from "../efp";
import { readRef } from "./helpers";

// Expected dimensions, taken independently from the EFP headers.
const EFP_DIMENSIONS: Record<string, [number, number]> = {
  "bodyp.efp": [320, 20],
  "bomb2.efp": [280, 7],
  "c4.efp": [8, 8],
  "crates.efp": [320, 14],
  "effects.efp": [320, 82],
  "enemy0.efp": [1160, 232],
  "enemy1.efp": [1160, 232],
  "enemy9.efp": [1160, 232],
  "floor1.efp": [320, 600],
  "floor1.generated.efp": [320, 600],
  "mine.efp": [7, 7],
  "polycolr.efp": [16, 60],
  "rambo1.efp": [2320, 262],
  "rambo2.efp": [2320, 175],
  "rambo3.efp": [2320, 204],
  "rambo4.efp": [2320, 175],
  "shadows.efp": [320, 20],
  "shopback_normal.efp": [640, 480],
  "walls1.efp": [320, 600],
  "walls1_1.generated.efp": [336, 630],
  "walls1_2.generated.efp": [352, 660],
  "walls1_3.generated.efp": [368, 690],
  "walls1_4.generated.efp": [384, 720],
  "walls1_5.generated.efp": [400, 750],
};

describe("EFP decoder", () => {
  for (const [name, [w, h]] of Object.entries(EFP_DIMENSIONS)) {
    test(`${name} decodes to ${w}x${h}`, async () => {
      const bytes = await readRef(`efps/${name}`);
      expect(isEfp(bytes)).toBe(true);
      const img = decodeEfp(bytes);
      expect([img.width, img.height]).toEqual([w, h]);
      expect(img.pixels.length).toBe(w * h);
      // Every pixel must be a valid palette index.
      for (let i = 0; i < img.pixels.length; i++) {
        expect(img.pixels[i]).toBeLessThanOrEqual(255);
      }
    });
  }

  test("rejects non-EFP data", async () => {
    const bytes = await readRef("efps/walls1.efp");
    const fake = bytes.slice(0, 16);
    fake[0] = 0;
    expect(isEfp(fake)).toBe(false);
  });

  test("extracts the trailing 768-byte palette (0..63)", async () => {
    const bytes = await readRef("efps/walls1.efp");
    const pal = decodeEfpPalette(bytes);
    expect(pal.length).toBe(768);
    for (let i = 0; i < pal.length; i++) expect(pal[i]).toBeLessThanOrEqual(63);
  });
});
