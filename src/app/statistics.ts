/**
 * `CGameSubStateStatistics` — the post-level kill/time summary and the reward
 * payout (`GivePlayerPrize`).
 *
 * Reward and time-bonus maths mirror the reference exactly; the statistics are
 * read for the level that was just completed (`GameStatistics.latest`).
 */

import { fontWrite, HAlign, VAlign } from "../data/font";
import type { MenuData } from "../data/menu-data";
import type { Framebuffer } from "../render/fb";
import { accuracy, totalKills, type GameStatistics } from "../sim/statistics";
import { EnemyTypes } from "../sim/types";
import type { SimPlayer } from "../sim/world";
import { GameFont, type SystemFonts } from "./fonts";

/** `CGameSubStateStatistics::GivePlayerPrize` — returns `iTimeBonus`. */
export function givePlayerPrize(
  player: SimPlayer,
  stats: GameStatistics,
  timeLimit: number,
  completeTime: number,
  gameOver: boolean,
  userQuit: boolean,
): number {
  let timeBonus = (timeLimit - completeTime) * 5;
  if (timeBonus < -500) timeBonus = -500;
  if (userQuit || gameOver) timeBonus = 0;

  const s = stats.latestLevelStats(0);
  for (let a = 0; a < EnemyTypes.length; a++) player.cash += EnemyTypes[a].reward * s.enemyKills[a];
  player.cash += timeBonus;
  if (player.cash < 0) player.cash = 0;
  return timeBonus;
}

/** `CGameDrawManager::FormatTime`. */
export function formatTime(seconds: number): string {
  return `${Math.trunc(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export interface StatisticsContext {
  readonly fb: Framebuffer;
  readonly menuData: MenuData;
  readonly fonts: SystemFonts;
  readonly stats: GameStatistics;
  readonly playerName: string;
  readonly actionTimeMatters: boolean;
  readonly frags: boolean;
  readonly gameOver: boolean;
  readonly userQuit: boolean;
  readonly timeBonus: number;
  readonly timeLimit: number;
  readonly completeTime: number;
  /** `CPlayer::iCash` after the prize payout, for the "Cash:" line. */
  readonly playerCash: number;
}

export function drawStatistics(ctx: StatisticsContext): void {
  const { fb, fonts } = ctx;
  fb.pixels.set(ctx.menuData.sprites.statisticsBack.pixels);

  const big = fonts.get(GameFont.BigMenuFont);
  const small = fonts.get(GameFont.SmallMenuFontDark);
  const header = ctx.gameOver || ctx.userQuit ? "Game Over" : "Completed !";
  fontWrite(
    big.font,
    fb,
    Math.trunc(fb.width / 2),
    20,
    header,
    VAlign.Below,
    HAlign.InMiddle,
    big.oneIsZero,
    big.scaleX,
    big.scaleY,
  );

  drawPlayerInfo(ctx, 0, 0, small);

  if (ctx.actionTimeMatters) {
    let text = `Time limit: ${formatTime(ctx.timeLimit)} Your time: ${formatTime(ctx.completeTime)}`;
    if (ctx.timeBonus > 0) text += ` Time bonus: +${ctx.timeBonus}`;
    else if (ctx.timeBonus < 0) text += ` Time penalty: ${ctx.timeBonus}`;
    fontWrite(
      small.font,
      fb,
      16,
      Math.trunc(fb.height * 0.8),
      text,
      VAlign.Below,
      HAlign.ToRight,
      small.oneIsZero,
      small.scaleX,
      small.scaleY,
    );
  }
}

/** `CGameSubStateStatistics::DrawPlayerInfo`. */
function drawPlayerInfo(
  ctx: StatisticsContext,
  partOfScreen: number,
  playerNo: number,
  font: ReturnType<SystemFonts["get"]>,
): void {
  const { fb, stats } = ctx;
  const horizStart = Math.trunc((partOfScreen * fb.width) / 2);
  const s = stats.latestLevelStats(playerNo);
  const kills = totalKills(s);
  const height = font.font.height;

  const header = kills > 0 ? `Kills for ${ctx.playerName}` : `No kills for ${ctx.playerName}`;
  fontWrite(
    font.font,
    fb,
    16 + horizStart,
    60,
    header,
    VAlign.Below,
    HAlign.ToRight,
    font.oneIsZero,
    font.scaleX,
    font.scaleY,
  );

  let b = 60 + height * 2;
  for (let a = 0; a < EnemyTypes.length; a++) {
    if (s.enemyKills[a] <= 0) continue;
    const plural = s.enemyKills[a] > 1 ? "s" : "";
    fontWrite(
      font.font,
      fb,
      16 + horizStart,
      b,
      `${s.enemyKills[a]} ${EnemyTypes[a].name}${plural}`,
      VAlign.Below,
      HAlign.ToRight,
      font.oneIsZero,
      font.scaleX,
      font.scaleY,
    );
    if (ctx.actionTimeMatters) {
      fontWrite(
        font.font,
        fb,
        220 + horizStart,
        b,
        `+${EnemyTypes[a].reward * s.enemyKills[a]}`,
        VAlign.Below,
        HAlign.ToRight,
        font.oneIsZero,
        font.scaleX,
        font.scaleY,
      );
    }
    b += height;
  }

  if (s.playerKills && ctx.frags) {
    b += height;
    fontWrite(
      font.font,
      fb,
      16 + horizStart,
      b,
      `${s.playerKills} Frags`,
      VAlign.Below,
      HAlign.ToRight,
      font.oneIsZero,
      font.scaleX,
      font.scaleY,
    );
    b += height;
    writeLine(ctx, font, 16 + horizStart, b, `Total kills: ${totalKills(s) + s.playerKills}`);
  } else {
    writeLine(ctx, font, 16 + horizStart, b, `Total kills: ${totalKills(s)}`);
  }
  b += height;

  b += height;
  writeLine(ctx, font, 16 + horizStart, b, `Accuracy: ${accuracy(s).toFixed(1)}%`);
  b += height;

  if (ctx.actionTimeMatters) {
    writeLine(ctx, font, 16 + horizStart, b, `Cash: ${ctx.playerCash}`);
  }
}

function writeLine(
  ctx: StatisticsContext,
  font: ReturnType<SystemFonts["get"]>,
  x: number,
  y: number,
  text: string,
): void {
  fontWrite(
    font.font,
    ctx.fb,
    x,
    y,
    text,
    VAlign.Below,
    HAlign.ToRight,
    font.oneIsZero,
    font.scaleX,
    font.scaleY,
  );
}
