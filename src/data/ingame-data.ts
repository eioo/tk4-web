/**
 * `CIngameData` sprite loading (`CIngameData.cpp`): resolves logical sprite keys
 * from the merged `.ini`, loads the base `.efp` sheets, generates the darkened /
 * zoomed wall variants with `CGraphicsGenerator`, then rotates the character
 * sheets. The global in-game palette is taken from the `GameSpriteWalls` file.
 */

import type { ConfigFile } from "./config";
import { KCharacterSpriteSize } from "./constants";
import { decodeEfp, isEfp, type IndexedImage } from "./efp";
import { makeFloors, rotateSprites, zoomWall } from "./graphics-generator";
import { fourMultiply, paletteFromFileTail, type Palette } from "./palette";

/** `TGameSprite` (`common/defines.h`). */
export const EGameSprite = {
  WallClr: 0,
  Crate: 1,
  Shadow: 2,
  Target: 3,
  Floor: 4,
  Floor2: 5,
  BodyPart: 6,
  Effect: 7,
  Wall2: 8,
  Walls: 9,
  Walls_1: 10,
  Walls_2: 11,
  Walls_3: 12,
  Walls_4: 13,
  Walls_5: 14,
  Rambo1: 15,
  Rambo2: 16,
  Rambo3: 17,
  Rambo4: 18,
  Enemy0: 19,
  Enemy1: 20,
  Enemy2: 21,
  Enemy3: 22,
  Enemy4: 23,
  Enemy5: 24,
  Enemy6: 25,
  Enemy7: 26,
  Enemy8: 27,
  Enemy9: 28,
  BulletC4: 29,
  BulletGrenade: 30,
  BulletMine: 31,
  Amount: 32,
} as const;

type Calc = { kind: "darken" } | { kind: "zoom"; level: number };

interface SpriteSpec {
  index: number;
  key: string;
  /** Source sprite to generate from (`-1` in the original = load the file). */
  src?: number;
  calc?: Calc;
  after?: 40 | 80;
}

const SPRITE_SPECS: SpriteSpec[] = [
  { index: EGameSprite.WallClr, key: "GameSpriteWallClr" },
  { index: EGameSprite.Crate, key: "GameSpriteCrate" },
  { index: EGameSprite.Shadow, key: "GameSpriteShadow" },
  { index: EGameSprite.Target, key: "GameSpriteTarget" },
  { index: EGameSprite.Floor, key: "GameSpriteFloor" },
  {
    index: EGameSprite.Floor2,
    key: "GameSpriteFloor2",
    src: EGameSprite.Floor,
    calc: { kind: "darken" },
  },
  { index: EGameSprite.BodyPart, key: "GameSpriteBodyPart" },
  { index: EGameSprite.Effect, key: "GameSpriteEffect" },
  {
    index: EGameSprite.Wall2,
    key: "GameSpriteWall2",
    src: EGameSprite.Walls,
    calc: { kind: "darken" },
  },
  { index: EGameSprite.Walls, key: "GameSpriteWalls" },
  {
    index: EGameSprite.Walls_1,
    key: "GameSpriteWalls_1",
    src: EGameSprite.Walls,
    calc: { kind: "zoom", level: 0 },
  },
  {
    index: EGameSprite.Walls_2,
    key: "GameSpriteWalls_2",
    src: EGameSprite.Walls,
    calc: { kind: "zoom", level: 1 },
  },
  {
    index: EGameSprite.Walls_3,
    key: "GameSpriteWalls_3",
    src: EGameSprite.Walls,
    calc: { kind: "zoom", level: 2 },
  },
  {
    index: EGameSprite.Walls_4,
    key: "GameSpriteWalls_4",
    src: EGameSprite.Walls,
    calc: { kind: "zoom", level: 3 },
  },
  {
    index: EGameSprite.Walls_5,
    key: "GameSpriteWalls_5",
    src: EGameSprite.Walls,
    calc: { kind: "zoom", level: 4 },
  },
  { index: EGameSprite.Rambo1, key: "GameSpriteRambo1", after: 80 },
  { index: EGameSprite.Rambo2, key: "GameSpriteRambo2", after: 80 },
  { index: EGameSprite.Rambo3, key: "GameSpriteRambo3", after: 80 },
  { index: EGameSprite.Rambo4, key: "GameSpriteRambo4", after: 80 },
  { index: EGameSprite.Enemy0, key: "GameSpriteEnemy0", after: 40 },
  { index: EGameSprite.Enemy1, key: "GameSpriteEnemy1", after: 40 },
  { index: EGameSprite.Enemy2, key: "GameSpriteEnemy2", after: 40 },
  { index: EGameSprite.Enemy3, key: "GameSpriteEnemy3", after: 40 },
  { index: EGameSprite.Enemy4, key: "GameSpriteEnemy4", after: 40 },
  { index: EGameSprite.Enemy5, key: "GameSpriteEnemy5", after: 40 },
  { index: EGameSprite.Enemy6, key: "GameSpriteEnemy6", after: 40 },
  { index: EGameSprite.Enemy7, key: "GameSpriteEnemy7", after: 40 },
  { index: EGameSprite.Enemy8, key: "GameSpriteEnemy8", after: 40 },
  { index: EGameSprite.Enemy9, key: "GameSpriteEnemy9", after: 40 },
  { index: EGameSprite.BulletC4, key: "GameSpriteBulletC4" },
  { index: EGameSprite.BulletGrenade, key: "GameSpriteBulletGrenade" },
  { index: EGameSprite.BulletMine, key: "GameSpriteBulletMine" },
];

export interface IngameData {
  palette: Palette;
  /** Indexed by `EGameSprite.*`. */
  sprites: IndexedImage[];
}

export type BytesLoader = (path: string) => Promise<Uint8Array>;

/**
 * Signature of the sprite-defining config values. `App` uses it to cache the
 * generated sheets: per-level `<level>.ini` / episode `default.ini` overrides
 * only trigger a reload when they actually change a source sprite path.
 */
export function ingameSignature(cfg: ConfigFile): string {
  return SPRITE_SPECS.filter((spec) => spec.src === undefined)
    .map((spec) => `${spec.key}=${cfg.get(spec.key) ?? ""}`)
    .join("\n");
}

/**
 * Loads and generates the in-game sprite set. `load` resolves a path from the
 * merged config (e.g. `"efps/walls1.efp"`) to bytes.
 */
export async function loadIngameData(cfg: ConfigFile, load: BytesLoader): Promise<IngameData> {
  const sprites: IndexedImage[] = Array.from<IndexedImage>({ length: EGameSprite.Amount });
  let palette: Palette = new Uint8Array(768);

  // Pass 1: load every base sheet; capture the global palette from walls.
  for (const spec of SPRITE_SPECS) {
    if (spec.src !== undefined) continue;
    const path = cfg.get(spec.key);
    if (!path) throw new Error(`loadIngameData: missing config key ${spec.key}`);
    const bytes = await load(path);
    if (!isEfp(bytes)) throw new Error(`loadIngameData: ${path} is not an EFP`);
    sprites[spec.index] = decodeEfp(bytes);
    if (spec.index === EGameSprite.Walls) palette = paletteFromFileTail(bytes);
  }
  fourMultiply(palette);

  // Pass 2: generate darkened / zoomed variants.
  for (const spec of SPRITE_SPECS) {
    if (spec.src === undefined || !spec.calc) continue;
    const src = sprites[spec.src];
    sprites[spec.index] =
      spec.calc.kind === "darken" ? makeFloors(src, palette) : zoomWall(src, spec.calc.level);
  }

  // Pass 3: rotate character sheets in place.
  for (const spec of SPRITE_SPECS) {
    if (!spec.after) continue;
    sprites[spec.index] = rotateSprites(sprites[spec.index], KCharacterSpriteSize, spec.after);
  }

  return { palette, sprites };
}
