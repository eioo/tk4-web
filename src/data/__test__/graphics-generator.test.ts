import { describe, expect, test } from "bun:test";

import { decodeEfp, decodeEfpPalette } from "../efp";
import { makeFloors, rotateSprites, zoomWall } from "../graphics-generator";
import { fourMultiply } from "../palette";
import { readRef, sha256 } from "./helpers";

// SHA-256 of the pixel buffers produced by the C++ oracle
// (tools/reference/rotate_gen.cpp). Byte-exact parity requirement.
const ROTATE: Array<[string, number, string]> = [
  ["rambo1.efp", 80, "858b2e3f0f14dabb2e4cf9db8167d9ed2204f569f6de31415058830f3ad05ef1"],
  ["rambo2.efp", 80, "5847d31fa6b3e48d5a43c3a3955347548e5147a1fcf302813d61bfc5aafd750d"],
  ["rambo3.efp", 80, "9f872476c561c356d035705c55ce7aa64dbdf2f777b07d9dc5a2e67aa2451aab"],
  ["rambo4.efp", 80, "676519996ca66117eb98d4459a018259711160266db21e5c4f20edf821521509"],
  ["enemy0.efp", 40, "5cc720ccebc8d635d6d2d3938728480641d0cfaef7e66ec2f6ba16c3d962cba9"],
  ["enemy1.efp", 40, "e76749949d45dae2b640133021c23df02f77a8323f09bfc8da593fe2ba9cfb13"],
  ["enemy9.efp", 40, "1992ef2de8835f7c5dbca7c3f88a68c64ae44387c5ee592e2122f800a0031458"],
];

const ZOOM: Array<[number, number, string]> = [
  [1, 336, "05eee0bef8ecefcf1402f7d923276b296b974ec62b9e1d2850f4a28bda640afa"],
  [2, 352, "cd8923f2d45765334e3b9788d36b2d8943d87187d1a25b63ba94435f1c15a28a"],
  [3, 368, "e361068aa92969611255ad082304f1dada9463a105d0e4305cb29441b6d75d5b"],
  [4, 384, "904b83f1a4863049ef4ded8b4b495bbbd60cee205ea2ee56a5f8239da3f49ae2"],
  [5, 400, "1ff03ebcca3be8d40817ad0fe9a360b6011db2a2f8d6eae1868e6e1ed153d7f2"],
];

describe("rotateSprites matches the C++ oracle byte-for-byte", () => {
  for (const [name, angles, hash] of ROTATE) {
    test(name, async () => {
      const img = decodeEfp(await readRef(`efps/${name}`));
      const out = rotateSprites(img, 28, angles);
      expect(out.pixels.length).toBe(out.width * out.height);
      expect(sha256(out.pixels)).toBe(hash);
    });
  }
});

describe("zoomWall matches the C++ oracle byte-for-byte", () => {
  for (const [level, width, hash] of ZOOM) {
    test(`walls1 level ${level}`, async () => {
      const src = decodeEfp(await readRef("efps/walls1.efp"));
      const out = zoomWall(src, level - 1);
      expect(out.width).toBe(width);
      expect(sha256(out.pixels)).toBe(hash);
    });
  }
});

describe("makeFloors matches the C++ oracle byte-for-byte", () => {
  test("floor1 darkened with the walls1 palette", async () => {
    const src = decodeEfp(await readRef("efps/floor1.efp"));
    const pal = decodeEfpPalette(await readRef("efps/walls1.efp"));
    fourMultiply(pal);
    const out = makeFloors(src, pal);
    expect(sha256(out.pixels)).toBe(
      "807212d07716b086c837c4e9296b8c0377048f4a2b4710bd4b46446342296a8c",
    );
  });
});
