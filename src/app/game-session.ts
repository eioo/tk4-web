/**
 * A single in-game level session: the `SimWorld`, its level/sprites, the local
 * player and the per-frame HUD state. This is the body that used to live in
 * `main.ts`; `App` owns one while the game main-state is active and the
 * `NextLevel` sub-state swaps it out.
 */

import { GlibcRandom } from "../core/rng";
import { fontLength, type Font } from "../data/font";
import type { IngameData } from "../data/ingame-data";
import type { Level } from "../data/level";
import { drawFrame } from "../render/draw-manager";
import type { DrawSprites, GameDrawer } from "../render/drawer";
import type { Framebuffer } from "../render/fb";
import type { Rect } from "../render/rect";
import { BulletId, WeaponId } from "../sim/types";
import { SimPlayer, SimWorld, type SimInput } from "../sim/world";

export interface SessionHud {
  readonly font: Font;
  readonly oneIsZero: boolean;
  readonly scaleX: number;
  readonly scaleY: number;
  frags: boolean;
  showMap: boolean;
  drawFrames: boolean;
  actionTimeMatters: boolean;
  currentFps: number;
  nextLevel: number;
  completeTime: number;
  timeLimit: number;
  hidePlayersFromMap: boolean;
  drawEnemiesOnMap: boolean;
  reachableOnMap: boolean;
  names: string[];
  kills: number[];
}

export function makePlayer(startX: number, startY: number): SimPlayer {
  const p = new SimPlayer();
  p.x = startX * 20;
  p.y = startY * 20;
  p.energy = 100;
  p.local = true;
  p.weapons[WeaponId.Fist] = 1;
  for (let w = WeaponId.Pistol; w <= WeaponId.FlameThrower; w++) p.weapons[w] = 1;
  p.bullets[BulletId.B9mm] = 600;
  p.bullets[BulletId.Shell] = 300;
  p.bullets[BulletId.B12mm] = 600;
  p.bullets[BulletId.MediumRockets] = 50;
  p.bullets[BulletId.Grenades] = 50;
  p.bullets[BulletId.Gas] = 1200;
  p.curWeapon = WeaponId.Pistol;
  return p;
}

export class GameSession {
  readonly world: SimWorld;
  readonly player: SimPlayer;
  readonly renderRng: GlibcRandom;
  timerCounter = 0;
  completeTime = 0;
  nextLevel = 0;
  timeLimit: number;
  currentFps = 0;

  constructor(
    readonly level: Level,
    readonly sprites: DrawSprites,
    readonly ingame: IngameData,
    readonly drawer: GameDrawer,
    readonly fb: Framebuffer,
    readonly dark: Uint8Array,
    readonly drawRect: Rect,
    readonly hud: SessionHud,
    seed: number,
  ) {
    this.world = new SimWorld(level, seed);
    this.renderRng = new GlibcRandom(seed);
    this.timeLimit = level.general.timeLimit;
    this.hud.timeLimit = this.timeLimit;

    const start = level.starts[0] ?? { x: level.width >> 1, y: level.height >> 1 };
    this.player = makePlayer(start.x, start.y);
    this.world.mouseOwner = 0;
    this.world.mouseSensitivity = 0.5;
    this.world.textLength = (text: string) => fontLength(this.hud.font, text);
    this.world.players = [this.player];
    this.world.initScr(this.player, this.drawRect);
    this.world.spawnEntities();
  }

  step(input: SimInput): void {
    this.world.tick(input, this.drawRect);
    if (this.nextLevel > 0) this.nextLevel++;
    if (this.world.enemies.length === 0 && this.nextLevel <= 0) this.nextLevel = 1;
    this.timerCounter++;
    this.hud.nextLevel = this.nextLevel;
    this.hud.completeTime = this.completeTime;
  }

  draw(): void {
    this.hud.currentFps = this.currentFps;
    drawFrame(
      {
        level: this.level,
        sprites: this.sprites,
        drawer: this.drawer,
        fb: this.fb,
        dark: this.dark,
        drawRect: this.drawRect,
        screenPos: { x: this.player.screenX, y: this.player.screenY },
        playerLocation: { x: this.player.x, y: this.player.y },
        players: this.world.players,
        bullets: this.world.bullets,
        enemies: this.world.enemies,
        bodyparts: this.world.bodyparts,
        effects: this.world.effects,
        crates: this.world.crates,
        spotLights: this.level.spotLights,
        deadEnemies: this.world.deadEnemies,
        renderRng: this.renderRng,
        hud: {
          font: this.hud.font,
          oneIsZero: this.hud.oneIsZero,
          scaleX: this.hud.scaleX,
          scaleY: this.hud.scaleY,
          videoWidth: this.fb.width,
          videoHeight: this.fb.height,
          frags: this.hud.frags,
          showMap: this.hud.showMap,
          drawFrames: this.hud.drawFrames,
          actionTimeMatters: this.hud.actionTimeMatters,
          currentFps: this.hud.currentFps,
          nextLevel: this.hud.nextLevel,
          completeTime: this.hud.completeTime,
          startTime: 0,
          timerCounter: this.timerCounter,
          timeLimit: this.hud.timeLimit,
          hidePlayersFromMap: this.hud.hidePlayersFromMap,
          drawEnemiesOnMap: this.hud.drawEnemiesOnMap,
          reachableOnMap: this.hud.reachableOnMap,
          names: this.hud.names,
          kills: this.hud.kills,
        },
      },
      this.fb.height,
    );
  }

  /** `IGameMode::ObjectiveFulfilled` for cooperative play. */
  objectiveFulfilled(): boolean {
    return this.world.enemies.length === 0;
  }

  allPlayersDead(): boolean {
    return this.world.players.length === 0 || this.world.players.every((p) => p.dead);
  }
}
