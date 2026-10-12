/**
 * M3 world simulation: players, bullets, and the per-tick update order from
 * `CGameSubStateOngoing::RunFrame` / `CLevelRuntimeData` / `CDynGameData`.
 *
 * This is a faithful port of `tools/reference/simreference.h` (which itself
 * copies the original C++). Float intermediates use `f32` exactly where the
 * C++ produces a `float`, and multi-`rand()` argument order is written out in
 * g++'s right-to-left order so traces match the oracle byte-for-byte.
 *
 * Deferred to M4: enemies, effects (they are counted but not rolled), body
 * parts, crates. The RNG-consumption of the call sites is still reproduced.
 */

import {
  addMovement,
  addMovementI,
  angleFix,
  cose,
  f32,
  getAngle,
  getDist,
  setMovement,
  setMovementI,
  sine,
  vectorAngle,
  vectorLength,
} from "../core/math";
import { GlibcRandom } from "../core/rng";
import { KCharacterSpriteSize, KBlockSpriteSize } from "../data/constants";
import { type Level, levelData, reachable } from "../data/level";
import type { Rect } from "../render/rect";
import { idiv, makeRect, rectHeight, rectWidth } from "../render/rect";
import { SimBodyPart, SimCrate, SimEffect, SimEnemy, crateText } from "./entities";
import { simCollision, simDustBlock, simVisibilityCheck } from "./level-physics";
import type { GameStatistics } from "./statistics";
import {
  approxDistance,
  BodyPartId,
  BodyPartTypes,
  BounceType,
  BulletId,
  BulletKind,
  BulletTypes,
  CrateKind,
  EffectId,
  EffectKind,
  EffectTypes,
  EnemyState,
  EnemyTypes,
  EEnemyAmount,
  SoundEffect,
  type SoundEvent,
  WeaponId,
  WeaponTypes,
} from "./types";

export const KPlayerNormalSpeed = 0.75;
export const KPlayerRotationSpeed = Math.fround(3.4);
const KStraightTolerance = 10;
const KWalkAnimationDelay = 50;
const KDeadAnimationDelay = 75;
const KBodyPartSpriteSize = 20;
const KEnemyRotationSpeed = 3;
const KMaxEffectsInGame = 4000;
const KLightOverloadLimit = 2000;
const KHeavyOverloadLimit = 3000;
const KTooManyTries = 100000;
const KCrateWakeupDelay = 1250;
/** `KPlayerMaxEnergy` / `KShieldEnergyAmount` (CPlayer.h). */
export const KPlayerMaxEnergy = 100;
export const KShieldEnergyAmount = 10;
/** `KPlayerColor` (defines.h) — per-seat recolour bases. */
export const KPlayerColor: readonly number[] = [
  16 * 3,
  16 * 9,
  16 * 10,
  16 * 11,
  16 * 1,
  16 * 2,
  16 * 4,
  16 * 5,
];
/** `KSteamRates[8]` (CDynGameData.cpp). */
const KSteamRates = [30, 20, 10, 10, 8, 8, 6, 6];

export const enum Key {
  Up = 1,
  Down = 2,
  Left = 4,
  Right = 8,
  Strafe = 16,
  LeftStrafe = 32,
  RightStrafe = 64,
  Shoot = 128,
  Shift = 256,
}

export const enum MouseButton {
  Left = 1,
  Right = 2,
  WheelDown = 4,
  WheelUp = 8,
}

export interface SimInput {
  keys: number;
  mouseXRel: number;
  mouseButtons: number;
}

/** No input for a seat (used for non-local seats in traces). */
export const EMPTY_INPUT: SimInput = { keys: 0, mouseXRel: 0, mouseButtons: 0 };

const enum Direction {
  Nowhere = -1,
  Up,
  Down,
  Left,
  Right,
}

export class SimBullet {
  typeId: BulletId = BulletId.Fist;
  x = 0;
  y = 0;
  speed = 0;
  angle = 0;
  spriteAngle = 0;
  spriteAngleAdd = 0;
  time = 0;
  counter = 0;
  share = 0;
  ownerId = -1;
  hitReported = false;
}

export class SimPlayer {
  x = 0;
  y = 0;
  angle = 0;
  targetAngle = 0;
  energy = 0;
  pushPower = 0;
  pushAngle = 0;
  dead = 0;
  hit = 0;
  speed = KPlayerNormalSpeed;
  walk = 0;
  fire = 0;
  fire2 = 0;
  kick = 0;
  anim = 0;
  shootCount = 0;
  weaponInHand = false;
  noDamage = false;
  weapons = Array.from({ length: 13 }, (): number => 0);
  bullets = Array.from({ length: 12 }, (): number => 0);
  loadCounter = 0;
  loadCounter2 = 0;
  secondaryCounter = 0;
  curWeapon: WeaponId = WeaponId.Fist;
  secWeapon = 0; // 0 == none
  screenX = 0;
  screenY = 0;
  burning = 0;
  fryingObserver = -1;
  shield = 0;
  cash = 0;
  targetSystem = false;
  local = true;
  /** `CPlayer::iName` — shown in deathmatch kill messages and statistics. */
  name = "";
  /** `CPlayer::iColor` — `KPlayerColor[i]`, used for the recolour and minimap dot. */
  color = 16 * 3;
  /**
   * This seat's viewport (`CDynGameData::PlayerDrawRect`). Set once per level by
   * the session; the simulation uses it for movement, camera and steam culling.
   */
  drawRect: Rect = makeRect(0, 0, 0, 0);

  spriteAngle(): number {
    return Math.trunc(this.angle / 4.5);
  }
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

export class SimWorld {
  readonly level: Level;
  readonly rng: GlibcRandom;
  players: SimPlayer[] = [];
  bullets: SimBullet[] = [];
  effects: SimEffect[] = [];
  newEffects: SimEffect[] = [];
  bodyparts: SimBodyPart[] = [];
  enemies: SimEnemy[] = [];
  crates: SimCrate[] = [];
  deadEnemies: Array<{ x: number; y: number }> = [];
  mouseOwner = -1;
  /**
   * Netplay extension: when set, every seat consumes its own mouse input
   * instead of the single shared `mouseOwner`. Off for single-player and local
   * split-screen (parity), on for online matches (docs/multiplayer/01).
   */
  perSeatMouse = false;
  mouseSensitivity = 0.5;
  /** Per-seat right-button edge state (the original has a single mouse). */
  mouseRightPressed: boolean[] = [];
  coopFrags = false;
  networkNone = true;
  steamAnimationCount = 0;
  /** `IGameMode::Frags()` — cooperative (the default) is false. */
  frags = false;
  /** `IGameMode::CrateRespawn()` — cooperative is false. */
  crateRespawn = false;
  /** `IGameMode::DMCrates()` — deathmatch places the DM crate lists. */
  dmCrates = false;
  /** `iEnemiesOnGame || !DisableEnemiesPossible()` — spawn enemies this level. */
  enemiesEnabled = true;
  /** `CGameSystem::CharacterDied` — cooperative death notification to the session. */
  onCharacterDied: ((index: number, p: SimPlayer) => void) | null = null;
  /** `IGameMode::RandomPlacePlayers()` — DM scatters players instead of start points. */
  randomPlacePlayers = false;
  /** `OptionsData.dmSpeed` — deathmatch player move speed. */
  dmSpeed = KPlayerNormalSpeed;
  /** `OptionsData.dmTargetSystem` — deathmatch gives everyone a target system. */
  dmTargetSystem = false;
  /** `CIngameData::iKillTexts` / `iSuicideTexts`, formatted on a player kill. */
  killTexts: readonly string[] = [];
  suicideTexts: readonly string[] = [];
  /** Kill/suicide messages emitted this tick; the app drains them to the board. */
  readonly messages: string[] = [];
  /** `CFonts::Length` for the small in-game font (crate pickup text). */
  textLength: (text: string) => number = (text) => text.length;
  /** `CGameStatisticsData` sink, if any (see `src/sim/statistics.ts`). */
  stats: GameStatistics | null = null;
  /** Samples emitted this tick (`CSoundPlayer`); the app drains them. */
  readonly sounds: SoundEvent[] = [];
  /**
   * `CEnemy::SoundHeard` on positional samples. The parity oracle
   * (`tools/reference/simreference.h`) does not model it yet, so the replay
   * harness turns it off to stay byte-comparable (docs/13).
   */
  hearSounds = true;
  /** Monotonic id for enemy bullet-owner identity. */
  private enemyUidCounter = 0;

  constructor(level: Level, seed: number) {
    this.level = level;
    this.rng = new GlibcRandom(seed);
  }

  /** `CLevelRuntimeData::NewEffect`. */
  newEffect(type: EffectId, x: number, y: number, angle: number, speed: number): void {
    if (type === EffectId.None) return;
    const w = this.level.width * KBlockSpriteSize;
    const h = this.level.height * KBlockSpriteSize;
    if (x >= 0 && x < w && y >= 0 && y < h) {
      const m = setMovement(angle, speed);
      this.newEffects.push(new SimEffect(type, x, y, m.x, m.y));
    }
  }

  /** `CLevelRuntimeData::NewBodyPart`. */
  newBodyPart(x: number, y: number, angle: number, speed: number, num: number): void {
    const part = new SimBodyPart();
    part.x = x;
    part.y = y;
    part.angle = angle;
    part.speed = speed;
    part.typeId = num;
    this.bodyparts.push(part);
  }

  /** `CLevelRuntimeData::NewEnemy`. */
  newEnemy(type: number, waitStill: boolean, x: number, y: number, angle: number): void {
    const e = new SimEnemy();
    e.uid = this.enemyUidCounter++;
    e.typeId = type;
    e.state = waitStill ? EnemyState.Still : EnemyState.WanderAround;
    e.angle = angle;
    e.targetAngle = angle;
    e.x = x;
    e.y = y;
    e.curWeapon = EnemyTypes[type].currentWeapon;
    e.energy = EnemyTypes[type].energy;
    e.seePlayer = Array.from({ length: this.players.length }, () => 0);
    this.enemies.push(e);
  }

  /** `CLevelRuntimeData::NewCrate`. */
  newCrate(x: number, y: number, kind: CrateKind, value: number): void {
    this.crates.push(new SimCrate(kind, value, x, y));
  }

  /** `CLevelRuntimeData::NewBullet`. */
  newBullet(
    type: BulletId,
    posX: number,
    posY: number,
    angle: number,
    timeAdd: number,
    share: number,
    owner: number,
  ): void {
    let rx = Math.trunc(posX);
    let ry = Math.trunc(posY);
    let cnt = 1;
    while (
      simCollision(this.level, idiv(rx, KBlockSpriteSize), idiv(ry, KBlockSpriteSize)) &&
      cnt < Math.trunc(KBlockSpriteSize * 1.4)
    ) {
      const p = addMovement({ x: f32(posX), y: f32(posY) }, angle, -cnt);
      rx = Math.trunc(p.x);
      ry = Math.trunc(p.y);
      cnt++;
    }
    if (cnt >= Math.trunc(KBlockSpriteSize * 1.4)) {
      rx = Math.trunc(posX);
      ry = Math.trunc(posY);
    }

    const b = new SimBullet();
    b.typeId = type;
    b.x = rx;
    b.y = ry;
    const ang = angleFix(angle);
    b.angle = ang;
    b.spriteAngle = f32(ang);
    b.spriteAngleAdd = 0;
    b.speed = f32(BulletTypes[type].speed);
    b.time = BulletTypes[type].time + timeAdd;
    b.counter = 0;
    b.share = share;
    b.ownerId = owner;
    b.hitReported = false;
    this.bullets.push(b);
  }

  // ---------------------------------------------------------------------
  // M7: sound emission (CSoundPlayer)
  // ---------------------------------------------------------------------

  /** `CSoundPlayer::PlayPosSample` — queues a panned sample and lets enemies hear it. */
  private playPosSound(effect: SoundEffect, x: number, y: number): void {
    if (effect === SoundEffect.NoSound) return;
    if (this.hearSounds) this.soundHeard(effect, Math.trunc(x), Math.trunc(y));
    this.sounds.push({ effect, volume: 1, x, y, positional: true });
  }

  /** `CSoundPlayer::PlaySample` — a centred sample with no hearing. */
  private playFlatSound(effect: SoundEffect): void {
    if (effect === SoundEffect.NoSound) return;
    this.sounds.push({ effect, volume: 1, x: 0, y: 0, positional: false });
  }

  /** `CGameSubStateOngoing::SoundHeard` — forwards to every enemy. */
  private soundHeard(effect: SoundEffect, posX: number, posY: number): void {
    for (const e of this.enemies) this.enemySoundHeard(e, effect, posX, posY);
  }

  /** `CEnemy::SoundHeard`. */
  private enemySoundHeard(e: SimEnemy, effect: SoundEffect, posX: number, posY: number): void {
    const t = EnemyTypes[e.typeId];
    if (!t.hostile) return;
    if (e.state === EnemyState.Assault) return;
    if (effect === SoundEffect.Click) return;
    if (
      getDist(posX, posY, e.x, e.y) < t.sightDistance &&
      simVisibilityCheck(this.level, Math.trunc(e.x) + 14, Math.trunc(e.y) + 14, posX, posY).visible
    ) {
      e.state = EnemyState.Assault;
      e.targetAngle = Math.trunc(getAngle(e.x, e.y, posX, posY));
      e.walkCounter = Math.trunc(
        (getDist(posX, posY, e.x, e.y) -
          approxDistance(BulletTypes[WeaponTypes[t.currentWeapon].bulletType]) * 0.75) /
          t.speed,
      );
      if (e.walkCounter < 0) e.walkCounter = 0;
    }
  }

  /** `CLevelRuntimeData::Explo`. */
  explo(posX: number, posY: number, size: number, share: number, owner: number): void {
    const ray = size * 5;
    for (let a = 0; a < ray; a++) {
      this.newBullet(
        BulletId.ExplosionRay,
        posX,
        posY,
        Math.trunc((a * 360.0) / ray),
        Math.trunc(size * 2.5),
        f32(share / ray),
        owner,
      );
    }
    const dst = (this.rng.rand() % 5) + 1;
    for (let a = 0; a < dst; a++) {
      // NewEffect(rand()%2 ? Yellow : Red, aPos, rand()%360, (rand()%2)+2)
      // g++ right-to-left: speed, angle, type.
      const sp = (this.rng.rand() % 2) + 2;
      const ang = this.rng.rand() % 360;
      const t = this.rng.rand() % 2 ? EffectId.MetalYellow : EffectId.MetalRed;
      this.newEffect(t, posX, posY, ang, sp);
    }

    // Move body parts near the blast (CLevelRuntimeData::Explo).
    const pushDist = 25 * size;
    const left = posX - pushDist * 2;
    const right = posX + pushDist * 2;
    for (const part of this.bodyparts) {
      // Body parts are sorted by X; this matches std::lower/upper_bound ranges.
      if (part.x < left || part.x > right) continue;
      const vx = part.x - posX;
      const vy = part.y - posY;
      let dist = vectorLength({ x: vx, y: vy });
      if (dist < pushDist * 2) {
        if (simVisibilityCheck(this.level, posX, posY, part.x, part.y).visible) {
          if (dist) {
            dist = f32(dist * f32(dist / 2));
            const nx = ((this.rng.rand() % pushDist) * vx) / dist;
            const ny = ((this.rng.rand() % pushDist) * vy) / dist;
            this.bodyPartPush(part, nx, ny);
          }
        }
      }
    }

    // CDynGameData::Explo — sound after the runtime explosion.
    const fx =
      size <= 1
        ? SoundEffect.SmallExplosion
        : size <= 3
          ? SoundEffect.Explosion
          : SoundEffect.BigExplosion;
    this.playPosSound(fx, posX, posY);
  }

  /** `CPlayer::GetDamage`. `observer`/`victimIndex` are player indices (`-1` = enemy). */
  getDamage(p: SimPlayer, damage: number, observer: number, victimIndex: number): void {
    if (p.dead) return;
    if (p.noDamage) return;
    p.hit = 15;
    p.energy = f32(p.energy - damage);
    if (p.energy <= 0) {
      p.energy = 0;
      // `IGameMode::Frags()` + a player observer (enemy killers hit the empty
      // `CCharacter::BulletPlayerKill` base, so they never count as a frag).
      if (this.frags && observer >= 0) {
        const killer = this.players[observer];
        const text =
          observer === victimIndex
            ? this.randomText(this.suicideTexts, [killer?.name ?? ""])
            : this.randomText(this.killTexts, [killer?.name ?? "", p.name]);
        if (text !== null) this.messages.push(text);
        this.stats?.addPlayerKill(observer, victimIndex);
      }
      if (p.burning) {
        this.playFlatSound(SoundEffect.Woosh);
        this.newEffect(EffectId.Explo, p.x + 12, p.y + 12, 0, 0);
        this.newEffect(EffectId.Explo, p.x + 18, p.y + 12, 0, 0);
        this.newEffect(EffectId.Explo, p.x + 15, p.y + 18, 0, 0);
      } else {
        for (let a = 0; a < 16; a++)
          if (this.rng.rand() % 2)
            this.newEffect(EffectId.Blood, p.x + 15, p.y + 15, Math.trunc(a * 22.5), 2);
        this.playFlatSound(SoundEffect.Death);
      }
      this.stats?.playerDied(victimIndex);
      p.dead = 1;
    }
  }

  /** `CIngameData::RandomKillText` / `RandomSuicideText` — `sprintf` with `%s` args. */
  private randomText(texts: readonly string[], args: string[]): string | null {
    if (texts.length === 0) return null;
    const template = texts[this.rng.rand() % texts.length];
    let i = 0;
    return template.replace(/%s/g, () => args[i++] ?? "");
  }

  private checkWalls(mode: Direction, nx: number, ny: number): boolean {
    switch (mode) {
      case Direction.Up:
        return simCollision(this.level, nx, ny - 1);
      case Direction.Left:
        return simCollision(this.level, nx - 1, ny);
      case Direction.Down:
        return simCollision(this.level, nx, ny + 1);
      case Direction.Right:
        return simCollision(this.level, nx + 1, ny);
    }
    return false;
  }

  private bounce(b: SimBullet, bounceType: BounceType, newLocX: number, newLocY: number): void {
    const KIso = 10000;
    let distUp = KIso;
    let distLeft = KIso;
    let distDown = KIso;
    let distRight = KIso;
    const nx = Math.trunc(newLocX);
    const ny = Math.trunc(newLocY);
    if (this.checkWalls(Direction.Up, nx, ny)) distUp = ny % KBlockSpriteSize;
    if (this.checkWalls(Direction.Left, nx, ny)) distLeft = nx % KBlockSpriteSize;
    if (this.checkWalls(Direction.Down, nx, ny))
      distDown = KBlockSpriteSize - (ny % KBlockSpriteSize);
    if (this.checkWalls(Direction.Right, nx, ny))
      distRight = KBlockSpriteSize - (nx % KBlockSpriteSize);

    let min = distUp;
    if (distLeft < min) min = distLeft;
    if (distDown < min) min = distDown;
    if (distRight < min) min = distRight;

    if (distUp !== KIso || distLeft !== KIso || distDown !== KIso || distRight !== KIso) {
      if (bounceType === BounceType.Normal) {
        if (min === distUp || min === distDown) b.angle = 360 - b.angle;
        if (min === distLeft || min === distRight) b.angle = 180 - b.angle;
      } else {
        const tmp = setMovement(b.angle, b.speed);
        if (min === distUp || min === distDown) tmp.y = 0;
        if (min === distLeft || min === distRight) tmp.x = 0;
        b.angle = Math.trunc(vectorAngle(tmp));
        b.speed = vectorLength(tmp);
      }
      b.angle = angleFix(b.angle);
      if (b.angle < 180) b.spriteAngleAdd = f32(-b.speed * 15);
      else b.spriteAngleAdd = f32(b.speed * 15);
    } else {
      b.speed = 0;
    }
  }

  /** `CBullet::Move` — returns true when the bullet dies. */
  moveBullet(b: SimBullet): boolean {
    let hit = false;
    let hitwall = false;
    let rposX = Math.trunc(b.x);
    let rposY = Math.trunc(b.y);
    let vposX = 0;
    let vposY = 0;
    const t = BulletTypes[b.typeId];

    let loopTimes = Math.trunc(b.speed) >> 2;
    if (loopTimes < 1) loopTimes = 1;
    b.time--;
    b.counter++;

    if (t.timeBeforeSpin > 0 && b.counter === t.timeBeforeSpin) {
      if (b.angle < 180) b.spriteAngleAdd = f32(-b.speed * 15);
      else b.spriteAngleAdd = f32(b.speed * 15);
    }

    for (let a = 0; a < loopTimes && !hit && !hitwall; a++) {
      if (b.speed > 0.001) {
        const proposal = addMovement({ x: b.x, y: b.y }, b.angle, f32(b.speed / loopTimes));
        const vis = simVisibilityCheck(this.level, b.x, b.y, proposal.x, proposal.y);
        let npx = vis.x;
        let npy = vis.y;
        if (!vis.visible) {
          if (t.collisionTrigger) {
            hitwall = true;
          } else {
            this.bounce(b, t.bounceType, npx, npy);
            this.playPosSound(t.bounceSound, b.x, b.y);
            const np = addMovement({ x: b.x, y: b.y }, b.angle, f32(b.speed / loopTimes));
            npx = np.x;
            npy = np.y;
          }
        }
        b.x = npx;
        b.y = npy;
        rposX = Math.trunc(b.x);
        rposY = Math.trunc(b.y);
      }

      if (b.counter > t.sleepTime && !hitwall) {
        // Enemies (NetworkMode != Client).
        for (let ei = 0; ei < this.enemies.length;) {
          const e = this.enemies[ei];
          const l = Math.trunc(e.x) + 5;
          const tt = Math.trunc(e.y) + 5;
          const r = Math.trunc(e.x) + 22;
          const bb = Math.trunc(e.y) + 22;
          const inside = rposX >= l && rposX < r && rposY >= tt && rposY < bb;
          const selfOk =
            b.ownerId !== this.enemyOwnerId(e) ||
            (t.type !== BulletKind.Incendiary && t.type !== BulletKind.Fist);
          if (inside && selfOk) {
            hit = true;
            this.enemyGotoBulletOrigin(e, b);
            const vp = addMovement({ x: f32(e.x + 14), y: f32(e.y + 14) }, b.angle, 4);
            vposX = Math.trunc(vp.x);
            vposY = Math.trunc(vp.y);
            e.pushAngle = b.angle;
            if (t.pushPower > e.pushPower) e.pushPower = f32(t.pushPower * 0.75);
            if (t.type === BulletKind.Incendiary) {
              e.burning += 15;
              e.fryingObserver = b.ownerId;
            }
            let dead = false;
            if (t.power > 0) dead = this.enemyGetDamage(e, t.power, b.ownerId);
            if (dead) this.killEnemy(ei);
            else ei++;
          } else ei++;
        }

        for (let bi = 0; bi < this.players.length; bi++) {
          const pl = this.players[bi];
          const l = Math.trunc(pl.x) + 5;
          const tt = Math.trunc(pl.y) + 5;
          const r = Math.trunc(pl.x) + 22;
          const bb = Math.trunc(pl.y) + 22;
          const inside = rposX >= l && rposX < r && rposY >= tt && rposY < bb;
          const selfOk =
            b.ownerId !== bi || (t.type !== BulletKind.Incendiary && t.type !== BulletKind.Fist);
          if (!pl.dead && inside && selfOk) {
            hit = true;
            const vp = addMovement({ x: f32(pl.x + 14), y: f32(pl.y + 14) }, b.angle, 4);
            vposX = Math.trunc(vp.x);
            vposY = Math.trunc(vp.y);
            if (this.networkNone) {
              pl.pushAngle = b.angle;
              if (t.pushPower > pl.pushPower) pl.pushPower = f32(t.pushPower * 0.75);
              if (t.type === BulletKind.Incendiary) {
                pl.burning += 15;
                pl.fryingObserver = b.ownerId;
              }
              if (t.power > 0) this.getDamage(pl, t.power, b.ownerId, bi);
            }
          }
        }
      }
    }

    if ((t.type === BulletKind.Normal || t.type === BulletKind.Fist) && hitwall)
      if (this.rng.rand() % 8 === 1) {
        // NewEffect(Metal, rpos, rand()%360, (rand()%2)+2) — right-to-left.
        const sp = (this.rng.rand() % 2) + 2;
        const ang = this.rng.rand() % 360;
        this.newEffect(EffectId.Metal, rposX, rposY, ang, sp);
      }

    if (hit) {
      if (t.stop) b.speed = 0;
      if (t.type === BulletKind.Normal || t.type === BulletKind.Fist) {
        let bp = 0.5 + t.power / 2 + (this.rng.rand() % 2);
        if (bp > 4) bp = 4;
        for (let a = 0; a < Math.trunc(t.power / 5) + 1; a++) {
          // NewEffect(Blood, vpos.Add((rand()%6)-3,(rand()%6)-3), iAngle+((rand()%30)-15), bp)
          // right-to-left: angle, then Add's y, then x.
          const ang = b.angle + ((this.rng.rand() % 30) - 15);
          const yy = vposY + ((this.rng.rand() % 6) - 3);
          const xx = vposX + ((this.rng.rand() % 6) - 3);
          this.newEffect(EffectId.Blood, xx, yy, ang, bp);
        }
      }
      if (b.ownerId >= 0 && t.power > 0 && !b.hitReported) {
        this.stats?.addHit(b.ownerId, b.share);
        b.hitReported = true;
      }
      if (t.type === BulletKind.Fist) this.playPosSound(WeaponTypes[0].sound, rposX, rposY);
    }

    if (
      (t.type === BulletKind.Normal || t.type === BulletKind.Fist) &&
      (b.time === 0 || hitwall) &&
      !hit &&
      t.speed > 10
    )
      this.newEffect(EffectId.Smoke, rposX, rposY, 0, 0);

    let alive = true;
    if ((t.collisionTrigger && (hit || hitwall)) || b.time === 0) {
      if (t.type === BulletKind.Explosive) {
        // rpos (int) .AddMovement: the movement component is truncated first.
        const ex = rposX + Math.trunc(cose(b.angle) * -1);
        const ey = rposY + Math.trunc(sine(b.angle) * -1);
        this.explo(ex, ey, t.explosion, b.share, b.ownerId);
      }
      alive = false;
    }

    // Effect / Effect2 are created even when the bullet dies this tick; rand is
    // consumed only inside the DoEffect() branch (rocket every other counter).
    {
      const doE = t.effectKind !== EffectKind.Rocket || b.counter % 2 === 0;
      if (doE) {
        const ea =
          t.effectKind === EffectKind.Rocket
            ? b.angle + 90 + (this.rng.rand() % 180)
            : t.effectKind === EffectKind.Ray
              ? b.angle + 180
              : b.angle;
        const es =
          t.effectKind === EffectKind.Rocket
            ? 0.1
            : t.effectKind === EffectKind.Ray
              ? this.rng.rand() % 2
              : 0;
        this.newEffect(t.effect, rposX, rposY, ea, es);
      }
    }
    this.newEffect(t.effect2, rposX, rposY, b.angle, 0);

    if (b.speed > 0) b.speed = f32(b.speed + t.slow);
    if (b.speed < 0) b.speed = 0;

    b.spriteAngle = f32(b.spriteAngle + b.spriteAngleAdd);
    b.spriteAngle = angleFix(b.spriteAngle);
    if (b.spriteAngleAdd > 0) b.spriteAngleAdd = f32(b.spriteAngleAdd - f32(0.4));
    if (b.spriteAngleAdd < 0) b.spriteAngleAdd = f32(b.spriteAngleAdd + f32(0.4));
    if (b.spriteAngleAdd >= -f32(0.4) && b.spriteAngleAdd <= f32(0.4)) b.spriteAngleAdd = 0;

    return !alive;
  }

  // ---- player ----
  private setAngle(p: SimPlayer, a: number): void {
    const ang = angleFix(a);
    p.angle = ang;
    p.targetAngle = Math.trunc(ang);
  }

  private rotate(p: SimPlayer, c: number): void {
    this.setAngle(p, f32(p.angle + c));
  }

  private straighten(p: SimPlayer): void {
    if (p.angle >= 360 - KStraightTolerance || p.angle <= KStraightTolerance)
      return this.setAngle(p, 0);
    if (p.angle >= 90 - KStraightTolerance && p.angle <= 90 + KStraightTolerance)
      return this.setAngle(p, 90);
    if (p.angle >= 180 - KStraightTolerance && p.angle <= 180 + KStraightTolerance)
      return this.setAngle(p, 180);
    if (p.angle >= 270 - KStraightTolerance && p.angle <= 270 + KStraightTolerance)
      return this.setAngle(p, 270);
  }

  private footprint(p: SimPlayer, side: number): void {
    const fp = addMovement(
      { x: f32(p.x + 15), y: f32(p.y + 15) },
      Math.trunc(p.angle) + 90 + side * 180,
      4,
    );
    const bx = Math.trunc(fp.x);
    const by = Math.trunc(fp.y);
    if (levelData(this.level, idiv(bx, KBlockSpriteSize), idiv(by, KBlockSpriteSize)).type === 0)
      if (simDustBlock(this.level, idiv(bx, KBlockSpriteSize), idiv(by, KBlockSpriteSize)))
        this.newEffect(EffectId.Footprint, bx, by, 0, 0);
  }

  /** `CDynGameData::CharCollision` — enemies then players, excluding `self`. */
  private charCollision(
    l: number,
    t: number,
    r: number,
    b: number,
    self: SimPlayer | SimEnemy,
  ): boolean {
    for (const e of this.enemies) {
      if (e === self) continue;
      const ex = Math.trunc(e.x);
      const ey = Math.trunc(e.y);
      if (ex >= l && ex < r && ey >= t && ey < b) return true;
    }
    for (const pl of this.players) {
      if (pl === self) continue;
      if (pl.dead) continue;
      const px = Math.trunc(pl.x);
      const py = Math.trunc(pl.y);
      if (px >= l && px < r && py >= t && py < b) return true;
    }
    return false;
  }

  /** `CCharacter::Move` — shared by players ({@link charMove}) and enemies. */
  private charMoveChar(
    ch: { x: number; y: number; walk: number },
    aAngle: number,
    aSpeed: number,
    self: SimPlayer | SimEnemy,
    footprint: (side: number) => void,
  ): void {
    const reuna = 6;
    const reuna2 = 4;
    if (
      ch.walk === Math.trunc(KWalkAnimationDelay * 0.25) ||
      ch.walk === Math.trunc(KWalkAnimationDelay * 0.75)
    )
      footprint(0);
    if (ch.walk === Math.trunc(KWalkAnimationDelay * 0.5) || ch.walk === KWalkAnimationDelay - 1)
      footprint(1);

    const newpos = addMovement({ x: ch.x, y: ch.y }, aAngle, aSpeed);
    const tx = Math.trunc(newpos.x);
    const ty = Math.trunc(newpos.y);
    const bp: Array<[number, number]> = [
      [idiv(tx + 14 - reuna2, KBlockSpriteSize), idiv(ty + reuna, KBlockSpriteSize)],
      [idiv(tx + 14 + reuna2, KBlockSpriteSize), idiv(ty + reuna, KBlockSpriteSize)],
      [
        idiv(tx + 14 - reuna2, KBlockSpriteSize),
        idiv(ty + KCharacterSpriteSize - reuna, KBlockSpriteSize),
      ],
      [
        idiv(tx + 14 + reuna2, KBlockSpriteSize),
        idiv(ty + KCharacterSpriteSize - reuna, KBlockSpriteSize),
      ],
      [idiv(tx + reuna, KBlockSpriteSize), idiv(ty + 14 - reuna2, KBlockSpriteSize)],
      [idiv(tx + reuna, KBlockSpriteSize), idiv(ty + 14 + reuna2, KBlockSpriteSize)],
      [
        idiv(tx + KCharacterSpriteSize - reuna, KBlockSpriteSize),
        idiv(ty + 14 - reuna2, KBlockSpriteSize),
      ],
      [
        idiv(tx + KCharacterSpriteSize - reuna, KBlockSpriteSize),
        idiv(ty + 14 + reuna2, KBlockSpriteSize),
      ],
    ];

    if (
      newpos.y < ch.y &&
      levelData(this.level, bp[0][0], bp[0][1]).type === 0 &&
      levelData(this.level, bp[1][0], bp[1][1]).type === 0
    ) {
      if (!this.charCollision(tx - 15, ty + 2 * reuna - KCharacterSpriteSize, tx + 15, ty, self)) {
        if (newpos.y < 0) ch.y = 0;
        else ch.y = newpos.y;
      }
    }
    if (
      newpos.y > ch.y &&
      levelData(this.level, bp[2][0], bp[2][1]).type === 0 &&
      levelData(this.level, bp[3][0], bp[3][1]).type === 0
    ) {
      if (!this.charCollision(tx - 15, ty, tx + 15, ty + KCharacterSpriteSize - 2 * reuna, self)) {
        if (newpos.y > this.level.height * KBlockSpriteSize - KCharacterSpriteSize)
          ch.y = this.level.height * KBlockSpriteSize - KCharacterSpriteSize;
        else ch.y = newpos.y;
      }
    }
    if (
      newpos.x < ch.x &&
      levelData(this.level, bp[4][0], bp[4][1]).type === 0 &&
      levelData(this.level, bp[5][0], bp[5][1]).type === 0
    ) {
      if (!this.charCollision(tx + 2 * reuna - KCharacterSpriteSize, ty - 15, tx, ty + 15, self)) {
        if (newpos.x < 0) ch.x = 0;
        else ch.x = newpos.x;
      }
    }
    if (
      newpos.x > ch.x &&
      levelData(this.level, bp[6][0], bp[6][1]).type === 0 &&
      levelData(this.level, bp[7][0], bp[7][1]).type === 0
    ) {
      if (!this.charCollision(tx, ty - 15, tx + KCharacterSpriteSize - 2 * reuna, ty + 15, self)) {
        if (newpos.x > this.level.width * KBlockSpriteSize - KCharacterSpriteSize)
          ch.x = this.level.width * KBlockSpriteSize - KCharacterSpriteSize;
        else ch.x = newpos.x;
      }
    }
  }

  private charMove(p: SimPlayer, aAngle: number, aSpeed: number): void {
    this.charMoveChar(p, aAngle, aSpeed, p, (side) => this.footprint(p, side));
  }

  /** `CPlayer::Move` (blood effect while hurt + character move + crate pickup). */
  private playerMove(p: SimPlayer, aAngle: number, aSpeed: number, drawRect: Rect): void {
    if (p.energy < 20 && p.walk % 4 === 0 && this.rng.rand() % 3 === 0)
      this.newEffect(EffectId.BloodOnGround, p.x + 15, p.y + 15, 0, 0);
    this.charMove(p, aAngle, aSpeed);
    this.pickupCrates(p, drawRect);
  }

  private changeWeapon(p: SimPlayer, reverse: boolean): void {
    let curWeapIndex = p.curWeapon;
    if (!reverse) {
      if (
        WeaponTypes[curWeapIndex].singleHand &&
        p.weapons[curWeapIndex] === 2 &&
        p.secWeapon === 0
      ) {
        p.secWeapon = p.curWeapon;
      } else {
        curWeapIndex++;
        curWeapIndex %= WeaponTypes.length;
        p.secWeapon = 0;
      }
      while (p.weapons[curWeapIndex % WeaponTypes.length] === 0) {
        curWeapIndex++;
        curWeapIndex %= WeaponTypes.length;
      }
      p.curWeapon = curWeapIndex;
    } else {
      if (p.secWeapon !== 0) {
        p.secWeapon = 0;
      } else {
        curWeapIndex--;
        if (curWeapIndex < 0) curWeapIndex += WeaponTypes.length;
        while (p.weapons[curWeapIndex % WeaponTypes.length] === 0) {
          curWeapIndex--;
          curWeapIndex %= WeaponTypes.length;
        }
        p.curWeapon = curWeapIndex;
        if (WeaponTypes[p.curWeapon].singleHand && p.weapons[curWeapIndex] === 2)
          p.secWeapon = curWeapIndex;
      }
    }
    p.loadCounter = 0;
    p.loadCounter2 = 0;
  }

  private chooseBestWeapon(p: SimPlayer): void {
    let best = 0;
    let selection = 0;
    for (let a = 0; a < WeaponTypes.length; a++) {
      if (
        p.weapons[a] > 0 &&
        WeaponTypes[a].priority > best &&
        p.bullets[WeaponTypes[a].bulletType] > 0
      ) {
        best = WeaponTypes[a].priority;
        selection = a;
      }
    }
    p.curWeapon = selection;
  }

  private shoot(p: SimPlayer, hand: number, owner: number): void {
    const rx = Math.trunc(p.x);
    const ry = Math.trunc(p.y);
    const wt = hand === 1 ? p.curWeapon : (p.secWeapon as WeaponId);
    const w = WeaponTypes[wt];

    if (hand === 1) {
      p.fire = 1;
      p.loadCounter = 0;
      p.secondaryCounter = idiv(w.loadingTime, 2);
    } else {
      p.fire2 = 1;
      p.loadCounter2 = 0;
    }

    this.stats?.addShot(owner);

    for (let a = 0; a < w.bulletAmount; a++) {
      let r: number;
      if (p.secWeapon === 0) r = (w.angleAdd >> 1) - (this.rng.rand() % w.angleAdd);
      else r = w.angleAdd - (this.rng.rand() % (2 * w.angleAdd));
      const sp = addMovement({ x: f32(rx + 14), y: f32(ry + 14) }, Math.trunc(p.angle), 10);
      this.newBullet(
        w.bulletType,
        Math.trunc(sp.x),
        Math.trunc(sp.y),
        Math.trunc(p.angle) + r,
        0,
        f32(1 / w.bulletAmount),
        owner,
      );
    }

    if (w.consumesBullets) p.bullets[w.bulletType]--;

    if (p.shootCount % BulletTypes[w.bulletType].multiplier === 0) {
      this.playPosSound(w.sound, rx, ry);
      if (w.smoke) {
        // ofs is a CCoord<int>: each Set/AddMovement truncates separately.
        const ra = Math.trunc(p.angle);
        const ofs = addMovementI(setMovementI(ra, 8), hand === 2 ? ra + 270 : ra + 90, 4);
        this.newEffect(EffectId.GunSmoke, rx + 14 + ofs.x, ry + 14 + ofs.y, ra, 1);
      }
    }
  }

  private playerCheckKeys(index: number, p: SimPlayer, input: SimInput): void {
    let walkChk = 0;
    let speedi = 0;
    let strafe = Direction.Nowhere;
    let forward = Direction.Nowhere;
    let fAngle = 0;

    p.noDamage = false;

    if (
      !this.mouseControls(index) &&
      !(input.keys & Key.Left) &&
      !(input.keys & Key.Right) &&
      p.targetAngle === Math.trunc(p.angle)
    )
      this.straighten(p);

    if (input.keys & Key.Left)
      if (!(input.keys & Key.Strafe)) this.rotate(p, -KPlayerRotationSpeed);
    if (input.keys & Key.Right)
      if (!(input.keys & Key.Strafe)) this.rotate(p, KPlayerRotationSpeed);

    if ((input.keys & Key.Strafe && input.keys & Key.Left) || input.keys & Key.LeftStrafe) {
      strafe = Direction.Left;
      walkChk = 1;
    }
    if ((input.keys & Key.Strafe && input.keys & Key.Right) || input.keys & Key.RightStrafe) {
      strafe = Direction.Right;
      walkChk = 1;
    }

    if (input.keys & Key.Up) {
      forward = Direction.Up;
      walkChk = 1;
      if (this.rng.rand() % 40 === 0) this.kickBodyParts(p);
    }
    if (input.keys & Key.Down) {
      forward = Direction.Down;
      walkChk = 1;
    }

    if (this.mouseControls(index)) fAngle = Math.trunc(p.angle);
    else fAngle = Math.trunc(f32(p.spriteAngle() * 4.5));

    if (forward === Direction.Up) {
      if (strafe === Direction.Left) fAngle -= 45;
      if (strafe === Direction.Right) fAngle += 45;
      speedi = p.speed;
    }
    if (forward === Direction.Down) {
      fAngle += 180;
      if (strafe === Direction.Left) fAngle += 45;
      if (strafe === Direction.Right) fAngle -= 45;
      speedi = f32(p.speed * 0.75);
    }
    if (forward === Direction.Nowhere) {
      if (strafe === Direction.Left) fAngle -= 90;
      if (strafe === Direction.Right) fAngle += 90;
      if (strafe > 0) speedi = p.speed;
      else speedi = 0;
    }

    fAngle = angleFix(fAngle);
    if (speedi !== 0) this.playerMove(p, fAngle, speedi, p.drawRect);

    if (walkChk && p.walk === 0) p.walk = 1;
    if (!walkChk) p.walk = 0;

    if (
      input.keys & Key.Shoot ||
      (this.mouseControls(index) && input.mouseButtons & MouseButton.Left)
    ) {
      p.shootCount++;
      if (WeaponTypes[p.curWeapon].bulletType !== BulletId.Fist)
        if (p.loadCounter === WeaponTypes[p.curWeapon].loadingTime) {
          if (p.bullets[WeaponTypes[p.curWeapon].bulletType] > 0) {
            this.shoot(p, 1, index);
            p.weaponInHand = true;
          } else {
            p.secWeapon = 0;
            p.loadCounter2 = 0;
            p.loadCounter = 0;
            this.chooseBestWeapon(p);
          }
        }
      if (p.secWeapon !== 0)
        if (p.secondaryCounter === 0)
          if (p.loadCounter2 === WeaponTypes[p.secWeapon].loadingTime) {
            if (p.bullets[WeaponTypes[p.secWeapon].bulletType] > 0) this.shoot(p, 2, index);
            else {
              p.secWeapon = 0;
              p.loadCounter2 = 0;
            }
          }
      if (WeaponTypes[p.curWeapon].bulletType === BulletId.Fist)
        if (p.loadCounter >= WeaponTypes[p.curWeapon].loadingTime) {
          this.shoot(p, 1, index);
          this.kickBodyParts(p);
        }
    } else {
      p.shootCount = 0;
      p.weaponInHand = false;
    }

    if (!(input.mouseButtons & MouseButton.Right)) this.mouseRightPressed[index] = false;
    if (
      input.keys & Key.Shift ||
      (this.mouseControls(index) &&
        input.mouseButtons & MouseButton.Right &&
        !this.mouseRightPressed[index])
    ) {
      this.changeWeapon(p, false);
      if (this.mouseControls(index)) this.mouseRightPressed[index] = true;
    }
  }

  private loadWeapons(p: SimPlayer): void {
    if (p.loadCounter < WeaponTypes[p.curWeapon].loadingTime) p.loadCounter++;
    if (p.secWeapon !== 0)
      if (p.loadCounter2 < WeaponTypes[p.secWeapon].loadingTime) p.loadCounter2++;
    if (p.secondaryCounter > 0) p.secondaryCounter--;
  }

  private animate(index: number, p: SimPlayer): void {
    p.anim = 1;
    if (p.walk) {
      if (p.walk - 1 < KWalkAnimationDelay) p.walk++;
      else p.walk = 1;
      p.anim = idiv(p.walk - 1, idiv(KWalkAnimationDelay, 4));
      if (p.anim >= 3) p.anim = 1;
    }
    if (!p.fire && p.weaponInHand) p.anim = 3;
    if (p.fire) {
      p.fire++;
      if (p.fire > 7) p.fire = 0;
      p.anim = 4;
    }
    if (p.fire2) {
      p.fire2++;
      if (p.fire2 > 7) p.fire2 = 0;
      p.anim = 5;
    }
    if (p.dead) {
      if (p.dead - 1 < KDeadAnimationDelay) p.dead++;
      // (int)(6 + ((float)(iDead-1)/KDeadAnimationDelay)*3)
      p.anim = Math.trunc(f32(6 + f32(f32((p.dead - 1) / KDeadAnimationDelay) * 3)));
      if (p.anim > 8) p.anim = 8;
      if (p.dead - 1 === KDeadAnimationDelay) this.characterDied(index, p);
    }
    if (p.kick) {
      p.kick++;
      if (p.kick > 6) p.kick = 0;
      p.anim = p.secWeapon === 0 ? 5 : 6;
    }
  }

  private moveScr(p: SimPlayer): void {
    const drawRect = p.drawRect;
    const halfW = idiv(rectWidth(drawRect), 2);
    const halfH = idiv(rectHeight(drawRect), 2);
    const cs = cose(Math.trunc(p.angle));
    const sn = sine(Math.trunc(p.angle));

    if (Math.abs(f32(f32(p.screenX + halfW) - f32(p.x + 14))) > 100)
      p.screenX = Math.trunc(f32(p.x - halfW));
    // speed uses 35*cos, but the dead-zone comparison uses 25*cos (original quirk).
    // NB: the original re-reads iScreenPos inside the second `if`, so a +spd that
    // overshoots can be undone immediately.
    const stepX = f32(f32(f32(35 * cs) + p.x) + 14);
    const cmpX = f32(f32(f32(25 * cs) + p.x) + 14);
    let spd = Math.trunc(Math.abs(f32(f32(p.screenX + halfW) - stepX)) / 4);
    if (f32(p.screenX + halfW) < cmpX) p.screenX += spd;
    if (f32(p.screenX + halfW) > cmpX) p.screenX -= spd;

    const targY = f32(f32(f32(25 * sn) + p.y) + 14);
    spd = Math.trunc(Math.abs(f32(f32(p.screenY + halfH) - targY)) / 4);
    if (f32(p.screenY + halfH) < targY) p.screenY += spd;
    if (f32(p.screenY + halfH) > targY) p.screenY -= spd;
    if (Math.abs(f32(f32(p.screenY + halfH) - f32(p.y + 14))) > 100)
      p.screenY = Math.trunc(f32(p.y - halfH));
  }

  /** `CPlayer::InitScr` — centre this seat's camera on its viewport. */
  initScr(p: SimPlayer): void {
    p.screenX = Math.trunc(p.x - idiv(rectWidth(p.drawRect), 2));
    p.screenY = Math.trunc(p.y - idiv(rectHeight(p.drawRect), 2));
  }

  /**
   * `CPlayer::Reset` — clears per-life state. `InitScr` uses `p.drawRect`, so
   * the caller must assign the viewport first. Energy is set by the caller
   * (`PreparePlayersForLevel` / deathmatch respawn), matching the original.
   */
  resetPlayer(p: SimPlayer): void {
    p.noDamage = false;
    p.anim = 0;
    p.pushPower = 0;
    p.burning = 0;
    p.fryingObserver = -1;
    p.dead = 0;
    if (p.weapons[p.curWeapon] <= 0) {
      p.curWeapon = WeaponId.Fist;
      p.secWeapon = 0;
    }
    if (p.secWeapon !== 0 && p.weapons[p.secWeapon] < 2) p.secWeapon = 0;
    p.kick = 0;
    p.hit = 0;
    p.fire = 0;
    p.fire2 = 0;
    p.angle = 0;
    p.targetAngle = 0;
    this.initScr(p);
    p.loadCounter = 0;
    p.loadCounter2 = 0;
    p.secondaryCounter = 0;
    p.shootCount = 0;
    p.weaponInHand = false;
    p.walk = 0;
    p.speed = KPlayerNormalSpeed;
  }

  /** `CPlayer::TotalReset` — wipes loadout/score then {@link resetPlayer}. */
  totalReset(p: SimPlayer): void {
    p.targetSystem = false;
    p.energy = 0;
    p.shield = 0;
    p.cash = 0;
    for (let a = 1; a < p.weapons.length; a++) p.weapons[a] = 0;
    for (let a = 1; a < p.bullets.length; a++) p.bullets[a] = 0;
    p.weapons[WeaponId.Fist] = 1;
    p.bullets[BulletId.Fist] = 1;
    this.resetPlayer(p);
  }

  /**
   * `CDynGameData::CharacterDied` (dispatched through `IGameMode`). Deathmatch
   * respawns the player at a random floor block; cooperative notifies the
   * session (which ends the level when everyone is dead).
   */
  private characterDied(index: number, p: SimPlayer): void {
    if (!this.frags) {
      this.onCharacterDied?.(index, p);
      return;
    }
    // CGameModeDeathmatch::CharacterDied.
    this.newEffect(EffectId.Teleport, p.x + 14, p.y + 14, 0, 0);
    this.totalReset(p);
    p.speed = this.dmSpeed;
    this.randomPlace(p);
    this.initScr(p);
    this.newEffect(EffectId.Teleport, p.x + 14, p.y + 14, 0, 0);
    p.shield = 30;
    p.energy = Math.trunc((KPlayerMaxEnergy + p.shield * KShieldEnergyAmount) / 3);
    if (this.dmTargetSystem) p.targetSystem = true;
  }

  /** `CPlayer::RandomPlace` — pick a reachable floor block away from enemies/players. */
  randomPlace(p: SimPlayer): void {
    const w = this.level.width;
    const h = this.level.height;
    let testCount = 0;
    let badLocation: boolean;
    do {
      badLocation = false;
      const easyMode = testCount > 200;
      let x: number;
      let y: number;
      if (easyMode) {
        x = (this.rng.rand() % w) * KBlockSpriteSize;
        y = (this.rng.rand() % h) * KBlockSpriteSize;
      } else {
        x = this.rng.rand() % (w * KBlockSpriteSize);
        y = this.rng.rand() % (h * KBlockSpriteSize);
      }
      p.x = x;
      p.y = y;

      const bx = idiv(x, KBlockSpriteSize);
      const by = idiv(y, KBlockSpriteSize);
      if (levelData(this.level, bx, by).type !== 0) badLocation = true;
      if (y % KBlockSpriteSize)
        if (levelData(this.level, bx, by + 1).type !== 0) badLocation = true;
      if (y % KBlockSpriteSize && x % KBlockSpriteSize)
        if (levelData(this.level, bx + 1, by + 1).type !== 0) badLocation = true;
      if (x % KBlockSpriteSize)
        if (levelData(this.level, bx + 1, by).type !== 0) badLocation = true;

      if (!badLocation) {
        const eta = easyMode ? 30 : 100;
        for (const e of this.enemies)
          if (getDist(p.x, p.y, e.x, e.y) < eta) {
            badLocation = true;
            break;
          }
      }
      for (const other of this.players)
        if (other !== p && getDist(p.x, p.y, other.x, other.y) < 30) badLocation = true;

      testCount++;
      if (testCount >= 10000) {
        // Original throws; keep the last candidate rather than hang.
        break;
      }
    } while (badLocation);
  }

  // ---------------------------------------------------------------------
  // M4: enemies
  // ---------------------------------------------------------------------

  private enemyOwnerId(e: SimEnemy): number {
    return -e.uid - 2;
  }

  private killEnemy(index: number): void {
    const e = this.enemies[index];
    this.deadEnemies.push({ x: Math.trunc(e.x), y: Math.trunc(e.y) });
    this.enemies.splice(index, 1);
  }

  /** `CEnemy::GotoBulletOrigin`. */
  private enemyGotoBulletOrigin(e: SimEnemy, b: SimBullet): void {
    const t = EnemyTypes[e.typeId];
    const walkCounter = Math.trunc(approxDistance(BulletTypes[b.typeId]) / t.speed);
    if (t.hostile) {
      if (e.state !== EnemyState.Assault) {
        e.targetAngle = angleFix(b.angle + 180);
        e.walkCounter = walkCounter;
        e.state = EnemyState.Assault;
      }
    } else {
      e.targetAngle = angleFix(b.angle);
      e.walkCounter = walkCounter;
      e.state = EnemyState.WanderAround;
    }
  }

  /** `CEnemy::GetDamage`. */
  private enemyGetDamage(e: SimEnemy, damage: number, observer: number): boolean {
    const t = EnemyTypes[e.typeId];
    const alku = this.rng.rand() % 7;
    let spd = f32(1 + f32(e.pushPower / 1.5));
    if (spd > 4.5) spd = 4.5;
    e.energy = f32(e.energy - damage);
    if (e.energy <= 0) {
      if (e.burning && !t.explosionDeath) {
        this.playPosSound(SoundEffect.Woosh, e.x, e.y);
        this.newEffect(EffectId.Explo, e.x + 12, e.y + 12, 0, 0);
        this.newEffect(EffectId.Explo, e.x + 18, e.y + 12, 0, 0);
        this.newEffect(EffectId.Explo, e.x + 15, e.y + 18, 0, 0);
        for (let a = 0; a < 3; a++)
          this.newBodyPart(
            e.x + 4,
            e.y + 4,
            this.rng.rand() % 360,
            2.5,
            a + BodyPartId.BurnedChest,
          );
      }
      if (!e.burning && !t.explosionDeath) {
        for (let a = 0; a < 16; a++)
          if (this.rng.rand() % 2)
            this.newEffect(EffectId.Blood, e.x + 15, e.y + 15, Math.trunc(a * 22.5), 2);
        for (let a = 0; a < 3; a++) {
          // Oracle: spd2 (rand()%2) is drawn before the angle (rand()%360).
          const spd2 = f32(spd + f32((this.rng.rand() % 2) * 0.3));
          this.newBodyPart(e.x + 4, e.y + 4, this.rng.rand() % 360, spd2, (a + alku) % 7);
        }
        this.playPosSound(SoundEffect.Death, e.x, e.y);
      }
      if (t.explosionDeath) {
        this.explo(Math.trunc(e.x + 4), Math.trunc(e.y + 4), 2, 1, observer);
        for (let a = 0; a < 3; a++)
          this.newBodyPart(e.x + 4, e.y + 4, this.rng.rand() % 360, 3, a + BodyPartId.BurnedChest);
      }
      if (observer >= 0) this.stats?.addEnemyKill(observer, e.typeId);
      return true;
    }
    return false;
  }

  /** `CEnemy::Footprint` — note the original multiplies the angle by 4. */
  private enemyFootprint(e: SimEnemy, side: number): void {
    const fp = addMovement(
      { x: f32(e.x + 15), y: f32(e.y + 15) },
      (Math.trunc(e.angle) + 90 + side * 180) * 4,
      4,
    );
    const fx = Math.trunc(fp.x);
    const fy = Math.trunc(fp.y);
    if (levelData(this.level, idiv(fx, KBlockSpriteSize), idiv(fy, KBlockSpriteSize)).type === 0)
      if (simDustBlock(this.level, idiv(fx, KBlockSpriteSize), idiv(fy, KBlockSpriteSize)))
        this.newEffect(EffectId.Footprint, fx, fy, 0, 0);
  }

  /** `CEnemy::Move`. */
  private enemyMove(e: SimEnemy, aAngle: number, aSpeed: number): void {
    if (e.energy < 10 && e.walk % 4 === 0 && this.rng.rand() % 3 === 0)
      this.newEffect(EffectId.BloodOnGround, e.x + 15, e.y + 15, 0, 0);
    const speedi = aSpeed === 0 ? EnemyTypes[e.typeId].speed : aSpeed;
    this.charMoveChar(e, aAngle, speedi, e, (side) => this.enemyFootprint(e, side));
  }

  /** `CEnemy::TargetAngle`. */
  private enemyTargetAngle(e: SimEnemy, aSpeed: number): void {
    if (e.angle !== e.targetAngle) {
      if (e.angle < 180) {
        if (e.targetAngle < e.angle + 180 && e.targetAngle > e.angle)
          e.angle = f32(e.angle + aSpeed);
        else e.angle = f32(e.angle - aSpeed);
      } else {
        if (e.targetAngle > e.angle - 180 && e.targetAngle < e.angle)
          e.angle = f32(e.angle - aSpeed);
        else e.angle = f32(e.angle + aSpeed);
      }
      e.angle = angleFix(e.angle);
      if (
        Math.abs(e.angle - e.targetAngle) < aSpeed ||
        Math.abs(e.angle + 360 - e.targetAngle) < aSpeed
      )
        e.angle = e.targetAngle;
    }
  }

  /** `CEnemy::CheckPlayerVisibility`. */
  private enemyCheckPlayerVisibility(e: SimEnemy): void {
    const t = EnemyTypes[e.typeId];
    let min = angleFix(Math.trunc(e.angle) - 90);
    const maximum = angleFix(Math.trunc(e.angle) + 90);

    if (e.state !== EnemyState.Still && !t.hostile) return;

    let seeSome = false;
    const n = this.players.length;
    for (let b = 0; b < n; b++) {
      const pl = this.players[b];
      e.seePlayer[b] = 0;
      let goOn = 0;
      if (!pl.dead) {
        const plyAngle = Math.trunc(getAngle(e.x, e.y, pl.x, pl.y));
        if (e.angle < 270 && e.angle > 90) {
          if (plyAngle > min && plyAngle < maximum) goOn = 1;
        } else if (plyAngle > min || plyAngle < maximum) goOn = 1;
      }
      if (goOn) {
        if (getDist(e.x + 14, e.y + 14, pl.x + 14, pl.y + 14) < t.sightDistance)
          if (simVisibilityCheck(this.level, e.x + 14, e.y + 14, pl.x + 14, pl.y + 14).visible) {
            e.seePlayer[b] = 1;
            if (t.hostile) {
              seeSome = true;
              e.state = EnemyState.Assault;
            } else {
              e.state = EnemyState.WanderAround;
              return;
            }
          }
      }
    }

    if (seeSome) {
      let closest = -1;
      for (let b = 0; b < n && closest < 0; b++)
        if (!this.players[b].dead) if (e.seePlayer[b]) closest = b;
      for (let b = 0; b < n; b++) {
        const pl = this.players[b];
        if (pl.dead || !e.seePlayer[b]) continue;
        const cur = this.players[closest];
        if (getDist(pl.x, pl.y, e.x, e.y) < getDist(cur.x, cur.y, e.x, e.y)) closest = b;
      }
      const cl = this.players[closest];
      e.targetAngle = Math.trunc(getAngle(e.x, e.y, cl.x, cl.y));
    } else {
      if (e.state !== EnemyState.Still) e.state = EnemyState.WanderAround;
    }
  }

  /** `CEnemy::Shoot`. */
  private enemyShoot(e: SimEnemy): void {
    const w = WeaponTypes[e.curWeapon];
    e.fire = 1;
    e.loadCounter = 0;
    const ia = Math.trunc(e.angle);
    for (let a = 0; a < w.bulletAmount; a++) {
      const r = (w.angleAdd >> 1) - (this.rng.rand() % w.angleAdd);
      const sp = addMovement({ x: f32(e.x + 14), y: f32(e.y + 14) }, ia, 10);
      this.newBullet(
        w.bulletType,
        sp.x,
        sp.y,
        ia + r,
        0,
        f32(1 / w.bulletAmount),
        this.enemyOwnerId(e),
      );
    }
    if (e.shootCount % BulletTypes[w.bulletType].multiplier === 0) {
      this.playPosSound(w.sound, Math.trunc(e.x), Math.trunc(e.y));
      if (w.smoke) {
        let p = addMovement({ x: f32(e.x + 14), y: f32(e.y + 14) }, ia, 8);
        p = addMovement(p, ia + 90, 5);
        this.newEffect(EffectId.GunSmoke, p.x, p.y, ia, 1);
      }
    }
  }

  /** `CEnemy::CheckForShoot`. */
  private enemyCheckForShoot(e: SimEnemy): void {
    let wannashoot = 0;
    const w = WeaponTypes[e.curWeapon];
    for (let a = 0; a < this.players.length; a++) {
      const pl = this.players[a];
      if (e.seePlayer[a] && Math.abs(Math.trunc(e.targetAngle - e.angle)) < 10) {
        e.walkCounter = Math.trunc(20 / EnemyTypes[e.typeId].speed);
        const dist = Math.trunc(getDist(e.x + 14, e.y + 14, pl.x + 14, pl.y + 14));
        if (dist <= approxDistance(BulletTypes[w.bulletType]) + 20) {
          e.shootCount++;
          wannashoot = 1;
          if (e.loadCounter === w.loadingTime) this.enemyShoot(e);
        }
      }
    }
    if (!wannashoot) e.shootCount = 0;
  }

  /** `CEnemy::EnemyCheck`. */
  private enemyCheck(e: SimEnemy): void {
    this.enemyCheckPlayerVisibility(e);
    if (EnemyTypes[e.typeId].hostile) {
      this.enemyCheckForShoot(e);
      if (e.loadCounter < WeaponTypes[e.curWeapon].loadingTime) e.loadCounter++;
    }
  }

  /** `CEnemy::Animate`. */
  private enemyAnimate(e: SimEnemy): void {
    e.anim = 1;
    if (e.walk) {
      if (e.walk - 1 < KWalkAnimationDelay) e.walk++;
      else e.walk = 1;
      e.anim = idiv(e.walk - 1, idiv(KWalkAnimationDelay, 4));
      if (e.anim >= 3) e.anim = 1;
    }
    if (e.fire) {
      e.fire++;
      if (e.fire > 6) e.fire = 0;
      e.anim = 3;
    }
    if (e.energy < 10) e.anim += 4;
  }

  /** `CEnemy::DecideAndMove`. */
  private enemyDecideAndMove(e: SimEnemy): void {
    const t = EnemyTypes[e.typeId];
    if (t.hostile) {
      for (let b = 0; b < this.players.length && e.state !== EnemyState.Assault; b++)
        if (e.seePlayer[b]) e.state = EnemyState.Assault;
    }

    if (e.state === EnemyState.WanderAround && !e.walkCounter && this.rng.rand() % 125 === 1)
      e.walkCounter = (this.rng.rand() % 40) + 20;

    if (e.walkCounter > 0) {
      this.enemyMove(e, Math.trunc(e.angle), 0);
      e.walkCounter--;
      if (e.walk === 0) e.walk = 1;
    } else e.walk = 0;

    if (e.targetAngle === e.angle && !e.walkCounter) {
      if (e.state === EnemyState.WanderAround || e.state === EnemyState.Still)
        if (this.rng.rand() % 50 === 1) e.targetAngle = this.rng.rand() % 360;
    }
    this.enemyTargetAngle(e, KEnemyRotationSpeed);
  }

  /** `CLevelRuntimeData::EnemyUpdate`. */
  private enemyUpdate(): void {
    for (const e of this.enemies) {
      this.enemyDecideAndMove(e);
      if (e.pushPower > 0) {
        this.enemyMove(e, e.pushAngle, e.pushPower);
        e.pushPower = f32(e.pushPower - f32(0.075));
      }
      this.enemyCheck(e);
      this.enemyAnimate(e);
    }
  }

  /** `CCharacter::CheckBurning` for an enemy (returns true if it dies). */
  private enemyCheckBurning(e: SimEnemy): boolean {
    if (e.burning) {
      e.burning--;
      if (this.steamAnimationCount % 15 === 0)
        this.newEffect(EffectId.Steam, e.x + 14, e.y + 14, 315, 1);
      let mod = 3;
      if (e.burning > 150) mod = 2;
      if (this.steamAnimationCount % mod === 0) {
        const yy = e.y + (10 + (this.rng.rand() % 8));
        const xx = e.x + (10 + (this.rng.rand() % 8));
        this.newEffect(EffectId.Flame2, xx, yy, 315, 1);
      }
      return this.enemyGetDamage(e, 0.1, e.fryingObserver);
    }
    return false;
  }

  /** `CCharacter::CheckBurning` for a player. */
  private playerCheckBurning(index: number, p: SimPlayer): void {
    if (p.burning) {
      p.burning--;
      if (this.steamAnimationCount % 15 === 0)
        this.newEffect(EffectId.Steam, p.x + 14, p.y + 14, 315, 1);
      let mod = 3;
      if (p.burning > 150) mod = 2;
      if (this.steamAnimationCount % mod === 0) {
        const yy = p.y + (10 + (this.rng.rand() % 8));
        const xx = p.x + (10 + (this.rng.rand() % 8));
        this.newEffect(EffectId.Flame2, xx, yy, 315, 1);
      }
      this.getDamage(p, 0.1, p.fryingObserver, index);
    }
  }

  /** `CDynGameData::CheckBurn`. */
  private checkBurn(): void {
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.dead) this.playerCheckBurning(i, p);
    }
    for (let i = 0; i < this.enemies.length;) {
      if (this.enemyCheckBurning(this.enemies[i])) this.killEnemy(i);
      else i++;
    }
  }

  /** `CDynGameData::ShowSteam`. */
  private showSteam(): void {
    const buffer = 100;
    for (const s of this.level.steams) {
      let du = false;
      for (const p of this.players) {
        if (!p.local) continue;
        const halfW = idiv(rectWidth(p.drawRect), 2);
        const halfH = idiv(rectHeight(p.drawRect), 2);
        const l = Math.trunc(p.x - halfW - buffer);
        const t = Math.trunc(p.y - halfH - buffer);
        const r = Math.trunc(p.x + halfW + buffer);
        const b = Math.trunc(p.y + halfH + buffer);
        if (s.x >= l && s.x < r && s.y >= t && s.y < b) {
          du = true;
          break;
        }
      }
      if (du) {
        const rate = s.speed < KSteamRates.length ? KSteamRates[s.speed] : 1;
        if (this.steamAnimationCount % rate === 0) {
          const ang = s.angle - 3 + (this.rng.rand() % 6);
          const sp = Math.trunc(s.speed / 2) * 0.75;
          this.newEffect(EffectId.Steam, s.x, s.y, ang, sp);
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // M4: body parts
  // ---------------------------------------------------------------------

  private bodyPartSetAngleAndSpeed(part: SimBodyPart, v: { x: number; y: number }): void {
    let s = vectorLength(v);
    if (s > 5) s = 5;
    part.speed = s;
    part.angle = Math.trunc(vectorAngle(v));
  }

  private bodyPartPush(part: SimBodyPart, vx: number, vy: number): void {
    const m = addMovement({ x: vx, y: vy }, part.angle, part.speed);
    this.bodyPartSetAngleAndSpeed(part, m);
  }

  private bodyPartBounce(part: SimBodyPart, side: Direction): void {
    if (side === Direction.Down || side === Direction.Up) part.angle = 360 - part.angle;
    else if (side === Direction.Right || side === Direction.Left)
      part.angle = 270 + (270 - part.angle);
    this.playPosSound(BodyPartTypes[part.typeId].sound, part.x, part.y);
  }

  private bodyPartKick(part: SimBodyPart, angle: number): void {
    part.angle = angle;
    part.speed = BodyPartTypes[part.typeId].kickspeed;
  }

  /** `CBodyPart::Move`. */
  private bodyPartMove(part: SimBodyPart): void {
    const reuna = 4;
    const reuna2 = 2;
    if (part.speed <= 0) return;
    let vec = setMovement(part.angle, part.speed);
    const npx = f32(part.x + vec.x);
    const npy = f32(part.y + vec.y);
    const tx = Math.trunc(npx);
    const ty = Math.trunc(npy);
    const bt = BodyPartTypes[part.typeId];
    if (bt.dropBlood)
      if (this.rng.rand() % 2 !== 0)
        this.newEffect(EffectId.BloodOnGround, part.x + 10, part.y + 10, 0, 0);

    const floor = (bx: number, by: number): boolean =>
      levelData(this.level, idiv(bx, KBlockSpriteSize), idiv(by, KBlockSpriteSize)).type === 0;

    if (npy < part.y) {
      if (floor(tx + 10 - reuna2, ty + reuna) && floor(tx + 10 + reuna2, ty + reuna)) part.y = npy;
      else if (bt.bounce) this.bodyPartBounce(part, Direction.Down);
      else {
        vec = { x: vec.x, y: 0 };
        this.bodyPartSetAngleAndSpeed(part, vec);
      }
    } else if (npy > part.y) {
      if (floor(tx + 10 - reuna2, ty + 20 - reuna) && floor(tx + 10 + reuna2, ty + 20 - reuna))
        part.y = npy;
      else if (bt.bounce) this.bodyPartBounce(part, Direction.Up);
      else {
        vec = { x: vec.x, y: 0 };
        this.bodyPartSetAngleAndSpeed(part, vec);
      }
    }
    if (npx < part.x) {
      if (floor(tx + reuna, ty + 10 - reuna2) && floor(tx + reuna, ty + 10 + reuna2)) part.x = npx;
      else if (bt.bounce) this.bodyPartBounce(part, Direction.Right);
      else {
        vec = { x: 0, y: vec.y };
        this.bodyPartSetAngleAndSpeed(part, vec);
      }
    } else if (npx > part.x) {
      if (floor(tx + 20 - reuna, ty + 10 - reuna2) && floor(tx + 20 - reuna, ty + 10 + reuna2))
        part.x = npx;
      else if (bt.bounce) this.bodyPartBounce(part, Direction.Left);
      else {
        vec = { x: 0, y: vec.y };
        this.bodyPartSetAngleAndSpeed(part, vec);
      }
    }
    part.speed = f32(part.speed + bt.slow);
  }

  /** `CPlayer::KickBodyParts`. */
  private kickBodyParts(p: SimPlayer): void {
    const lx = idiv(KCharacterSpriteSize, 2) - KBodyPartSpriteSize;
    const rx = idiv(KCharacterSpriteSize, 2);
    for (const part of this.bodyparts) {
      if (part.x < p.x + lx || part.x > p.x + rx) continue;
      if (p.x + rx > part.x && p.x + lx < part.x && p.y + rx > part.y && p.y + lx < part.y) {
        p.kick = 1;
        const ang = angleFix(Math.trunc(p.angle) - 5 + (this.rng.rand() % 10));
        this.bodyPartKick(part, ang);
        this.playFlatSound(BodyPartTypes[part.typeId].sound);
      }
    }
  }

  // ---------------------------------------------------------------------
  // M4: effects, body parts, enemies, crates per-frame plumbing
  // ---------------------------------------------------------------------

  /** `CLevelRuntimeData::PerFrameCalc`. */
  private perFrameCalc(): void {
    const amount = this.effects.length + this.newEffects.length;
    if (amount > KMaxEffectsInGame) {
      const drop = Math.min(amount - KMaxEffectsInGame, this.effects.length);
      this.effects.splice(0, drop);
    }
    for (const eff of this.newEffects) this.effects.push(eff);
    this.newEffects.length = 0;

    stableSortByX(this.enemies);
    stableSortByX(this.bodyparts);

    for (let i = 0; i < this.bullets.length;) {
      if (this.moveBullet(this.bullets[i])) this.bullets.splice(i, 1);
      else i++;
    }
    for (const part of this.bodyparts) this.bodyPartMove(part);
    this.moveCrateTexts();
  }

  /** `CLevelRuntimeData::RollEffects`. */
  private rollEffects(): void {
    const amount = this.effects.length;
    for (let i = 0; i < this.effects.length;) {
      if (this.effectRoll(this.effects[i], amount)) this.effects.splice(i, 1);
      else i++;
    }
    this.steamAnimationCount++;
  }

  /** `CEffect::Roll` — returns true when the effect dies. */
  private effectRoll(eff: SimEffect, amount: number): boolean {
    const t = EffectTypes[eff.typeId];
    let mul = 1;
    if (amount > KLightOverloadLimit) {
      if (amount > KHeavyOverloadLimit) mul = t.heavyOverloadMul;
      else mul = t.lightOverloadMul;
    }
    if (eff.counter < t.tCount * t.delay) {
      if (!t.random) eff.counter += mul;
      else eff.counter += this.rng.rand() % (mul * 3);
    }
    let die = false;
    if (eff.counter >= t.tCount * t.delay) die = true;
    if ((eff.vx !== 0 || eff.vy !== 0) && !die) {
      eff.x = f32(eff.x + eff.vx);
      eff.y = f32(eff.y + eff.vy);
      if (
        simCollision(
          this.level,
          Math.trunc(eff.x / KBlockSpriteSize),
          Math.trunc(eff.y / KBlockSpriteSize),
        )
      )
        die = true;
    }
    if (die && t.afterDeathEffect !== EffectId.None)
      this.newEffect(t.afterDeathEffect, eff.x, eff.y, 0, 0);
    return die;
  }

  /** `CLevelRuntimeData::ChkWakeUps`. */
  private chkWakeUps(): void {
    for (const c of this.crates) {
      if (c.inUse !== 0) continue;
      if (c.wakeUpCounter > 0) {
        c.wakeUpCounter++;
        if (c.wakeUpCounter >= KCrateWakeupDelay) {
          this.newEffect(EffectId.Teleport, c.x + 8, c.y + 8, 0, 0);
          c.textCounter = 0;
          c.textCounter2 = 0;
          c.inUse = 1;
          c.wakeUpCounter = 0;
        }
      }
    }
  }

  private moveCrateTexts(): void {
    for (const c of this.crates) if (c.inUse && c.textCounter > 0) this.crateMoveText(c);
  }

  /** `CCrate::MoveText`. */
  private crateMoveText(c: SimCrate): void {
    if (c.textCounter > 0) {
      const m = addMovement({ x: c.textX, y: c.textY }, c.textAngle, c.textCounter2);
      c.textX = m.x;
      c.textY = m.y;
      c.textCounter = f32(c.textCounter - c.textCounter2);
      c.textCounter2 = f32(c.textCounter2 + f32(0.05));
      if (c.textCounter <= 0) {
        c.inUse = 0;
        if (this.crateRespawn) c.wakeUpCounter = 1;
      }
    }
  }

  // ---------------------------------------------------------------------
  // M4: enemy/crate placement
  // ---------------------------------------------------------------------

  /** `CDynGameData::TestEnemyLocation`. */
  testEnemyLocation(x: number, y: number, strict: boolean): boolean {
    const plyDist = strict ? KCharacterSpriteSize * 5 : KCharacterSpriteSize;
    if (!reachable(this.level, idiv(x + 10, KBlockSpriteSize), idiv(y + 10, KBlockSpriteSize)))
      return false;
    for (const e of this.enemies) if (getDist(x, y, e.x, e.y) < 18) return false;
    if (!strict) {
      for (const s of this.level.starts)
        if (getDist(x, y, s.x * KBlockSpriteSize, s.y * KBlockSpriteSize) < KBlockSpriteSize)
          return false;
    }
    for (const p of this.players) if (getDist(x, y, p.x, p.y) < plyDist) return false;
    return true;
  }

  /** `CLevelRuntimeData::PlaceEnemy` — returns true if placement failed. */
  private placeEnemy(type: number): boolean {
    let nx = 0;
    let ny = 0;
    let tryno = 0;
    for (;;) {
      tryno++;
      if (tryno >= KTooManyTries) return true;
      nx = (this.rng.rand() % (this.level.width - 2)) + 1;
      ny = (this.rng.rand() % (this.level.height - 2)) + 1;
      if (this.testEnemyLocation(nx * KBlockSpriteSize, ny * KBlockSpriteSize, true)) break;
    }
    this.newEnemy(type, false, nx * KBlockSpriteSize, ny * KBlockSpriteSize, this.rng.rand() % 360);
    return false;
  }

  /** `CLevelRuntimeData::InitEnemies`. */
  initEnemies(): void {
    for (const en of this.level.enemies) {
      if (this.testEnemyLocation(en.x, en.y, false))
        this.newEnemy(en.type, true, en.x, en.y, this.rng.rand() % 360);
    }
    let randFuckUp = false;
    for (let b = 0; b < EEnemyAmount && !randFuckUp; b++) {
      const count = this.level.general.enemies[b] ?? 0;
      for (let a = 0; a < count && !randFuckUp; a++) randFuckUp = this.placeEnemy(b);
    }
  }

  /** `CDynGameData::CheckCratePlace`. */
  checkCratePlace(x: number, y: number, size: number): number {
    if (idiv(y + size, KBlockSpriteSize) >= this.level.height) return 1;
    if (idiv(x + size, KBlockSpriteSize) >= this.level.width) return 1;
    if (levelData(this.level, idiv(x, 20), idiv(y, 20)).type !== 0) return 1;
    if (levelData(this.level, idiv(x, 20), idiv(y + size, 20)).type !== 0) return 1;
    if (levelData(this.level, idiv(x + size, 20), idiv(y, 20)).type !== 0) return 1;
    if (levelData(this.level, idiv(x + size, 20), idiv(y + size, 20)).type !== 0) return 1;
    for (const p of this.players) if (p.local && getDist(x, y, p.x, p.y) < 50) return 1;
    return 0;
  }

  /** `CLevelRuntimeData::PlaceGameCrates( aDMCrates )`. */
  placeGameCrates(dmCrates: boolean): void {
    const placed = dmCrates ? this.level.placedCratesDM : this.level.placedCratesNormal;
    const random = dmCrates ? this.level.randomCratesDM : this.level.randomCratesNormal;
    for (const c of placed) this.newCrate(c.x, c.y, c.type1 as CrateKind, c.type2);
    const w = this.level.width * KBlockSpriteSize;
    const h = this.level.height * KBlockSpriteSize;
    for (const rc of random)
      for (let b = 0; b < rc.amount; b++) {
        let x = 0;
        let y = 0;
        do {
          x = this.rng.rand() % w;
          y = this.rng.rand() % h;
        } while (this.checkCratePlace(x, y, 14));
        this.newCrate(x, y, rc.type1 as CrateKind, rc.type2);
      }
  }

  /** `CDynGameData::SetupLevelStart`'s entity spawn (after start-point placement). */
  spawnEntities(): void {
    if (this.enemiesEnabled) this.initEnemies();
    this.placeGameCrates(this.dmCrates);
  }

  /** `CPlayer::PickupCrates`. */
  private pickupCrates(p: SimPlayer, drawRect: Rect): void {
    if (p.dead !== 0) return;
    for (const c of this.crates) {
      if (
        c.inUse &&
        c.textCounter === 0 &&
        c.x + 7 > p.x &&
        c.x + 7 < p.x + KCharacterSpriteSize &&
        c.y + 7 > p.y &&
        c.y + 7 < p.y + KCharacterSpriteSize
      )
        this.crateTryPickup(c, p, drawRect);
    }
  }

  private crateTryPickup(c: SimCrate, p: SimPlayer, drawRect: Rect): void {
    switch (c.kind) {
      case CrateKind.Weapon: {
        const wi = c.value + 1;
        if (p.weapons[wi] < (WeaponTypes[wi].singleHand ? 2 : 1)) {
          p.weapons[wi]++;
          this.crateTaken(c, p, drawRect);
        }
        break;
      }
      case CrateKind.Bullet: {
        const bi = c.value + 1;
        const t = BulletTypes[bi];
        if (p.bullets[bi] < t.maximumForPlayer * t.multiplier) {
          p.bullets[bi] += t.amountInCrate;
          p.bullets[bi] = Math.min(p.bullets[bi], t.maximumForPlayer * t.multiplier);
          this.crateTaken(c, p, drawRect);
        }
        break;
      }
      case CrateKind.Health: {
        const max = KPlayerMaxEnergy + p.shield * KShieldEnergyAmount;
        if (p.energy < max) {
          p.energy = f32(p.energy + 40);
          p.energy = Math.min(p.energy, max);
          this.crateTaken(c, p, drawRect);
        }
        break;
      }
      case CrateKind.Money: {
        this.crateTaken(c, p, drawRect);
        p.cash += c.value;
        break;
      }
      default: {
        if (!p.targetSystem) {
          p.targetSystem = true;
          this.crateTaken(c, p, drawRect);
        }
        break;
      }
    }
  }

  /** `CCrate::Taken` — the floating text counter depends on the font width. */
  private crateTaken(c: SimCrate, p: SimPlayer, drawRect: Rect): void {
    this.playFlatSound(SoundEffect.Click);
    const len = this.textLength(crateText(c));
    const tx = c.x + 7 - len - p.screenX;
    const ty = c.y + 7 - p.screenY;
    c.textX = tx;
    c.textY = ty;
    const bx = drawRect.left + 10;
    const by = drawRect.bottom - 20;
    c.textCounter = f32(f32(getDist(tx, ty, bx, by)) + 1);
    c.textAngle = Math.trunc(getAngle(tx, ty, bx, by));
  }

  /**
   * Whether seat `index`'s mouse drives its player's aim/shoot right-click.
   * Offline that is only the single `mouseOwner`; online (`perSeatMouse`) every
   * seat owns its own mouse — and crucially the answer must NOT depend on which
   * client is running, or the worlds diverge.
   */
  private mouseControls(index: number): boolean {
    return this.perSeatMouse || this.mouseOwner === index;
  }

  /** `CPlayer` mouse rotation + wheel weapon switching (both mouse paths). */
  private applyMouse(p: SimPlayer, mouse: SimInput): void {
    let temp = f32(f32(mouse.mouseXRel) * this.mouseSensitivity);
    if (temp < -15) temp = -15;
    if (temp > 15) temp = 15;
    this.rotate(p, temp);
    if (mouse.mouseButtons & MouseButton.WheelDown) this.changeWeapon(p, false);
    if (mouse.mouseButtons & MouseButton.WheelUp) this.changeWeapon(p, true);
  }

  /**
   * One 100 Hz tick — mirrors the inner loop of `CGameSubStateOngoing::RunFrame`.
   * `inputs[i]` is seat `i`'s keyboard (and, for `mouseOwner`, mouse) state.
   */
  tick(inputs: readonly SimInput[]): void {
    // 1. CheckUserInput — player keys, then the mouse owner.
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.local && !p.dead) this.playerCheckKeys(i, p, inputs[i] ?? EMPTY_INPUT);
    }

    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.dead || !this.mouseControls(i)) continue;
      this.applyMouse(p, inputs[i] ?? EMPTY_INPUT);
    }

    // 2. LevelRuntimeData::PerFrameCalc
    this.perFrameCalc();

    // 3. PushPlayers
    for (const p of this.players) {
      if (!p.local) continue;
      if (p.pushPower > 0) {
        this.playerMove(p, p.pushAngle, p.pushPower, p.drawRect);
        p.pushPower = f32(p.pushPower - f32(0.075));
      }
    }

    // 4. CheckBurn
    this.checkBurn();

    // 5. ChkWakeUps
    if (this.crateRespawn) this.chkWakeUps();

    // 6. MoveScr + LoadWeapons (local players)
    for (const p of this.players)
      if (p.local) {
        this.moveScr(p);
        this.loadWeapons(p);
      }

    // 7. AnimatePlayers (local players)
    for (let i = 0; i < this.players.length; i++)
      if (this.players[i].local) this.animate(i, this.players[i]);

    // 8. EnemyUpdate
    this.enemyUpdate();

    // 9. DecHits (local players)
    for (const p of this.players) if (p.local && p.hit > 0) p.hit--;

    // 10. ShowSteam
    this.showSteam();

    // 11. RollEffects
    this.rollEffects();
  }
}

/** Stable sort by `x` (`std::stable_sort` in the oracle, JS sort is stable). */
function stableSortByX<T extends { x: number }>(arr: T[]): void {
  arr.sort((a, b) => (a.x < b.x ? -1 : a.x > b.x ? 1 : 0));
}
