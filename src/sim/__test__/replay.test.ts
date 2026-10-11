import { describe, expect, test } from "bun:test";

import { readRef, sha256 } from "../../data/__test__/helpers";
import { buildScript, runReplay, serializeScript } from "../replay";

/**
 * Byte-for-byte parity with the C++ simulation oracle
 * (`tools/reference/sim_gen.cpp`, built from `simreference.h`).
 *
 * Fixtures:
 *   tools/reference/fixtures/replay1.script — the serialised input script
 *   tools/reference/fixtures/replay1.trace  — the oracle's per-tick state trace
 *
 * Regenerate the trace:
 *   bun run tools/reference/dump-level.ts tapankaikki4/data/levs/default/level1.lev /tmp/lvl.dump
 *   bun run tools/reference/dump-script.ts /tmp/replay1.script
 *   g++ -O2 -o /tmp/sim_gen tools/reference/sim_gen.cpp -lm
 *   /tmp/sim_gen replay /tmp/lvl.dump /tmp/replay1.script /tmp/replay1.trace
 */
const SCRIPT_FIXTURE = new URL("../../../tools/reference/fixtures/replay1.script", import.meta.url);
const TRACE_FIXTURE = new URL("../../../tools/reference/fixtures/replay1.trace", import.meta.url);

const ORACLE_TRACE_HASH = "36c8af3bbb518559a99bc6d231d73d6e0cbdedca362f584c296477b3700ffd50";

async function readFile(url: URL): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(url).arrayBuffer());
}

describe("M3 replay against the C++ oracle", () => {
  test("the serialised script matches the committed fixture", async () => {
    const fixture = await readFile(SCRIPT_FIXTURE);
    const mine = serializeScript(buildScript());
    expect(mine.length).toBe(fixture.length);
    expect(sha256(mine)).toBe(sha256(fixture));
  });

  test("the whole 400-tick trace is byte-identical", async () => {
    const levelBytes = await readRef("levs/default/level1.lev");
    const got = runReplay(levelBytes, buildScript());
    const want = await readFile(TRACE_FIXTURE);

    if (sha256(got) !== sha256(want)) {
      const n = Math.min(got.length, want.length);
      let first = -1;
      for (let i = 0; i < n; i++) {
        if (got[i] !== want[i]) {
          first = i;
          break;
        }
      }
      throw new Error(`trace differs at byte ${first} (got ${got.length}B, want ${want.length}B)`);
    }

    expect(sha256(got)).toBe(ORACLE_TRACE_HASH);
  });
});
