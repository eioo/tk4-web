# 06 — Asset Formats

All numeric fields are **little-endian** unless noted. Decoding is implemented by the
original in `src/common/CGraphicsBuffer.cpp`, `CPalette.cpp`, `CFonts.cpp`,
`CConfigFile.cpp`, `src/CIngameData.cpp`.

## EFP sprite (`"EF pic"`)

`CGraphicsBuffer::LoadEFP` / `SaveEFP`.

```
offset 0  : magic "EF pic"                        (6 bytes)
offset 6  : width   uint16                          (2)
offset 8  : height  uint16                          (2)
offset 10 : RLE-compressed pixel indices
last 768  : palette, 256 × (R,G,B), each 0..63
```

RLE decoding (note the unusual scheme):

```
while pixels_left:
    t = next_byte()
    if t > 192:  v = next_byte(); repeat v (t-192) times
    else:        emit t
```

Palette values are 0–63 and are multiplied by 4 (`FourMultiply`) to reach 0–255 for
display. **In-game, only `walls1.efp`'s palette is used** as the global palette; other
in-game EFPs' stored palettes are ignored (their pixel indices are interpreted with the
global palette). Menu/shop/logo images do use their own palettes.

### EFP2 (`"EFP2"`)

`LoadEFP2`: magic `EFP2` (4), width `int32`, height `int32`, bits (must be 8), palette
768 bytes, then raw uncompressed pixels.

### SCI (`"RIX3"`)

`LoadSCI`: magic `RIX3`, width/height `uint16`, a `short`, palette 768 bytes, then raw
pixels. Used by the editor.

### PCX

Standard 8-bit PCX, RLE, palette in the last 768 bytes. Used for logos/menu/target
art. `LoadPCX` reads width/height from the header and RLE-decodes one plane.

### BMP / other images

Any other extension is loaded via SDL_image; only 8-bit surfaces are accepted.

## Fonts (`.fnt`)

`CFonts::Load`:

```
offset 0   : width  (uint8)
offset 1   : height (uint8)
offset 512 : 256 glyphs, each width*height bytes (indexed)
```

The loader reads the two header bytes, then `fseek(fnt, 256*2, SEEK_SET)` seeks to
**absolute** offset 512, then reads `256*width*height` glyph bytes. So the total file
size is `512 + 256*width*height` (the 510 bytes between the header and the glyphs are
skipped, not a separate 512-byte table). Measured: `8x8b` → 8×8 (16896 B),
`menu15x18*` → 15×18 (69632 B), `menu25x30*` → 25×30 (192512 B), `snumbers` → 3×5
(4352 B).

Glyph rendering (`CFonts::Write`):

- Each glyph is trimmed to its non-zero left/right extent; blank glyph → advance
  `width/2`.
- `aOneIsZero=1` (small font) maps glyph pixel value `1` to index 0 (transparent).
- `iScaleX/iScaleY` support the "large text" option (×2).
- Character advance = trimmed width; pixel values are palette indices.

## Palette table (`palette.tab`)

86016 bytes, pre-baked colour tables (see doc 05): transparency, shadow, and four
16-step light tables. Generated from the walls1 palette; safe to ship as-is or
regenerate.

## Sound effects (`wavs/*.wav`)

RIFF/WAVE, 8-bit mono PCM, ~22050 Hz (header shows `0xAC44`/2 ... e.g. `pistol.wav`
`fmt` chunk: 1 channel, rate `0xAC44`=44100? verify at build). Played via SDL_mixer
with `Mix_PlayChannel`, positional panning and volume. 16 effects:
pistol, shotgun, uzi, 12mm, sinko (bazooka), hit, verysmallexplo, smallexplo, explo,
klik, death, woosh, flame, metalhit, grenadelauncher, kickhead.

## Music (`music/**.ogg`)

OGG Vorbis. `menu.ogg` plus themes `default`, `heavy`, `oldskool`, `techno`, each with
`0.ogg`–`4.ogg`. The active theme/song is chosen by options and can be forced per
episode/level via `ForceSoundTrack`/`ForceSongNumber`.

## Configuration files

- `default.ini` — maps logical names to asset paths and holds frag/suicide texts. Same
  format as `CConfigFile`: `Key = Value` lines, `#`/`;` comments; optional indexed keys
  like `FragText[0]`.
- `options.cfg` — **binary**, a raw dump of `COptionsData` (see `COptions.cpp`). Saved
  on menu exit and destructor. Contains key bindings, names, volumes, gamma, mouse
  setting, video mode, DM options, proxy/version settings, music theme.
- Episode/level overrides: an episode folder may add its own `default.ini`, and a level
  may add `levelN.ini`; missing keys fall back to the root `default.ini`.

### Key `default.ini` entries

Sprite keys `GameSpriteWallClr/Crate/Shadow/Target/Floor/Floor2/BodyPart/Effect/Walls/
Wall2/Walls_1..5/Rambo1..4/Enemy0..9/BulletC4/BulletGrenade/BulletMine`; sound keys
`GameSoundEffect*`; text keys `FragText`, `SuicideText`, optional `ForceSoundTrack`,
`ForceSongNumber`.

## `polycolr.efp` and wall colouring

`EGameSpriteWallClr` is used to tint wall faces: a 16×60 indexed image addressed as
`polycolr[n + 16*(n/16)]` for edge-based shading (base colour) and `+16` for the top
colour, with `±1` for side shading. This is used by the pseudo-3D wall renderer.

## Asset size reference

`data/` is ~48 MB total: `music/` ~40 MB, `efps/` ~5.6 MB, `levs/` ~1.2 MB, `wavs/`
~784 KB, `fnts/` ~508 KB. Music dominates; consider lazy-loading themes in the web
port.
