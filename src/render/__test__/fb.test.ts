import { describe, expect, test } from "bun:test";

import { Framebuffer } from "../fb";

function paletteWith(entries: Array<[number, number, number, number]>): Uint8Array {
  const pal = new Uint8Array(256 * 3);
  for (const [index, r, g, b] of entries) {
    pal[index * 3] = r;
    pal[index * 3 + 1] = g;
    pal[index * 3 + 2] = b;
  }
  return pal;
}

describe("Framebuffer", () => {
  test("toRgba maps indices through the palette with opaque alpha", () => {
    const pal = paletteWith([
      [0, 10, 20, 30],
      [1, 1, 2, 3],
      [200, 255, 128, 0],
    ]);
    const fb = new Framebuffer(3, 1);
    fb.pixels[0] = 0;
    fb.pixels[1] = 1;
    fb.pixels[2] = 200;
    expect([...fb.toRgba(pal)]).toEqual([10, 20, 30, 255, 1, 2, 3, 255, 255, 128, 0, 255]);
  });

  test("toRgba reuses a provided buffer", () => {
    const pal = paletteWith([[0, 9, 9, 9]]);
    const fb = new Framebuffer(1, 1);
    const out = new Uint8ClampedArray(4);
    expect(fb.toRgba(pal, out)).toBe(out);
  });

  test("fillRect and putPixelClip stay in bounds", () => {
    const fb = new Framebuffer(4, 2);
    fb.fillRect({ left: 1, top: 0, right: 3, bottom: 2 }, 7);
    expect([...fb.pixels]).toEqual([0, 7, 7, 0, 0, 7, 7, 0]);

    fb.putPixelClip(3, 1, 5, { left: 0, top: 0, right: 3, bottom: 2 });
    expect(fb.pixels[1 * 4 + 3]).toBe(0);
    fb.putPixelClip(2, 1, 5, { left: 0, top: 0, right: 4, bottom: 2 });
    expect(fb.pixels[1 * 4 + 2]).toBe(5);
  });

  test("clear zeroes the buffer", () => {
    const fb = new Framebuffer(2, 2);
    fb.pixels.fill(9);
    fb.clear();
    expect([...fb.pixels]).toEqual([0, 0, 0, 0]);
  });
});
