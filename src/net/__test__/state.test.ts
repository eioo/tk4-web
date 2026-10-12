import { describe, expect, test } from "bun:test";

import { BulletId, WeaponId } from "../../sim/types";
import { makeStartPlayer } from "../../sim/world";
import { resolveNetUrl } from "../client";
import type { NetPlayerState } from "../protocol";
import { packNetPlayerState, playerFromNetState } from "../state";

describe("resolveNetUrl", () => {
  test("derives a same-origin ws url", () => {
    expect(resolveNetUrl("", { protocol: "http:", host: "localhost:5173" })).toBe(
      "ws://localhost:5173/ws",
    );
    expect(resolveNetUrl("?x=1", { protocol: "https:", host: "tk4.space" })).toBe(
      "wss://tk4.space/ws",
    );
  });

  test("honours the ?net override", () => {
    expect(
      resolveNetUrl("?net=ws://example.com:9000/sock", { protocol: "https:", host: "tk4.space" }),
    ).toBe("ws://example.com:9000/sock");
  });
});

describe("player state conversion", () => {
  test("a null state yields the fresh start loadout", () => {
    const player = playerFromNetState(null, "John");
    expect(player.name).toBe("John");
    expect(player.cash).toBe(500);
    expect(player.weapons[WeaponId.Fist]).toBe(1);
    expect(player.bullets[BulletId.Fist]).toBe(1);
    expect(player.curWeapon).toBe(WeaponId.Fist);
  });

  test("round-trips the persistent fields", () => {
    const player = makeStartPlayer();
    player.name = "Paul";
    player.cash = 1234;
    player.shield = 30;
    player.curWeapon = WeaponId.Pistol;
    player.secWeapon = WeaponId.Fist;
    player.weapons[WeaponId.Pistol] = 1;
    player.bullets[BulletId.B9mm] = 42;

    const packed = packNetPlayerState(player, 7);
    const restored = playerFromNetState(packed, "ignored");

    expect(restored.name).toBe("Paul");
    expect(restored.cash).toBe(1234);
    expect(restored.shield).toBe(30);
    expect(restored.curWeapon).toBe(WeaponId.Pistol);
    expect(restored.secWeapon).toBe(WeaponId.Fist);
    expect(restored.weapons[WeaponId.Pistol]).toBe(1);
    expect(restored.bullets[BulletId.B9mm]).toBe(42);
    expect(packed.frags).toBe(7);
  });

  test("pads short arrays from the wire", () => {
    const state: NetPlayerState = {
      name: "X",
      cash: 0,
      weapons: [],
      bullets: [],
      shield: 0,
      curWeapon: 0,
      secWeapon: 0,
      frags: 0,
    };
    const player = playerFromNetState(state, "X");
    expect(player.weapons).toHaveLength(13);
    expect(player.bullets).toHaveLength(12);
    expect(player.weapons.every((w) => w === 0)).toBe(true);
  });
});
