/**
 * Port of `CGameDrawer` (`CGameDrawer.cpp`) — the low-level primitives that
 * write into the index framebuffer: blocks, wall shadows, sprites and the
 * fixed-point triangle rasteriser used by the camera-cone shadow cast.
 */

import type { ColorTables } from "../data/color-tables";
import { KBlockSpriteSize } from "../data/constants";
import { EBlockTypeFloor } from "../data/level";
import type { Framebuffer } from "./fb";
import {
  fixSmall,
  idiv,
  makeRect,
  rectHeight,
  rectValid,
  rectWidth,
  type Point,
  type Rect,
} from "./rect";

const KFixedPointBits = 10;

/** The subset of sprite sheets the static renderer needs. */
export interface SpriteView {
  pixels: Uint8Array;
  width: number;
  height: number;
}

export interface DrawSprites {
  floor: SpriteView;
  floor2: SpriteView;
  wall2: SpriteView;
  /** Wall sheets by height, index 0..5 (`EGameSpriteWalls` + height). */
  walls: SpriteView[];
  wallClr: SpriteView;
}

function setRange(buf: Uint8Array, offset: number, value: number, length: number): void {
  if (length <= 0) return;
  buf.fill(value, offset, offset + length);
}

function copyRange(
  dst: Uint8Array,
  dstOfs: number,
  src: Uint8Array,
  srcOfs: number,
  length: number,
): void {
  if (length <= 0) return;
  dst.set(src.subarray(srcOfs, srcOfs + length), dstOfs);
}

export class GameDrawer {
  constructor(private readonly tables: ColorTables) {}

  /** `CGameDrawer::ClipRect`. Returns the visible sub-rect *inside* the block. */
  clipRect(x: number, y: number, blockXSize: number, blockYSize: number, draw: Rect): Rect {
    const clip = makeRect(0, 0, blockXSize, blockYSize);
    if (x + blockXSize > draw.right) clip.right = blockXSize - (x + blockXSize - draw.right);
    if (x < draw.left) clip.left = draw.left - x;
    if (y + blockYSize > draw.bottom) clip.bottom = blockYSize - (y + blockYSize - draw.bottom);
    if (y < draw.top) clip.top = draw.top - y;
    return clip;
  }

  /** `CGameDrawer::DrawBlock`. */
  drawBlock(
    x: number,
    y: number,
    type: number,
    number: number,
    height: number,
    sprites: DrawSprites,
    fb: Framebuffer,
    draw: Rect,
  ): void {
    const xSize = height * 16 + 320;
    const blockSpriteSize = KBlockSpriteSize + height;
    const clip = this.clipRect(x, y, blockSpriteSize, blockSpriteSize, draw);
    if (!rectValid(clip)) return;

    const offset =
      (number & 15) * blockSpriteSize +
      idiv(number, 16) * xSize * blockSpriteSize +
      clip.top * xSize +
      clip.left;
    const tex = (type === EBlockTypeFloor ? sprites.floor : sprites.walls[height]).pixels;

    const w = rectWidth(clip);
    let src = offset;
    let dst = (y + clip.top) * fb.width + x + clip.left;
    for (let a = clip.top; a < clip.bottom; a++) {
      fb.pixels.set(tex.subarray(src, src + w), dst);
      src += xSize;
      dst += fb.width;
    }
  }

  /** `CGameDrawer::DrawDarkBlock` — writes the darkened tile into `dark`. */
  drawDarkBlock(
    x: number,
    y: number,
    type: number,
    number: number,
    dark: Uint8Array,
    sprites: DrawSprites,
    fb: Framebuffer,
    draw: Rect,
  ): void {
    const clip = this.clipRect(x, y, KBlockSpriteSize, KBlockSpriteSize, draw);
    if (!rectValid(clip)) return;

    let offset =
      (number & 15) * KBlockSpriteSize +
      idiv(number, 16) * 320 * KBlockSpriteSize +
      clip.top * 320 +
      clip.left;
    const spr = (type === EBlockTypeFloor ? sprites.floor2 : sprites.wall2).pixels;

    const w = rectWidth(clip);
    let dst = dark;
    let dstOfs = (clip.top + y) * fb.width + x + clip.left;
    for (let a = clip.top; a < clip.bottom; a++) {
      copyRange(dst, dstOfs, spr, offset, w);
      offset += 320;
      dstOfs += fb.width;
    }
  }

  /** `CGameDrawer::DrawWallShadow`. */
  drawWallShadow(
    x: number,
    y: number,
    number: number,
    size: number,
    fb: Framebuffer,
    draw: Rect,
  ): void {
    const lum = 6;
    const clip = this.clipRect(x, y, size, size, draw);
    if (!rectValid(clip)) return;

    const shadow = this.tables.shadow;
    const px = fb.pixels;
    let base = (y + clip.top) * fb.width + x;

    switch (number) {
      case 1:
        for (let a = clip.top; a < clip.bottom; a++, base += fb.width) {
          for (let b = clip.left; b < clip.right; b++)
            px[base + b] = shadow[px[base + b] * 16 + lum];
        }
        break;
      case 2:
        for (let a = clip.top; a < clip.bottom; a++, base += fb.width) {
          for (let b = Math.max(clip.left, size - a); b < clip.right; b++)
            px[base + b] = shadow[px[base + b] * 16 + lum];
        }
        break;
      case 3:
        for (let a = clip.top; a < clip.bottom; a++, base += fb.width) {
          for (let b = clip.left; b < size - a && clip.left < size - a && b < clip.right; b++) {
            px[base + b] = shadow[px[base + b] * 16 + lum];
          }
        }
        break;
      case 4:
        for (let a = clip.top; a < clip.bottom; a++, base += fb.width) {
          for (let b = clip.left + a; b < clip.right && clip.left + a < clip.right; b++) {
            px[base + b] = shadow[px[base + b] * 16 + lum];
          }
        }
        break;
      case 5:
        for (let a = clip.top; a < clip.bottom; a++, base += fb.width) {
          for (let b = clip.left; b < clip.right + a; b++)
            px[base + b] = shadow[px[base + b] * 16 + lum];
        }
        break;
    }
  }

  /** `CGameDrawer::DrawSprite` — transparent (skip index 0) blit of a sub-rect. */
  drawSprite(
    x: number,
    y: number,
    xs: number,
    ys: number,
    sprite: SpriteView,
    offset: number,
    fb: Framebuffer,
    draw: Rect,
  ): void {
    const clip = this.clipRect(x, y, xs, ys, draw);
    if (!rectValid(clip)) return;

    const px = fb.pixels;
    const sw = sprite.width;
    let src = offset + clip.left + clip.top * sw;
    let dst = (y + clip.top) * fb.width + x + clip.left;
    const w = rectWidth(clip);
    const dh = rectHeight(clip);
    for (let a = 0; a < dh; a++, dst += fb.width) {
      for (let b = 0; b < w; b++) {
        const colo = sprite.pixels[src + b];
        if (colo !== 0) px[dst + b] = colo;
      }
      src += sw;
    }
  }

  /** `CGameDrawer::DrawTransSprite` — 50/50 blend via `TransparencyTable`. */
  drawTransSprite(
    x: number,
    y: number,
    xs: number,
    ys: number,
    sprite: SpriteView,
    offset: number,
    fb: Framebuffer,
    draw: Rect,
  ): void {
    const clip = this.clipRect(x, y, xs, ys, draw);
    if (!rectValid(clip)) return;

    const transparency = this.tables.transparency;
    const px = fb.pixels;
    const sw = sprite.width;
    let src = offset + clip.left + clip.top * sw;
    let dst = (y + clip.top) * fb.width + x + clip.left;
    const w = rectWidth(clip);
    const dh = rectHeight(clip);
    for (let a = 0; a < dh; a++, dst += fb.width) {
      for (let b = 0; b < w; b++) {
        const colo = sprite.pixels[src + b];
        if (colo !== 0) px[dst + b] = transparency[colo * 256 + px[dst + b]];
      }
      src += sw;
    }
  }

  /** `CGameDrawer::DrawHumanShadow`. */
  drawHumanShadow(
    x: number,
    y: number,
    number: number,
    shadowSprite: Uint8Array,
    fb: Framebuffer,
    draw: Rect,
  ): void {
    const clip = this.clipRect(x, y, KBlockSpriteSize, KBlockSpriteSize, draw);
    if (!rectValid(clip)) return;

    const shadow = this.tables.shadow;
    const px = fb.pixels;
    let s = number * KBlockSpriteSize + clip.left + 320 * clip.top;
    let vb = (y + clip.top) * fb.width + x + clip.left;
    for (let a = 0; a < rectHeight(clip); a++, vb += fb.width, s += 320) {
      for (let b = 0; b < rectWidth(clip); b++) {
        const colo = shadowSprite[s + b];
        if (colo !== 0) px[vb + b] = shadow[px[vb + b] * 16 + colo];
      }
    }
  }

  private calcX(p1: Point, p2: Point, y: number): number {
    return p1.x + idiv((y - p1.y) * (p2.x - p1.x), p2.y - p1.y);
  }

  private calcY(p1: Point, p2: Point, x: number): number {
    return p1.y + idiv((x - p1.x) * (p2.y - p1.y), p2.x - p1.x);
  }

  /** Relative-coordinate overload of `CGameDrawer::DrawPolygon`. */
  drawPolygon(
    p1x: number,
    p1y: number,
    p2x: number,
    p2y: number,
    p3x: number,
    p3y: number,
    col: number,
    dark: Uint8Array | null,
    fb: Framebuffer,
    draw: Rect,
  ): void {
    if (col === -1 && dark === null) return;
    const p1: Point = { x: p1x + draw.left, y: p1y + draw.top };
    const p2: Point = { x: p2x + draw.left, y: p2y + draw.top };
    const p3: Point = { x: p3x + draw.left, y: p3y + draw.top };
    this.drawPolygonAbs(p1, p2, p3, col, dark, fb, draw);
  }

  private drawPolygonAbs(
    pa: Point,
    pb: Point,
    pc: Point,
    col: number,
    dark: Uint8Array | null,
    fb: Framebuffer,
    draw: Rect,
  ): void {
    // Order by X.
    let p1 = pa;
    let p2 = pb;
    let p3 = pc;
    let tmp: Point;
    if (p1.x > p2.x) {
      tmp = p1;
      p1 = p2;
      p2 = tmp;
    }
    if (p1.x > p3.x) {
      tmp = p1;
      p1 = p3;
      p3 = tmp;
    }
    if (p2.x > p3.x) {
      tmp = p2;
      p2 = p3;
      p3 = tmp;
    }

    if (p1.x !== p3.x) {
      if (p2.x < draw.left) {
        if (p3.x <= draw.left) return;
        p2.y = this.calcY(p3, p2, draw.left);
        p2.x = draw.left;
        p1.y = this.calcY(p3, p1, draw.left);
        p1.x = draw.left;
      } else if (p1.x < draw.left) {
        if (p3.x <= draw.left) return;
        const p4: Point = { x: draw.left, y: this.calcY(p3, p1, draw.left) };
        const p5: Point = { x: draw.left, y: this.calcY(p1, p2, draw.left) };
        if (p1.x === p4.x && p1.y === p4.y) return;
        if (p1.x === p5.x && p1.y === p5.y) return;
        this.drawPolygonAbs(p3, p4, p2, col, dark, fb, draw);
        this.drawPolygonAbs(p4, p5, p2, col, dark, fb, draw);
        return;
      }

      if (p2.x >= draw.right) {
        if (p1.x >= draw.right - 1) return;
        p2.y = this.calcY(p1, p2, draw.right - 1);
        p2.x = draw.right - 1;
        p3.y = this.calcY(p3, p1, draw.right - 1);
        p3.x = draw.right - 1;
      } else if (p3.x >= draw.right) {
        if (p1.x >= draw.right - 1) return;
        const p4: Point = { x: draw.right - 1, y: this.calcY(p3, p1, draw.right - 1) };
        const p5: Point = { x: draw.right - 1, y: this.calcY(p3, p2, draw.right - 1) };
        if (p3.x === p4.x && p3.y === p4.y) return;
        if (p3.x === p5.x && p3.y === p5.y) return;
        this.drawPolygonAbs(p1, p4, p2, col, dark, fb, draw);
        this.drawPolygonAbs(p4, p5, p2, col, dark, fb, draw);
        return;
      }
    } else return;

    // Order by Y.
    if (p1.y > p2.y) {
      tmp = p1;
      p1 = p2;
      p2 = tmp;
    }
    if (p1.y > p3.y) {
      tmp = p1;
      p1 = p3;
      p3 = tmp;
    }
    if (p2.y > p3.y) {
      tmp = p2;
      p2 = p3;
      p3 = tmp;
    }

    if (p1.y !== p3.y) {
      if (p2.y < draw.top) {
        if (p3.y <= draw.top) return;
        p1.x = this.calcX(p1, p3, draw.top);
        p1.y = draw.top;
        p2.x = this.calcX(p2, p3, draw.top);
        p2.y = draw.top;
      } else if (p1.y < draw.top) {
        if (p3.y <= draw.top) return;
        const p4: Point = { x: this.calcX(p1, p3, draw.top), y: draw.top };
        const p5: Point = { x: this.calcX(p1, p2, draw.top), y: draw.top };
        if (p1.x === p4.x && p1.y === p4.y) return;
        if (p1.x === p5.x && p1.y === p5.y) return;
        this.drawPolygonAbs(p3, p4, p2, col, dark, fb, draw);
        this.drawPolygonAbs(p4, p5, p2, col, dark, fb, draw);
        return;
      }

      if (p2.y >= draw.bottom) {
        if (p1.y >= draw.bottom - 1) return;
        p2.x = this.calcX(p2, p1, draw.bottom - 1);
        p2.y = draw.bottom - 1;
        p3.x = this.calcX(p3, p1, draw.bottom - 1);
        p3.y = draw.bottom - 1;
      } else if (p3.y >= draw.bottom) {
        if (p1.y >= draw.bottom - 1) return;
        const p4: Point = { x: this.calcX(p3, p1, draw.bottom - 1), y: draw.bottom - 1 };
        const p5: Point = { x: this.calcX(p3, p2, draw.bottom - 1), y: draw.bottom - 1 };
        if (p3.x === p4.x && p3.y === p4.y) return;
        if (p3.x === p5.x && p3.y === p5.y) return;
        this.drawPolygonAbs(p1, p4, p2, col, dark, fb, draw);
        this.drawPolygonAbs(p4, p5, p2, col, dark, fb, draw);
        return;
      }
    } else return;

    fixSmall(draw, p1);
    fixSmall(draw, p2);
    fixSmall(draw, p3);

    const h1 = p2.y - p1.y;
    let h2 = p3.y - p1.y;
    const k2 = idiv((p3.x - p1.x) << KFixedPointBits, h2);

    if (h1) {
      const k1 = idiv((p2.x - p1.x) << KFixedPointBits, h1);
      this.drawPolyTri(k1, k2, p1.x, p1.y, h1, col, dark, fb);
    }
    h2 -= h1;
    if (h2) {
      const k1 = idiv((p2.x - p3.x) << KFixedPointBits, h2);
      this.drawPolyTri(k1, -k2, p3.x, p3.y, -h2, col, dark, fb);
    }
  }

  /** `CGameDrawer::DrawPolyTri` (10-bit fixed point, one triangle half). */
  private drawPolyTri(
    k1: number,
    k2: number,
    x: number,
    y: number,
    aHeight: number,
    col: number,
    dark: Uint8Array | null,
    fb: Framebuffer,
  ): void {
    let adder = fb.width;
    let height = aHeight;
    const ofs = adder * y;
    if (height < 0) {
      adder = -adder;
      height = -height;
    }
    if (k1 > k2) {
      const t = k1;
      k1 = k2;
      k2 = t;
    }

    let dx = x << KFixedPointBits;
    let dx2 = dx;
    const px = fb.pixels;

    if (col < 0) {
      if (dark === null) return;
      let yg = ofs;
      let yg2 = ofs;
      for (let row = 0; row <= height; row++) {
        const left = dx >> KFixedPointBits;
        const len = (dx2 >> KFixedPointBits) - left + 1;
        copyRange(px, yg + left, dark, yg2 + left, len);
        yg += adder;
        yg2 += adder;
        dx += k1;
        dx2 += k2;
      }
    } else {
      let yg = ofs;
      for (let row = 0; row <= height; row++) {
        const left = dx >> KFixedPointBits;
        const len = (dx2 >> KFixedPointBits) - left + 1;
        setRange(px, yg + left, col, len);
        yg += adder;
        dx += k1;
        dx2 += k2;
      }
    }
  }
}
