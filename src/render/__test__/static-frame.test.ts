import { describe, expect, test } from "bun:test";

import { readRef, readRefText, sha256 } from "../../data/__test__/helpers";
import { decodePaletteTab } from "../../data/color-tables";
import { mergeIni } from "../../data/config";
import { loadIngameData } from "../../data/ingame-data";
import { loadLevel } from "../../data/level";
import { drawStaticFrame, screenPosFor, toDrawSprites } from "../draw-manager";
import { GameDrawer } from "../drawer";
import { Framebuffer } from "../fb";

// Byte-exact SHA-256 of the frames produced by the C++ rendering oracle
// (tools/reference/render_gen.cpp) for the level's first start point.
const FRAMES: Array<[string, string]> = [
  ["default/level1.lev", "f766ff22e80b770d1f0819c17563ff76064c641cdf86915ebc5d061e957c4099"],
  ["default/level5.lev", "a4df518f682ddfd0f01d51d3f57a3a336c813bb6597a3a797a1d33043d2e64a9"],
  ["cave.lev", "6ab0e73a4a9afe7cf1219b10599616644a0045411b5aac14df135d07fd5eeabe"],
  ["dm.lev", "a36dcbd8719f209f974d199e0b4de914fd3c59f9923667bfea2a62156eb6cbab"],
  ["jailbreak/level3.lev", "8fa4175218247dc0259f3f870f92224362eb0e4bc8150e4d12e1989783a5af6a"],
  ["small.lev", "e599f19e28a946c2f8ecd72102211ee8557a5f7c41d0e27a41f24c2337720d1e"],
];

const paletteTab = decodePaletteTab(await readRef("palette.tab"));
const ingame = await loadIngameData(mergeIni(await readRefText("default.ini")), readRef);
const sprites = toDrawSprites(ingame);

describe("static level rendering matches the C++ oracle byte-for-byte", () => {
  for (const [file, hash] of FRAMES) {
    test(file, async () => {
      const level = loadLevel(await readRef(`levs/${file}`));
      const start = level.starts[0];
      const location = { x: start.x * 20 + 10, y: start.y * 20 + 10 };

      const fb = new Framebuffer(640, 480);
      const dark = new Uint8Array(640 * 480);
      const drawRect = fb.rect();
      const drawer = new GameDrawer(paletteTab);

      drawStaticFrame({
        level,
        sprites,
        drawer,
        fb,
        dark,
        drawRect,
        screenPos: screenPosFor(location, drawRect),
        playerLocation: location,
      });

      expect(sha256(fb.pixels)).toBe(hash);
    });
  }
});
