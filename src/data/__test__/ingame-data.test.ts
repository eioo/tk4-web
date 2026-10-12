import { describe, expect, test } from "bun:test";

import { mergeIni } from "../config";
import { ingameSignature } from "../ingame-data";
import { readRefText } from "./helpers";

describe("ingame sprite signature", () => {
  test("is stable for the same sprite config", async () => {
    const a = mergeIni(await readRefText("default.ini"));
    const b = mergeIni(await readRefText("default.ini"));
    expect(ingameSignature(a)).toBe(ingameSignature(b));
  });

  test("changes when a source sprite path is overridden", async () => {
    const base = mergeIni(await readRefText("default.ini"));
    const over = mergeIni("GameSpriteWalls = efps/other.efp\n", await readRefText("default.ini"));
    expect(ingameSignature(over)).not.toBe(ingameSignature(base));
  });

  test("ignores non-sprite overrides", async () => {
    const base = mergeIni(await readRefText("default.ini"));
    const over = mergeIni("ForceSoundTrack = music/Heavy\n", await readRefText("default.ini"));
    expect(ingameSignature(over)).toBe(ingameSignature(base));
  });
});
