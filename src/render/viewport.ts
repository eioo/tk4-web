/**
 * Split-screen viewport layout — a port of `CDynGameData::GraphicsModeChanged`.
 *
 * For N local players the screen is divided into N viewports (each drawn with
 * its own camera and HUD) and, for the 3-player layout, two black letterbox
 * rects. Rect widths/heights use C++ integer division (`mode.X()/2`), so the
 * helpers mirror that exactly. `CDynGameData::PlayerDrawRect` indexes the table
 * by `count - 1`; `playerDrawRects` returns just the row for `count`.
 */

import { idiv, makeRect, type Rect } from "./rect";

/**
 * The N viewports for `count` (1–4) local players in a `width`×`height`
 * framebuffer, in seat order. Matches `iDrawRects[count-1]`.
 *
 * ```
 *   1: full          2: left|right
 *   3:  [1][2]       4:  [1][2]
 *       [  3  ]          [3][4]   (3 letterboxes the sides of row 2, below)
 * ```
 */
export function playerDrawRects(width: number, height: number, count: number): Rect[] {
  switch (count) {
    case 2:
      return [makeRect(0, 0, idiv(width, 2), height), makeRect(idiv(width, 2), 0, width, height)];
    case 3:
      return [
        makeRect(0, 0, idiv(width, 2), idiv(height, 2)),
        makeRect(idiv(width, 2), 0, width, idiv(height, 2)),
        makeRect(idiv(width, 4), idiv(height, 2), idiv(width * 3, 4), height),
      ];
    case 4:
      return [
        makeRect(0, 0, idiv(width, 2), idiv(height, 2)),
        makeRect(idiv(width, 2), 0, width, idiv(height, 2)),
        makeRect(0, idiv(height, 2), idiv(width, 2), height),
        makeRect(idiv(width, 2), idiv(height, 2), width, height),
      ];
    default:
      return [makeRect(0, 0, width, height)];
  }
}

/**
 * Black letterbox rects for `count` players (`iBlackRects[count-1]`). Only the
 * 3-player layout has any: the two sides of the bottom row that seat 3's
 * centred viewport leaves empty.
 */
export function blackRects(width: number, height: number, count: number): Rect[] {
  if (count !== 3) return [];
  return [
    makeRect(0, idiv(height, 2), idiv(width, 4), height),
    makeRect(idiv(width * 3, 4), idiv(height, 2), width, height),
  ];
}
