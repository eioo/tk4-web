/**
 * `.lev` level decoder — old (flat, version ≤ 8) and new (chunked, version > 8)
 * formats, plus the derived maps computed on load. Port of `CLevel` in
 * `common/CLevel.cpp`. See docs/07-level-format.md.
 */

import { KBlockSpriteSize, KLastOldFormatVersion, KMaxPlayers } from "./constants";

export const EBlockTypeFloor = 0;
export const EBlockTypeWall = 1;

/** `KBlockHeights[16*30]` — block number → pseudo-3D height (0..5). */
export const KBlockHeights: readonly number[] = [
  3, 3, 3, 3, 3, 2, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 3, 3, 3, 5, 1, 2, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 3,
  3, 3, 3, 1, 1, 1, 2, 2, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 1, 1, 3, 2, 1, 1, 1, 1, 3, 3, 3, 2, 2,
  2, 2, 2, 2, 2, 2, 3, 1, 1, 1, 1, 3, 3, 3, 2, 2, 2, 2, 1, 2, 2, 1, 1, 1, 1, 1, 1, 3, 3, 3, 2, 2, 2,
  2, 1, 3, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 4, 4, 5, 3, 3, 3, 3, 3, 3, 3, 1, 1, 1, 1,
  1, 1, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 0, 0, 0, 3, 3, 3, 3, 3, 3, 0, 3, 3, 3, 3, 3,
  3, 3, 1, 1, 0, 0, 1, 1, 3, 3, 3, 3, 3, 3, 4, 1, 2, 1, 1, 1, 0, 0, 1, 1, 3, 3, 3, 3, 3, 3, 3, 1, 1,
  1, 1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2,
  1, 1, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 1, 1, 3, 3, 3, 4, 3, 3, 3, 2, 2, 2, 2, 1, 3, 2, 2,
  3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 1, 2, 4, 4, 5, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1,
  3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 3, 3, 3, 4, 3, 3, 3, 2, 2, 2, 2, 1, 1, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

/** `KVersionWeapons` / `KVersionBullets` / `KVersionEnemies` (index = version). */
const KVersionWeapons = [9, 9, 10, 11, 11, 11, 12, 12, 12];
const KVersionBullets = [7, 7, 8, 9, 9, 9, 10, 10, 10];
const KVersionEnemies = [7, 7, 7, 7, 8, 8, 8, 10, 10];

/** `KDustBlocks` — block numbers that spawn footprints. */
const KDustBlocks = [
  0,
  16 * 4,
  16 * 5,
  16 * 5 + 2,
  16 * 6 + 1,
  16 * 6 + 1,
  16 * 6 + 2,
  16 * 7 + 1,
  16 * 7 + 2,
  16 * 7 + 3,
  21,
  22,
  23,
  24,
  21 + 16,
  22 + 16,
  23 + 16,
  24 + 16,
];

export interface Block {
  type: number;
  number: number;
  shadow: number;
  height: number;
  castDarkness: number;
}

export interface CrateInfo {
  type1: number;
  type2: number;
  x: number;
  y: number;
}

export interface RandomCrateInfo {
  type1: number;
  type2: number;
  amount: number;
}

export interface EnemyCoords {
  type: number;
  x: number;
  y: number;
}

export interface SpotLight {
  x: number;
  y: number;
  size: number;
}

export interface Steam {
  x: number;
  y: number;
  angle: number;
  speed: number;
}

export interface GeneralLevelInfo {
  comment: string;
  timeLimit: number;
  enemies: number[];
}

export interface Level {
  version: number;
  width: number;
  height: number;
  blocks: Block[];
  starts: Array<{ x: number; y: number }>;
  spotLights: SpotLight[];
  steams: Steam[];
  enemies: EnemyCoords[];
  placedCratesNormal: CrateInfo[];
  placedCratesDM: CrateInfo[];
  randomCratesNormal: RandomCrateInfo[];
  randomCratesDM: RandomCrateInfo[];
  general: GeneralLevelInfo;
  outBlock: Block;
  reachable: Uint8Array;
}

class Reader {
  pos = 0;
  constructor(readonly bytes: Uint8Array) {}
  eof(): boolean {
    return this.pos + 4 > this.bytes.length;
  }
  int(): number {
    const b = this.bytes;
    if (this.pos + 4 > b.length) throw new Error("level: unexpected end of file");
    const v =
      b[this.pos] | (b[this.pos + 1] << 8) | (b[this.pos + 2] << 16) | (b[this.pos + 3] << 24) | 0;
    this.pos += 4;
    return v;
  }
  take(n: number): Uint8Array {
    if (this.pos + n > this.bytes.length) throw new Error("level: unexpected end of file");
    const s = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return s;
  }
  skip(n: number): void {
    this.pos += n;
  }
}

function newBlock(type: number, number: number, height: number): Block {
  return { type, number, shadow: 0, height, castDarkness: 0 };
}

/**
 * Parses a level file into blocks/entities but does **not** compute the derived
 * maps (visibility, border, darkness, shadows). Use `loadLevel` for a playable
 * level, or this + {@link computeDerivedMaps} when the raw block data is needed
 * (e.g. to feed the reference oracle).
 */
export function parseLevel(bytes: Uint8Array): Level {
  const version = new Reader(bytes).int();
  if (version > 100) throw new Error("loadLevel: level file corrupted?");
  const level: Level = {
    version,
    width: 0,
    height: 0,
    blocks: [],
    starts: [],
    spotLights: [],
    steams: [],
    enemies: [],
    placedCratesNormal: [],
    placedCratesDM: [],
    randomCratesNormal: [],
    randomCratesDM: [],
    general: { comment: "", timeLimit: 0, enemies: Array.from({ length: 10 }, () => 0) },
    outBlock: newBlock(EBlockTypeFloor, 0, 0),
    reachable: new Uint8Array(0),
  };
  if (version > KLastOldFormatVersion) loadNewFormat(level, bytes);
  else loadOldFormat(level, bytes);
  return level;
}

/**
 * The four derived-map passes run on every load, in this order (matches
 * `CLevel::Load`): reachability, border modification, darkness cast, shadows.
 */
export function computeDerivedMaps(level: Level): void {
  generateReachableMap(level);
  modifyBorderBlocks(level);
  darknessCast(level);
  generateShadows(level);
}

export function loadLevel(bytes: Uint8Array): Level {
  const level = parseLevel(bytes);
  computeDerivedMaps(level);
  return level;
}

function loadOldFormat(level: Level, bytes: Uint8Array): void {
  const r = new Reader(bytes);
  const version = r.int();
  level.width = r.int();
  level.height = r.int();

  const count = level.width * level.height;
  level.blocks = [];
  for (let a = 0; a < count; a++) {
    const type = r.int();
    const number = r.int();
    let height: number;
    let shadow = 0;
    if (version < 6) {
      shadow = r.int();
      height = type === EBlockTypeWall ? KBlockHeights[number] : 0;
    } else {
      height = r.int();
      if (type === EBlockTypeFloor) height = 0;
    }
    level.blocks.push({ type, number, shadow, height, castDarkness: 0 });
  }

  const players = version < 8 ? 2 : KMaxPlayers;
  for (let a = 0; a < players; a++) {
    const x = r.int();
    const y = r.int();
    if (x !== 0 || y !== 0) level.starts.push({ x, y });
  }

  const spotCount = r.int();
  for (let a = 0; a < spotCount; a++) {
    level.spotLights.push({ x: r.int(), y: r.int(), size: r.int() });
  }

  const steamCount = r.int();
  for (let a = 0; a < steamCount; a++) {
    const x = r.int();
    const y = r.int();
    let angle = r.int();
    if (version < 9) {
      angle = -angle + 90;
      angle = ((angle % 360) + 360) % 360;
    }
    const speed = r.int();
    level.steams.push({ x, y, angle, speed });
  }

  const commentBytes = r.take(20);
  let comment = "";
  for (let i = 0; i < commentBytes.length && commentBytes[i] !== 0; i++) {
    comment += String.fromCharCode(commentBytes[i]);
  }
  level.general.comment = comment;
  level.general.timeLimit = r.int();

  const enemyAmount = KVersionEnemies[version] ?? 0;
  for (let a = 0; a < enemyAmount; a++) level.general.enemies[a] = r.int();

  const weapons = KVersionWeapons[version];
  const bullets = KVersionBullets[version];
  for (let a = 0; a < weapons; a++)
    level.randomCratesNormal.push({ type1: 0, type2: a, amount: r.int() });
  for (let a = 0; a < bullets; a++)
    level.randomCratesNormal.push({ type1: 1, type2: a, amount: r.int() });
  level.randomCratesNormal.push({ type1: 2, type2: 0, amount: r.int() });

  for (let a = 0; a < weapons; a++)
    level.randomCratesDM.push({ type1: 0, type2: a, amount: r.int() });
  for (let a = 0; a < bullets; a++)
    level.randomCratesDM.push({ type1: 1, type2: a, amount: r.int() });
  level.randomCratesDM.push({ type1: 2, type2: 0, amount: r.int() });

  if (version >= 5) {
    let n = r.int();
    for (let a = 0; a < n; a++) level.placedCratesNormal.push(readCrate(r));
    n = r.int();
    for (let a = 0; a < n; a++) level.placedCratesDM.push(readCrate(r));
  }

  if (version >= 6) {
    level.outBlock.number = r.int();
    level.outBlock.type = r.int();
    const n = r.int();
    for (let a = 0; a < n; a++) level.enemies.push({ type: r.int(), x: r.int(), y: r.int() });
  } else {
    level.outBlock.number = 16 * 10 - 1;
    level.outBlock.type = EBlockTypeWall;
  }

  level.outBlock.height =
    level.outBlock.type === EBlockTypeFloor ? 0 : KBlockHeights[level.outBlock.number];
}

function readCrate(r: Reader): CrateInfo {
  return { type1: r.int(), type2: r.int(), x: r.int(), y: r.int() };
}

// New-format chunk ids (CLevel::TChunk).
const KLevelData = 0x1000;
const KPlayerStartPoints = 0x1001;
const KSpotLights = 0x1002;
const KSteams = 0x1003;
const KGeneralLevelInfo = 0x1004;
const KRandomWeaponCrateAmountNormal = 0x1005;
const KRandomBulletCrateAmountNormal = 0x1006;
const KRandomOtherCrateAmountNormal = 0x1007;
const KRandomWeaponCrateAmountDM = 0x1008;
const KRandomBulletCrateAmountDM = 0x1009;
const KRandomOtherCrateAmountDM = 0x100a;
const KPlacedCratesNormal = 0x100b;
const KPlacedCratesDM = 0x100c;
const KOutblockData = 0x100d;
const KPlacedEnemies = 0x100e;
const KOutblockHeight = 0x100f;
const KRandomCratesNormal = 0x1010;
const KRandomCratesDM = 0x1011;

function loadNewFormat(level: Level, bytes: Uint8Array): void {
  level.version = new Reader(bytes).int();
  const r = new Reader(bytes);
  r.int(); // version

  while (!r.eof()) {
    const chunkType = r.int();
    const chunkLength = r.int();
    switch (chunkType) {
      case KLevelData: {
        level.width = r.int();
        level.height = r.int();
        const count = level.width * level.height;
        level.blocks = [];
        for (let a = 0; a < count; a++) {
          level.blocks.push(newBlock(r.int(), r.int(), r.int()));
        }
        break;
      }
      case KPlayerStartPoints: {
        const n = r.int();
        for (let a = 0; a < n; a++) level.starts.push({ x: r.int(), y: r.int() });
        break;
      }
      case KSpotLights: {
        const n = r.int();
        for (let a = 0; a < n; a++)
          level.spotLights.push({ x: r.int(), y: r.int(), size: r.int() });
        break;
      }
      case KSteams: {
        const n = r.int();
        for (let a = 0; a < n; a++) {
          level.steams.push({ x: r.int(), y: r.int(), angle: r.int(), speed: r.int() });
        }
        break;
      }
      case KGeneralLevelInfo: {
        const info = r.take(20 + 4 + 10 * 4);
        let comment = "";
        for (let i = 0; i < 20 && info[i] !== 0; i++) comment += String.fromCharCode(info[i]);
        level.general.comment = comment;
        const dv = new DataView(info.buffer, info.byteOffset, info.byteLength);
        level.general.timeLimit = dv.getInt32(20, true);
        for (let a = 0; a < 10; a++) level.general.enemies[a] = dv.getInt32(24 + a * 4, true);
        break;
      }
      case KRandomWeaponCrateAmountNormal: {
        const n = r.int();
        for (let a = 0; a < n; a++)
          level.randomCratesNormal.push({ type1: 0, type2: a, amount: r.int() });
        break;
      }
      case KRandomBulletCrateAmountNormal: {
        const n = r.int();
        for (let a = 0; a < n; a++)
          level.randomCratesNormal.push({ type1: 1, type2: a, amount: r.int() });
        break;
      }
      case KRandomOtherCrateAmountNormal: {
        r.int(); // amount (always 1)
        level.randomCratesNormal.push({ type1: 2, type2: 0, amount: r.int() });
        break;
      }
      case KRandomWeaponCrateAmountDM: {
        const n = r.int();
        for (let a = 0; a < n; a++)
          level.randomCratesDM.push({ type1: 0, type2: a, amount: r.int() });
        break;
      }
      case KRandomBulletCrateAmountDM: {
        const n = r.int();
        for (let a = 0; a < n; a++)
          level.randomCratesDM.push({ type1: 1, type2: a, amount: r.int() });
        break;
      }
      case KRandomOtherCrateAmountDM: {
        r.int();
        level.randomCratesDM.push({ type1: 2, type2: 0, amount: r.int() });
        break;
      }
      case KPlacedCratesNormal: {
        const n = r.int();
        for (let a = 0; a < n; a++) level.placedCratesNormal.push(readCrate(r));
        break;
      }
      case KPlacedCratesDM: {
        const n = r.int();
        for (let a = 0; a < n; a++) level.placedCratesDM.push(readCrate(r));
        break;
      }
      case KOutblockData: {
        level.outBlock.number = r.int();
        level.outBlock.type = r.int();
        break;
      }
      case KPlacedEnemies: {
        const n = r.int();
        for (let a = 0; a < n; a++) level.enemies.push({ type: r.int(), x: r.int(), y: r.int() });
        break;
      }
      case KOutblockHeight: {
        level.outBlock.height = r.int();
        break;
      }
      case KRandomCratesNormal: {
        const n = r.int();
        for (let a = 0; a < n; a++) {
          level.randomCratesNormal.push({ type1: r.int(), type2: r.int(), amount: r.int() });
        }
        break;
      }
      case KRandomCratesDM: {
        const n = r.int();
        for (let a = 0; a < n; a++) {
          level.randomCratesDM.push({ type1: r.int(), type2: r.int(), amount: r.int() });
        }
        break;
      }
      default:
        // KUnknown (and anything unrecognised) is skipped by its chunk length.
        r.skip(chunkLength);
        break;
    }
  }
}

export function inLevel(level: Level, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < level.width && y < level.height;
}

export function levelData(level: Level, x: number, y: number): Block {
  if (!inLevel(level, x, y)) return level.outBlock;
  return level.blocks[y * level.width + x];
}

/** `CLevel::Collision` — true if the block coordinate is not walkable floor. */
export function collision(level: Level, x: number, y: number): boolean {
  if (inLevel(level, x, y) && level.blocks[y * level.width + x].type === EBlockTypeFloor)
    return false;
  return true;
}

export function reachable(level: Level, x: number, y: number): boolean {
  if (!inLevel(level, x, y)) return false;
  return level.reachable[y * level.width + x] !== 0;
}

export function dustBlock(level: Level, x: number, y: number): boolean {
  const num = levelData(level, x, y).number;
  return KDustBlocks.includes(num);
}

/**
 * `GenerateReachableMap` — flood fill of walkable floor from the first player
 * start. The original uses a horizontal/vertical scanline recursion; the
 * resulting set is exactly the 4-connected floor region, so an iterative fill
 * is used here (avoids recursion limits).
 */
export function generateReachableMap(level: Level): void {
  const { width, height } = level;
  const total = width * height;
  const map = new Uint8Array(total);
  level.reachable = map;
  if (level.starts.length === 0) return;

  const start = level.starts[0];
  const stack: number[] = [];
  const push = (x: number, y: number): void => {
    if (!inLevel(level, x, y)) return;
    const i = y * width + x;
    if (map[i] !== 0) return;
    if (level.blocks[i].type !== EBlockTypeFloor) return;
    map[i] = 1;
    stack.push(x, y);
  };
  push(start.x, start.y);
  while (stack.length > 0) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
}

/** `ModifyBorderBlocks` — border floors become walls at the out-block height. */
export function modifyBorderBlocks(level: Level): void {
  const outHeight = KBlockHeights[level.outBlock.number];
  for (let y = 0; y < level.height; y++) {
    for (const x of [0, level.width - 1]) {
      const b = level.blocks[y * level.width + x];
      if (b.type === EBlockTypeFloor) b.type = EBlockTypeWall;
      if (b.height < outHeight) b.height = outHeight;
    }
  }
  for (let x = 0; x < level.width; x++) {
    for (const y of [0, level.height - 1]) {
      const b = level.blocks[y * level.width + x];
      if (b.type === EBlockTypeFloor) b.type = EBlockTypeWall;
      if (b.height < outHeight) b.height = outHeight;
    }
  }
}

/** `DarknessCast` — interior blocks cast darkness when their height is non-zero. */
export function darknessCast(level: Level): void {
  for (let y = 1; y < level.height - 1; y++) {
    for (let x = 1; x < level.width - 1; x++) {
      level.blocks[y * level.width + x].castDarkness =
        level.blocks[y * level.width + x].height === 0 ? 0 : 1;
    }
  }
}

/** `GenerateShadows` — writes iShadow 1/2/3 down-left / down-right of walls. */
export function generateShadows(level: Level): void {
  const { width, height, blocks } = level;
  for (let i = 0; i < width * height; i++) blocks[i].shadow = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const off = y * width + x;
      if (blocks[off].height <= 0) continue;
      let length = 1;
      if (blocks[off].height > 2) length = 2;
      if (blocks[off].height > 4) length = 3;

      for (let a = 1; a < length + 1; a++) {
        if (x - a >= 0 && y + a < height) {
          const i = off + width * a - a;
          if (blocks[i].height <= blocks[off].height - a) blocks[i].shadow = 1;
        }
        if (x - a >= 0 && y + a - 1 < height) {
          const i = off + width * (a - 1) - a;
          if (blocks[i].height <= blocks[off].height - a) {
            switch (blocks[i].shadow) {
              case 0:
                blocks[i].shadow = 2;
                break;
              case 1:
                blocks[i].shadow = 1;
                break;
              case 2:
                blocks[i].shadow = 2;
                break;
              case 3:
                blocks[i].shadow = 1;
                break;
            }
          }
        }
        if (x - (a - 1) >= 0 && y + a < height) {
          const i = off + width * a - a + 1;
          if (blocks[i].height <= blocks[off].height - a) {
            switch (blocks[i].shadow) {
              case 0:
                blocks[i].shadow = 3;
                break;
              case 1:
                blocks[i].shadow = 1;
                break;
              case 2:
                blocks[i].shadow = 1;
                break;
              case 3:
                blocks[i].shadow = 3;
                break;
            }
          }
        }
      }
    }
  }
}

/**
 * `CLevel::VisibilityCheck` — 1px-accurate line of sight between two pixel
 * positions, with the diagonal corner-cut check.
 */
export function visibilityCheck(
  level: Level,
  srcX: number,
  srcY: number,
  dstX: number,
  dstY: number,
): boolean {
  const iterations = Math.trunc(
    Math.max(1, Math.max(Math.abs(dstX - srcX), Math.abs(dstY - srcY))),
  );
  const xSign = Math.sign(dstX - srcX);
  const ySign = Math.sign(dstY - srcY);
  const xDelta = (dstX - srcX) / iterations;
  const yDelta = (dstY - srcY) / iterations;

  for (let a = 0; a <= iterations; a++) {
    const nx = srcX + xDelta * a;
    const ny = srcY + yDelta * a;
    if (collision(level, Math.trunc(nx / KBlockSpriteSize), Math.trunc(ny / KBlockSpriteSize)))
      return false;
    if (xSign !== 0 && ySign !== 0 && a > 0) {
      const cx = Math.trunc((nx - xSign) / KBlockSpriteSize);
      const cy = Math.trunc((ny - ySign) / KBlockSpriteSize);
      if (
        collision(level, cx, Math.trunc(ny / KBlockSpriteSize)) &&
        collision(level, Math.trunc(nx / KBlockSpriteSize), cy)
      ) {
        return false;
      }
    }
  }
  return true;
}
