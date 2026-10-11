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

interface EpisodeEntry {
  name: string;
  levels: AssetEntry[];
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
  musicThemes: string[];
  deathmatchLevels: AssetEntry[];
  episodes: EpisodeEntry[];
}

/** `CLevel::ReadLevelName`: the level's `iComment`, or its filename. */
function levelName(bytes: Uint8Array, file: string): string {
  const comment = loadLevel(bytes).general.comment;
  return comment.length > 0 ? comment : file;
}

function levelNumber(file: string): number {
  return Number(/level(\d+)\.lev$/i.exec(file)?.[1] ?? 0);
}

async function main(): Promise<void> {
  const efps = await list("efps/*.efp");
  const pcxs = await list("efps/*.pcx");
  const fnts = await list("fnts/*.fnt");
  const levs = await list("levs/**/*.lev");
  const wavs = await list("wavs/*.wav");
  const music = await list("music/**/*.ogg");

  await copyAll(efps);
  await copyAll(pcxs);
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

  // Episode listing: `stdlib` can't `scandir` in the browser, so mirror
  // `CEpisodeList::ListFiles`/`CDeathMatchEpisode::ListFiles` here. Regular
  // episodes are the subdirectories of `levs/` (alphabetical, numeric level
  // order); the Deathmatch episode is every `*.lev` directly in `levs/`.
  const levelNameCache = new Map<string, string>();
  const nameOf = async (file: string): Promise<string> => {
    const cached = levelNameCache.get(file);
    if (cached !== undefined) return cached;
    const bytes = new Uint8Array(await Bun.file(new URL(file, srcDir)).arrayBuffer());
    const base = file.slice(file.lastIndexOf("/") + 1);
    const name = levelName(bytes, base);
    levelNameCache.set(file, name);
    return name;
  };

  const deathmatchLevels: AssetEntry[] = [];
  for (const file of levs) {
    if (!file.slice("levs/".length).includes("/")) {
      deathmatchLevels.push({ file, logical: await nameOf(file) });
    }
  }
  deathmatchLevels.sort((a, b) => a.file.localeCompare(b.file));

  const episodeDirs = new Map<string, string[]>();
  for (const file of levs) {
    const rest = file.slice("levs/".length);
    const slash = rest.indexOf("/");
    if (slash === -1) continue;
    const dir = rest.slice(0, slash);
    const base = rest.slice(slash + 1);
    if (!/^level\d+\.lev$/i.test(base)) continue;
    const files = episodeDirs.get(dir) ?? [];
    files.push(file);
    episodeDirs.set(dir, files);
  }
  const episodes: EpisodeEntry[] = [];
  for (const dir of [...episodeDirs.keys()].toSorted()) {
    const files = episodeDirs.get(dir)!.toSorted((a, b) => levelNumber(a) - levelNumber(b));
    episodes.push({
      name: dir,
      levels: await Promise.all(files.map(async (file) => ({ file, logical: await nameOf(file) }))),
    });
  }

  const musicThemes = music
    .filter((file) => file.slice("music/".length).includes("/"))
    .map((file) => file.slice("music/".length).split("/")[0])
    .filter((v, i, all) => all.indexOf(v) === i)
    .toSorted();

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
    musicThemes,
    deathmatchLevels,
    episodes,
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
