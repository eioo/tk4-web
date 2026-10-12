# 11 — Asset Pipeline

Goal: turn the original `tapankaikki4/data/` files into web-ready assets **without
changing a single pixel or sample**, using reproducible build-time scripts (Bun/TS, with
Python used only while bootstrapping/verifying).

## Principles

1. **Lossless.** Never resample images or re-encode audio unless required for browser
   support. Preserve exact pixel indices, palettes and samples.
2. **Deterministic.** Same inputs → byte-identical outputs. No timestamps, no map-order
   dependence.
3. **Reference-checked.** Every decoder is validated against the C++ behaviour and/or
   against a Python reference decoder before it is trusted.
4. **Runtime vs. build-time.** Anything the C++ game computes once at load may be either
   baked at build time or computed at runtime — as long as the result is identical. Prefer
   baking expensive, deterministic transforms (character sheet rotation) at build time.

## Inputs and outputs

| Input | Decoder | Output | Where used |
|-------|---------|--------|-----------|
| `efps/*.efp` | EFP RLE + last-768 palette | `.bin` (w, h, index bytes) or PNG; global palette JSON | software renderer |
| `efps/walls1.efp` | same | **global palette** (`Uint8Array[256*3]`, ×4) | all in-game colours |
| `efps/*.generated.efp`, `walls1_N*.efp` | same | `.bin` | use as-is (matches `CIngameData` "generated present" path) |
| `efps/rambo*.efp`, `enemy*.efp` | EFP + `RotateSprites` | 80×N / 40×N angle sheets `.bin` | characters |
| `efps/*.pcx`, `*.bmp` | PCX/BMP | PNG (with own palette) | menus/logos/splash |
| `fnts/*.fnt` | FNT | `{w, h, glyphs: Uint8Array}` JSON/bin | text rasteriser |
| `levs/**/*.lev` | `.lev` old+new | shipped raw; decoded in TS at runtime | level data |
| `palette.tab` | raw | `Uint8Array` (or JSON) | colour tables |
| `wavs/*.wav` | copy | copy (optionally normalise) | sound |
| `music/**/*.ogg` | copy | copy (+ optional MP3 fallback) | music |
| `help/*` | copy | copy (static help) | optional |
| `default.ini`, `options.cfg` | config / binary | JSON (default.ini parsed at runtime; options.cfg → defaults) | data |
| `tk.ico` | copy | copied as-is to `assets/tk.ico` | browser favicon |

## EFP decoder (must be exact)

```
magic "EF pic"; w,h = uint16 LE; then RLE: t = byte;
  if t > 192: v = byte; repeat v (t-192) times
  else:       emit t
trailing 768 bytes = palette, 256×(r,g,b) each 0..63
```

Port from `CGraphicsBuffer::LoadEFP`. Also support `.efp2`, `.pcx`, `.sci`, `.bmp`
(doc 06) because menus use PCX and the editor uses SCI.

## Character sheet generation — `RotateSprites`

Port `CGraphicsGenerator::RotateSprites` exactly (float `sin/cos`, `int()` truncation,
the `column`/`row` loops, the `column` from 1, the `(column+aAngles/4)%aAngles` source
term, the read guard `ax>0 && ax<sw && ay in band`). Parameters: player `80` angles,
enemy `40`, cell `28`, output `(28+1)` gutter.

> The shipped `rambo*.efp`/`enemy*.efp` are already angle sheets, but the game
> regenerates them at load from the left-most "base" strip. Run the same algorithm on
> the same bytes (verified against a reference build, doc 13) — do not "optimise" by
> using the shipped columns.

Also port:

- `CGraphicsGenerator::MakeFloors` (HSL-lightness/3, HSL-saturation/3 → closest palette
  index) for the dark floor variant.
- `CGraphicsGenerator::ZoomWall` (nearest-neighbour wall upscale, `size = 20 + level+1`,
  the exact `size/(aAdd+1)+1` stepping rule) for wall heights 1–5.

Prefer using the shipped `.generated.efp` files when present (that is what the original
does when timestamps say they are current); keep the generator available for mods.

## Palette & tables

- Extract the global palette from `efps/walls1.efp` (last 768 bytes, `×4`).
- Ship `palette.tab` as-is (86016 bytes) and parse into:
  `TransparencyTable[256][256]`, `ShadowTable[256][16]`, `Normal/Red/Yellow/Explosion
  Light[256][16]`. Alternatively regenerate from the walls1 palette using the exact
  HSL/`ClosestInPalette` algorithms.
- Provide a `closestInPalette(r,g,b)` implementation matching `CLightTable` so any
  runtime generation is identical.

## Fonts

Decode `.fnt` to `{ w, h, glyphs: Uint8Array(256*w*h) }`. Rendering lives in the port
(`CFonts::Write`), including left/right glyph trimming, the blank-glyph advance of
`w/2`, `iOneIsZero` for the 8×8 font, and scale factors for large text.

## Levels

Ship raw `.lev` files; decode at runtime with the TS port of `CLevel::Load` (both old
and new, doc 07), including `KBlockHeights`, `GenerateReachableMap`,
`ModifyBorderBlocks`, `DarknessCast`, `GenerateShadows`. Do **not** pre-convert to JSON
unless needed — runtime decode keeps parity with the original's derived data.

## Audio

- Copy `wavs/*.wav` unchanged (validated RIFF 8-bit PCM).
- Copy `music/**/*.ogg`. Optionally generate `.mp3` siblings for older Safari.
- If downmixing is required, use `ffmpeg` deterministically and document the command.

## Build script contract

- `bun run assets` (`tools/build-assets.ts`) reads `../tapankaikki4/data` and writes
  `public/assets/`. On a fresh tree it first clones `suomipelit/tapankaikki4` (depth 1)
  into `tapankaikki4/`, which this repo keeps out of history; music is always included.
- `bun run assets:ensure` (`tools/ensure-assets.ts`) runs it only when
  `public/assets/manifest.json` is missing. `bun run dev` and `bun run start` call it
  first, so a fresh checkout builds assets on demand.
- Publish an `assets/manifest.json` (key → path, dims, palette refs) so the loader can
  fetch lazily (music especially, ~40 MB total).
- Real-data checks in the script: assert palette sizes, EFPs decode fully, level
  versions recognised, fonts match `2 + 512 + 256*w*h`, etc.

## Reference decoder

Keep a slow, obviously-correct Python reference (`tools/reference/*.py`) alongside the TS
implementation to cross-check outputs during development (the Python snippets used while
writing these docs are a starting point). Any mismatch is a bug in the fast path.
