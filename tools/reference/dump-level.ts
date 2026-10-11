/**
 * Dev-only helper: serialises a `.lev` into the raw block dump consumed by the
 * C++ rendering/simulation oracles (`tools/reference/render_gen.cpp`,
 * `sim_gen.cpp`).
 *
 *   bun run tools/reference/dump-level.ts <level.lev> <dump.bin>
 *
 * Block heights are dumped in their on-disk form (0 for old-format levels,
 * where the oracle re-derives them from `KBlockHeights`) so the oracle validates
 * the height table independently. The M4 section (general info, enemies, crates,
 * steams) is appended after the start points; the render oracle ignores it.
 */

import { parseLevel } from "../../src/data/level";

const parts: number[] = [];
const i32 = (v: number): void => {
  parts.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
};

const [, , levPath, outPath] = process.argv;
if (!levPath || !outPath) {
  console.error("usage: dump-level.ts <level.lev> <dump.bin>");
  process.exit(2);
}

const bytes = new Uint8Array(await Bun.file(levPath).arrayBuffer());
const level = parseLevel(bytes);

const oldFormat = level.version < 6;
i32(level.version);
i32(level.width);
i32(level.height);
for (const b of level.blocks) {
  i32(b.type);
  i32(b.number);
  i32(oldFormat ? 0 : b.height);
}
i32(level.outBlock.type);
i32(level.outBlock.number);
i32(oldFormat ? 0 : level.outBlock.height);
i32(level.starts.length);
for (const s of level.starts) {
  i32(s.x);
  i32(s.y);
}

// ---- M4: general info, enemies, crates, steams ----
i32(level.general.timeLimit);
for (let a = 0; a < 10; a++) i32(level.general.enemies[a] ?? 0);
i32(level.enemies.length);
for (const e of level.enemies) {
  i32(e.type);
  i32(e.x);
  i32(e.y);
}
i32(level.placedCratesNormal.length);
for (const c of level.placedCratesNormal) {
  i32(c.type1);
  i32(c.type2);
  i32(c.x);
  i32(c.y);
}
i32(level.randomCratesNormal.length);
for (const c of level.randomCratesNormal) {
  i32(c.type1);
  i32(c.type2);
  i32(c.amount);
}
i32(level.steams.length);
for (const s of level.steams) {
  i32(s.x);
  i32(s.y);
  i32(s.angle);
  i32(s.speed);
}

await Bun.write(outPath, new Uint8Array(parts));
console.log(`dumped ${levPath} (v${level.version}, ${level.width}x${level.height}) -> ${outPath}`);
