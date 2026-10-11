import { describe, expect, test } from "bun:test";

import { decodeEfpPalette, decodePcx } from "../efp";
import { readRef, sha256 } from "./helpers";

// SHA-256 of the buffer produced by the C++ oracle
// (`/tmp/render_gen pcx <file> <out.raw>`), which is the little-endian
// `width,height`, the decoded index buffer and the trailing 768-byte palette.
const HASHES: Record<string, string> = {
  "efps/menu.pcx": "7179accf58ae2b6a9e70ffc4a03936b3c65e7fe2d5c99028865512f2f3061500",
  "efps/eflogo.pcx": "64a487700fb7f64c616985c7cec3adcf0a53705390c868f356cde51ac9a5e9a0",
};

for (const [path, hash] of Object.entries(HASHES)) {
  test(`decodePcx matches the C++ oracle: ${path}`, async () => {
    const bytes = await readRef(path);
    const image = decodePcx(bytes);
    const palette = decodeEfpPalette(bytes);
    const out = new Uint8Array(8 + image.pixels.length + palette.length);
    new DataView(out.buffer).setUint32(0, image.width, true);
    new DataView(out.buffer).setUint32(4, image.height, true);
    out.set(image.pixels, 8);
    out.set(palette, 8 + image.pixels.length);
    expect(sha256(out)).toBe(hash);
  });
}

describe("decodePcx", () => {
  test("reads dimensions", async () => {
    const image = decodePcx(await readRef("efps/menu.pcx"));
    expect(image.width).toBe(640);
    expect(image.height).toBe(480);
  });
});
