import { describe, expect, test } from "bun:test";

import { blackRects, playerDrawRects } from "../viewport";

describe("split-screen viewport layout (CDynGameData::GraphicsModeChanged)", () => {
  test("1 player fills the screen", () => {
    expect(playerDrawRects(640, 480, 1)).toEqual([{ left: 0, top: 0, right: 640, bottom: 480 }]);
    expect(blackRects(640, 480, 1)).toEqual([]);
  });

  test("2 players split left/right", () => {
    expect(playerDrawRects(640, 480, 2)).toEqual([
      { left: 0, top: 0, right: 320, bottom: 480 },
      { left: 320, top: 0, right: 640, bottom: 480 },
    ]);
    expect(blackRects(640, 480, 2)).toEqual([]);
  });

  test("3 players: two on top, one centred below with letterboxes", () => {
    expect(playerDrawRects(640, 480, 3)).toEqual([
      { left: 0, top: 0, right: 320, bottom: 240 },
      { left: 320, top: 0, right: 640, bottom: 240 },
      { left: 160, top: 240, right: 480, bottom: 480 },
    ]);
    expect(blackRects(640, 480, 3)).toEqual([
      { left: 0, top: 240, right: 160, bottom: 480 },
      { left: 480, top: 240, right: 640, bottom: 480 },
    ]);
  });

  test("4 players: a 2x2 grid", () => {
    expect(playerDrawRects(640, 480, 4)).toEqual([
      { left: 0, top: 0, right: 320, bottom: 240 },
      { left: 320, top: 0, right: 640, bottom: 240 },
      { left: 0, top: 240, right: 320, bottom: 480 },
      { left: 320, top: 240, right: 640, bottom: 480 },
    ]);
    expect(blackRects(640, 480, 4)).toEqual([]);
  });

  test("uses C++ integer division on odd dimensions", () => {
    // 1281/2 = 640, 961/2 = 480, 3*1281/4 = 960.
    expect(playerDrawRects(1281, 961, 2)).toEqual([
      { left: 0, top: 0, right: 640, bottom: 961 },
      { left: 640, top: 0, right: 1281, bottom: 961 },
    ]);
    expect(playerDrawRects(1281, 961, 3)[2]).toEqual({
      left: 320,
      top: 480,
      right: 960,
      bottom: 961,
    });
    expect(blackRects(1281, 961, 3)).toEqual([
      { left: 0, top: 480, right: 320, bottom: 961 },
      { left: 960, top: 480, right: 1281, bottom: 961 },
    ]);
  });
});
