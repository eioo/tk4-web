import { describe, expect, test } from "bun:test";

import { SoundEffect } from "../../sim/types";
import { panValue, stereoShaper, KEffectFiles } from "../sound";

describe("CSoundPlayer::StereoShaper", () => {
  test("centres a sound at the observer", () => {
    expect(stereoShaper(100, 100, 100, 100)).toEqual({ left: 128, right: 128 });
  });

  test("pans a sound on the left to the left channel", () => {
    const pan = stereoShaper(0, 0, -100, 0);
    expect(pan.left).toBeGreaterThan(pan.right);
    expect(pan.right).toBeGreaterThan(0);
  });

  test("pans a sound on the right to the right channel", () => {
    const pan = stereoShaper(0, 0, 100, 0);
    expect(pan.right).toBeGreaterThan(pan.left);
  });

  test("never lets both channels stay loud", () => {
    for (const [dx, dy] of [
      [0, 0],
      [50, 0],
      [-50, 0],
      [0, 50],
      [0, -50],
      [200, 120],
      [-200, -120],
    ]) {
      const pan = stereoShaper(0, 0, dx, dy);
      // The original's integer `dif/2` can leave the sum at 257.
      expect(pan.left + pan.right).toBeLessThanOrEqual(257);
      expect(pan.left).toBeGreaterThanOrEqual(0);
      expect(pan.right).toBeGreaterThanOrEqual(0);
    }
  });

  test("is symmetric left/right", () => {
    const left = stereoShaper(0, 0, -100, 20);
    const right = stereoShaper(0, 0, 100, 20);
    expect(left.left).toBe(right.right);
    expect(left.right).toBe(right.left);
  });
});

describe("panValue", () => {
  test("maps centred to 0 and flips on reverse", () => {
    expect(panValue({ left: 128, right: 128 })).toBe(0);
    expect(panValue({ left: 226, right: 31 })).toBeCloseTo(-0.759, 2);
    expect(panValue({ left: 226, right: 31 }, true)).toBeCloseTo(0.759, 2);
  });

  test("clamps to -1..1", () => {
    expect(panValue({ left: 255, right: 0 })).toBe(-1);
    expect(panValue({ left: 0, right: 255 })).toBe(1);
  });
});

describe("KEffectFiles", () => {
  test("names every effect in SoundEffect order", () => {
    expect(KEffectFiles).toHaveLength(SoundEffect.Amount);
    expect(KEffectFiles[SoundEffect.Pistol]).toBe("GameSoundEffectPistol");
    expect(KEffectFiles[SoundEffect.KickHead]).toBe("GameSoundEffectKickHead");
  });
});
