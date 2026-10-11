/**
 * Build-time asset pipeline (docs/11-asset-pipeline.md).
 *
 * Mirrors the small, runtime-needed files from the original `tapankaikki4/data`
 * into `public/assets/` and emits a manifest. Assets are copied unchanged and
 * decoded by the TypeScript loaders at runtime, guaranteeing bit-exact parity.
 *
 *   bun run assets               # sprites, fonts, levels, sounds, tables
 *   bun run assets --with-music  # also copy the ~40 MB of music
 *
 * Deterministic: output contains no timestamps and file listings are sorted.
 */

import { decodePaletteTab } from "../src/data/color-tables";
import { decodeEfp, isEfp } from "../src/data/efp";
import { decodeFnt } from "../src/data/font";
import { loadLevel } from "../src/data/level";

const root = new URL("../", import.meta.url);
const srcDir = new URL("tapankaikki4/data/", root);
const outDir = new URL("public/assets/", root);
const srcPath = srcDir.pathname;
const withMusic = process.argv.includes("--with-music");

async function list(pattern: string): Promise<string[]> {
  const found: string[] = [];
  for await (const rel of new Bun.Glob(pattern).scan({ cwd: srcPath })) found.push(rel);
  found.sort();
  return found;
}

async function copyAll(files: string[]): Promise<void> {
  for (const rel of files) {
    const data = await Bun.file(new URL(rel, srcDir)).arrayBuffer();
    await Bun.write(new URL(rel, outDir), data);
  }
}

interface AssetEntry {
  file: string;
  logical?: string;
}

interface SpriteEntry extends AssetEntry {
  width: number;
  height: number;
}

interface Manifest {
  source: "tapankaikki4/data";
  palette: string;
  config: string;
  colorTables: string;
  sprites: SpriteEntry[];
  fonts: Array<{ file: string; width: number; height: number }>;
  levels: AssetEntry[];
  sounds: AssetEntry[];
  music: AssetEntry[];
}

async function main(): Promise<void> {
  const efps = await list("efps/*.efp");
  const fnts = await list("fnts/*.fnt");
  const levs = await list("levs/**/*.lev");
  const wavs = await list("wavs/*.wav");
  const music = await list("music/**/*.ogg");

  await copyAll(efps);
  await copyAll(fnts);
  await copyAll(levs);
  await copyAll(wavs);
  if (withMusic) await copyAll(music);
  for (const extra of ["palette.tab", "default.ini"]) {
    await Bun.write(new URL(extra, outDir), await Bun.file(new URL(extra, srcDir)).arrayBuffer());
  }

  const sprites: SpriteEntry[] = [];
  for (const file of efps) {
    const bytes = new Uint8Array(await Bun.file(new URL(file, srcDir)).arrayBuffer());
    // A few files carry an `.efp` extension but are not EFP (e.g. tklogo.efp is
    // really a PCX). Only true EFPs belong in the sprite manifest.
    if (!isEfp(bytes)) {
      process.stderr.write(`assets: skipping non-EFP image ${file}\n`);
      continue;
    }
    const img = decodeEfp(bytes);
    sprites.push({ file, width: img.width, height: img.height });
  }

  const fonts = [];
  for (const file of fnts) {
    const font = decodeFnt(new Uint8Array(await Bun.file(new URL(file, srcDir)).arrayBuffer()));
    fonts.push({ file, width: font.width, height: font.height });
  }

  const levels: AssetEntry[] = [];
  for (const file of levs) {
    // Validate every level parses; the loader is the same one used at runtime.
    loadLevel(new Uint8Array(await Bun.file(new URL(file, srcDir)).arrayBuffer()));
    levels.push({ file });
  }

  // Sanity-check the colour tables.
  decodePaletteTab(new Uint8Array(await Bun.file(new URL("palette.tab", srcDir)).arrayBuffer()));

  const manifest: Manifest = {
    source: "tapankaikki4/data",
    palette: "efps/walls1.efp",
    config: "default.ini",
    colorTables: "palette.tab",
    sprites,
    fonts,
    levels,
    sounds: wavs.map((file) => ({ file })),
    music: music.map((file) => ({ file })),
  };
  await Bun.write(new URL("manifest.json", outDir), `${JSON.stringify(manifest, null, 2)}\n`);

  const total =
    sprites.length + fonts.length + levels.length + wavs.length + (withMusic ? music.length : 0);
  process.stdout.write(
    `assets: ${sprites.length} sprites, ${fonts.length} fonts, ${levels.length} levels, ` +
      `${wavs.length} sounds${withMusic ? `, ${music.length} music` : " (music skipped)"}; ` +
      `${total} files -> public/assets\n`,
  );
}

await main();
