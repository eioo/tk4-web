/**
 * `.fnt` bitmap font decoder (`CFonts::Load`).
 *
 * Layout: byte 0 = width, byte 1 = height, then glyph data read from the
 * absolute file offset 512. Total file size is `512 + 256 * width * height`.
 * Note the original `fseek(fnt, 256*2, SEEK_SET)` seeks to 512 absolutely (not
 * to 2 + 512), so exactly 510 bytes between the header and the glyphs are
 * skipped. See docs/06-asset-formats.md.
 */

export interface Font {
  width: number;
  height: number;
  /** 256 glyphs, each `width * height` bytes, row-major. */
  glyphs: Uint8Array;
}

export function decodeFnt(bytes: Uint8Array): Font {
  if (bytes.length < 2) throw new Error("decodeFnt: file too short");
  const width = bytes[0];
  const height = bytes[1];
  const glyphBytes = 256 * width * height;
  const start = 512;
  if (bytes.length < start + glyphBytes) {
    throw new Error(
      `decodeFnt: expected at least ${start + glyphBytes} bytes, got ${bytes.length}`,
    );
  }
  return { width, height, glyphs: bytes.slice(start, start + glyphBytes) };
}
