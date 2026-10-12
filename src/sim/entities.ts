/**
 * Entity data classes: effects, body parts, enemies and crates. The
 * behaviour lives in `world.ts` (which owns the RNG and the level); these are
 * the mutable records the per-tick trace serialises.
 */

import type { BodyPartId, CrateKind, EffectId, EnemyState } from "./types";
import { BulletTypes, WeaponTypes } from "./types";

/** `CEffect`. */
export class SimEffect {
  typeId: EffectId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  counter: number;

  constructor(typeId: EffectId, x: number, y: number, vx: number, vy: number) {
    this.typeId = typeId;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.counter = 0;
  }
}

/** `CBodyPart`. */
export class SimBodyPart {
  typeId: BodyPartId = 0;
  x = 0;
  y = 0;
  angle = 0;
  speed = 0;
}

/** `CEnemy`. */
export class SimEnemy {
  /** Stable identity for bullet-owner comparisons (never reused). */
  uid = -1;
  typeId = 0;
  x = 0;
  y = 0;
  angle = 0;
  targetAngle = 0;
  energy = 0;
  pushPower = 0;
  pushAngle = 0;
  walk = 0;
  fire = 0;
  anim = 0;
  loadCounter = 0;
  shootCount = 0;
  burning = 0;
  fryingObserver = -1;
  state: EnemyState = 0;
  walkCounter = 0;
  /** `iSeePlayer` — one flag per player (all players, not just local). */
  seePlayer: number[] = [];
  curWeapon = 0;

  spriteAngle(): number {
    return Math.trunc(this.angle / 4.5);
  }
}

/** `CCrate` (and its subclasses, flattened into a kind + value). */
export class SimCrate {
  kind: CrateKind;
  /** Weapon id / bullet id offset / money amount, per {@link CrateKind}. */
  value: number;
  x: number;
  y: number;
  inUse = 1;
  textCounter = 0;
  textCounter2 = 0;
  textAngle = 0;
  textX = 0;
  textY = 0;
  wakeUpCounter = 0;

  constructor(kind: CrateKind, value: number, x: number, y: number) {
    this.kind = kind;
    this.value = value;
    this.x = x;
    this.y = y;
  }
}

/** Text label a crate shows when picked up (`CCrate::Text`). */
export function crateText(crate: SimCrate): string {
  switch (crate.kind) {
    case 0:
      return WeaponTypes[crate.value + 1]?.name ?? "";
    case 1:
      return BulletTypes[crate.value + 1]?.name ?? "";
    case 2:
      return "energy";
    case 3:
      return `money (${crate.value})`;
    default:
      return "target system";
  }
}
