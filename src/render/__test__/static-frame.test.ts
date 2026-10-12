import { describe, expect, test } from "bun:test";

import { readRef, readRefText, sha256 } from "../../data/__test__/helpers";
import { decodePaletteTab } from "../../data/color-tables";
import { mergeIni } from "../../data/config";
import { loadIngameData } from "../../data/ingame-data";
import { loadLevel } from "../../data/level";
import { drawStaticFrame, screenPosFor, toDrawSprites } from "../draw-manager";
import { GameDrawer } from "../drawer";
import { Framebuffer } from "../fb";
import { FRAME_CASES } from "../frames";

const paletteTab = decodePaletteTab(await readRef("palette.tab"));
const ingame = await loadIngameData(mergeIni(await readRefText("default.ini")), readRef);
const sprites = toDrawSprites(ingame);

describe("static level rendering matches the C++ oracle byte-for-byte", () => {
  for (const { file, hash } of FRAME_CASES) {
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
