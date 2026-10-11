# 05 — Rendering Pipeline

The original is an **8-bit palette-indexed software rasteriser** presenting to a
16-bit SDL surface. Reproducing it exactly means porting this pipeline, not
approximating it with sprites. Sources: `CGameDrawManager.cpp`, `CGameDrawer.cpp`,
`CGameGraphicsInterface.cpp`, `common/CGraphicsDevice.cpp`, `common/CColorTable.cpp`,
`common/CLightTable.cpp`, `common/CLightMap.cpp`, `common/CGraphicsGenerator.cpp`.

## Screen model

- Requested mode: 640×480 for menus (`SetMenuMode`), `iInGameVideoMode` (default
  640×480) in game. **No scaling or letterboxing** — buffers are exactly the mode size.
- Buffers are 8-bit indexed (`unsigned char`): `iVirBuf` (draw), `iPostBuf` (fader),
  `iDarkBuffer` (shadow-cast source, size of mode).
- Output: build an 8-bit paletted `SDL_Surface` from a buffer + the global palette, blit
  to the 16-bit screen, update dirty rects. In practice the whole screen is dirty each
  frame.
- **Global palette** is taken from `efps/walls1.efp` (`KIngamePaletteKey =
  "GameSpriteWalls"`): 768 bytes at the end of the file, each channel 0–63, multiplied
  by 4 (`FourMultiply`) to 0–255. All in-game pixels use this palette. Menu sprites
  carry their own palettes.

## Palette-index conventions

- **Index 0 is transparent** for sprites (`DrawSprite`, `DrawTransSprite`, `DrawRambo`,
  `DrawHumanShadow`, effects, and the crate/bodypart/target blits).
- Pixel `1` in `.fnt` glyphs means transparent for the small 8×8 font
  (`iOneIsZero`), otherwise glyph pixel values are palette indices.
- Player sprites remap palette indices **80..95** to `playerColor + (index-80)`. Player
  colours: `KPlayerColor = {48,144,160,176,16,32,64,80}` (i.e. `16*{3,9,10,11,1,2,4,5}`).

## Precomputed colour tables (`CColorTable`, `palette.tab`)

`palette.tab` is `86016 = 65536 + 5*4096` bytes, in this order:

| Table | Size | Meaning |
|-------|------|---------|
| `TransparencyTable[256][256]` | 65536 | `ClosestInPalette((r1+r2)/2, …)` — 50/50 blend of two indices |
| `ShadowTable[256][16]` | 4096 | per-index HSL lightness steps, `l -= (l/16)/2.5` per level |
| `NormalLight[256][16]` | 4096 | light ramp, neutral |
| `RedLight[256][16]` | 4096 | light ramp, +red |
| `YellowLight[256][16]` | 4096 | light ramp, +yellow |
| `ExplosionLight[256][16]` | 4096 | explosion light ramp |

The file is regenerated from the walls1 palette if stale; for the port we can decode the
shipped `palette.tab` directly (byte-identical) or regenerate with the same algorithms.

`CLightMap`s are 10 radial masks of sizes `15,20,25,30,35,40,45,50,55,60` px
(`Make(15 + a*5)`). A light map value at a pixel is `pow = clamp(16 - dist*(16/(size/2)),
0, 15)`; `LightMap(0)` is the smallest radius, etc.

## Drawing primitives (`CGameDrawer`)

- `DrawBlock` — floor/wall tile `memcpy` per row. Floor: 16 cols, 20 px cells, row
  stride 320, texture `EGameSpriteFloor`. Walls: cell `20+h`, stride `16*(20+h)`,
  texture `EGameSpriteWalls+h` (h = block height 0..5). Offset formula:
  `((n&15)*cell) + (n/16)*stride*cell + clipTop*stride + clipLeft`.
- `DrawDarkBlock` — same but from the pre-darkened `*2` textures (`Floor2`/`Wall2`),
  always 16 cols / 20 px / stride 320.
- `DrawSprite` — transparent (skip index 0) blit of a sub-rect.
- `DrawTransSprite` — uses `TransparencyTable` to blend.
- `DrawRambo` — player sprite: angle index from `SpriteAngle()` (0–79), frame row from
  `iAnim`, colour remap 80..95. Offset:
  `((1 + aNumber*29 + clipTop)*Width) + (sprno*29) + 1`, inner row stride `29*80`.
- `DrawEnemy` — `DrawSprite(x, y, 28, 28, sheet, aNumber*29*1160 + aAngle*29, ...)`,
  angle from `(40 - SpriteAngle()/2) + 10 mod 40` (40 directions, ~9° granularity).
- `DrawWallShadow` — 5 shapes of per-cell darkening for `iShadow` 1..3 (lum level 6).
- `DrawHumanShadow` — blob shadow under characters (shadow sheet, frame 5).
- `DrawLight` — apply a light: per-pixel `sum = lightMap[offset]; if sum==0 skip;
  sum = clamp(sum + add, 0, 15); dst = lightTable[dst][sum]`.
- Polygon rasteriser (10-bit fixed point) used for the camera-cone shadow cast; colour
  `< 0` means "copy from `iDarkBuffer`".

### Sprite-sheet geometry (measured from `data/efps`)

| Sheet(s) | On-disk size | Grid | Cell |
|----------|--------------|------|------|
| `floor1`, `floor*.generated`, `walls1`, `walls*.generated`, `walls1_N` | 320×600 (walls_N: `16*(20+N)` × `16*30*(20+N)`) | 16 cols | `20` (floor) / `20+h` (wall h) |
| `rambo1..4` | 2320×{262,175,204,175} | **80 cols × 9 rows** | 29×29 |
| `enemy0..9` | 1160×232 | **40 cols × 8 rows** | 29×29 |
| `bodyp` | 320×20 | 16 | 20×20 |
| `crates` | 320×14 | 22 | 14×14 (5 used) |
| `shadows` | 320×20 | 16 | 20×20 |
| `effects` | 320×82 | 16 | ~20 (see offsets) |
| `c4` | 8×8 | — | — |
| `bomb2` (grenade) | 280×7 | 40 | 7×7 |
| `mine` | 7×7 | — | — |
| `target` | 7×7 | — | — |
| `polycolr` (wall clarity) | 16×60 | — | — |

### Definition of "angle" for characters

The character sprite sheets are **generated at load** by `CGraphicsGenerator::
RotateSprites(buffer, 28, 28, 80|40, palette)`:

- Output cell is `(28+1)×(28+1)` = 29×29 with a 1 px gutter.
- 80 columns for the player (`KPlayerSpriteAmount`), 40 for enemies
  (`KEnemySpriteAmount`).
- Rows = `inputHeight / 28` animation frames.

> ⚠️ **Parity question (resolve by building the original):** the shipped `rambo*.efp` /
> `enemy*.efp` files are already 80×9 / 40×8 angle sheets, yet `CIngameData` still runs
> `RotateSprites` on them at load. The rotation algorithm only ever *reads* the
> left-most ~29 px strip of each row (the "one angle" base), so it effectively
> **regenerates the full sheet from the left column each load**. To be pixel-exact we
> must run the same algorithm on the same file bytes. This must be confirmed against a
> reference build (doc 13).

## Frame draw order (`CGameDrawManager::DrawFrame`)

Per local player (using its `drawRect` and camera `ScreenPos`):

1. Fill black rects (split-screen letterbox) with index 0.
2. `DrawFloor` (also fills `iDarkBuffer` with dark floor/wall tiers).
3. Dead players.
4. Low-order effects (`pos=0`).
5. Body parts.
6. Character shadows.
7. Crates.
8. Bullets.
9. Alive enemies.
10. Live players.
11. Fire/muzzle lights.
12. Block/floor shadows (static `iShadow`).
13. High-order effects (`pos=1`).
14. Spotlights.
15. Black parts of level (camera-cone shadow cast from `iDarkBuffer`).
16. **Walls** (pseudo-3D, drawn last so they occlude actors).
17. Hit flash border.
18. Target system laser + reticle.
19. Energy bar.
20. Weapon/ammo text.

Then: kills (DM), crate pickup texts, minimap (F5), FPS (F6), timer, "MISSION
COMPLETED" banner. Debug keys `1`–`5` disable fire lights / shadows / spots / black
parts / map.

Notes:
- Dynamic lights are applied **before** walls, so they never light walls; walls only
  get their static `iShadow` darkening.
- Actors are occluded by walls because walls are drawn after them.

## Camera (per player)

- `InitScr`: `ScreenPos = location - drawRect.size/2`.
- `MoveScr` each tick: if `|screenCenter - (loc+14)| > 100` snap;
  else nudge toward `loc+14 + 25*(cos,sin)(angle)` by
  `spd = |screenCenter - (loc+14 + 35*cos/sin(angle))| / 4` per axis (X uses 35,
  target uses 25 — an original quirk). Integer truncation.
- World→screen: `screen = drawRect.topLeft + world - ScreenPos`.

## Split-screen layout

`CDynGameData::GraphicsModeChanged` builds `iDrawRects` for 1–4 players:

- 1p: full screen.
- 2p: left/right halves.
- 3p: two top quadrants + bottom spanning; two black side rects.
- 4p: four quadrants.

## HUD elements

- **Energy bar** — bottom of each draw rect; `div = 100 + shield*10`; direct pixel
  writes into the buffer.
- **Weapon/ammo** — current weapon name bottom-left (+`" (double)"`), ammo above.
- **Target laser** — dotted line to `ApproxDistance` when the target system is active.
- **Hit flash** — 1 px border colour `63 - iHit`.
- **Frags** (DM) — name + player kills in a 4-column grid.
- **Minimap** — top-right; pixel size 2 (or 1 if width < 640); walls/floor/dead
  enemies/reachable/player colours.
- **Timer** — centred `M:SS`, red when over the limit.
- **Mission complete** — spiral banner during the 940-tick countdown.

## Faders / transitions (`CGraphicsFader`)

- `FadeIn`/`FadeOut` (palette multiply) and `FadeZoomOut` (sine-warped pixel phase),
  applied to `iPostBuf` for `KTimerFreq/2` ticks, then the queued state change runs.
- Zoom-out warps pixels by a sine LUT and zero-fills outside the source; fade multiplies
  palette channels by `(channel*mul)>>8`.

## Consequences for the web port

This pipeline must be reproduced in TypeScript:

1. 8-bit index buffer + global palette + `palette.tab` tables + light maps.
2. The exact draw order and per-primitive offsets above.
3. The `RotateSprites` generation (doc 11) to build character sheets.
4. Present the finished index buffer as one canvas/GPU frame (doc 10) — there is no
   per-entity rendering stage.
