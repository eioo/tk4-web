import { describe, expect, test } from "bun:test";

import { BodyPartTypes, BulletId, BulletTypes, SoundEffect, WeaponId, WeaponTypes } from "../types";

describe("sound-effect tables", () => {
  test("weapons play their firing sound (common/types.cpp)", () => {
    expect(WeaponTypes[WeaponId.Fist].sound).toBe(SoundEffect.Hit);
    expect(WeaponTypes[WeaponId.Pistol].sound).toBe(SoundEffect.Pistol);
    expect(WeaponTypes[WeaponId.Shotgun].sound).toBe(SoundEffect.Shotgun);
    expect(WeaponTypes[WeaponId.Uzi].sound).toBe(SoundEffect.Uzi);
    expect(WeaponTypes[WeaponId.AutoRifle].sound).toBe(SoundEffect.Autorifle);
    expect(WeaponTypes[WeaponId.RocketLauncher].sound).toBe(SoundEffect.Bazooka);
    expect(WeaponTypes[WeaponId.AutoLauncher].sound).toBe(SoundEffect.Bazooka);
    expect(WeaponTypes[WeaponId.HeavyLauncher].sound).toBe(SoundEffect.Bazooka);
    expect(WeaponTypes[WeaponId.AutoShotgun].sound).toBe(SoundEffect.Shotgun);
    expect(WeaponTypes[WeaponId.C4Activator].sound).toBe(SoundEffect.NoSound);
    expect(WeaponTypes[WeaponId.FlameThrower].sound).toBe(SoundEffect.Flame);
    expect(WeaponTypes[WeaponId.MineDropper].sound).toBe(SoundEffect.NoSound);
    expect(WeaponTypes[WeaponId.GrenadeLauncher].sound).toBe(SoundEffect.GrenadeLauncher);
  });

  test("only grenades bounce with a sound", () => {
    expect(BulletTypes[BulletId.Grenades].bounceSound).toBe(SoundEffect.MetalHit);
    for (const id of [BulletId.Fist, BulletId.B9mm, BulletId.Shell, BulletId.Mines]) {
      expect(BulletTypes[id].bounceSound).toBe(SoundEffect.NoSound);
    }
  });

  test("head/skull/bones kick with KickHead, the rest Hit", () => {
    const sounds = BodyPartTypes.map((b) => b.sound);
    expect(sounds[0]).toBe(SoundEffect.KickHead); // Head
    expect(sounds[7]).toBe(SoundEffect.KickHead); // BurnedChest
    expect(sounds[8]).toBe(SoundEffect.KickHead); // Skull
    expect(sounds[9]).toBe(SoundEffect.KickHead); // Bones
    expect(sounds[1]).toBe(SoundEffect.Hit);
    expect(sounds[2]).toBe(SoundEffect.Hit);
  });
});
