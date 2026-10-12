/**
 * Dev-only helper: writes the replay script in the binary format the C++
 * simulation oracle (`tools/reference/sim_gen.cpp`) consumes.
 *
 *   bun run tools/reference/dump-script.ts <script.bin>
 */

import { buildScript, serializeScript } from "../../src/sim/replay";

const out = process.argv[2];
if (!out) {
  console.error("usage: dump-script.ts <script.bin>");
  process.exit(2);
}
await Bun.write(out, serializeScript(buildScript()));
console.log(`wrote ${out}`);
