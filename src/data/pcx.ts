/**
 * 256-colour PCX decoder (`CGraphicsBuffer::LoadPCX`).
 *
 * Only the subset the original exercises is implemented: 8-bit, one plane,
 * RLE-encoded, with the palette stored as the trailing 768 bytes. The original
 * uses the odd run marker test `tavu > 192` (an `unsigned char`, so values
 * 193..255 mean "repeat `tavu - 192` copies" and the value 192 is a literal
 * pixel), which is reproduced exactly. See docs/06-asset-formats.md.
 */

import { paletteFromFileTail, type Palette } from "./palette";

export interface PcxImage {
  readonly width: number;
  readonly height: number;
  /** `width * height` palette indices, row-major. */
  readonly pixels: Uint8Array;
  /** The trailing 768-byte palette (`r,g,b` per entry). */
  readonly palette: Palette;
}

export function decodePcx(bytes: Uint8Array): PcxImage {
  if (bytes.length < 128) throw new Error("decodePcx: file too short");
  const width = bytes[8] + (bytes[9] << 8) + 1;
  const height = bytes[10] + (bytes[11] << 8) + 1;
  const pixels = new Uint8Array(width * height);

  let p = 0;
  for (let i = 128; p < width * height;) {
    const tavu = bytes[i++];
    if (tavu > 192) {
      const tavu2 = bytes[i++];
      for (let n = tavu - 192; n > 0; n--) pixels[p++] = tavu2;
    } else {
      pixels[p++] = tavu;
    }
  }

  return { width, height, pixels, palette: paletteFromFileTail(bytes) };
}
