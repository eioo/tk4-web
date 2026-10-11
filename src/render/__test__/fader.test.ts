import { describe, expect, test } from "bun:test";

import { sha256 } from "../../data/__test__/helpers";
import { GraphicsFader } from "../fader";
import { Framebuffer } from "../fb";

// SHA-256 of `DrawPhase(77)` followed by `DrawZoom(0.6)`, produced by the C++
// oracle (`/tmp/render_gen fader <out.raw>`).
const HASH = "5e1eeec1ee35b172c0e3be8e035cb939d8ac699952861d3ad70f5c141bd63a8d";

describe("fader matches the C++ oracle byte-for-byte", () => {
  test("DrawPhase and DrawZoom", () => {
    const width = 320;
    const height = 200;
    const src = new Framebuffer(width, height);
    for (let i = 0; i < width * height; i++) src.pixels[i] = (i * 7) & 0x3f;

    const fader = new GraphicsFader();
    const dest = new Framebuffer(width, height);
    fader.drawPhase(77, src, dest);

    const zoom = new Framebuffer(width, height);
    fader.drawZoom(0.6, src, zoom);

    const out = new Uint8Array(width * height * 2);
    out.set(dest.pixels, 0);
    out.set(zoom.pixels, width * height);
    expect(sha256(out)).toBe(HASH);
  });
});
