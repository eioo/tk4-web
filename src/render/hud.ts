/**
 * HUD rendering — the pieces of `CGameDrawManager::DrawFrame` after
 * `DrawWalls`: hit flash, target laser, energy bar, weapon/ammo text, crate
 * pickup text, frag list, minimap, FPS, timer and the "mission completed"
 * banner. Byte-for-byte against `render_gen hud` / `render_gen fontwrite`.
 *
 * All per-player HUD is drawn inside the player loop of the original, i.e.
 * after the walls for that player; the post-loop overlays are composed by
 * {@link drawHudFrame} in `draw-manager.ts`.
 */

import { addMovement, cose, f32, getDist, sine } from "../core/math";
import { KTimerFreq } from "../data/constants";
import { HAlign, VAlign, fontWrite, type Font } from "../data/font";
import { EGameSprite } from "../data/ingame-data";
import { EBlockTypeWall, levelData, reachable, type Level } from "../data/level";
import type { SimCrate } from "../sim/entities";
import { crateText } from "../sim/entities";
import { simVisibilityCheck } from "../sim/level-physics";
import { BulletTypes, WeaponTypes, approxDistance } from "../sim/types";
import type { SimPlayer } from "../sim/world";
import type { GameDrawer, DrawSprites } from "./drawer";
import type { Framebuffer } from "./fb";
import { idiv, rectHeight, rectWidth, type Point, type Rect } from "./rect";

/** `KPlayerMaxEnergy` / `KShieldEnergyAmount` (`CPlayer.h`). */
const KPlayerMaxEnergy = 100;
const KShieldEnergyAmount = 10;

/** Everything the HUD needs that is not part of the actor scene. */
export interface HudContext {
  /** `CGameGraphicsInterface::ESmallFont` (`fnts/8x8b.fnt`). */
  font: Font;
  /** `CFonts` `iOneIsZero` — true for `8x8b.fnt`. */
  oneIsZero: boolean;
  scaleX: number;
  scaleY: number;
  /** Video mode size (`iGGI->GD()`). */
  videoWidth: number;
  videoHeight: number;
  /** `IGameMode::Frags()`. */
  frags: boolean;
  /** `CDynGameData::iShowMap`. */
  showMap: boolean;
  /** `CDynGameData::iDrawFrames`. */
  drawFrames: boolean;
  /** `IGameMode::ActionTimeMatters()`. */
  actionTimeMatters: boolean;
  /** `CDynGameData::CurrentFPS`. */
  currentFps: number;
  /** `CDynGameData::iNextLevel` (0 = level still running). */
  nextLevel: number;
  /** `CDynGameData::iCompleteTime`; `drawTime` returns the updated value. */
  completeTime: number;
  /** `CDynGameData::StartTime()`. */
  startTime: number;
  /** The `TimerCounter` global (1/100 s ticks). */
  timerCounter: number;
  /** `CGeneralLevelInfo::iTimeLimit`. */
  timeLimit: number;
  /** `IGameMode::HidePlayersFromMap()`. */
  hidePlayersFromMap: boolean;
  /** Map dot for enemies (`EF_DEBUG`). */
  drawEnemiesOnMap: boolean;
  /** Map dot for reachable floor. */
  reachableOnMap: boolean;
  /** Display names for the frag list. */
  names: string[];
  /** Kill counts for the frag list, parallel to `names`. */
  kills: number[];
}

/** `CGameDrawManager::DrawHits` — the red screen-border damage flash. */
export function drawHits(fb: Framebuffer, player: SimPlayer, drawRect: Rect): void {
  if (player.hit > 0) {
    fb.rectangle(
      drawRect.left,
      drawRect.top,
      drawRect.right - 1,
      drawRect.bottom - 1,
      4 * 16 - 1 - player.hit,
    );
  }
}

/**
 * `CGameDrawManager::DrawTargets` — the target-system laser: dots along the
 * bullet's path and the cross-hair sprite where it stops or hits a wall.
 */
let targetPlotCount = 0;

export function resetTargetPlotCount(): void {
  targetPlotCount = 0;
}

export function drawTargets(
  level: Level,
  sprites: DrawSprites,
  drawer: GameDrawer,
  fb: Framebuffer,
  drawRect: Rect,
  screenPos: Point,
  player: SimPlayer,
): void {
  targetPlotCount++;
  if (player.dead) return;
  const wtype = WeaponTypes[player.curWeapon];
  if (!wtype.gun) return;
  if (!player.targetSystem) return;

  const angle = Math.trunc(player.angle);
  let pos = { x: f32(player.x), y: f32(player.y) };
  // `Location().AddMovement(RealAngle, 10).Add(14, 14)`.
  pos = addMovement(pos, angle, 10);
  pos = { x: f32(pos.x + 14), y: f32(pos.y + 14) };

  const bt = BulletTypes[wtype.bulletType];
  let dist = approxDistance(bt);
  const dst = addMovement(pos, angle, dist);
  const res = simVisibilityCheck(level, pos.x, pos.y, dst.x, dst.y);
  dist = Math.trunc(getDist(pos.x, pos.y, res.x, res.y));

  const w = rectWidth(drawRect);
  const h = rectHeight(drawRect);
  let a = 0;
  for (
    ;
    a < dist &&
    pos.x - screenPos.x >= 0 &&
    pos.x - screenPos.x < w &&
    pos.y - screenPos.y >= 0 &&
    pos.y - screenPos.y < h;
    a++
  ) {
    if ((a - Math.trunc(targetPlotCount / 4)) % 6 === 0) {
      const px = Math.trunc(drawRect.left + pos.x - screenPos.x);
      const py = Math.trunc(drawRect.top + pos.y - screenPos.y);
      fb.pixels[py * fb.width + px] = 9 * 16;
    }
    pos = addMovement(pos, angle, 1);
  }
  if (
    a === dist ||
    levelData(level, Math.trunc(pos.x / 20), Math.trunc(pos.y / 20)).type === EBlockTypeWall
  ) {
    drawer.drawTransSprite(
      Math.trunc(drawRect.left + pos.x - 3 - screenPos.x),
      Math.trunc(drawRect.top + pos.y - 3 - screenPos.y),
      7,
      7,
      sprites.spriteOf(EGameSprite.Target),
      0,
      fb,
      drawRect,
    );
  }
}

/** `CCoord<float>::AddMovement` is provided by `core/math` (`addMovement`). */

/** `CGameDrawManager::DrawEnergies` — the bottom-left energy bar. */
export function drawEnergies(fb: Framebuffer, player: SimPlayer, drawRect: Rect): void {
  const w = fb.width;
  const div = KPlayerMaxEnergy + player.shield * KShieldEnergyAmount;
  const target = idiv(rectHeight(drawRect), 80);
  const offset = (rectHeight(drawRect) - 3 - target + drawRect.top) * w + 3 + drawRect.left;
  for (let a = 0; a < player.energy / 5; a++) {
    for (let b = 0, yadd = 0; b < target; b++, yadd += w) {
      fb.pixels[offset + a + yadd] = 239 - Math.trunc((5 * a * 15) / div);
    }
  }
}

/** `CGameDrawManager::DrawInfos` — weapon name and ammo readout (bottom-left). */
export function drawInfos(
  fb: Framebuffer,
  player: SimPlayer,
  drawRect: Rect,
  ctx: HudContext,
): void {
  const wtype = WeaponTypes[player.curWeapon];
  const fontHeight = ctx.font.height * ctx.scaleY;
  const z = idiv(ctx.videoHeight, 80);

  let text = wtype.name;
  if (player.secWeapon !== 0) text += " (double)";
  fontWrite(
    ctx.font,
    fb,
    3 + drawRect.left,
    rectHeight(drawRect) - 5 - z + drawRect.top - fontHeight,
    text,
    VAlign.Below,
    HAlign.ToRight,
    ctx.oneIsZero,
    ctx.scaleX,
    ctx.scaleY,
  );

  let x = idiv(player.bullets[wtype.bulletType], BulletTypes[wtype.bulletType].multiplier);
  if (x < 0) x = 1;
  if (wtype.bulletType !== 0) {
    fontWrite(
      ctx.font,
      fb,
      3 + drawRect.left,
      rectHeight(drawRect) - 5 - z + drawRect.top - fontHeight * 2,
      String(x),
      VAlign.Below,
      HAlign.ToRight,
      ctx.oneIsZero,
      ctx.scaleX,
      ctx.scaleY,
    );
  }
}

/** `CGameDrawManager::DrawCrateTexts` — floating pickup labels. */
export function drawCrateTexts(fb: Framebuffer, crates: SimCrate[], ctx: HudContext): void {
  for (const c of crates) {
    if (c.inUse && c.textCounter > 0) {
      fontWrite(
        ctx.font,
        fb,
        Math.trunc(c.textX),
        Math.trunc(c.textY),
        crateText(c),
        VAlign.Below,
        HAlign.ToRight,
        ctx.oneIsZero,
        ctx.scaleX,
        ctx.scaleY,
      );
    }
  }
}

/** `CGameDrawManager::DrawKills` — frag counts (deathmatch/`Frags`). */
export function drawKills(fb: Framebuffer, ctx: HudContext): void {
  for (let b = 0; b < ctx.names.length; b++) {
    const text = `${ctx.names[b]} ${ctx.kills[b] ?? 0}`;
    fontWrite(
      ctx.font,
      fb,
      3 + (b % 4) * 80,
      3 + idiv(b, 4) * 10,
      text,
      VAlign.Below,
      HAlign.ToRight,
      ctx.oneIsZero,
      ctx.scaleX,
      ctx.scaleY,
    );
  }
}

/** `CGameDrawManager::DrawMap` — the top-right minimap. */
export function drawMap(
  level: Level,
  drawer: GameDrawer,
  fb: Framebuffer,
  enemies: ReadonlyArray<{ x: number; y: number }>,
  deadEnemies: ReadonlyArray<{ x: number; y: number }>,
  players: ReadonlyArray<{ x: number; y: number; color: number }>,
  ctx: HudContext,
): void {
  const size = ctx.videoWidth >= 640 ? 2 : 1;
  const cx = ctx.videoWidth - level.width * size;
  const cy = 0;

  let offset = cy * fb.width + cx;
  for (let a = 0; a < level.height; a++, offset += (fb.width - level.width) * size) {
    for (let b = 0; b < level.width; b++, offset += size) {
      const type = levelData(level, b, a).type;
      drawer.drawMapPixel(offset, size, type === EBlockTypeWall ? 16 : -1, fb);
      if (ctx.reachableOnMap && reachable(level, b, a)) {
        drawer.drawMapPixel(offset, size, 3, fb);
      }
    }
  }

  for (const d of deadEnemies) {
    const ofs =
      (idiv(Math.trunc(d.y) + 15, 20) * size + cy) * fb.width +
      idiv(Math.trunc(d.x) + 15, 20) * size +
      cx;
    drawer.drawMapPixel(ofs, size, 9, fb);
  }

  if (ctx.drawEnemiesOnMap) {
    for (const e of enemies) {
      const ofs =
        (Math.trunc((e.y + 15) / 20) * size + cy) * fb.width +
        Math.trunc((e.x + 15) / 20) * size +
        cx;
      drawer.drawMapPixel(ofs, size, 3, fb);
    }
  }

  if (!ctx.hidePlayersFromMap) {
    for (const p of players) {
      const ofs =
        (Math.trunc((p.y + 15) / 20) * size + cy) * fb.width +
        Math.trunc((p.x + 15) / 20) * size +
        cx;
      drawer.drawMapPixel(ofs, size, p.color, fb);
    }
  }
}

/** `CGameDrawManager::FormatTime`. */
export function formatTime(aika: number): string {
  return `${idiv(aika, 60)}:${String(aika % 60).padStart(2, "0")}`;
}

const TIME_Y_POS = 10;

/** `CGameDrawManager::DrawTime` — the level timer; returns the new `iCompleteTime`. */
export function drawTime(fb: Framebuffer, ctx: HudContext): number {
  let completeTime = ctx.completeTime;
  if (!ctx.nextLevel) completeTime = Math.trunc((ctx.timerCounter - ctx.startTime) / KTimerFreq);
  fontWrite(
    ctx.font,
    fb,
    idiv(ctx.videoWidth, 2),
    TIME_Y_POS,
    formatTime(completeTime),
    VAlign.Below,
    HAlign.InMiddle,
    ctx.oneIsZero,
    ctx.scaleX,
    ctx.scaleY,
  );
  return completeTime;
}

/** `CGameDrawManager::DrawFPS`. */
export function drawFps(fb: Framebuffer, ctx: HudContext): void {
  const fpsYPos = TIME_Y_POS + ctx.font.height * ctx.scaleY + 2;
  const text = `${Math.trunc(ctx.currentFps)} / ${KTimerFreq} fps`;
  fontWrite(
    ctx.font,
    fb,
    idiv(ctx.videoWidth, 2),
    fpsYPos,
    text,
    VAlign.Below,
    HAlign.InMiddle,
    ctx.oneIsZero,
    ctx.scaleX,
    ctx.scaleY,
  );
}

/** `CGameDrawManager::DrawComplete` — the rotating "MISSION COMPLETED" banner. */
export function drawComplete(fb: Framebuffer, ctx: HudContext): void {
  const a = ctx.nextLevel * 2;
  const tmp = f32(ctx.nextLevel / 940);
  const xpos = Math.trunc(f32(idiv(ctx.videoWidth, 2) * f32(1 + f32(f32(1 - tmp) * cose(a)))));
  const ypos = Math.trunc(f32(idiv(ctx.videoHeight, 2) * f32(1 + f32(f32(1 - tmp) * sine(a)))));
  fontWrite(
    ctx.font,
    fb,
    xpos,
    ypos,
    "MISSION COMPLETED",
    VAlign.InVertMiddle,
    HAlign.InMiddle,
    ctx.oneIsZero,
    ctx.scaleX,
    ctx.scaleY,
  );
}
