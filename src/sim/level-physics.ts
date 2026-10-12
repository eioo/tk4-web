/**
 * Float-faithful level physics: `CLevel::Collision`,
 * `CLevel::VisibilityCheck` (with collision point), `Reachable`, `DustBlock`.
 *
 * The C++ versions compute in 32-bit `float`; the `f32` rounding points here
 * mirror the reference oracle (`tools/reference/simreference.h`) so bullet and
 * sight rays are bit-identical.
 */

import { f32 } from "../core/math";
import { KBlockSpriteSize } from "../data/constants";
import { type Level, collision, inLevel, levelData, reachable } from "../data/level";

export interface Float2 {
  x: number;
  y: number;
}

/** `CLevel::Collision` at a block coordinate. */
export function simCollision(level: Level, bx: number, by: number): boolean {
  return collision(level, bx, by);
}

/** `CLevel::Reachable`. */
export function simReachable(level: Level, bx: number, by: number): boolean {
  return reachable(level, bx, by);
}

/** `CLevel::DustBlock`. */
export function simDustBlock(level: Level, bx: number, by: number): boolean {
  if (!inLevel(level, bx, by)) return false;
  const num = levelData(level, bx, by).number;
  return DUST.includes(num);
}

const DUST = [
  0,
  16 * 4,
  16 * 5,
  16 * 5 + 2,
  16 * 6 + 1,
  16 * 6 + 1,
  16 * 6 + 2,
  16 * 7 + 1,
  16 * 7 + 2,
  16 * 7 + 3,
  21,
  22,
  23,
  24,
  21 + 16,
  22 + 16,
  23 + 16,
  24 + 16,
];

/** C++ `sign` macro. */
function sign(a: number): number {
  return a < 0 ? -1 : a > 0 ? 1 : 0;
}

/**
 * `CLevel::VisibilityCheck` — returns true if `src` and `dst` see each other.
 * When false, `collisionPoint` receives the last good position (like the
 * reference), which bullet bouncing relies on.
 */
export function simVisibilityCheck(
  level: Level,
  srcX: number,
  srcY: number,
  dstX: number,
  dstY: number,
): { visible: boolean; x: number; y: number } {
  const sx = f32(srcX);
  const sy = f32(srcY);
  const dx = f32(dstX - sx);
  const dy = f32(dstY - sy);
  const iterations = Math.trunc(Math.max(1, Math.max(Math.abs(dx), Math.abs(dy))));
  const xSign = sign(dx);
  const ySign = sign(dy);
  const xDelta = f32(dx / iterations);
  const yDelta = f32(dy / iterations);

  let oldX = sx;
  let oldY = sy;
  for (let a = 0; a <= iterations; a++) {
    const nx = f32(sx + f32(xDelta * a));
    const ny = f32(sy + f32(yDelta * a));
    if (
      simCollision(
        level,
        Math.trunc(f32(nx / KBlockSpriteSize)),
        Math.trunc(f32(ny / KBlockSpriteSize)),
      )
    ) {
      return { visible: false, x: oldX, y: oldY };
    }
    if (xSign !== 0 && ySign !== 0 && a > 0) {
      const cx = Math.trunc(f32(f32(nx - xSign) / KBlockSpriteSize));
      const cy = Math.trunc(f32(f32(ny - ySign) / KBlockSpriteSize));
      if (
        simCollision(level, cx, Math.trunc(f32(ny / KBlockSpriteSize))) &&
        simCollision(level, Math.trunc(f32(nx / KBlockSpriteSize)), cy)
      ) {
        return { visible: false, x: oldX, y: oldY };
      }
    }
    oldX = nx;
    oldY = ny;
  }
  return { visible: true, x: f32(dstX), y: f32(dstY) };
}
