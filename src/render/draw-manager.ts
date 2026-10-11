/**
 * Static parts of `CGameDrawManager::DrawFrame` (`CGameDrawManager.cpp`):
 * floor, block shadows, the camera-cone "black parts of level" cast and the
 * pseudo-3D walls. Enough to render a loaded level with a fixed camera.
 *
 * Float expressions are rounded to 32-bit at the same points the C++ code
 * produces a `float`, so the fixed-point/perspective maths matches the
 * reference build.
 */

import { KBlockSpriteSize } from "../data/constants";
import { EGameSprite, type IngameData } from "../data/ingame-data";
import { EBlockTypeFloor, EBlockTypeWall, levelData, type Block, type Level } from "../data/level";
import type { DrawSprites, GameDrawer } from "./drawer";
import type { Framebuffer } from "./fb";
import { idiv, rectHeight, rectWidth, type Point, type Rect } from "./rect";

const f32 = Math.fround;

/** `(float)a / b * c` — float division then float multiply, truncated to int. */
function fmulDiv(a: number, b: number, c: number): number {
  return Math.trunc(f32(f32(a / b) * c));
}

/** `a / ((float)b / c)` — float division, truncated to int. */
function fdivFloat(a: number, b: number, c: number): number {
  return Math.trunc(f32(a / f32(b / c)));
}

/** `CLevel::FloorLevel` — floors, and walls of height 0, are walkable/drawable. */
function floorLevel(block: Block): boolean {
  return block.type === EBlockTypeFloor || block.height === 0;
}

/** Adapts a loaded `IngameData` to the sprite set the static renderer needs. */
export function toDrawSprites(data: IngameData): DrawSprites {
  return {
    floor: data.sprites[EGameSprite.Floor],
    floor2: data.sprites[EGameSprite.Floor2],
    wall2: data.sprites[EGameSprite.Wall2],
    walls: [0, 1, 2, 3, 4, 5].map((h) => data.sprites[EGameSprite.Walls + h]),
    wallClr: data.sprites[EGameSprite.WallClr],
  };
}

/** `CPlayer::InitScr` — screen position for a world location in a draw rect. */
export function screenPosFor(location: Point, drawRect: Rect): Point {
  return {
    x: Math.trunc(location.x) - idiv(rectWidth(drawRect), 2),
    y: Math.trunc(location.y) - idiv(rectHeight(drawRect), 2),
  };
}

export interface StaticScene {
  level: Level;
  sprites: DrawSprites;
  drawer: GameDrawer;
  fb: Framebuffer;
  /** Same size as `fb`; index buffer for the cone-cast source. */
  dark: Uint8Array;
  drawRect: Rect;
  /** Player screen position (`ScreenPos`). */
  screenPos: Point;
  /** Player world location (float); `+14` is applied internally. */
  playerLocation: Point;
}

export function drawFloor(
  level: Level,
  sprites: DrawSprites,
  drawer: GameDrawer,
  fb: Framebuffer,
  dark: Uint8Array,
  drawRect: Rect,
  scr: Point,
): void {
  const xEnd = Math.ceil(rectWidth(drawRect) / KBlockSpriteSize) + 1;

  let ovx: number;
  let xOfs: number;
  if (scr.x >= 0) {
    ovx = scr.x % KBlockSpriteSize;
    xOfs = idiv(scr.x, KBlockSpriteSize);
  } else {
    xOfs = idiv(scr.x + 1, KBlockSpriteSize) - 1;
    ovx = (scr.x + 10000) % KBlockSpriteSize;
  }

  let ovy: number;
  let yOfs: number;
  if (scr.y >= 0) {
    ovy = scr.y % KBlockSpriteSize;
    yOfs = idiv(scr.y, KBlockSpriteSize);
  } else {
    ovy = (10000 + scr.y) % KBlockSpriteSize;
    yOfs = idiv(scr.y + 1, KBlockSpriteSize) - 1;
  }

  const yEnd = Math.ceil(rectHeight(drawRect) / KBlockSpriteSize) + 1;
  for (let a = 0; a < yEnd; a++) {
    for (let b = 0; b < xEnd; b++) {
      const bx = xOfs + b;
      const by = yOfs + a;
      if (bx >= 0 && bx < level.width && by >= 0 && by < level.height) {
        const block = levelData(level, bx, by);
        if (floorLevel(block)) {
          const px = drawRect.left + b * KBlockSpriteSize - ovx;
          const py = drawRect.top + a * KBlockSpriteSize - ovy;
          drawer.drawBlock(px, py, block.type, block.number, 0, sprites, fb, drawRect);
          drawer.drawDarkBlock(px, py, block.type, block.number, dark, sprites, fb, drawRect);
        }
      }
    }
  }
}

export function drawShadows(
  level: Level,
  drawer: GameDrawer,
  fb: Framebuffer,
  drawRect: Rect,
  scr: Point,
): void {
  let ovx: number;
  let xOfs: number;
  if (scr.x >= 0) {
    ovx = scr.x % 20;
    xOfs = idiv(scr.x, 20);
  } else {
    ovx = (scr.x + 10000) % 20;
    xOfs = idiv(scr.x + 1, 20) - 1;
  }

  let ovy: number;
  let yOfs: number;
  if (scr.y >= 0) {
    ovy = scr.y % 20;
    yOfs = idiv(scr.y, 20);
  } else {
    ovy = (scr.y + 10000) % 20;
    yOfs = idiv(scr.y + 1, 20) - 1;
  }

  const yEnd = Math.ceil(rectHeight(drawRect) / 20) + 1;
  const xEnd = Math.ceil(rectWidth(drawRect) / 20) + 1;

  for (let a = Math.min(0, yOfs); a < yEnd; a++) {
    for (let b = Math.min(0, -xOfs); b < xEnd; b++) {
      const bx = xOfs + b;
      const by = yOfs + a;
      if (bx >= 0 && bx < level.width && by > 0 && by < level.height) {
        const block = levelData(level, bx, by);
        if (
          block.shadow > 0 &&
          (block.type === EBlockTypeFloor || (block.type === EBlockTypeWall && block.height === 0))
        ) {
          drawer.drawWallShadow(
            drawRect.left + b * 20 - ovx,
            drawRect.top + a * 20 - ovy,
            block.shadow,
            20,
            fb,
            drawRect,
          );
        }
      }
    }
  }
}

/** `CGameDrawManager::CheckCasting`. */
export function checkCasting(level: Level, xOfs: number, yOfs: number, mode: number): boolean {
  const cast = (x: number, y: number): boolean => levelData(level, x, y).castDarkness !== 0;
  switch (mode) {
    case 1:
      if (cast(xOfs - 1, yOfs) && cast(xOfs - 1, yOfs - 1) && cast(xOfs, yOfs - 1)) return false;
      break;
    case 2:
      if (cast(xOfs, yOfs + 1)) return false;
      break;
    case 3:
      if (cast(xOfs + 1, yOfs) && cast(xOfs + 1, yOfs - 1) && cast(xOfs, yOfs - 1)) return false;
      break;
    case 4:
      if (cast(xOfs + 1, yOfs)) return false;
      break;
    case 5:
      if (cast(xOfs - 1, yOfs)) return false;
      break;
    case 6:
      if (cast(xOfs - 1, yOfs) && cast(xOfs - 1, yOfs + 1) && cast(xOfs, yOfs + 1)) return false;
      break;
    case 7:
      if (cast(xOfs, yOfs - 1)) return false;
      break;
    case 8:
      if (cast(xOfs + 1, yOfs) && cast(xOfs + 1, yOfs + 1) && cast(xOfs, yOfs + 1)) return false;
      break;
  }
  return true;
}

export function drawBlackPartsOfLevel(scene: StaticScene): void {
  const { level, drawer, fb, dark, drawRect, screenPos, playerLocation } = scene;
  const scrXSize = rectWidth(drawRect);
  const drawH = rectHeight(drawRect);

  const eyeX = Math.trunc(playerLocation.x + 14 - screenPos.x);
  const eyeY = Math.trunc(playerLocation.y + 14 - screenPos.y);

  let xOffset: number;
  if (screenPos.x >= 0) xOffset = idiv(screenPos.x, KBlockSpriteSize);
  else xOffset = idiv(screenPos.x + 1, KBlockSpriteSize) - 1;

  let yOffset: number;
  if (screenPos.y >= 0) yOffset = idiv(screenPos.y, KBlockSpriteSize);
  else yOffset = idiv(screenPos.y + 1, KBlockSpriteSize) - 1;

  const px = [0, 0, 0, 0, 0];
  const py = [0, 0, 0, 0, 0];
  const poly = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): void => {
    drawer.drawPolygon(x0, y0, x1, y1, x2, y2, -1, dark, fb, drawRect);
  };

  for (let a = 0; a < idiv(drawH, KBlockSpriteSize); a++) {
    for (let b = 0; b < idiv(scrXSize, KBlockSpriteSize) + 1; b++) {
      const bx = xOffset + b;
      const by = yOffset + a;
      if (!(bx > 0 && bx < level.width - 1 && by > 0 && by < level.height - 1)) continue;
      if (!levelData(level, bx, by).castDarkness) continue;

      let drawPolys = false;
      const blockx = bx * KBlockSpriteSize - screenPos.x;
      const blocky = by * KBlockSpriteSize - screenPos.y;

      // Situation 1
      if (
        blockx + KBlockSpriteSize <= eyeX &&
        blocky + KBlockSpriteSize < eyeY &&
        checkCasting(level, bx, by, 1)
      ) {
        px[0] = blockx;
        py[0] = blocky + KBlockSpriteSize;
        px[1] = blockx + KBlockSpriteSize;
        py[1] = blocky;
        py[2] = py[0] - fmulDiv(eyeY - py[0], eyeX - px[0], px[0]);
        if (py[2] < 0) {
          px[2] = px[0] - fdivFloat(py[0], eyeY - py[0], eyeX - px[0]);
          py[2] = 0;
        } else px[2] = 0;
        if (px[2] > px[0]) px[2] = px[0];
        if (py[2] > py[0]) py[2] = py[0];
        py[3] = py[1] - fmulDiv(eyeY - py[1], eyeX - px[1], px[1]);
        if (py[3] <= 0) {
          px[3] = px[1] - fdivFloat(py[1], eyeY - py[1], eyeX - px[1]);
          py[3] = 0;
        } else px[3] = 0;
        if (px[3] > px[1]) px[3] = px[1];
        if (py[3] > py[1]) py[3] = py[1];
        if (px[2] !== px[3]) poly(px[2], py[2], px[3], py[3], 0, 0);
        drawPolys = true;
      }

      // Situation 2
      if (
        blockx + KBlockSpriteSize >= eyeX &&
        blockx <= eyeX &&
        blocky + KBlockSpriteSize < eyeY &&
        checkCasting(level, bx, by, 2)
      ) {
        px[0] = blockx - 1;
        py[0] = blocky + KBlockSpriteSize;
        px[1] = blockx + KBlockSpriteSize;
        py[1] = blocky + KBlockSpriteSize;
        if (eyeX !== px[0]) px[2] = px[0] - fdivFloat(py[0], eyeY - py[0], eyeX - px[0]);
        else px[2] = px[0];
        if (px[2] < 0) {
          py[2] = py[0] - fmulDiv(eyeY - py[0], eyeX - px[0], px[0]);
          px[2] = 0;
        } else py[2] = 0;
        if (eyeX !== px[1]) px[3] = px[1] - fdivFloat(py[1], eyeY - py[1], eyeX - px[1]);
        else px[3] = px[1];
        if (px[3] > scrXSize - 1) {
          py[3] = py[1] + fmulDiv(eyeY - py[1], eyeX - px[1], scrXSize - 1 - px[1]);
          px[3] = scrXSize - 1;
        } else py[3] = 0;
        if (py[2] > 0 && py[3] === 0) poly(px[2], py[2], px[3], py[3], 0, 0);
        if (py[2] === 0 && py[3] > 0) poly(px[2], py[2], px[3], py[3], scrXSize - 1, 0);
        if (py[2] > 0 && py[3] > 0) {
          poly(0, 0, px[3], py[3], scrXSize - 1, 0);
          poly(px[2], py[2], px[3], py[3], 0, 0);
        }
        drawPolys = true;
      }

      // Situation 3
      if (blockx > eyeX && blocky + KBlockSpriteSize < eyeY && checkCasting(level, bx, by, 3)) {
        px[0] = blockx;
        py[0] = blocky;
        px[1] = blockx + KBlockSpriteSize;
        py[1] = blocky + KBlockSpriteSize;
        py[2] = py[0] + fmulDiv(eyeY - py[0], eyeX - px[0], scrXSize - 1 - px[0]);
        if (py[2] < 0) {
          px[2] = px[0] - fdivFloat(py[0], eyeY - py[0], eyeX - px[0]);
          py[2] = 0;
        } else px[2] = scrXSize - 1;
        if (px[2] < px[0]) px[2] = px[0];
        if (py[2] > py[0]) py[2] = py[0];
        py[3] = py[1] + fmulDiv(eyeY - py[1], eyeX - px[1], scrXSize - 1 - px[1]);
        if (py[3] < 0) {
          px[3] = px[1] - fdivFloat(py[1], eyeY - py[1], eyeX - px[1]);
          py[3] = 0;
        } else px[3] = scrXSize - 1;
        if (px[3] < px[1]) {
          px[1] = scrXSize - 1;
          px[3] = px[1];
        }
        if (py[3] > py[1]) py[3] = py[1];
        if (px[2] !== px[3]) poly(px[2], py[2], px[3], py[3], scrXSize - 1, 0);
        drawPolys = true;
      }

      // Situation 4
      if (
        blockx < eyeX &&
        blocky <= eyeY &&
        blocky + KBlockSpriteSize >= eyeY &&
        checkCasting(level, bx, by, 4)
      ) {
        px[0] = blockx + KBlockSpriteSize;
        py[0] = blocky + KBlockSpriteSize;
        px[1] = blockx + KBlockSpriteSize;
        py[1] = blocky - 1;
        py[2] = py[0] - fmulDiv(eyeY - py[0], eyeX - px[0], px[0]);
        if (py[2] > drawH - 1) {
          px[2] = px[0] + fdivFloat(drawH - 1 - py[0], eyeY - py[0], eyeX - px[0]);
          py[2] = drawH - 1;
        } else px[2] = 0;
        py[3] = py[1] - fmulDiv(eyeY - py[1], eyeX - px[1], px[1]);
        if (py[3] < 0) {
          px[3] = px[1] - fdivFloat(py[1], eyeY - py[1], eyeX - px[1]);
          py[3] = 0;
        } else px[3] = 0;
        if (px[2] > 0 && px[3] === 0) poly(px[2], py[2], px[3], py[3], 0, drawH - 1);
        if (px[2] === 0 && px[3] > 0) poly(px[2], py[2], px[3], py[3], 0, 0);
        if (px[2] > 0 && px[3] > 0) {
          poly(0, 0, px[2], py[2], 0, drawH - 1);
          poly(px[2], py[2], px[3], py[3], 0, 0);
        }
        drawPolys = true;
      }

      // Situation 5
      if (
        blockx > eyeX &&
        blocky <= eyeY &&
        blocky + KBlockSpriteSize >= eyeY &&
        checkCasting(level, bx, by, 5)
      ) {
        px[0] = blockx;
        py[0] = blocky + KBlockSpriteSize;
        px[1] = blockx;
        py[1] = blocky - 1;
        py[2] = py[0] + fmulDiv(eyeY - py[0], eyeX - px[0], scrXSize - 1 - px[0]);
        if (py[2] > drawH - 1) {
          px[2] = px[0] + fdivFloat(drawH - py[0], eyeY - py[0], eyeX - px[0]);
          py[2] = drawH - 1;
        } else px[2] = scrXSize - 1;
        py[3] = py[1] + fmulDiv(eyeY - py[1], eyeX - px[1], scrXSize - 1 - px[1]);
        if (py[3] < 0) {
          px[3] = px[1] - fdivFloat(py[1], eyeY - py[1], eyeX - px[1]);
          py[3] = 0;
        } else px[3] = scrXSize - 1;
        if (px[2] < scrXSize - 1 && px[3] === scrXSize - 1)
          poly(px[2], py[2], px[3], py[3], scrXSize - 1, drawH - 1);
        if (px[2] === scrXSize - 1 && px[3] < scrXSize - 1)
          poly(px[2], py[2], px[3], py[3], scrXSize - 1, 0);
        if (px[2] < scrXSize - 1 && px[3] < scrXSize - 1) {
          poly(scrXSize - 1, 0, px[2], py[2], scrXSize - 1, drawH - 1);
          poly(px[2], py[2], px[3], py[3], scrXSize - 1, 0);
        }
        drawPolys = true;
      }

      // Situation 6
      if (blockx + KBlockSpriteSize < eyeX && blocky > eyeY && checkCasting(level, bx, by, 6)) {
        px[0] = blockx + KBlockSpriteSize;
        py[0] = blocky + KBlockSpriteSize;
        px[1] = blockx;
        py[1] = blocky;
        py[2] = py[0] - fmulDiv(eyeY - py[0], eyeX - px[0], px[0]);
        if (py[2] > drawH - 1) {
          px[2] = px[0] + fdivFloat(drawH - 1 - py[0], eyeY - py[0], eyeX - px[0]);
          py[2] = drawH - 1;
        } else px[2] = 0;
        if (px[2] > px[0]) px[2] = px[0];
        if (py[2] < py[0]) py[2] = py[0];
        py[3] = py[1] - fmulDiv(eyeY - py[1], eyeX - px[1], px[1]);
        if (py[3] > drawH - 1) {
          px[3] = px[1] + fdivFloat(drawH - 1 - py[1], eyeY - py[1], eyeX - px[1]);
          py[3] = drawH - 1;
        } else px[3] = 0;
        if (px[3] > px[1]) px[3] = px[1];
        if (py[3] < py[1]) py[3] = py[1];
        if (px[2] !== px[3]) poly(px[2], py[2], px[3], py[3], 0, drawH - 1);
        drawPolys = true;
      }

      // Situation 7
      if (
        blockx + KBlockSpriteSize >= eyeX &&
        blockx <= eyeX &&
        blocky > eyeY &&
        checkCasting(level, bx, by, 7)
      ) {
        px[0] = blockx - 1;
        py[0] = blocky;
        px[1] = blockx + KBlockSpriteSize;
        py[1] = blocky;
        if (eyeX !== px[0])
          px[2] = px[0] + fdivFloat(drawH - 1 - py[0], eyeY - py[0], eyeX - px[0]);
        else px[2] = px[0];
        if (px[2] < 0) {
          py[2] = py[0] - fmulDiv(eyeY - py[0], eyeX - px[0], px[0]);
          px[2] = 0;
        } else py[2] = drawH - 1;
        if (eyeX !== px[1])
          px[3] = px[1] + fdivFloat(drawH - 1 - py[1], eyeY - py[1], eyeX - px[1]);
        else px[3] = px[1];
        if (px[3] > scrXSize - 1) {
          py[3] = py[1] + fmulDiv(eyeY - py[1], eyeX - px[1], scrXSize - 1 - px[1]);
          px[3] = scrXSize - 1;
        } else py[3] = drawH - 1;
        if (py[2] < drawH - 1 && py[3] === drawH - 1)
          poly(px[2], py[2], px[3], py[3], 0, drawH - 1);
        if (py[2] === drawH - 1 && py[3] < drawH - 1)
          poly(px[2], py[2], px[3], py[3], scrXSize - 1, drawH - 1);
        if (py[2] < drawH - 1 && py[3] < drawH - 1) {
          poly(0, drawH - 1, px[3], py[3], scrXSize - 1, drawH - 1);
          poly(px[2], py[2], px[3], py[3], 0, drawH - 1);
        }
        drawPolys = true;
      }

      // Situation 8
      if (blockx > eyeX && blocky > eyeY && checkCasting(level, bx, by, 8)) {
        px[0] = blockx;
        py[0] = blocky + KBlockSpriteSize;
        px[1] = blockx + KBlockSpriteSize;
        py[1] = blocky;
        py[2] = py[0] + fmulDiv(eyeY - py[0], eyeX - px[0], scrXSize - 1 - px[0]);
        if (py[2] > drawH - 1) {
          px[2] = px[0] + fdivFloat(drawH - 1 - py[0], eyeY - py[0], eyeX - px[0]);
          py[2] = drawH - 1;
        } else px[2] = scrXSize - 1;
        if (px[2] < px[0]) px[2] = px[0];
        if (py[2] < py[0]) py[2] = py[0];
        py[3] = py[1] + fmulDiv(eyeY - py[1], eyeX - px[1], scrXSize - 1 - px[1]);
        if (py[3] > drawH - 1) {
          px[3] = px[1] + fdivFloat(drawH - 1 - py[1], eyeY - py[1], eyeX - px[1]);
          py[3] = drawH - 1;
        } else px[3] = scrXSize - 1;
        if (px[3] < px[1]) {
          px[1] = scrXSize - 1;
          px[3] = px[1];
        }
        if (py[3] < py[1]) py[3] = py[1];
        if (px[2] !== px[3]) poly(px[2], py[2], px[3], py[3], scrXSize - 1, drawH - 1);
        drawPolys = true;
      }

      if (drawPolys) {
        poly(px[0], py[0], px[1], py[1], px[2], py[2]);
        poly(px[2], py[2], px[3], py[3], px[1], py[1]);
      }
    }
  }
}

/** `CGameDrawManager::DrawWalls` — pseudo-3D walls drawn in four quadrants. */
export function drawWalls(scene: StaticScene): void {
  const { level, sprites, drawer, fb, drawRect, screenPos } = scene;
  const sprWallClr = sprites.wallClr.pixels;

  let offsetInsideBlockX: number;
  let levelOffsetX: number;
  if (screenPos.x >= 0) {
    offsetInsideBlockX = screenPos.x % KBlockSpriteSize;
    levelOffsetX = idiv(screenPos.x, KBlockSpriteSize);
  } else {
    offsetInsideBlockX = KBlockSpriteSize - 1 + ((screenPos.x + 1) % KBlockSpriteSize);
    levelOffsetX = idiv(screenPos.x + 1, KBlockSpriteSize) - 1;
  }

  let offsetInsideBlockY: number;
  let levelOffsetY: number;
  if (screenPos.y >= 0) {
    offsetInsideBlockY = screenPos.y % KBlockSpriteSize;
    levelOffsetY = idiv(screenPos.y, KBlockSpriteSize);
  } else {
    offsetInsideBlockY = KBlockSpriteSize - 1 + ((screenPos.y + 1) % KBlockSpriteSize);
    levelOffsetY = idiv(screenPos.y + 1, KBlockSpriteSize) - 1;
  }

  const scrBlockHalfWidth = Math.trunc(Math.ceil(rectWidth(drawRect) / (KBlockSpriteSize * 2)));
  const scrBlockHalfHeight = Math.trunc(Math.ceil(rectHeight(drawRect) / (KBlockSpriteSize * 2)));

  const perspectFixOffsetX = [0, 0, 0, 0, 0, 0];
  const perspectFixOffsetY = [0, 0, 0, 0, 0, 0];
  for (let b = 0; b < 6; b++) {
    perspectFixOffsetX[b] = Math.trunc(
      f32(
        -offsetInsideBlockX +
          f32(f32(f32(-offsetInsideBlockX) / KBlockSpriteSize) - scrBlockHalfWidth) * b,
      ),
    );
    perspectFixOffsetY[b] = Math.trunc(
      f32(
        -offsetInsideBlockY +
          f32(f32(f32(-offsetInsideBlockY) / KBlockSpriteSize) - scrBlockHalfHeight) * b,
      ),
    );
  }

  const outBlock = level.outBlock;
  const outPerspectX = perspectFixOffsetX[outBlock.height];
  const outPerspectY = perspectFixOffsetY[outBlock.height];

  const wallCol = (number: number): [number, number] => {
    const base = number + 16 * idiv(number, 16);
    return [sprWallClr[base], sprWallClr[base + 16]];
  };

  const drawOutBlock = (b: number, a: number): void => {
    const xofs2 = Math.trunc(f32(outPerspectX + f32(b * (outBlock.height + KBlockSpriteSize))));
    const yofs2 = Math.trunc(f32(outPerspectY + f32(a * (outBlock.height + KBlockSpriteSize))));
    drawer.drawBlock(
      drawRect.left + xofs2,
      drawRect.top + yofs2,
      outBlock.type,
      outBlock.number,
      outBlock.height,
      sprites,
      fb,
      drawRect,
    );
  };

  const yEnd = Math.ceil(rectHeight(drawRect) / 40);
  for (let a = 0; a < yEnd; a++) {
    const xEnd = Math.ceil(rectWidth(drawRect) / 40);
    const yofs1 = a * KBlockSpriteSize - offsetInsideBlockY;

    // upper left
    for (let b = 0; b < xEnd; b++) {
      const bx = levelOffsetX + b;
      const by = levelOffsetY + a;
      const xofs1 = b * KBlockSpriteSize - offsetInsideBlockX;
      if (bx >= 0 && bx < level.width && by >= 0 && by < level.height) {
        const block = levelData(level, bx, by);
        if (!floorLevel(block)) {
          const xofs2 = perspectFixOffsetX[block.height] + b * (block.height + KBlockSpriteSize);
          const yofs2 = perspectFixOffsetY[block.height] + a * (block.height + KBlockSpriteSize);
          const size = KBlockSpriteSize + block.height;
          const wc = wallCol(block.number);

          const below = levelData(level, bx, by + 1);
          if (!(below.type === EBlockTypeWall && below.height >= block.height)) {
            drawer.drawPolygon(
              xofs2 - 1,
              yofs2 + size,
              xofs1 - 1,
              yofs1 + KBlockSpriteSize,
              xofs1 + KBlockSpriteSize,
              yofs1 + KBlockSpriteSize,
              wc[1],
              null,
              fb,
              drawRect,
            );
            drawer.drawPolygon(
              xofs2 - 1,
              yofs2 + size,
              xofs2 + size,
              yofs2 + size,
              xofs1 + KBlockSpriteSize,
              yofs1 + KBlockSpriteSize,
              wc[1],
              null,
              fb,
              drawRect,
            );
          }
          const right = levelData(level, bx + 1, by);
          if (!(right.type === EBlockTypeWall && right.height >= block.height)) {
            drawer.drawPolygon(
              xofs2 + size,
              yofs2 + size,
              xofs1 + KBlockSpriteSize,
              yofs1 + KBlockSpriteSize,
              xofs2 + size,
              yofs2 - 1,
              wc[0] + 1,
              null,
              fb,
              drawRect,
            );
            drawer.drawPolygon(
              xofs1 + KBlockSpriteSize,
              yofs1 - 1,
              xofs1 + KBlockSpriteSize,
              yofs1 + KBlockSpriteSize,
              xofs2 + size,
              yofs2 - 1,
              wc[0] + 1,
              null,
              fb,
              drawRect,
            );
          }
          if (
            xofs2 + block.height + KBlockSpriteSize > 0 &&
            yofs2 + block.height + KBlockSpriteSize > 0
          ) {
            drawer.drawBlock(
              drawRect.left + xofs2,
              drawRect.top + yofs2,
              block.type,
              block.number,
              block.height,
              sprites,
              fb,
              drawRect,
            );
            drawer.drawWallShadow(
              drawRect.left + xofs2,
              drawRect.top + yofs2,
              block.shadow,
              block.height + KBlockSpriteSize,
              fb,
              drawRect,
            );
          }
        }
      } else {
        drawOutBlock(b, a);
      }
    }

    // upper right
    const xStartR = Math.ceil(rectWidth(drawRect) / KBlockSpriteSize);
    for (let b = xStartR; b >= xEnd; b--) {
      const bx = levelOffsetX + b;
      const by = levelOffsetY + a;
      const xofs1 = b * KBlockSpriteSize - offsetInsideBlockX;
      if (bx >= 0 && bx < level.width && by >= 0 && by < level.height) {
        const block = levelData(level, bx, by);
        if (!floorLevel(block)) {
          const size = KBlockSpriteSize + block.height;
          const wc = wallCol(block.number);
          const xofs2 = perspectFixOffsetX[block.height] + b * (block.height + KBlockSpriteSize);
          const yofs2 = perspectFixOffsetY[block.height] + a * (block.height + KBlockSpriteSize);

          const below = levelData(level, bx, by + 1);
          if (!(below.type === EBlockTypeWall && below.height >= block.height)) {
            drawer.drawPolygon(
              xofs2 - 1,
              yofs2 + size,
              xofs1 - 1,
              yofs1 + KBlockSpriteSize,
              xofs1 + KBlockSpriteSize,
              yofs1 + KBlockSpriteSize,
              wc[1],
              null,
              fb,
              drawRect,
            );
            drawer.drawPolygon(
              xofs2 - 1,
              yofs2 + size,
              xofs2 + size,
              yofs2 + size,
              xofs1 + KBlockSpriteSize,
              yofs1 + KBlockSpriteSize,
              wc[1],
              null,
              fb,
              drawRect,
            );
          }
          const left = levelData(level, bx - 1, by);
          if (!(left.type === EBlockTypeWall && left.height >= block.height) && xofs2 > xofs1) {
            drawer.drawPolygon(
              xofs2 - 1,
              yofs2 - 1,
              xofs1 - 1,
              yofs1 - 1,
              xofs2 - 1,
              yofs2 + size,
              wc[1] - 1,
              null,
              fb,
              drawRect,
            );
            drawer.drawPolygon(
              xofs1 - 1,
              yofs1 + KBlockSpriteSize,
              xofs1 - 1,
              yofs1 - 1,
              xofs2 - 1,
              yofs2 + size,
              wc[1] - 1,
              null,
              fb,
              drawRect,
            );
          }
          if (xofs2 < rectWidth(drawRect) && yofs2 + block.height + KBlockSpriteSize > 0) {
            drawer.drawBlock(
              drawRect.left + xofs2,
              drawRect.top + yofs2,
              block.type,
              block.number,
              block.height,
              sprites,
              fb,
              drawRect,
            );
            drawer.drawWallShadow(
              drawRect.left + xofs2,
              drawRect.top + yofs2,
              block.shadow,
              block.height + KBlockSpriteSize,
              fb,
              drawRect,
            );
          }
        }
      } else {
        drawOutBlock(b, a);
      }
    }
  }

  // lower left
  const yStartL = Math.ceil(rectHeight(drawRect) / KBlockSpriteSize);
  for (let a = yStartL; a >= yEnd; a--) {
    const xEndLower = Math.ceil(rectWidth(drawRect) / 40);
    const yofs1 = a * KBlockSpriteSize - offsetInsideBlockY;
    for (let b = 0; b < xEndLower; b++) {
      const bx = levelOffsetX + b;
      const by = levelOffsetY + a;
      const xofs1 = b * KBlockSpriteSize - offsetInsideBlockX;
      if (bx >= 0 && bx < level.width && by >= 0 && by < level.height) {
        const block = levelData(level, bx, by);
        if (!floorLevel(block)) {
          const size = KBlockSpriteSize + block.height;
          const wc = wallCol(block.number);
          const xofs2 = perspectFixOffsetX[block.height] + b * (block.height + KBlockSpriteSize);
          const yofs2 = perspectFixOffsetY[block.height] + a * (block.height + KBlockSpriteSize);

          const above = levelData(level, bx, by - 1);
          if (yofs2 > yofs1 && !(above.type === EBlockTypeWall && above.height >= block.height)) {
            drawer.drawPolygon(
              xofs2 - 1,
              yofs2 - 1,
              xofs1 - 1,
              yofs1 - 1,
              xofs1 + KBlockSpriteSize,
              yofs1 - 1,
              wc[0],
              null,
              fb,
              drawRect,
            );
            drawer.drawPolygon(
              xofs2 - 1,
              yofs2 - 1,
              xofs2 + size,
              yofs2 - 1,
              xofs1 + KBlockSpriteSize,
              yofs1 - 1,
              wc[0],
              null,
              fb,
              drawRect,
            );
          }
          const right = levelData(level, bx + 1, by);
          if (!(right.type === EBlockTypeWall && right.height >= block.height)) {
            drawer.drawPolygon(
              xofs2 + size,
              yofs2 + size,
              xofs1 + KBlockSpriteSize,
              yofs1 + KBlockSpriteSize,
              xofs2 + size,
              yofs2 - 1,
              wc[0] + 1,
              null,
              fb,
              drawRect,
            );
            drawer.drawPolygon(
              xofs1 + KBlockSpriteSize,
              yofs1 - 1,
              xofs1 + KBlockSpriteSize,
              yofs1 + KBlockSpriteSize,
              xofs2 + size,
              yofs2 - 1,
              wc[0] + 1,
              null,
              fb,
              drawRect,
            );
          }
          if (xofs2 + block.height + KBlockSpriteSize > 0 && yofs2 < rectHeight(drawRect)) {
            drawer.drawBlock(
              drawRect.left + xofs2,
              drawRect.top + yofs2,
              block.type,
              block.number,
              block.height,
              sprites,
              fb,
              drawRect,
            );
            drawer.drawWallShadow(
              drawRect.left + xofs2,
              drawRect.top + yofs2,
              block.shadow,
              block.height + KBlockSpriteSize,
              fb,
              drawRect,
            );
          }
        }
      } else {
        drawOutBlock(b, a);
      }
    }

    // lower right
    const xStartR = Math.ceil(rectWidth(drawRect) / KBlockSpriteSize);
    for (let b = xStartR; b >= xEndLower; b--) {
      const bx = levelOffsetX + b;
      const by = levelOffsetY + a;
      const xofs1 = b * KBlockSpriteSize - offsetInsideBlockX;
      if (bx >= 0 && bx < level.width && by >= 0 && by < level.height) {
        const block = levelData(level, bx, by);
        if (!floorLevel(block)) {
          const size = KBlockSpriteSize + block.height;
          const wc = wallCol(block.number);
          const xofs2 = perspectFixOffsetX[block.height] + b * (block.height + KBlockSpriteSize);
          const yofs2 = perspectFixOffsetY[block.height] + a * (block.height + KBlockSpriteSize);

          const above = levelData(level, bx, by - 1);
          if (yofs2 > yofs1 && !(above.type === EBlockTypeWall && above.height >= block.height)) {
            drawer.drawPolygon(
              xofs1 + KBlockSpriteSize,
              yofs1 - 1,
              xofs2 - 1,
              yofs2 - 1,
              xofs1 - 1,
              yofs1 - 1,
              wc[0],
              null,
              fb,
              drawRect,
            );
            drawer.drawPolygon(
              xofs2 - 1,
              yofs2 - 1,
              xofs2 + size,
              yofs2 - 1,
              xofs1 + KBlockSpriteSize,
              yofs1 - 1,
              wc[0],
              null,
              fb,
              drawRect,
            );
          }
          const left = levelData(level, bx - 1, by);
          if (xofs2 > xofs1 && !(left.type === EBlockTypeWall && left.height >= block.height)) {
            drawer.drawPolygon(
              xofs2 - 1,
              yofs2 - 1,
              xofs1 - 1,
              yofs1 - 1,
              xofs2 - 1,
              yofs2 + size,
              wc[1] - 1,
              null,
              fb,
              drawRect,
            );
            drawer.drawPolygon(
              xofs1 - 1,
              yofs1 + KBlockSpriteSize,
              xofs1 - 1,
              yofs1 - 1,
              xofs2 - 1,
              yofs2 + size,
              wc[1] - 1,
              null,
              fb,
              drawRect,
            );
          }
          if (xofs2 < rectWidth(drawRect) && yofs2 < rectHeight(drawRect)) {
            drawer.drawBlock(
              drawRect.left + xofs2,
              drawRect.top + yofs2,
              block.type,
              block.number,
              block.height,
              sprites,
              fb,
              drawRect,
            );
            drawer.drawWallShadow(
              drawRect.left + xofs2,
              drawRect.top + yofs2,
              block.shadow,
              block.height + KBlockSpriteSize,
              fb,
              drawRect,
            );
          }
        }
      } else {
        drawOutBlock(b, a);
      }
    }
  }
}

/** Composes the static (level-only) parts of a frame in the original order. */
export function drawStaticFrame(scene: StaticScene): void {
  const { level, sprites, drawer, fb, dark, drawRect, screenPos } = scene;
  drawFloor(level, sprites, drawer, fb, dark, drawRect, screenPos);
  drawShadows(level, drawer, fb, drawRect, screenPos);
  drawBlackPartsOfLevel(scene);
  drawWalls(scene);
}
