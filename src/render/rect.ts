/**
 * Minimal geometry helpers mirroring `CRect<int>` / `CCoord<int>` from the
 * original (`common/CRect.h`, `common/CCoord.h`). Rects use exclusive
 * `right`/`bottom` (width = right - left), exactly like the C++ class.
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

export function makeRect(left: number, top: number, right: number, bottom: number): Rect {
  return { left, top, right, bottom };
}

export function rectWidth(r: Rect): number {
  return r.right - r.left;
}

export function rectHeight(r: Rect): number {
  return r.bottom - r.top;
}

/** `CRect::Valid`. */
export function rectValid(r: Rect): boolean {
  return r.right > r.left && r.bottom > r.top;
}

/** `CRect::Inside`. */
export function rectInside(r: Rect, x: number, y: number): boolean {
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

/** `CRect::FixSmall` — pull a point one pixel inside the rect if it sits on the edge. */
export function fixSmall(r: Rect, p: Point): void {
  if (p.x + 1 === r.left) p.x = r.left;
  if (p.x === r.right) p.x = r.right - 1;
  if (p.y + 1 === r.top) p.y = r.top;
  if (p.y === r.bottom) p.y = r.bottom - 1;
}

/** Integer division that truncates toward zero (C++ `int` division). */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}
