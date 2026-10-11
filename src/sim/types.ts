/**
 * Weapon and bullet type tables (port of `common/types.cpp` +
 * `common/CBulletBase.cpp` defaults). Values are what the simulation reads;
 * light/sprite fields are kept for the renderer's use in M5.
 *
 * See docs/08-game-data-tables.md.
 */

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
}

/** `CBulletBase` defaults, then the overrides from `types.cpp`. */
function bullet(overrides: Partial<BulletType>): BulletType {
  return {
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
    ...overrides,
  };
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
    ...overrides,
  };
}

export const WeaponTypes: readonly WeaponType[] = [
  weapon({ name: "Fist", loadingTime: 25, priority: 1, consumesBullets: false }),
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
  }),
];
