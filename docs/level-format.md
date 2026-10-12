# Level Format (`.lev`)

Source: `src/common/CLevel.cpp` (`Load`, `LoadOldFormat`, `LoadNewFormat`),
`src/common/CEditableLevel.cpp` (writer), `CLevel.h`, `CSpotlight.h`, `CSteam.h`.

A level is a grid of 20×20 blocks (`KBlockSpriteSize = 20`). Each block:

```c
struct TBlock {
    TBlockType iType;   // 0 = Floor, 1 = Wall
    int iNumber;        // texture/tile index (0..479)
    int iShadow;        // derived on load
    int iHeight;        // 0 = floor-level, 1..5 = wall height
    int iCastDarkness;  // derived on load
};
```

`KLevelVersion = 11`; old formats are versions `<= KLastOldFormatVersion = 8`.

The loader reads the version int, `fseek(0)`, then dispatches:
`version > 8` → new format (chunked), else old format. Version `> 100` is rejected as
corrupt. **Bundled maps are mostly old-format** (versions 1,2,4,5,7,8,9); `dm.lev`,
`seacastle.lev`, `small.lev` and most `jailbreak` levels are version 9–11.

## New format (chunked, version > 8)

The file begins with the version `int32`. Then repeating chunks
`{ chunkType int32, chunkLength int32, payload }`. Unknown chunk types are skipped by
`chunkLength`.

| Chunk | ID | Payload |
|-------|----|---------|
| `KLevelData` | `0x1000` | `width, height,` then `w*h` × `(type, number, height)` int32 |
| `KPlayerStartPoints` | `0x1001` | `count`, then `count` × `(x, y)` int32 |
| `KSpotLights` | `0x1002` | `count`, then count × spotlight records |
| `KSteams` | `0x1003` | `count`, then count × steam records |
| `KGeneralLevelInfo` | `0x1004` | raw `TGeneralLevelInfo` struct (comment[20], timeLimit, enemies[EEnemyAmount]) |
| `KRandomWeaponCrateAmountNormal` | `0x1005` | `count`, then `count` × amount |
| `KRandomBulletCrateAmountNormal` | `0x1006` | `count`, then `count` × amount |
| `KRandomOtherCrateAmountNormal` | `0x1007` | `1`, then amount |
| `KRandomWeaponCrateAmountDM` | `0x1008` | … |
| `KRandomBulletCrateAmountDM` | `0x1009` | … |
| `KRandomOtherCrateAmountDM` | `0x100a` | … |
| `KPlacedCratesNormal` | `0x100b` | `count`, then `count` × `TCrateInfo` (type1,type2,x,y) |
| `KPlacedCratesDM` | `0x100c` | … |
| `KOutblockData` | `0x100d` | `outBlock.number, outBlock.type` |
| `KPlacedEnemies` | `0x100e` | `count`, then `count` × `TEnemyCoords` (type,x,y) |
| `KOutblockHeight` | `0x100f` | `outBlock.height` |
| `KRandomCratesNormal` | `0x1010` | `count`, then `count` × `(type1,type2,amount)` |
| `KRandomCratesDM` | `0x1011` | … |

> The cleanest reference for the new format is `CEditableLevel::Save`, which writes
> exactly these chunks in order.

## Old format (version <= 8)

Flat sequential layout, version-dependent:

```
int32 version
int32 width, height
for each of width*height blocks:
    int32 type, int32 number
    if version < 6:  int32 shadow;  height = (type==Wall) ? KBlockHeights[number] : 0
    else:            int32 height;  height = (type==Floor) ? 0 : height
int32 startX, int32 startY      (repeated `players` times)
    players = 2 if version < 8 else KMaxPlayers(16)
    entry added only if (x,y) != (0,0)
int32 spotLightCount            then that many spotlight records
int32 steamCount                then that many steam records
char[20] comment
int32 timeLimit
int32 enemies[KVersionEnemies[version]]     (only if that table entry != 0)
weapons*4-byte random weapon crate amounts   (KVersionWeapons[version])
bullets*4-byte random bullet crate amounts   (KVersionBullets[version])
1 more normal "other crate" amount
DM: same three groups again                    (random DM crates)
if version >= 5:
    int32 placedNormalCount, then that many TCrateInfo
    int32 placedDMCount,     then that many TCrateInfo
if version >= 6:
    int32 outBlock.number, int32 outBlock.type, int32 placedEnemyCount, then TEnemyCoords[]
else:
    outBlock.number = 16*10 - 1; outBlock.type = Wall
outBlock.height = (type==Floor) ? 0 : KBlockHeights[number]
```

Version-dependent table sizes:

| version | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---------|---|---|---|---|---|---|---|---|
| weapons | 9 | 9 | 10| 11| 11| 11| 12| 12|
| bullets | 7 | 7 | 8 | 9 | 9 | 9 | 10| 10|
| enemies | 7 | 7 | 7 | 7 | 8 | 8 | 8 | 10|

## Block heights (`KBlockHeights[480]`)

A static 16×30 table maps `iNumber` → `iHeight` (0–5). The full table is in
`CLevel.cpp` lines 44–76 and must be copied verbatim into the port — pseudo-3D wall
height depends on it. `EBlockTypeFloor = 0`, `EBlockTypeWall = 1`.

## Derived data computed on load (must be replicated)

After loading, in this order:

1. **`GenerateReachableMap()`** — `bool[w*h]`, flood fill (`RecurseReachable`,
   alternating horizontal/vertical scanline) from `iPlStart[0]`. Used by enemy spawn
   validity. (Crashes if the level has no start points.)
2. **`ModifyBorderBlocks()`** — border floor blocks become walls; border wall heights
   are raised to `KBlockHeights[iOutBlock.iNumber]`.
3. **`DarknessCast()`** — interior blocks: `iCastDarkness = (iHeight != 0)`. Drives the
   camera-cone shadow render.
4. **`GenerateShadows()`** — writes `iShadow` (1/2/3) to down-left/down-right cells
   based on wall height and neighbour heights. Purely a rendering aid.

## Spotlights & steam

- **Spotlight**: floating `(x,y)` + int `size`. Rendered as a flickering light
  (`add = 2 + (-2 + rand()%5)` refreshed periodically).
- **Steam**: `CCoord<float>` + `iAngle` + `iSpeed`, moving particle emitter. For
  versions `< 9`, the angle is converted: `iAngle = -iAngle + 90; ANGLEFIX`.

## Crates placed in the level

`TCrateInfo { type1, type2, x, y }`. `type1` is the crate class
(`0 weapon, 1 bullet, 2 health?, 3 money?, 4 target?` — see [Simulation & Physics](simulation-and-physics.md) for the actual
mapping used by `NewCrate`); `(x,y)` are **pixel** coordinates. Random crates specify
`(type1, type2, amount)` and are placed at random positions validated by
`CheckCratePlace` (on floor, inside bounds, ≥50 px from local players).

## Enemy placement in the level

`TEnemyCoords { type, x, y }` (pixel coords). Fixed enemies are validated with
`TestEnemyLocation(pos, strict=false)`; invalid ones are skipped. Additional random
enemies come from `TGeneralLevelInfo.iEnemies[type]` (counts per type).

## Time limit & comment

`TGeneralLevelInfo.iComment[20]` is the level name shown on the level-info screen;
`iTimeLimit` (seconds) drives the countdown and the time bonus in the statistics
screen.

## Editor

`src/Editor/` is a GTK/Win32 level editor. Out of scope for the port, but
`CEditableLevel::Save` is the authoritative writer for the new format and is useful as
a spec.
