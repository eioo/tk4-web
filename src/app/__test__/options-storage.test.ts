import { describe, expect, test } from "bun:test";

import { KDefaultResolution, Options, OptionsData, stepResolution, TPlayerKeys } from "../options";
import { applyOptions, serializeOptions, type StorageLike } from "../options-storage";

function roundTrip(data: OptionsData): OptionsData {
  const restored = new OptionsData();
  applyOptions(restored, serializeOptions(data));
  return restored;
}

describe("COptions persistence", () => {
  test("round-trips the defaults unchanged", () => {
    const data = new OptionsData();
    const restored = roundTrip(data);
    expect(restored.gamma).toBe(data.gamma);
    expect(restored.musicVolume).toBe(data.musicVolume);
    expect(restored.effectsVolume).toBe(data.effectsVolume);
    expect(restored.mouseSensitivity).toBe(data.mouseSensitivity);
    expect(restored.mouseMode).toBe(data.mouseMode);
    expect(restored.musicTheme).toBe(data.musicTheme);
    expect(restored.inGameVideoMode).toEqual(data.inGameVideoMode);
    expect(restored.name).toEqual(data.name);
    expect(restored.keys).toEqual(data.keys);
  });

  test("round-trips edited values, keys and names", () => {
    const data = new OptionsData();
    data.musicVolume = 0.35;
    data.effectsVolume = 0.8;
    data.gamma = 1.6;
    data.mouseSensitivity = 2.5;
    data.mouseMode = 3;
    data.multiPlayers = 4;
    data.multiPlayGameMode = 1;
    data.multiPlayEpisode = 2;
    data.multiPlayLevel = 5;
    data.dmSpeed = 3.2;
    data.dmTargetSystem = true;
    data.stereo = true;
    data.fullScreen = false;
    data.inGameLargeText = true;
    data.musicTheme = "heavy";
    data.name[0] = "Kalle";
    data.keys[0][TPlayerKeys.LEFT] = "q".charCodeAt(0);

    const restored = roundTrip(data);
    expect(restored.musicVolume).toBeCloseTo(0.35, 6);
    expect(restored.effectsVolume).toBeCloseTo(0.8, 6);
    expect(restored.gamma).toBeCloseTo(1.6, 6);
    expect(restored.mouseMode).toBe(3);
    expect(restored.multiPlayers).toBe(4);
    expect(restored.multiPlayGameMode).toBe(1);
    expect(restored.dmSpeed).toBeCloseTo(3.2, 6);
    expect(restored.dmTargetSystem).toBe(true);
    expect(restored.stereo).toBe(true);
    expect(restored.fullScreen).toBe(false);
    expect(restored.inGameLargeText).toBe(true);
    expect(restored.musicTheme).toBe("heavy");
    expect(restored.name[0]).toBe("Kalle");
    expect(restored.keys[0][TPlayerKeys.LEFT]).toBe("q".charCodeAt(0));
  });

  test("leaves defaults when nothing is stored", () => {
    const data = new OptionsData();
    expect(applyOptions(data, null)).toBe(false);
    expect(data.musicVolume).toBe(1.0);
  });

  test("rejects malformed JSON and unknown versions", () => {
    const data = new OptionsData();
    expect(applyOptions(data, "{ not json")).toBe(false);
    expect(applyOptions(data, JSON.stringify({ version: 999, musicVolume: 0.1 }))).toBe(false);
    expect(data.musicVolume).toBe(1.0);
  });

  test("clamps out-of-range numbers", () => {
    const data = new OptionsData();
    applyOptions(
      data,
      JSON.stringify({
        version: 1,
        gamma: 99,
        musicVolume: 2,
        effectsVolume: -3,
        mouseSensitivity: 50,
        mouseMode: 9,
        dmSpeed: 100,
        multiPlayers: 99,
      }),
    );
    expect(data.gamma).toBe(3.0);
    expect(data.musicVolume).toBe(1.0);
    expect(data.effectsVolume).toBe(0.0);
    expect(data.mouseSensitivity).toBe(10.0);
    expect(data.mouseMode).toBe(4);
    expect(data.dmSpeed).toBe(5.0);
    expect(data.multiPlayers).toBe(4);
  });

  test("ignores fields of the wrong type and keeps the rest", () => {
    const data = new OptionsData();
    applyOptions(
      data,
      JSON.stringify({
        version: 1,
        musicVolume: "loud",
        fullScreen: "yes",
        name: 42,
        keys: "nope",
        mouseMode: 2,
      }),
    );
    expect(data.musicVolume).toBe(1.0);
    expect(data.fullScreen).toBe(true);
    expect(data.name[0]).toBe("John");
    expect(data.mouseMode).toBe(2);
  });

  test("trims trailing spaces and truncates names on load", () => {
    const data = new OptionsData();
    data.name[0] = "Ringo   ";
    const raw = serializeOptions(data);
    expect(JSON.parse(raw).name[0]).toBe("Ringo");

    const restored = new OptionsData();
    applyOptions(restored, JSON.stringify({ version: 1, name: ["x".repeat(40)] }));
    expect(restored.name[0]).toBe("x".repeat(14));
  });

  test("survives a real StorageLike round-trip", () => {
    const store = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
    };
    const data = new OptionsData();
    data.musicVolume = 0.5;
    storage.setItem("opts", serializeOptions(data));

    const loaded = new OptionsData();
    expect(applyOptions(loaded, storage.getItem("opts"))).toBe(true);
    expect(loaded.musicVolume).toBeCloseTo(0.5, 6);
  });
});

describe("COptions sanity checks", () => {
  test("resets the DM episode/level when they fall out of range", () => {
    const options = new Options(
      [],
      [
        { name: "ep0", levels: [{ file: "a", name: "a" }] },
        { name: "ep1", levels: [{ file: "b", name: "b" }] },
      ],
    );
    options.data.multiPlayEpisode = 9;
    options.data.multiPlayLevel = 9;
    options.validate();
    expect(options.data.multiPlayEpisode).toBe(0);
    expect(options.data.multiPlayLevel).toBe(0);
  });
});

describe("CGraphicsDevice resolution stepping", () => {
  test("cycles forward and backward, wrapping", () => {
    const first = stepResolution(KDefaultResolution, true);
    expect(first).not.toEqual(KDefaultResolution);
    expect(stepResolution(first, false)).toEqual(KDefaultResolution);
  });

  test("falls back to 640x480 for an unknown mode", () => {
    expect(stepResolution({ x: 123, y: 456 }, true)).toEqual(KDefaultResolution);
  });
});
