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
  angleFix,
  cose,
  f32,
  setMovement,
  sine,
  vectorAngle,
  vectorLength,
} from "../core/math";
import { GlibcRandom } from "../core/rng";
import { KCharacterSpriteSize, KBlockSpriteSize } from "../data/constants";
import { type Level, levelData } from "../data/level";
import type { Rect } from "../render/rect";
import { idiv, rectHeight, rectWidth } from "../render/rect";
import { simCollision, simDustBlock, simVisibilityCheck } from "./level-physics";
import {
  BounceType,
  BulletId,
  BulletKind,
  BulletTypes,
  EffectId,
  EffectKind,
  WeaponId,
  WeaponTypes,
} from "./types";

export const KPlayerNormalSpeed = 0.75;
export const KPlayerRotationSpeed = Math.fround(3.4);
const KStraightTolerance = 10;
const KWalkAnimationDelay = 50;
const KDeadAnimationDelay = 75;

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
  local = true;

  spriteAngle(): number {
    return Math.trunc(this.angle / 4.5);
  }
}

export class SimWorld {
  readonly level: Level;
  readonly rng: GlibcRandom;
  players: SimPlayer[] = [];
  bullets: SimBullet[] = [];
  mouseOwner = -1;
  mouseSensitivity = 0.5;
  mouseRightPressed = false;
  coopFrags = false;
  networkNone = true;
  steamAnimationCount = 0;
  /** Number of effects that passed the in-level filter (diagnostics only). */
  effectSpawns = 0;

  constructor(level: Level, seed: number) {
    this.level = level;
    this.rng = new GlibcRandom(seed);
  }

  /** `CLevelRuntimeData::NewEffect` — stores nothing yet (M4), counts only. */
  newEffect(type: EffectId, x: number, y: number, _angle: number, _speed: number): void {
    if (type === EffectId.None) return;
    const w = this.level.width * KBlockSpriteSize;
    const h = this.level.height * KBlockSpriteSize;
    if (x >= 0 && x < w && y >= 0 && y < h) this.effectSpawns++;
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
  }

  /** `CPlayer::GetDamage`. */
  getDamage(p: SimPlayer, damage: number, _observer: number): void {
    if (p.dead) return;
    if (p.noDamage) return;
    p.hit = 15;
    p.energy = f32(p.energy - damage);
    if (p.energy <= 0) {
      p.energy = 0;
      if (p.burning) {
        this.newEffect(EffectId.Explo, p.x + 12, p.y + 12, 0, 0);
        this.newEffect(EffectId.Explo, p.x + 18, p.y + 12, 0, 0);
        this.newEffect(EffectId.Explo, p.x + 15, p.y + 18, 0, 0);
      } else {
        for (let a = 0; a < 16; a++)
          if (this.rng.rand() % 2)
            this.newEffect(EffectId.Blood, p.x + 15, p.y + 15, Math.trunc(a * 22.5), 2);
      }
      p.dead = 1;
    }
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
        for (let bi = 0; bi < this.players.length; bi++) {
          const pl = this.players[bi];
          const lx = Math.trunc(pl.x);
          const ly = Math.trunc(pl.y);
          const l = lx + 5;
          const tt = ly + 5;
          const r = lx + 22;
          const bb = ly + 22;
          const inside = rposX >= l && rposX < r && rposY >= tt && rposY < bb;
          const selfOk =
            b.ownerId !== bi || (t.type !== BulletKind.Incendiary && t.type !== BulletKind.Fist);
          if (!pl.dead && inside && selfOk) {
            hit = true;
            const vp = addMovement({ x: f32(lx + 14), y: f32(ly + 14) }, b.angle, 4);
            vposX = Math.trunc(vp.x);
            vposY = Math.trunc(vp.y);
            if (this.networkNone) {
              pl.pushAngle = b.angle;
              if (t.pushPower > pl.pushPower) pl.pushPower = f32(t.pushPower * 0.75);
              if (t.type === BulletKind.Incendiary) {
                pl.burning += 15;
                pl.fryingObserver = b.ownerId;
              }
              if (t.power > 0) this.getDamage(pl, t.power, b.ownerId);
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
      if (b.ownerId >= 0 && t.power > 0 && !b.hitReported) b.hitReported = true;
    }

    if (
      (t.type === BulletKind.Normal || t.type === BulletKind.Fist) &&
      (b.time === 0 || hitwall) &&
      !hit &&
      t.speed > 10
    )
      this.newEffect(EffectId.Smoke, rposX, rposY, 0, 0);

    if ((t.collisionTrigger && (hit || hitwall)) || b.time === 0) {
      if (t.type === BulletKind.Explosive) {
        const ep = addMovement({ x: b.x, y: b.y }, b.angle, -1);
        this.explo(Math.trunc(ep.x), Math.trunc(ep.y), t.explosion, b.share, b.ownerId);
      }
      return true;
    }

    // Effect / Effect2 — args evaluated only inside the DoEffect() branch, and
    // for no-effect bullets the call is a no-op (no rand consumed).
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
    if (b.spriteAngleAdd > 0) b.spriteAngleAdd = f32(b.spriteAngleAdd - 0.4);
    if (b.spriteAngleAdd < 0) b.spriteAngleAdd = f32(b.spriteAngleAdd + 0.4);
    if (b.spriteAngleAdd >= -0.4 && b.spriteAngleAdd <= 0.4) b.spriteAngleAdd = 0;

    return false;
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

  private charCollision(l: number, t: number, r: number, b: number, self: SimPlayer): boolean {
    for (const pl of this.players) {
      if (pl === self) continue;
      if (pl.dead) continue;
      const px = Math.trunc(pl.x);
      const py = Math.trunc(pl.y);
      if (px >= l && px < r && py >= t && py < b) return true;
    }
    return false;
  }

  /** `CCharacter::Move`. */
  private charMove(p: SimPlayer, aAngle: number, aSpeed: number): void {
    const reuna = 6;
    const reuna2 = 4;
    if (
      p.walk === Math.trunc(KWalkAnimationDelay * 0.25) ||
      p.walk === Math.trunc(KWalkAnimationDelay * 0.75)
    )
      this.footprint(p, 0);
    if (p.walk === Math.trunc(KWalkAnimationDelay * 0.5) || p.walk === KWalkAnimationDelay - 1)
      this.footprint(p, 1);

    const newpos = addMovement({ x: p.x, y: p.y }, aAngle, aSpeed);
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
      newpos.y < p.y &&
      levelData(this.level, bp[0][0], bp[0][1]).type === 0 &&
      levelData(this.level, bp[1][0], bp[1][1]).type === 0
    ) {
      if (!this.charCollision(tx - 15, ty + 2 * reuna - KCharacterSpriteSize, tx + 15, ty, p)) {
        if (newpos.y < 0) p.y = 0;
        else p.y = newpos.y;
      }
    }
    if (
      newpos.y > p.y &&
      levelData(this.level, bp[2][0], bp[2][1]).type === 0 &&
      levelData(this.level, bp[3][0], bp[3][1]).type === 0
    ) {
      if (!this.charCollision(tx - 15, ty, tx + 15, ty + KCharacterSpriteSize - 2 * reuna, p)) {
        if (newpos.y > this.level.height * KBlockSpriteSize - KCharacterSpriteSize)
          p.y = this.level.height * KBlockSpriteSize - KCharacterSpriteSize;
        else p.y = newpos.y;
      }
    }
    if (
      newpos.x < p.x &&
      levelData(this.level, bp[4][0], bp[4][1]).type === 0 &&
      levelData(this.level, bp[5][0], bp[5][1]).type === 0
    ) {
      if (!this.charCollision(tx + 2 * reuna - KCharacterSpriteSize, ty - 15, tx, ty + 15, p)) {
        if (newpos.x < 0) p.x = 0;
        else p.x = newpos.x;
      }
    }
    if (
      newpos.x > p.x &&
      levelData(this.level, bp[6][0], bp[6][1]).type === 0 &&
      levelData(this.level, bp[7][0], bp[7][1]).type === 0
    ) {
      if (!this.charCollision(tx, ty - 15, tx + KCharacterSpriteSize - 2 * reuna, ty + 15, p)) {
        if (newpos.x > this.level.width * KBlockSpriteSize - KCharacterSpriteSize)
          p.x = this.level.width * KBlockSpriteSize - KCharacterSpriteSize;
        else p.x = newpos.x;
      }
    }
  }

  /** `CPlayer::Move` (blood effect while hurt + character move). */
  private playerMove(p: SimPlayer, aAngle: number, aSpeed: number): void {
    if (p.energy < 20 && p.walk % 4 === 0 && this.rng.rand() % 3 === 0)
      this.newEffect(EffectId.BloodOnGround, p.x + 15, p.y + 15, 0, 0);
    this.charMove(p, aAngle, aSpeed);
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
  }

  private playerCheckKeys(index: number, p: SimPlayer, input: SimInput): void {
    let walkChk = 0;
    let speedi = 0;
    let strafe = Direction.Nowhere;
    let forward = Direction.Nowhere;
    let fAngle = 0;

    p.noDamage = false;

    if (
      this.mouseOwner !== index &&
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
      if (this.rng.rand() % 40 === 0) {
        // KickBodyParts: no body parts in M3.
      }
    }
    if (input.keys & Key.Down) {
      forward = Direction.Down;
      walkChk = 1;
    }

    if (this.mouseOwner === index) fAngle = Math.trunc(p.angle);
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
    if (speedi !== 0) this.playerMove(p, fAngle, speedi);

    if (walkChk && p.walk === 0) p.walk = 1;
    if (!walkChk) p.walk = 0;

    if (
      input.keys & Key.Shoot ||
      (this.mouseOwner === index && input.mouseButtons & MouseButton.Left)
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
        if (p.loadCounter >= WeaponTypes[p.curWeapon].loadingTime) this.shoot(p, 1, index);
    } else {
      p.shootCount = 0;
      p.weaponInHand = false;
    }

    if (!(input.mouseButtons & MouseButton.Right)) this.mouseRightPressed = false;
    if (
      input.keys & Key.Shift ||
      (this.mouseOwner === index &&
        input.mouseButtons & MouseButton.Right &&
        !this.mouseRightPressed)
    ) {
      this.changeWeapon(p, false);
      if (this.mouseOwner === index) this.mouseRightPressed = true;
    }
  }

  private loadWeapons(p: SimPlayer): void {
    if (p.loadCounter < WeaponTypes[p.curWeapon].loadingTime) p.loadCounter++;
    if (p.secWeapon !== 0)
      if (p.loadCounter2 < WeaponTypes[p.secWeapon].loadingTime) p.loadCounter2++;
    if (p.secondaryCounter > 0) p.secondaryCounter--;
  }

  private animate(p: SimPlayer): void {
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
    }
    if (p.kick) {
      p.kick++;
      if (p.kick > 6) p.kick = 0;
      p.anim = p.secWeapon === 0 ? 5 : 6;
    }
  }

  private moveScr(p: SimPlayer, drawRect: Rect): void {
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

  initScr(p: SimPlayer, drawRect: Rect): void {
    p.screenX = Math.trunc(p.x - idiv(rectWidth(drawRect), 2));
    p.screenY = Math.trunc(p.y - idiv(rectHeight(drawRect), 2));
  }

  /** One 100 Hz tick — mirrors the inner loop of `CGameSubStateOngoing::RunFrame`. */
  tick(input: SimInput, drawRect: Rect): void {
    for (let i = 0; i < this.players.length; i++)
      if (this.players[i].local && !this.players[i].dead)
        this.playerCheckKeys(i, this.players[i], input);

    if (this.mouseOwner >= 0 && !this.players[this.mouseOwner].dead) {
      let temp = f32(f32(input.mouseXRel) * this.mouseSensitivity);
      if (temp < -15) temp = -15;
      if (temp > 15) temp = 15;
      this.rotate(this.players[this.mouseOwner], temp);
      if (input.mouseButtons & MouseButton.WheelDown)
        this.changeWeapon(this.players[this.mouseOwner], false);
      if (input.mouseButtons & MouseButton.WheelUp)
        this.changeWeapon(this.players[this.mouseOwner], true);
    }

    for (let i = 0; i < this.bullets.length;) {
      if (this.moveBullet(this.bullets[i])) this.bullets.splice(i, 1);
      else i++;
    }

    for (const p of this.players) {
      if (!p.local) continue;
      if (p.pushPower > 0) {
        this.playerMove(p, p.pushAngle, p.pushPower);
        p.pushPower = f32(p.pushPower - 0.075);
      }
    }

    for (const p of this.players) {
      if (p.dead) continue;
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
        this.getDamage(p, 0.1, p.fryingObserver);
      }
    }

    for (const p of this.players)
      if (p.local) {
        this.moveScr(p, drawRect);
        this.loadWeapons(p);
      }

    for (const p of this.players) if (p.local) this.animate(p);

    for (const p of this.players) if (p.local && p.hit > 0) p.hit--;

    this.steamAnimationCount++;
  }
}
