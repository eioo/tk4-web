import { describe, expect, test } from "bun:test";

import { lightMapSize, makeLightMaps } from "../light-map";
import { sha256 } from "./helpers";

// SHA-256 of the concatenated light maps emitted by the C++ oracle
// (`/tmp/render_gen lightmap`), sizes 15, 20, … 60 (16125 bytes total).
const HASH = "74f40d7cd4883b6cf81cc5be19f8e3e87511a2e1abf0cb9baab0b194ce8bc470";

describe("makeLightMaps matches the C++ oracle byte-for-byte", () => {
  test("all ten light maps", () => {
    const maps = makeLightMaps();
    expect(maps).toHaveLength(10);
    expect(maps.map((_, i) => lightMapSize(i))).toEqual([15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);

    const total = maps.reduce((n, m) => n + m.length, 0);
    const all = new Uint8Array(total);
    let offset = 0;
    for (const map of maps) {
      all.set(map, offset);
      offset += map.length;
    }
    expect(total).toBe(16125);
    expect(sha256(all)).toBe(HASH);
  });
});
