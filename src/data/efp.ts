/**
 * Decoders for the original's indexed image formats: EFP, EFP2, PCX and SCI
 * (`CGraphicsBuffer::LoadEFP/LoadEFP2/LoadPCX/LoadSCI`).
 *
 * All produce a raw 8-bit index buffer; palettes are returned in their stored
 * (0..63) form unless noted. See docs/asset-formats.md.
 */

import { paletteFromFileTail, type Palette } from "./palette";

export interface IndexedImage {
  width: number;
  height: number;
  /** Row-major palette indices, length `width * height`. */
  pixels: Uint8Array;
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readI32LE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
      0) |
    0
  );
}

export function isEfp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 6 &&
    bytes[0] === 0x45 &&
    bytes[1] === 0x46 &&
    bytes[2] === 0x20 &&
    bytes[3] === 0x70 &&
    bytes[4] === 0x69 &&
    bytes[5] === 0x63
  );
}

/** Decodes an EFP (`"EF pic"`): 6-byte magic, u16 w, u16 h, RLE indices, 768-byte palette. */
export function decodeEfp(bytes: Uint8Array): IndexedImage {
  if (!isEfp(bytes)) throw new Error("decodeEfp: not an EFP file (bad magic)");
  const width = readU16LE(bytes, 6);
  const height = readU16LE(bytes, 8);
  const count = width * height;
  const pixels = new Uint8Array(count);
  let src = 10;
  let p = 0;
  while (p < count) {
    const t = bytes[src++];
    if (t > 192) {
      const value = bytes[src++];
      const run = t - 192;
      if (p + run > count) throw new Error("decodeEfp: RLE run overruns buffer");
      pixels.fill(value, p, p + run);
      p += run;
    } else {
      pixels[p++] = t;
    }
  }
  return { width, height, pixels };
}

/**
 * EFP2: `"EFP2"`, i32 width, i32 height, u8 bits (must be 8), 768-byte palette,
 * raw pixels.
 */
export function decodeEfp2(bytes: Uint8Array): IndexedImage {
  if (!(bytes[0] === 0x45 && bytes[1] === 0x46 && bytes[2] === 0x50 && bytes[3] === 0x32)) {
    throw new Error("decodeEfp2: bad magic");
  }
  const width = readI32LE(bytes, 4);
  const height = readI32LE(bytes, 8);
  if (bytes[12] !== 8) throw new Error("decodeEfp2: only 8-bit EFP2 supported");
  const start = 13 + 768;
  return { width, height, pixels: bytes.slice(start, start + width * height) };
}

/** PCX: 8-bit, RLE from offset 128, palette in the last 768 bytes. */
export function decodePcx(bytes: Uint8Array): IndexedImage {
  const width = bytes[8] + 1 + (bytes[9] << 8);
  const height = bytes[10] + 1 + (bytes[11] << 8);
  const count = width * height;
  const pixels = new Uint8Array(count);
  let src = 128;
  let p = 0;
  while (p < count) {
    const t = bytes[src++];
    if (t > 192) {
      const value = bytes[src++];
      const run = t - 192;
      if (p + run > count) throw new Error("decodePcx: RLE run overruns buffer");
      pixels.fill(value, p, p + run);
      p += run;
    } else {
      pixels[p++] = t;
    }
  }
  return { width, height, pixels };
}

/** SCI: `"RIX3"`, u16 w, u16 h, u16 tag, 768-byte palette at offset 10, raw pixels at 778. */
export function decodeSci(bytes: Uint8Array): IndexedImage {
  if (!(bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x58 && bytes[3] === 0x33)) {
    throw new Error("decodeSci: bad magic");
  }
  const width = readU16LE(bytes, 4);
  const height = readU16LE(bytes, 6);
  // Palette at offset 10 (768 bytes), pixels at 778.
  return { width, height, pixels: bytes.slice(10 + 768, 10 + 768 + width * height) };
}

/** Extracts the trailing palette of an EFP/PCX file (values are 0..63). */
export function decodeEfpPalette(bytes: Uint8Array): Palette {
  return paletteFromFileTail(bytes);
}
