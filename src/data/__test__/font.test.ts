import { describe, expect, test } from "bun:test";

import { decodeFnt } from "../font";
import { readRef } from "./helpers";

const FONTS: Array<[string, number, number]> = [
  ["8x8b.fnt", 8, 8],
  ["menu15x18dark.fnt", 15, 18],
  ["menu15x18gray.fnt", 15, 18],
  ["menu15x18light.fnt", 15, 18],
  ["menu25x30dark.fnt", 25, 30],
  ["menu25x30gray.fnt", 25, 30],
  ["menu25x30light.fnt", 25, 30],
  ["snumbers.fnt", 3, 5],
];

describe(".fnt decoder", () => {
  for (const [name, w, h] of FONTS) {
    test(`${name} (${w}x${h})`, async () => {
      const bytes = await readRef(`fnts/${name}`);
      expect(bytes.length).toBe(512 + 256 * w * h);
      const font = decodeFnt(bytes);
      expect(font.width).toBe(w);
      expect(font.height).toBe(h);
      expect(font.glyphs.length).toBe(256 * w * h);
    });
  }
});
