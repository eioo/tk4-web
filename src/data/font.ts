/**
 * `.fnt` bitmap font decoder (`CFonts::Load`).
 *
 * Layout: byte 0 = width, byte 1 = height, then glyph data read from the
 * absolute file offset 512. Total file size is `512 + 256 * width * height`.
 * Note the original `fseek(fnt, 256*2, SEEK_SET)` seeks to 512 absolutely (not
 * to 2 + 512), so exactly 510 bytes between the header and the glyphs are
 * skipped. See docs/06-asset-formats.md.
 */

import type { Rect } from "../render/rect";

export interface Font {
  width: number;
  height: number;
  /** 256 glyphs, each `width * height` bytes, row-major. */
  glyphs: Uint8Array;
}

/** `CFonts::TVertAlign`. */
export const enum VAlign {
  Below = 0,
  InVertMiddle = 1,
  Above = 2,
}

/** `CFonts::THorizAlign`. */
export const enum HAlign {
  ToRight = 0,
  InMiddle = 1,
  ToLeft = 2,
}

/** Minimal framebuffer surface `CFonts::Write` needs (`CGraphicsBuffer`). */
export interface FontTarget {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
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
export function fontLength(font: Font, text: string, scaleX = 1): number {
  return fontNaturalLength(font, text) * scaleX;
}

function fontNaturalLength(font: Font, text: string): number {
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

/**
 * `CFonts::Write` — blits `text` into an index framebuffer, returning the
 * (possibly empty) bounding rect `CRect(aX, aY, maxX + 1, maxY + 1)`.
 *
 * `oneIsZero` mirrors the C++ `iOneIsZero`: for the in-game `8x8b.fnt` a glyph
 * value of `1` is transparent (written as index 0). `scaleX`/`scaleY` mirror
 * `SetScaleX`/`SetScaleY` (the "large text" option, off by default).
 *
 * Note the two intentional quirks kept from the original: the horizontal
 * alignment uses `Length` (which counts `xpos2 - xpos1 + 1` columns) while the
 * glyph loop draws only `xpos2 - xpos1` columns, so text is one pixel narrower
 * than `Length` reports; and the in-bounds test before the scaled sub-pixel
 * loop uses the unscaled position.
 */
export function fontWrite(
  font: Font,
  target: FontTarget,
  x: number,
  y: number,
  text: string,
  vAlign: VAlign,
  hAlign: HAlign,
  oneIsZero: boolean,
  scaleX = 1,
  scaleY = 1,
): Rect {
  const { width, height, glyphs } = font;
  const fsize = width * height;
  let maxX = x;
  let maxY = y;

  if (text.length === 0) return { left: 0, top: 0, right: 0, bottom: 0 };

  if (vAlign === VAlign.InVertMiddle) y -= Math.trunc((height * scaleY) / 2);
  else if (vAlign === VAlign.Above) y -= height * scaleY;

  if (hAlign === HAlign.InMiddle) x -= Math.trunc(fontLength(font, text, scaleX) / 2);
  else if (hAlign === HAlign.ToLeft) x -= fontLength(font, text, scaleX);

  const px = target.pixels;
  const tw = target.width;
  const th = target.height;
  let textcnt = 0;

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

    c = width;
    col = 0;
    while (col === 0 && c > 0) {
      for (let d = 0; d < height; d++) if (glyphs[base + d * width + (c - 1)] !== 0) col = 1;
      if (col === 0) c--;
    }
    const xpos2 = c;

    const drawX1 = xpos1 > xpos2 ? 0 : xpos1;
    const drawX2 = xpos1 > xpos2 ? Math.trunc(width / 2) : xpos2;

    for (let d = 0; d < height * scaleY; d += scaleY) {
      const rowBase = base + Math.trunc(d / scaleY) * width;
      for (let cc = drawX1; cc < drawX2; cc++) {
        let pixel = glyphs[rowBase + cc];
        if (pixel === 0) continue;
        if (
          d + y < th &&
          d + y >= 0 &&
          cc - drawX1 + x + textcnt < tw &&
          cc - drawX1 + x + textcnt >= 0
        ) {
          if (pixel === 1 && oneIsZero) pixel = 0;
          for (let subX = 0; subX < scaleX; subX++) {
            for (let subY = 0; subY < scaleY; subY++) {
              const tx = (cc - drawX1) * scaleX + x + textcnt + subX;
              const ty = d + y + subY;
              if (tx >= 0 && tx < tw && ty >= 0 && ty < th) px[ty * tw + tx] = pixel;
            }
          }
          if ((cc - drawX1) * scaleX + x + textcnt > maxX)
            maxX = (cc - drawX1) * scaleX + x + textcnt;
          if (d + y > maxY) maxY = d + y;
        }
      }
    }
    textcnt += (drawX2 - drawX1) * scaleX;
  }
  return { left: x, top: y, right: maxX + 1, bottom: maxY + 1 };
}
