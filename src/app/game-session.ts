/**
 * A single in-game level session: the `SimWorld`, its level/sprites, the local
 * players and the per-frame HUD state. This is the body that used to live in
 * `main.ts`; `App` owns one while the game main-state is active and the
 * `NextLevel` sub-state swaps it out.
 *
 * The local players and the statistics outlive the session: `App` creates them
 * once per game and each session resets them for its level, so money, weapons
 * and kills persist across levels (`CDynGameData::PreparePlayersForLevel`).
 *
 * Split-screen (`CDynGameData::GraphicsModeChanged`): each local player gets a
 * viewport (`playerDrawRects`) and its own camera; `draw` renders one view per
 * player and the global overlays once.
 */

import { getDist } from "../core/math";
import { GlibcRandom } from "../core/rng";
import { KBlockSpriteSize } from "../data/constants";
import { fontLength, type Font } from "../data/font";
import type { IngameData } from "../data/ingame-data";
import { type Level, reachable } from "../data/level";
import { drawGlobalHud, drawPlayerHud, drawWorldFrame } from "../render/draw-manager";
import type { DrawSprites, GameDrawer } from "../render/drawer";
import type { Framebuffer } from "../render/fb";
import type { Rect } from "../render/rect";
import { blackRects, playerDrawRects } from "../render/viewport";
import type { GameStatistics } from "../sim/statistics";
import { BulletId, WeaponId } from "../sim/types";
import {
  KPlayerColor,
  KPlayerMaxEnergy,
  KPlayerNormalSpeed,
  KShieldEnergyAmount,
  SimPlayer,
  SimWorld,
  type SimInput,
} from "../sim/world";

/** `KTimerFreq` — sim ticks per second. */
const KTimerFreq = 100;
/** `CDynGameData::KTooManyTries`. */
const KTooManyTries = 100000;

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

/** `CPlayer::Reset` + `PreparePlayersForLevel` for one level (position set separately). */
export function resetPlayerState(p: SimPlayer): void {
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

/** `CPlayer::SetColorByIndex`. */
function setColorByIndex(p: SimPlayer, index: number): void {
  p.color = KPlayerColor[index % KPlayerColor.length];
}

/**
 * `CDynGameData::PlacePlayersForLevel` — seat `b` starts at start point
 * `b % startPositions` and is nudged onto a reachable, non-overlapping block if
 * that start is blocked or another player is too close.
 */
function placePlayersForLevel(world: SimWorld, players: SimPlayer[]): void {
  const level = world.level;
  const startPositions = level.starts.length;
  for (let b = 0; b < players.length; b++) {
    const ply = players[b];
    const base =
      startPositions > 0
        ? level.starts[b % startPositions]
        : { x: level.width >> 1, y: level.height >> 1 };
    let posX = base.x * KBlockSpriteSize;
    let posY = base.y * KBlockSpriteSize;
    let found = false;
    let tries = 0;
    for (; tries < KTooManyTries && !found; tries++) {
      let newX = posX;
      let newY = posY;
      // `CCoord::Set(x, y)` — g++ evaluates the trailing argument first, so the
      // y jitter draws before the x jitter (docs/13).
      let addY = 0;
      let addX = 0;
      if (tries > 0 && tries < 9) {
        addY = (world.rng.rand() % 3) - 1;
        addX = (world.rng.rand() % 3) - 1;
      } else if (tries > 10 && tries < 99) {
        addY = (world.rng.rand() % 5) - 2;
        addX = (world.rng.rand() % 5) - 2;
      } else if (tries > 100) {
        addY = (world.rng.rand() % 9) - 4;
        addX = (world.rng.rand() % 9) - 4;
      }
      newX += addX * KBlockSpriteSize;
      newY += addY * KBlockSpriteSize;

      if (
        !reachable(level, Math.trunc(newX / KBlockSpriteSize), Math.trunc(newY / KBlockSpriteSize))
      )
        continue;

      let tooClose = false;
      for (let cnt = 0; cnt < b && !tooClose; cnt++)
        if (getDist(newX, newY, players[cnt].x, players[cnt].y) < KBlockSpriteSize) tooClose = true;
      if (tooClose) continue;

      posX = newX;
      posY = newY;
      found = true;
    }
    ply.x = posX;
    ply.y = posY;
  }
}

export class GameSession {
  readonly world: SimWorld;
  /** Seat 0 (the shop / statistics "current" player). */
  readonly player: SimPlayer;
  readonly players: SimPlayer[];
  readonly drawRects: Rect[];
  readonly blackRects: Rect[];
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
    readonly hud: SessionHud,
    seed: number,
    players: SimPlayer[],
    stats: GameStatistics | null,
  ) {
    this.world = new SimWorld(level, seed);
    this.world.stats = stats;
    this.renderRng = new GlibcRandom(seed);
    this.timeLimit = level.general.timeLimit;
    this.hud.timeLimit = this.timeLimit;

    this.players = players;
    this.player = players[0];
    this.drawRects = playerDrawRects(fb.width, fb.height, players.length);
    this.blackRects = blackRects(fb.width, fb.height, players.length);

    // `CDynGameData::PreparePlayersForLevel`: place all seats, then reset state
    // and assign each its viewport + colour.
    placePlayersForLevel(this.world, players);
    for (let i = 0; i < players.length; i++) {
      resetPlayerState(players[i]);
      players[i].drawRect = this.drawRects[i];
      setColorByIndex(players[i], i);
    }

    // Only seat 0 owns the mouse by default (mission: `iMouseMode` 1..N).
    this.world.mouseOwner = players.length > 0 ? 0 : -1;
    this.world.mouseSensitivity = 0.5;
    this.world.textLength = (text: string) => fontLength(this.hud.font, text);
    this.world.players = players;
    for (const p of players) this.world.initScr(p);
    this.world.spawnEntities();
  }

  /** The mouse owner as a world index (`CDynGameData::UpdateMouseOwner`). */
  setMouseOwner(playerIndex: number): void {
    this.world.mouseOwner =
      playerIndex >= 0 && playerIndex < this.players.length ? playerIndex : -1;
  }

  step(inputs: readonly SimInput[]): void {
    this.world.tick(inputs);
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

  /** One scene per view; the arrays/RNG are shared, only the camera differs. */
  private baseScene(): Parameters<typeof drawWorldFrame>[0] {
    return {
      level: this.level,
      sprites: this.sprites,
      drawer: this.drawer,
      fb: this.fb,
      dark: this.dark,
      drawRect: this.fb.rect(),
      screenPos: { x: 0, y: 0 },
      playerLocation: { x: 0, y: 0 },
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
    };
  }

  draw(): void {
    this.hud.currentFps = this.currentFps;
    const base = this.baseScene();
    const screenHeight = this.fb.height;

    // Fill the letterbox rects with black (the framebuffer is cleared anyway,
    // but the original is explicit — CDynGameData::GraphicsModeChanged).
    for (const r of this.blackRects) this.fb.fillRect(r, 0);

    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const view = {
        ...base,
        drawRect: this.drawRects[i],
        screenPos: { x: p.screenX, y: p.screenY },
        playerLocation: { x: p.x, y: p.y },
      };
      drawWorldFrame(view, screenHeight);
      drawPlayerHud(view, p);
    }
    drawGlobalHud(base);
  }

  /** `IGameMode::ObjectiveFulfilled` for cooperative play. */
  objectiveFulfilled(): boolean {
    return this.world.enemies.length === 0;
  }

  allPlayersDead(): boolean {
    return this.world.players.length === 0 || this.world.players.every((p) => p.dead);
  }
}
