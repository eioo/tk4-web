import { describe, expect, test } from "bun:test";

import { loadLevel, reachable } from "../level";
import { readRef } from "./helpers";

// Expected version and (for old-format files) dimensions, read independently
// from the level headers. New-format files (v > 8) are checked structurally.
const LEVELS: Array<[string, number, number?, number?]> = [
  ["blanket/level1.lev", 1, 32, 20],
  ["blanket/level2.lev", 1, 32, 20],
  ["blanket/level3.lev", 2, 32, 20],
  ["blanket/level4.lev", 2, 50, 25],
  ["blanket/level5.lev", 2, 39, 33],
  ["blanket/level6.lev", 2, 18, 30],
  ["blanket/level7.lev", 1, 40, 32],
  ["blanket/level8.lev", 1, 28, 22],
  ["blanket/level9.lev", 2, 40, 36],
  ["blanket/level10.lev", 1, 42, 38],
  ["blanket2/level1.lev", 2, 32, 20],
  ["blanket2/level2.lev", 2, 40, 36],
  ["blanket2/level3.lev", 2, 20, 34],
  ["blanket2/level4.lev", 2, 36, 30],
  ["blanket2/level5.lev", 2, 40, 34],
  ["blanket2/level6.lev", 2, 32, 34],
  ["blanket2/level7.lev", 2, 45, 20],
  ["blanket2/level8.lev", 2, 36, 24],
  ["blanket2/level9.lev", 2, 36, 26],
  ["blanket2/level10.lev", 2, 42, 36],
  ["cave.lev", 7, 45, 30],
  ["default/level1.lev", 1, 32, 20],
  ["default/level2.lev", 1, 40, 30],
  ["default/level3.lev", 1, 45, 30],
  ["default/level4.lev", 1, 50, 40],
  ["default/level5.lev", 1, 80, 60],
  ["default/level6.lev", 1, 32, 20],
  ["default/level7.lev", 1, 40, 30],
  ["default/level8.lev", 1, 45, 40],
  ["default/level9.lev", 1, 50, 50],
  ["default/level10.lev", 1, 80, 60],
  ["dm.lev", 11],
  ["fiendis/level1.lev", 5, 40, 32],
  ["fiendis/level2.lev", 2, 50, 20],
  ["fiendis/level3.lev", 2, 42, 34],
  ["fiendis/level4.lev", 5, 24, 16],
  ["fiendis/level5.lev", 5, 16, 38],
  ["fiendis/level6.lev", 2, 40, 38],
  ["fiendis/level7.lev", 5, 40, 38],
  ["fiendis/level8.lev", 5, 40, 20],
  ["fiendis/level9.lev", 5, 32, 24],
  ["fiendis/level10.lev", 5, 40, 30],
  ["jailbreak/level1.lev", 8, 30, 20],
  ["jailbreak/level2.lev", 7, 30, 30],
  ["jailbreak/level3.lev", 9],
  ["jailbreak/level4.lev", 9],
  ["jailbreak/level5.lev", 9],
  ["jailbreak/level6.lev", 9],
  ["jailbreak/level7.lev", 9],
  ["jailbreak/level8.lev", 9],
  ["mothafux/level1.lev", 2, 40, 30],
  ["mothafux/level2.lev", 2, 70, 20],
  ["mothafux/level3.lev", 2, 34, 25],
  ["mothafux/level4.lev", 2, 60, 15],
  ["mothafux/level5.lev", 4, 34, 24],
  ["mothafux/level6.lev", 2, 50, 34],
  ["mothafux/level7.lev", 2, 70, 40],
  ["mothafux/level8.lev", 2, 42, 34],
  ["mothafux/level9.lev", 4, 50, 40],
  ["mothafux/level10.lev", 4, 30, 50],
  ["seacastle.lev", 11],
  ["small.lev", 7, 32, 20],
];

describe(".lev decoder", () => {
  for (const [file, version, width, height] of LEVELS) {
    test(file, async () => {
      const level = loadLevel(await readRef(`levs/${file}`));
      expect(level.version).toBe(version);
      if (width !== undefined && height !== undefined) {
        expect([level.width, level.height]).toEqual([width, height]);
      }
      expect(level.width).toBeGreaterThan(0);
      expect(level.height).toBeGreaterThan(0);
      expect(level.blocks.length).toBe(level.width * level.height);
      expect(level.starts.length).toBeGreaterThan(0);
      expect(level.general.timeLimit).toBeGreaterThanOrEqual(0);

      // Reachability must flood-fill at least the start area.
      let reachCount = 0;
      for (let i = 0; i < level.reachable.length; i++) if (level.reachable[i]) reachCount++;
      expect(reachCount).toBeGreaterThan(0);
      const s = level.starts[0];
      expect(reachable(level, s.x, s.y)).toBe(true);
    });
  }

  test("border blocks are forced to walls by the border pass", async () => {
    const level = loadLevel(await readRef("levs/default/level1.lev"));
    expect(level.outBlock.type).toBe(1);
    // Corners are forced to walls.
    expect(level.blocks[0].type).toBe(1);
    expect(level.blocks[level.width - 1].type).toBe(1);
  });
});
