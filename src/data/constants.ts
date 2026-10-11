/**
 * Shared engine constants. Values are copied from the original headers
 * (docs/02-engine-architecture.md, docs/05-rendering-pipeline.md).
 */

/** Size of one level block / tile, in pixels. */
export const KBlockSpriteSize = 20;

/** Size of a character sprite cell (before the 1px sheet gutter). */
export const KCharacterSpriteSize = 28;

/** Number of sprite directions for players. */
export const KPlayerSpriteAmount = 80;

/** Number of sprite directions for enemies. */
export const KEnemySpriteAmount = 40;

/** Number of wall height variants (heights 0..5). */
export const KWallSprites = 6;

/** Size of a body-part sprite cell. */
export const KBodyPartSpriteSize = 20;

/** Number of distinct enemy types. */
export const EEnemyAmount = 10;

/** Simulation tick rate, in Hz (`KTimerFreq`). */
export const KTimerFreq = 100;

/** Level block-height lookup table size (16 columns × 30 rows). */
export const KBlockHeightTableSize = 16 * 30;

/** Levels at or below this version use the old flat format. */
export const KLastOldFormatVersion = 8;

/** Current (new) level format version. */
export const KLevelVersion = 11;

/** Maximum number of players (`KMaxPlayers`). */
export const KMaxPlayers = 16;
