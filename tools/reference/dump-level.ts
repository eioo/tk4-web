/**
 * Dev-only helper: serialises a `.lev` into the raw block dump consumed by the
 * C++ rendering oracle (`tools/reference/render_gen.cpp`).
 *
 *   bun run tools/reference/dump-level.ts <level.lev> <dump.bin>
 *
 * Block heights are dumped in their on-disk form (0 for old-format levels,
 * where the oracle re-derives them from `KBlockHeights`) so the oracle validates
 * the height table independently.
 */

import { parseLevel } from "../../src/data/level";

function i32(view: DataView, offset: number, value: number): number {
  view.setInt32(offset, value, true);
  return offset + 4;
}

const [, , levPath, outPath] = process.argv;
if (!levPath || !outPath) {
  console.error("usage: dump-level.ts <level.lev> <dump.bin>");
  process.exit(2);
}

const bytes = new Uint8Array(await Bun.file(levPath).arrayBuffer());
const level = parseLevel(bytes);

const oldFormat = level.version < 6;
const size = 4 * 3 + level.blocks.length * 4 * 3 + 4 * 3 + 4 + level.starts.length * 4 * 2;
const buf = new ArrayBuffer(size);
const view = new DataView(buf);
let o = 0;
o = i32(view, o, level.version);
o = i32(view, o, level.width);
o = i32(view, o, level.height);
for (const b of level.blocks) {
  o = i32(view, o, b.type);
  o = i32(view, o, b.number);
  o = i32(view, o, oldFormat ? 0 : b.height);
}
o = i32(view, o, level.outBlock.type);
o = i32(view, o, level.outBlock.number);
o = i32(view, o, oldFormat ? 0 : level.outBlock.height);
o = i32(view, o, level.starts.length);
for (const s of level.starts) {
  o = i32(view, o, s.x);
  o = i32(view, o, s.y);
}

await Bun.write(outPath, new Uint8Array(buf, 0, o));
console.log(`dumped ${levPath} (v${level.version}, ${level.width}x${level.height}) -> ${outPath}`);
