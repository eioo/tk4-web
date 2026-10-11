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

/**
 * `CFonts::Length` — the rendered width of a string, used by crate pickup text.
 * Glyph horizontal padding (transparent columns) is trimmed per glyph; an empty
 * glyph (e.g. space) counts as `width / 2`.
 */
export function fontLength(font: Font, text: string): number {
  const { width, height, glyphs } = font;
  const fsize = width * height;
  let length = 0;
  for (let a = 0; a < text.length; a++) {
    const code = text.charCodeAt(a) & 0xff;
    const base = code * fsize;
    let c = 0;
    let col = 0;
    while (col === 0 && c < width) {
      for (let d = 0; d < height; d++) if (glyphs[base + d * width + c] !== 0) col = 1;
      if (col === 0) c++;
    }
    const xpos1 = c;
    c = width - 1;
    col = 0;
    while (col === 0 && c > 0) {
      for (let d = 0; d < height; d++) if (glyphs[base + d * width + c] !== 0) col = 1;
      if (col === 0) c--;
    }
    let xpos2 = c;
    let left = xpos1;
    if (left > xpos2) {
      left = 0;
      xpos2 = Math.trunc(width / 2);
    }
    length += xpos2 - left + 1;
  }
  return length;
}
