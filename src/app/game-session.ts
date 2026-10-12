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
import {
  KPlayerColor,
  KPlayerMaxEnergy,
  KShieldEnergyAmount,
  SimPlayer,
  SimWorld,
  type SimInput,
} from "../sim/world";
import type { GameMode } from "./game-mode";

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
export { makeStartPlayer } from "../sim/world";

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

/** Mode/option values the session needs from `App` (docs/12 M12). */
export interface ModeOptions {
  /** `iEnemiesOnGame` — with `DisableEnemiesPossible()` decides enemy spawning. */
  enemiesOnGame: boolean;
  /** `OptionsData.dmSpeed`. */
  dmSpeed: number;
  /** `OptionsData.dmTargetSystem`. */
  dmTargetSystem: boolean;
}

export class GameSession {
  readonly world: SimWorld;
  /** Seat 0 (the shop / statistics "current" player). */
  readonly player: SimPlayer;
  readonly players: SimPlayer[];
  readonly drawRects: Rect[];
  readonly blackRects: Rect[];
  /** Seats to render (all in local play; one seat online). */
  readonly viewSeats: number[];
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
    readonly mode: GameMode,
    readonly modeOptions: ModeOptions,
    seed: number,
    players: SimPlayer[],
    stats: GameStatistics | null,
    /** Netplay: the seat this client renders, or -1 for local play. */
    readonly onlineSeat = -1,
  ) {
    this.world = new SimWorld(level, seed);
    this.world.stats = stats;
    this.renderRng = new GlibcRandom(seed);
    this.timeLimit = level.general.timeLimit;
    this.hud.timeLimit = this.timeLimit;

    this.players = players;
    this.player = players[0];

    // Online: every client assigns the identical full-screen rect to every seat
    // (so the sim cannot diverge on `drawRect`) and renders only its own view.
    // Local play keeps the split-screen viewport tables.
    if (onlineSeat >= 0) {
      const full = fb.rect();
      this.drawRects = players.map(() => ({ ...full }));
      this.blackRects = [];
      this.viewSeats = [onlineSeat];
      this.world.perSeatMouse = true;
      // Online the client pre-scales `mouseXRel` by its own sensitivity, so
      // every client applies the identical angle delta (sensitivity 1.0).
      this.world.mouseSensitivity = 1.0;
    } else {
      this.drawRects = playerDrawRects(fb.width, fb.height, players.length);
      this.blackRects = blackRects(fb.width, fb.height, players.length);
      this.viewSeats = players.map((_, i) => i);
    }

    // Mode + option flags (`CDynGameData::SetLevels` reads the same values).
    const world = this.world;
    world.frags = mode.frags();
    world.crateRespawn = mode.crateRespawn();
    world.dmCrates = mode.dmCrates();
    world.randomPlacePlayers = mode.randomPlacePlayers();
    world.enemiesEnabled = modeOptions.enemiesOnGame || !mode.disableEnemiesPossible();
    world.dmSpeed = modeOptions.dmSpeed;
    world.dmTargetSystem = modeOptions.dmTargetSystem;
    world.killTexts = ingame.killTexts;
    world.suicideTexts = ingame.suicideTexts;
    world.mouseOwner = players.length > 0 ? 0 : -1;
    world.mouseSensitivity = 0.5;
    world.textLength = (text: string) => fontLength(this.hud.font, text);
    world.players = players;

    // Viewports + colours must be set before `Reset`/`InitScr` use them.
    for (let i = 0; i < players.length; i++) {
      players[i].drawRect = this.drawRects[i];
      setColorByIndex(players[i], i);
    }

    // `CDynGameData::SetLevels`: start-point placement, entities, then the DM
    // random placement — all before `PreparePlayersForLevel` resets the players.
    placePlayersForLevel(world, players);
    world.spawnEntities();
    if (world.randomPlacePlayers) for (const p of players) world.randomPlace(p);

    // `PreparePlayersForLevel`: reset each player, set energy from the shield,
    // then apply the mode's per-level setup (DM energy/speed/target system).
    for (const p of players) {
      world.resetPlayer(p);
      p.energy = KPlayerMaxEnergy + p.shield * KShieldEnergyAmount;
      mode.setupPlayerLevel(p, modeOptions.dmSpeed, modeOptions.dmTargetSystem);
    }
  }

  /** The mouse owner as a world index (`CDynGameData::UpdateMouseOwner`). */
  setMouseOwner(playerIndex: number): void {
    this.world.mouseOwner =
      playerIndex >= 0 && playerIndex < this.players.length ? playerIndex : -1;
  }

  step(inputs: readonly SimInput[]): void {
    this.world.tick(inputs);
    if (this.nextLevel > 0) this.nextLevel++;
    if (this.nextLevel <= 0 && this.objectiveFulfilled()) this.nextLevel = 1;
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

    for (let i = 0; i < this.viewSeats.length; i++) {
      const seat = this.viewSeats[i];
      const p = this.players[seat];
      const view = {
        ...base,
        drawRect: this.drawRects[seat],
        screenPos: { x: p.screenX, y: p.screenY },
        playerLocation: { x: p.x, y: p.y },
      };
      drawWorldFrame(view, screenHeight);
      drawPlayerHud(view, p);
    }
    drawGlobalHud(base);
  }

  /** `IGameMode::ObjectiveFulfilled` — cooperative ends when the enemies are dead. */
  objectiveFulfilled(): boolean {
    return this.mode.objectiveFulfilled(this.world.enemies.length === 0);
  }

  allPlayersDead(): boolean {
    return this.world.players.length === 0 || this.world.players.every((p) => p.dead);
  }
}
