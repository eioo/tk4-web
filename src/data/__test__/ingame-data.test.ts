import { describe, expect, test } from "bun:test";

import { mergeIni } from "../config";
import { ingameSignature, loadIngameData } from "../ingame-data";
import { readRef, readRefText } from "./helpers";

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

  test("changes when a frag/suicide text is overridden", async () => {
    const base = mergeIni(await readRefText("default.ini"));
    const over = mergeIni("FragText[0] = boom %s %s\n", await readRefText("default.ini"));
    expect(ingameSignature(over)).not.toBe(ingameSignature(base));
  });
});

describe("ingame kill texts", () => {
  test("loads FragText/SuicideText from the merged config", async () => {
    const data = await loadIngameData(mergeIni(await readRefText("default.ini")), readRef);
    expect(data.killTexts.length).toBe(13);
    expect(data.suicideTexts.length).toBe(10);
    expect(data.killTexts[0]).toContain("%s");
    expect(data.suicideTexts[0]).toContain("%s");
  });
});
