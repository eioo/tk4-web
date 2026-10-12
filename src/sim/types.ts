/**
 * Weapon and bullet type tables (port of `common/types.cpp` +
 * `common/CBulletBase.cpp` defaults). Values are what the simulation reads;
 * light/sprite fields are kept for the renderer's use.
 *
 * See docs/game-data-tables.md.
 */

import { f32 } from "../core/math";

export const EBulletAmount = 12;
export const EWeaponAmount = 13;

export const enum BulletId {
  Fist = 0,
  B9mm,
  B12mm,
  Shell,
  LightRockets,
  MediumRockets,
  HeavyRockets,
  C4,
  Gas,
  Mines,
  Grenades,
  ExplosionRay,
}

export const enum WeaponId {
  Fist = 0,
  Pistol,
  Shotgun,
  Uzi,
  AutoRifle,
  RocketLauncher,
  AutoLauncher,
  HeavyLauncher,
  AutoShotgun,
  C4Activator,
  FlameThrower,
  MineDropper,
  GrenadeLauncher,
}

/** `IBulletType::TBulletType`. */
export const enum BulletKind {
  Normal = 0,
  Explosive,
  Incendiary,
  Fist,
}

/** `IBulletType::TBounceType`. */
export const enum BounceType {
  None = 0,
  Normal,
  FollowWall,
}

/** `TIngameSoundEffect` (`common/defines.h`). */
export const enum SoundEffect {
  NoSound = -1,
  Pistol = 0,
  Shotgun,
  Uzi,
  Autorifle,
  Bazooka,
  Hit,
  SmallExplosion,
  Explosion,
  BigExplosion,
  Click,
  Death,
  Woosh,
  Flame,
  MetalHit,
  GrenadeLauncher,
  KickHead,
  Amount,
}

/** A sample the simulation emitted this tick (`CSoundPlayer`). */
export interface SoundEvent {
  effect: SoundEffect;
  volume: number;
  x: number;
  y: number;
  /** `PlayPosSample` (panned around the observer) vs `PlaySample` (centred). */
  positional: boolean;
}

/** Effect ids (`TEffect`). -1 = no effect. */
export const enum EffectId {
  None = -1,
  Blood = 0,
  Smoke,
  Explo,
  Metal,
  MetalYellow,
  MetalRed,
  Smoke2,
  BloodOnGround,
  GunSmoke,
  Steam,
  Teleport,
  Footprint,
  Flame,
  Flame2,
}

/** Which effect-angle/speed variant a bullet uses (the C++ overrides). */
export const enum EffectKind {
  Default = 0,
  Rocket,
  Ray,
}

export interface BulletType {
  name: string;
  type: BulletKind;
  stop: boolean;
  collisionTrigger: boolean;
  bounceType: BounceType;
  speed: number;
  timeBeforeSpin: number;
  slow: number;
  power: number;
  time: number;
  explosion: number;
  pushPower: number;
  cost: number;
  amountInCrate: number;
  multiplier: number;
  sleepTime: number;
  maximumForPlayer: number;
  rocketLength: number;
  rocketColor: number;
  /** `EGameSprite` id of the flying sprite, or -1 for none. */
  sprite: number;
  xs: number;
  ys: number;
  spriteAngles: number;
  light: number;
  lightSize: number;
  lightLuminance: number;
  lightAdd: number;
  effect: EffectId;
  effect2: EffectId;
  effectKind: EffectKind;
  /** `CBulletBase::BounceSound` — played when the bullet bounces off a wall. */
  bounceSound: SoundEffect;
}

/** `CBulletBase` defaults, then the overrides from `types.cpp`. */
function bullet(overrides: Partial<BulletType>): BulletType {
  const b: BulletType = {
    name: "",
    type: BulletKind.Normal,
    stop: false,
    collisionTrigger: true,
    bounceType: BounceType.None,
    speed: 0,
    timeBeforeSpin: 0,
    slow: 0,
    power: 0,
    time: 0,
    explosion: 0,
    pushPower: 0,
    cost: 0,
    amountInCrate: 0,
    multiplier: 1,
    sleepTime: 0,
    maximumForPlayer: 0,
    rocketLength: 0,
    rocketColor: 32,
    sprite: -1,
    xs: 0,
    ys: 0,
    spriteAngles: 0,
    light: -1,
    lightSize: 0,
    lightLuminance: 0,
    lightAdd: 0,
    effect: EffectId.None,
    effect2: EffectId.None,
    effectKind: EffectKind.Default,
    bounceSound: SoundEffect.NoSound,
    ...overrides,
  };
  // The C++ oracle stores these as `float`; round them so f32 arithmetic matches.
  b.speed = f32(b.speed);
  b.slow = f32(b.slow);
  b.power = f32(b.power);
  b.pushPower = f32(b.pushPower);
  b.lightAdd = f32(b.lightAdd);
  return b;
}

export const BulletTypes: readonly BulletType[] = [
  bullet({
    name: "Fist",
    type: BulletKind.Fist,
    stop: true,
    speed: 5,
    power: 3,
    pushPower: 2,
    time: 1,
  }),
  bullet({
    name: "9mm Bullets",
    type: BulletKind.Normal,
    stop: true,
    speed: 6 * 18,
    power: 5,
    pushPower: 1,
    time: 1,
    cost: 3,
    amountInCrate: 50,
    maximumForPlayer: 300,
  }),
  bullet({
    name: "12mm Bullets",
    type: BulletKind.Normal,
    stop: true,
    speed: 8 * 18,
    power: 9,
    pushPower: 1.5,
    time: 1,
    cost: 5,
    amountInCrate: 50,
    maximumForPlayer: 300,
  }),
  bullet({
    name: "Shotgun Shells",
    type: BulletKind.Normal,
    stop: true,
    speed: 6 * 18,
    power: 3,
    pushPower: 1.5,
    time: 1,
    cost: 6,
    amountInCrate: 20,
    maximumForPlayer: 300,
  }),
  bullet({
    name: "Light Rockets",
    type: BulletKind.Explosive,
    stop: true,
    speed: 3,
    time: (15 * 18) / 3,
    light: 0,
    effect: EffectId.Smoke2,
    effect2: EffectId.Flame,
    explosion: 1,
    rocketLength: 10,
    lightSize: 3,
    cost: 70,
    amountInCrate: 15,
    maximumForPlayer: 150,
    effectKind: EffectKind.Rocket,
  }),
  bullet({
    name: "Medium Rockets",
    type: BulletKind.Explosive,
    stop: true,
    speed: 3,
    time: (15 * 18) / 3,
    light: 0,
    effect: EffectId.Smoke2,
    effect2: EffectId.Flame,
    explosion: 2,
    rocketLength: 13,
    lightSize: 3,
    cost: 100,
    amountInCrate: 10,
    maximumForPlayer: 125,
    effectKind: EffectKind.Rocket,
  }),
  bullet({
    name: "Heavy Rockets",
    type: BulletKind.Explosive,
    stop: true,
    speed: 3,
    time: (15 * 18) / 3,
    light: 0,
    effect: EffectId.Smoke2,
    effect2: EffectId.Flame,
    explosion: 4,
    rocketLength: 16,
    lightSize: 6,
    cost: 200,
    amountInCrate: 5,
    maximumForPlayer: 100,
    effectKind: EffectKind.Rocket,
  }),
  bullet({
    name: "C4-Explosives",
    type: BulletKind.Explosive,
    collisionTrigger: false,
    bounceType: BounceType.Normal,
    stop: true,
    time: 250,
    explosion: 4,
    sprite: 29,
    xs: 8,
    ys: 8,
    cost: 150,
    amountInCrate: 5,
    maximumForPlayer: 100,
  }),
  bullet({
    name: "Gas",
    type: BulletKind.Incendiary,
    collisionTrigger: false,
    bounceType: BounceType.FollowWall,
    stop: true,
    speed: Math.trunc(3 * 0.75),
    power: 0.2,
    time: Math.trunc(112 / 3),
    light: 1,
    lightSize: 2,
    lightLuminance: -10,
    lightAdd: 0.4,
    cost: 6,
    amountInCrate: 500,
    multiplier: 10,
    sleepTime: 1,
    maximumForPlayer: 300,
  }),
  bullet({
    name: "Mines",
    type: BulletKind.Explosive,
    stop: true,
    time: 6250,
    explosion: 1,
    sprite: 31,
    xs: 7,
    ys: 7,
    cost: 150,
    amountInCrate: 10,
    sleepTime: 62,
    maximumForPlayer: 100,
  }),
  bullet({
    name: "Grenades",
    type: BulletKind.Explosive,
    stop: true,
    timeBeforeSpin: 38,
    collisionTrigger: false,
    bounceType: BounceType.Normal,
    speed: 3,
    slow: -0.0225,
    time: Math.trunc((10 * 20 * 1.25) / 2),
    explosion: 2,
    sprite: 30,
    xs: 7,
    ys: 7,
    spriteAngles: 40,
    lightSize: 0,
    cost: 60,
    amountInCrate: 10,
    maximumForPlayer: 100,
    bounceSound: SoundEffect.MetalHit,
  }),
  bullet({
    name: "Explosive ray",
    type: BulletKind.Normal,
    bounceType: BounceType.Normal,
    collisionTrigger: false,
    stop: true,
    speed: 8,
    power: 30,
    pushPower: 5,
    time: 0,
    effect: EffectId.Explo,
    effectKind: EffectKind.Ray,
  }),
];

export interface WeaponType {
  name: string;
  sprite: number;
  singleHand: boolean;
  cost: number;
  loadingTime: number;
  smoke: number;
  bulletAmount: number;
  angleAdd: number;
  gun: boolean;
  bulletType: BulletId;
  priority: number;
  consumesBullets: boolean;
  /** `CWeaponBase::Sound` — played when firing. */
  sound: SoundEffect;
}

// ---------------------------------------------------------------------------
// Effect, body part and enemy tables (common/types.cpp + the base classes)
// ---------------------------------------------------------------------------

/** `TLightTable` (defines.h). */
export const enum LightTable {
  NoLight = -1,
  Normal = 0,
  Explosion,
  Yellow,
  Red,
}

export const EBodyPartAmount = 10;
export const EEnemyAmount = 10;
export const EEffectAmount = 14;

/** `TBodyPart`. */
export const enum BodyPartId {
  Head = 0,
  Arm,
  Chest,
  Entrails,
  LeftLeg,
  RightLeg,
  Shit,
  BurnedChest,
  Skull,
  Bones,
}

/** `IBodyPartType` / `CBodyPartBase` + the ten types. */
export interface BodyPartType {
  slow: number;
  kickspeed: number;
  bounce: boolean;
  dropBlood: boolean;
  spriteOffset: number;
  /** `CBodyPartBase::Sound` — played on kick/hit. */
  sound: SoundEffect;
}

export const BodyPartTypes: readonly BodyPartType[] = [
  {
    slow: -0.04,
    kickspeed: 3.8,
    bounce: true,
    dropBlood: true,
    spriteOffset: 0,
    sound: SoundEffect.KickHead,
  }, // Head
  {
    slow: -0.05,
    kickspeed: 2.8,
    bounce: false,
    dropBlood: true,
    spriteOffset: 21,
    sound: SoundEffect.Hit,
  }, // Arm
  {
    slow: -0.07,
    kickspeed: 2.5,
    bounce: false,
    dropBlood: true,
    spriteOffset: 42,
    sound: SoundEffect.Hit,
  }, // Chest
  {
    slow: -0.06,
    kickspeed: 2.5,
    bounce: false,
    dropBlood: true,
    spriteOffset: 63,
    sound: SoundEffect.Hit,
  }, // Entrails
  {
    slow: -0.05,
    kickspeed: 2.8,
    bounce: false,
    dropBlood: true,
    spriteOffset: 84,
    sound: SoundEffect.Hit,
  }, // LeftLeg
  {
    slow: -0.05,
    kickspeed: 2.8,
    bounce: false,
    dropBlood: true,
    spriteOffset: 105,
    sound: SoundEffect.Hit,
  }, // RightLeg
  {
    slow: -0.05,
    kickspeed: 2.8,
    bounce: false,
    dropBlood: true,
    spriteOffset: 126,
    sound: SoundEffect.Hit,
  }, // Shit
  {
    slow: -0.05,
    kickspeed: 3.0,
    bounce: false,
    dropBlood: false,
    spriteOffset: 252,
    sound: SoundEffect.KickHead,
  }, // BurnedChest
  {
    slow: -0.04,
    kickspeed: 4.0,
    bounce: true,
    dropBlood: false,
    spriteOffset: 273,
    sound: SoundEffect.KickHead,
  }, // Skull
  {
    slow: -0.05,
    kickspeed: 3.0,
    bounce: false,
    dropBlood: false,
    spriteOffset: 294,
    sound: SoundEffect.KickHead,
  }, // Bones
].map((b) => ({ ...b, slow: f32(b.slow), kickspeed: f32(b.kickspeed) }));

/** `IEffectType` / `CEffectBase` + the effect types. */
export interface EffectType {
  tCount: number;
  order: number;
  delay: number;
  random: boolean;
  sprite: boolean;
  xs: number;
  ys: number;
  offset: number;
  lightTable: LightTable;
  lightSize: number;
  lightAddConst: number;
  lightAddMultiplier: number;
  lightOverloadMul: number;
  heavyOverloadMul: number;
  afterDeathEffect: EffectId;
  transparentSprite: boolean;
}

function effect(overrides: Partial<EffectType>): EffectType {
  return {
    tCount: 0,
    order: 0,
    delay: 0,
    random: false,
    sprite: false,
    xs: 0,
    ys: 0,
    offset: 0,
    lightTable: LightTable.NoLight,
    lightSize: 0,
    lightAddConst: 0,
    lightAddMultiplier: 0,
    lightOverloadMul: 1,
    heavyOverloadMul: 1,
    afterDeathEffect: EffectId.None,
    transparentSprite: false,
    ...overrides,
  };
}

/** Indexed by {@link EffectId}. */
export const EffectTypes: readonly EffectType[] = [
  effect({
    tCount: 4,
    order: 1,
    delay: 5,
    sprite: true,
    xs: 12,
    ys: 12,
    afterDeathEffect: EffectId.BloodOnGround,
  }),
  effect({
    tCount: 4,
    order: 0,
    delay: 5,
    sprite: true,
    xs: 12,
    ys: 12,
    offset: 13 * 4,
    lightTable: LightTable.Normal,
    lightSize: 1,
    lightAddMultiplier: -1,
  }),
  effect({
    tCount: 9,
    order: 1,
    delay: 8,
    xs: 25,
    ys: 25,
    offset: 320 * 13,
    lightTable: LightTable.Explosion,
    lightSize: 7,
    lightAddConst: 5,
    lightAddMultiplier: -0.8,
  }),
  effect({
    tCount: 8,
    order: 1,
    delay: 5,
    sprite: true,
    xs: 12,
    ys: 12,
    offset: 13 * 8,
    lightTable: LightTable.Normal,
    lightAddMultiplier: -1,
  }),
  effect({
    tCount: 8,
    order: 1,
    delay: 5,
    sprite: true,
    xs: 12,
    ys: 12,
    offset: 13 * 8,
    lightTable: LightTable.Yellow,
    lightAddMultiplier: -1,
  }),
  effect({
    tCount: 8,
    order: 1,
    delay: 5,
    sprite: true,
    xs: 12,
    ys: 12,
    offset: 13 * 8,
    lightTable: LightTable.Red,
    lightAddMultiplier: -1,
  }),
  effect({
    tCount: 12,
    order: 1,
    delay: 12,
    random: true,
    sprite: true,
    xs: 20,
    ys: 20,
    offset: 320 * 39,
    transparentSprite: true,
  }),
  effect({
    tCount: 8,
    order: 0,
    delay: 250,
    random: true,
    sprite: true,
    xs: 6,
    ys: 6,
    offset: 13 * 20,
    lightOverloadMul: 2,
    heavyOverloadMul: 3,
    transparentSprite: true,
  }),
  effect({
    tCount: 4,
    order: 1,
    delay: 5,
    sprite: true,
    xs: 12,
    ys: 12,
    offset: 13 * 16,
    transparentSprite: true,
  }),
  effect({
    tCount: 12,
    order: 1,
    delay: 5,
    sprite: true,
    xs: 20,
    ys: 20,
    offset: 320 * 39,
    transparentSprite: true,
  }),
  effect({
    tCount: 7,
    order: 1,
    delay: 5,
    sprite: true,
    xs: 20,
    ys: 20,
    offset: 320 * 60,
    lightTable: LightTable.Normal,
    lightSize: 4,
  }),
  effect({
    tCount: 4,
    order: 0,
    delay: 250,
    random: true,
    sprite: true,
    xs: 6,
    ys: 6,
    offset: 13 * 20 + 320 * 7,
    lightOverloadMul: 2,
    heavyOverloadMul: 3,
    transparentSprite: true,
  }),
  effect({
    tCount: 1,
    order: 1,
    delay: 12,
    lightTable: LightTable.Explosion,
    lightAddConst: -5,
    lightAddMultiplier: -1,
  }),
  effect({
    tCount: 1,
    order: 1,
    delay: 38,
    lightTable: LightTable.Explosion,
    lightAddConst: -5,
    lightAddMultiplier: -0.33,
  }),
];

/** `TEnemy`. */
export const enum EnemyId {
  Pistolboy = 0,
  ShotgunManiac,
  UziRebel,
  Commando,
  BazookaBoy,
  Civilian,
  Punisher,
  Flamer,
  Punk,
  GrenadeGay,
}

/** Enemy AI states (`CEnemy::TState`). */
export const enum EnemyState {
  Still = 0,
  Assault,
  WanderAround,
}

/** `IEnemyType` / `CEnemyBase` + the ten types. */
export interface EnemyType {
  name: string;
  sprite: number;
  speed: number;
  currentWeapon: WeaponId;
  hostile: boolean;
  energy: number;
  reward: number;
  explosionDeath: boolean;
  sightDistance: number;
}

function enemy(overrides: Partial<EnemyType> & { name: string }): EnemyType {
  return {
    sprite: 0,
    speed: 0,
    currentWeapon: WeaponId.Fist,
    hostile: false,
    energy: 0,
    reward: 0,
    explosionDeath: false,
    sightDistance: 10 * 20,
    ...overrides,
  };
}

export const EnemyTypes: readonly EnemyType[] = [
  enemy({
    name: "Pistol Boy",
    sprite: 0,
    speed: 0.75,
    currentWeapon: WeaponId.Pistol,
    hostile: true,
    energy: 18,
    reward: 200,
  }),
  enemy({
    name: "Shotgun Maniac",
    sprite: 1,
    speed: 0.75,
    currentWeapon: WeaponId.Shotgun,
    hostile: true,
    energy: 28,
    reward: 350,
  }),
  enemy({
    name: "Uzi Rebel",
    sprite: 2,
    speed: 0.75,
    currentWeapon: WeaponId.Uzi,
    hostile: true,
    energy: 40,
    reward: 400,
  }),
  enemy({
    name: "Commando",
    sprite: 3,
    speed: 1.0,
    currentWeapon: WeaponId.AutoRifle,
    hostile: true,
    energy: 50,
    reward: 600,
  }),
  enemy({
    name: "Bazooka Boy",
    sprite: 4,
    speed: 0.75,
    currentWeapon: WeaponId.RocketLauncher,
    hostile: true,
    energy: 40,
    reward: 700,
    explosionDeath: true,
  }),
  enemy({
    name: "Civilian",
    sprite: 5,
    speed: 0.75,
    currentWeapon: WeaponId.Fist,
    energy: 18,
    reward: 50,
  }),
  enemy({
    name: "Punisher",
    sprite: 6,
    speed: 0.5,
    currentWeapon: WeaponId.AutoShotgun,
    hostile: true,
    energy: 150,
    reward: 650,
  }),
  enemy({
    name: "Flamer",
    sprite: 7,
    speed: 0.75,
    currentWeapon: WeaponId.FlameThrower,
    hostile: true,
    energy: 100,
    reward: 600,
    explosionDeath: true,
  }),
  enemy({
    name: "Punk",
    sprite: 8,
    speed: 1.0,
    currentWeapon: WeaponId.Fist,
    hostile: true,
    energy: 30,
    reward: 100,
  }),
  enemy({
    name: "Grenade Gay",
    sprite: 9,
    speed: 0.75,
    currentWeapon: WeaponId.GrenadeLauncher,
    hostile: true,
    energy: 70,
    reward: 500,
    explosionDeath: true,
  }),
];

/** `CLevel::TCrate`. */
export const enum CrateKind {
  Weapon = 0,
  Bullet,
  Health,
  Money,
  Target,
}

/** `IBulletType::ApproxDistance` — the closed-form distance a bullet travels. */
export function approxDistance(t: BulletType): number {
  // Mirrors the C++ `int a1, n; float an = a1 + (n-1)*slow; return (int)(n*((a1+an)/2))`.
  const a1 = Math.trunc(t.speed);
  const n = t.time;
  const an = f32(f32(a1) + f32(f32(n - 1) * t.slow));
  return Math.trunc(f32(f32(n) * f32(f32(f32(a1) + an) / 2)));
}

function weapon(overrides: Partial<WeaponType>): WeaponType {
  return {
    name: "",
    sprite: 0,
    singleHand: false,
    cost: 0,
    loadingTime: 0,
    smoke: 0,
    bulletAmount: 1,
    angleAdd: 1,
    gun: false,
    bulletType: BulletId.Fist,
    priority: 0,
    consumesBullets: true,
    sound: SoundEffect.NoSound,
    ...overrides,
  };
}

export const WeaponTypes: readonly WeaponType[] = [
  weapon({
    name: "Fist",
    loadingTime: 25,
    priority: 1,
    consumesBullets: false,
    sound: SoundEffect.Hit,
  }),
  weapon({
    name: "Pistol",
    sprite: 1,
    singleHand: true,
    cost: 400,
    loadingTime: 25,
    smoke: 1,
    angleAdd: 10,
    gun: true,
    bulletType: BulletId.B9mm,
    priority: 2,
    sound: SoundEffect.Pistol,
  }),
  weapon({
    name: "Shotgun",
    sprite: 3,
    cost: 1000,
    loadingTime: 43,
    smoke: 1,
    bulletAmount: 6,
    angleAdd: 20,
    gun: true,
    bulletType: BulletId.Shell,
    priority: 3,
    sound: SoundEffect.Shotgun,
  }),
  weapon({
    name: "Uzi",
    sprite: 1,
    singleHand: true,
    cost: 2000,
    loadingTime: 10,
    smoke: 1,
    angleAdd: 10,
    gun: true,
    bulletType: BulletId.B9mm,
    priority: 4,
    sound: SoundEffect.Uzi,
  }),
  weapon({
    name: "Auto Rifle",
    sprite: 3,
    cost: 4000,
    loadingTime: 12,
    smoke: 1,
    angleAdd: 10,
    gun: true,
    bulletType: BulletId.B12mm,
    priority: 5,
    sound: SoundEffect.Autorifle,
  }),
  weapon({
    name: "Rocket Launcher",
    sprite: 3,
    cost: 4000,
    loadingTime: 75,
    angleAdd: 10,
    gun: true,
    bulletType: BulletId.MediumRockets,
    priority: 0,
    sound: SoundEffect.Bazooka,
  }),
  weapon({
    name: "Auto Launcher",
    sprite: 3,
    cost: 6000,
    loadingTime: 25,
    angleAdd: 10,
    gun: true,
    bulletType: BulletId.LightRockets,
    priority: 0,
    sound: SoundEffect.Bazooka,
  }),
  weapon({
    name: "Heavy Launcher",
    sprite: 3,
    cost: 6000,
    loadingTime: 100,
    angleAdd: 10,
    gun: true,
    bulletType: BulletId.HeavyRockets,
    priority: 0,
    sound: SoundEffect.Bazooka,
  }),
  weapon({
    name: "Auto Shotgun",
    sprite: 3,
    cost: 6000,
    loadingTime: 12,
    smoke: 1,
    bulletAmount: 6,
    angleAdd: 20,
    gun: true,
    bulletType: BulletId.Shell,
    priority: 6,
    sound: SoundEffect.Shotgun,
  }),
  weapon({
    name: "C4-Activator",
    cost: 1000,
    loadingTime: 25,
    angleAdd: 1,
    bulletType: BulletId.C4,
    priority: 0,
  }),
  weapon({
    name: "Flame Thrower",
    sprite: 3,
    cost: 3000,
    loadingTime: 3,
    angleAdd: 10,
    gun: true,
    bulletType: BulletId.Gas,
    priority: 4,
    sound: SoundEffect.Flame,
  }),
  weapon({
    name: "Mine Dropper",
    cost: 1000,
    loadingTime: 50,
    angleAdd: 1,
    bulletType: BulletId.Mines,
    priority: 0,
  }),
  weapon({
    name: "Grenade Launcher",
    sprite: 3,
    cost: 2000,
    loadingTime: 50,
    smoke: 1,
    angleAdd: 10,
    gun: true,
    bulletType: BulletId.Grenades,
    priority: 0,
    sound: SoundEffect.GrenadeLauncher,
  }),
];
