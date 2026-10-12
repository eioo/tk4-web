/**
 * A single in-game level session: the `SimWorld`, its level/sprites, the local
 * player and the per-frame HUD state. This is the body that used to live in
 * `main.ts`; `App` owns one while the game main-state is active and the
 * `NextLevel` sub-state swaps it out.
 *
 * The local player and the statistics outlive the session: `App` creates them
 * once per game and each session resets the player for its level, so money,
 * weapons and kills persist across levels (`CDynGameData::PreparePlayersForLevel`).
 */

import { GlibcRandom } from "../core/rng";
import { fontLength, type Font } from "../data/font";
import type { IngameData } from "../data/ingame-data";
import type { Level } from "../data/level";
import { drawFrame } from "../render/draw-manager";
import type { DrawSprites, GameDrawer } from "../render/drawer";
import type { Framebuffer } from "../render/fb";
import type { Rect } from "../render/rect";
import type { GameStatistics } from "../sim/statistics";
import { BulletId, WeaponId } from "../sim/types";
import {
  KPlayerMaxEnergy,
  KPlayerNormalSpeed,
  KShieldEnergyAmount,
  SimPlayer,
  SimWorld,
  type SimInput,
} from "../sim/world";

/** `KTimerFreq` — sim ticks per second. */
const KTimerFreq = 100;

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

/** The loadout a game starts with (`CGameSystem::Init` + `CDynGameData::SetupPlayers`). */
export function makeStartPlayer(): SimPlayer {
  const p = new SimPlayer();
  p.weapons[WeaponId.Fist] = 1;
  p.bullets[BulletId.Fist] = 1;
  p.curWeapon = WeaponId.Fist;
  p.cash = 500;
  return p;
}

/** `CPlayer::Reset` + `PreparePlayersForLevel` for one level. */
export function resetPlayerForLevel(p: SimPlayer, startX: number, startY: number): void {
  p.x = startX * 20;
  p.y = startY * 20;
  p.angle = 0;
  p.targetAngle = 0;
  p.dead = 0;
  p.hit = 0;
  p.burning = 0;
  p.fryingObserver = -1;
  p.pushPower = 0;
  p.pushAngle = 0;
  p.anim = 0;
  p.kick = 0;
  p.fire = 0;
  p.fire2 = 0;
  p.loadCounter = 0;
  p.loadCounter2 = 0;
  p.secondaryCounter = 0;
  p.shootCount = 0;
  p.weaponInHand = false;
  p.noDamage = false;
  p.speed = KPlayerNormalSpeed;
  p.energy = KPlayerMaxEnergy + p.shield * KShieldEnergyAmount;

  // `CPlayer::Reset` drops weapons the player no longer owns.
  if (p.weapons[p.curWeapon] <= 0) p.curWeapon = WeaponId.Fist;
  if (p.secWeapon !== 0 && p.weapons[p.secWeapon] < 2) p.secWeapon = 0;
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
  gameOver = false;

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
    player: SimPlayer,
    stats: GameStatistics | null,
  ) {
    this.world = new SimWorld(level, seed);
    this.world.stats = stats;
    this.renderRng = new GlibcRandom(seed);
    this.timeLimit = level.general.timeLimit;
    this.hud.timeLimit = this.timeLimit;

    const start = level.starts[0] ?? { x: level.width >> 1, y: level.height >> 1 };
    resetPlayerForLevel(player, start.x, start.y);
    this.player = player;
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
    // `CGameDrawManager::DrawTime` — freeze the clock once the level is done.
    if (this.nextLevel <= 0) {
      this.completeTime = Math.trunc(this.timerCounter / KTimerFreq);
      if (this.completeTime > this.timeLimit) this.completeTime = this.timeLimit;
    }
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
