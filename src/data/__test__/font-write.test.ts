import { describe, expect, test } from "bun:test";

import { Framebuffer } from "../../render/fb";
import { HAlign, VAlign, decodeFnt, fontWrite } from "../font";
import { readRef, sha256 } from "./helpers";

// SHA-256 of the frame produced by the C++ oracle
// (`/tmp/render_gen fontwrite <datadir> <out.raw>`), which renders the same
// strings through the verbatim `CFonts::Write`.
const HASH = "a562191fa0f4eb32efbd265ecd863bfced62c89ed3980018cccf37c8ef4e41e5";

describe("fontWrite matches the C++ oracle byte-for-byte", () => {
  test("CFonts::Write alignment, oneIsZero and scaling", async () => {
    const font = decodeFnt(await readRef("fnts/8x8b.fnt"));
    const menu = decodeFnt(await readRef("fnts/menu15x18dark.fnt"));

    const width = 320;
    const height = 200;
    const fb = new Framebuffer(width, height);
    for (let i = 0; i < width * height; i++) fb.pixels[i] = (i * 5 + 3) & 0x3f;

    const f = (x: number, y: number, text: string, v: VAlign, h: HAlign): void => {
      fontWrite(font, fb, x, y, text, v, h, true);
    };
    f(4, 4, "Hello, World! 0123", VAlign.Below, HAlign.ToRight);
    f(160, 30, "centered", VAlign.InVertMiddle, HAlign.InMiddle);
    f(310, 60, "right", VAlign.Below, HAlign.ToLeft);
    f(40, 90, "above me", VAlign.Above, HAlign.ToRight);
    f(10, 150, "tab\ttest", VAlign.Below, HAlign.ToRight);
    f(10, 170, "jY{}[]<>=+-*/", VAlign.Below, HAlign.ToRight);
    fontWrite(menu, fb, 8, 120, "BIG", VAlign.InVertMiddle, HAlign.ToRight, false, 2, 2);

    expect(sha256(fb.pixels)).toBe(HASH);
  });
});
