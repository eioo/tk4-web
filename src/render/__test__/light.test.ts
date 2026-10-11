import { describe, expect, test } from "bun:test";

import { readRef, sha256 } from "../../data/__test__/helpers";
import { decodePaletteTab } from "../../data/color-tables";
import { makeLightMaps } from "../../data/light-map";
import { LightTable } from "../../sim/types";
import { GameDrawer } from "../drawer";
import { Framebuffer } from "../fb";

// SHA-256 of the frame produced by the C++ oracle
// (`/tmp/render_gen lightrender <palette.tab>`), which applies the same eight
// synthetic lights (all four light tables, sizes 0..9, edge clipping).
const HASH = "50dfca34ceb108a1644536b76392e74d23f50e0c63f3840c7eb26ed3123e4b09";

describe("GameDrawer.drawLight matches the C++ oracle byte-for-byte", () => {
  test("synthetic light scene", async () => {
    const tables = decodePaletteTab(await readRef("palette.tab"));
    const drawer = new GameDrawer(tables, makeLightMaps());

    const width = 200;
    const height = 150;
    const fb = new Framebuffer(width, height);
    for (let i = 0; i < width * height; i++) fb.pixels[i] = (i * 7) & 0xff;
    const draw = fb.rect();

    drawer.drawLight(LightTable.Normal, 30, 40, 2, -10, fb, draw);
    drawer.drawLight(LightTable.Normal, 30, 40, 2, 0, fb, draw);
    drawer.drawLight(LightTable.Explosion, 100, 75, 7, 3, fb, draw);
    drawer.drawLight(LightTable.Yellow, 100, 75, 3, -1, fb, draw);
    drawer.drawLight(LightTable.Red, 5, 5, 4, 2, fb, draw);
    drawer.drawLight(LightTable.Normal, 199, 149, 0, 15, fb, draw);
    drawer.drawLight(LightTable.Explosion, 150, 120, 9, -5, fb, draw);
    drawer.drawLight(LightTable.Normal, 0, 0, 1, 4, fb, draw);

    expect(sha256(fb.pixels)).toBe(HASH);
  });
});
