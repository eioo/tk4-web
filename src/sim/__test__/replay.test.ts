import { describe, expect, test } from "bun:test";

import { readRef, sha256 } from "../../data/__test__/helpers";
import { runReplay, SCENARIOS, serializeScript } from "../replay";

/**
 * Byte-for-byte parity with the C++ simulation oracle
 * (`tools/reference/sim_gen.cpp`, built from `simreference.h`).
 *
 * Each scenario has two fixtures under `tools/reference/fixtures/`:
 *   <name>.script — the serialised input script
 *   <name>.trace  — the oracle's per-tick state trace
 *
 * Regenerate them (needs g++) with:
 *   bun run parity --update
 */
const FIXTURE_DIR = new URL("../../../tools/reference/fixtures/", import.meta.url);

async function readFixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(new URL(name, FIXTURE_DIR)).arrayBuffer());
}

function firstDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

describe("scripted replays match the C++ oracle byte-for-byte", () => {
  for (const scenario of SCENARIOS) {
    test(`${scenario.name}: the serialised script matches the fixture`, async () => {
      const fixture = await readFixture(`${scenario.name}.script`);
      const mine = serializeScript(scenario.build());
      expect(mine.length).toBe(fixture.length);
      expect(sha256(mine)).toBe(sha256(fixture));
    });

    test(`${scenario.name}: the whole trace is byte-identical`, async () => {
      const levelBytes = await readRef(scenario.level);
      const fontBytes = await readRef("fnts/menu15x18dark.fnt");
      const got = runReplay(levelBytes, scenario.build(), fontBytes);
      const want = await readFixture(`${scenario.name}.trace`);
      expect(firstDiff(got, want)).toBe(-1);
      expect(sha256(got)).toBe(sha256(want));
    });
  }
});
