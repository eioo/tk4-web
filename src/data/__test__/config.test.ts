import { describe, expect, test } from "bun:test";

import { mergeIni, parseIni } from "../config";
import { readRefText } from "./helpers";

describe("ini config", () => {
  test("parses default.ini sprite and text keys", async () => {
    const cfg = mergeIni(await readRefText("default.ini"));
    expect(cfg.get("GameSpriteWalls")).toBe("efps/walls1.efp");
    expect(cfg.get("GameSpriteFloor2")).toBe("efps/floor1.generated.efp");
    expect(cfg.get("GameSpriteBulletGrenade")).toBe("efps/bomb2.efp");
    expect(cfg.getIndexed("FragText", 0)).toBe("%s sent %s to an upper orbit.");
    expect(cfg.get("FragTextAmount")).toBe("13");
    expect(cfg.get("SuicideTextAmount")).toBe("10");
    expect(cfg.get("GameSoundEffectPistol")).toBe("wavs/pistol.wav");
  });

  test("ignores comments and blank lines", () => {
    const pairs = parseIni("# comment\n; also\n\nKey = Value\nOther=  spaced  \n");
    expect(pairs).toEqual([
      ["Key", "Value"],
      ["Other", "spaced"],
    ]);
  });

  test("first file in priority order wins", () => {
    const cfg = mergeIni(
      "A = level\nB = level\n",
      "A = episode\nC = episode\n",
      "A = default\nD = default\n",
    );
    expect(cfg.get("A")).toBe("level");
    expect(cfg.get("B")).toBe("level");
    expect(cfg.get("C")).toBe("episode");
    expect(cfg.get("D")).toBe("default");
  });

  test("undefined files are skipped", () => {
    const cfg = mergeIni(undefined, "X = 1\n");
    expect(cfg.get("X")).toBe("1");
  });
});
