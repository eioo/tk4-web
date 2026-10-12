import { describe, expect, test } from "bun:test";

import { GlibcRandom } from "../../core/rng";
import { BulletId, BulletTypes, WeaponId, WeaponTypes } from "../../sim/types";
import { SimPlayer } from "../../sim/world";
import {
  currentAmount,
  DynShopData,
  KItemsInCategories,
  KShieldCost,
  shieldPrice,
  shopBuy,
  shopSell,
} from "../shop";

function makePlayer(cash = 10000): SimPlayer {
  const p = new SimPlayer();
  p.cash = cash;
  p.weapons[WeaponId.Fist] = 1;
  p.bullets[BulletId.Fist] = 1;
  return p;
}

describe("CDynShopData selection", () => {
  test("categories and item counts match the reference", () => {
    expect(KItemsInCategories).toEqual([WeaponTypes.length - 1, BulletTypes.length - 2, 2]);
  });

  test("inc/dec wrap between categories", () => {
    const shop = new DynShopData();
    // Walk off the end of the weapons category into bullets.
    for (let a = 0; a < KItemsInCategories[0]; a++) shop.incItem();
    expect(shop.cat).toBe(1);
    expect(shop.item).toBe(0);
    // ...and back again.
    shop.decItem();
    expect(shop.cat).toBe(0);
    expect(shop.item).toBe(KItemsInCategories[0] - 1);
  });

  test("big steps keep the column and clamp at the last category", () => {
    const shop = new DynShopData();
    shop.item = 2;
    shop.bigIncItem();
    expect(shop.cat).toBe(0);
    expect(shop.item).toBe(10);
    for (let a = 0; a < 20; a++) shop.bigIncItem();
    expect(shop.cat).toBe(2);
    expect(shop.item).toBe(1);
  });

  test("updatePrices uses the reference discount formula", () => {
    const shop = new DynShopData();
    const rng = new GlibcRandom(1234);
    const expected = new GlibcRandom(1234);
    shop.updatePrices(rng);
    for (let a = 0; a < WeaponTypes.length - 1; a++) {
      const cost = WeaponTypes[a + 1].cost;
      expect(shop.weaponSellPrice[a]).toBe(
        Math.trunc(0.8 * cost - (expected.rand() % Math.trunc(cost / 2))),
      );
    }
  });
});

describe("CPlayer::ShopBuy / ShopSell", () => {
  test("buying a pistol deducts its cost", () => {
    const player = makePlayer(500);
    const shop = new DynShopData();
    shopBuy(player, shop, 1);
    expect(player.cash).toBe(500 - WeaponTypes[WeaponId.Pistol].cost);
    expect(player.weapons[WeaponId.Pistol]).toBe(1);
  });

  test("a single-hand weapon can be bought twice, no more", () => {
    const player = makePlayer(10000);
    const shop = new DynShopData();
    shopBuy(player, shop, 5);
    expect(player.weapons[WeaponId.Pistol]).toBe(WeaponTypes[WeaponId.Pistol].singleHand ? 2 : 1);
  });

  test("buying bullets adds the multiplier, capped at the maximum", () => {
    const player = makePlayer(10000);
    const shop = new DynShopData();
    shop.cat = 1;
    shop.item = BulletId.B9mm - 1;
    const t = BulletTypes[BulletId.B9mm];
    shopBuy(player, shop, 10000);
    expect(player.bullets[BulletId.B9mm]).toBe(t.maximumForPlayer * t.multiplier);
  });

  test("selling a weapon refunds the weapon sell price", () => {
    const player = makePlayer(0);
    player.weapons[WeaponId.Pistol] = 1;
    const shop = new DynShopData();
    shop.weaponSellPrice[WeaponId.Pistol - 1] = 321;
    shopSell(player, shop, 1);
    expect(player.weapons[WeaponId.Pistol]).toBe(0);
    expect(player.cash).toBe(321);
  });

  test("shield price rises with each point of shield", () => {
    const player = makePlayer(100000);
    const shop = new DynShopData();
    shop.cat = 2;
    shop.item = 0;
    expect(shieldPrice(0)).toBe(KShieldCost);
    shopBuy(player, shop, 3);
    expect(player.shield).toBe(3);
    expect(shieldPrice(3)).toBe(KShieldCost + 3 * 15);
    expect(player.cash).toBe(100000 - KShieldCost - (KShieldCost + 15) - (KShieldCost + 30));
  });

  test("target system is a one-off purchase", () => {
    const player = makePlayer(10000);
    const shop = new DynShopData();
    shop.cat = 2;
    shop.item = 1;
    shopBuy(player, shop, 5);
    expect(player.targetSystem).toBe(true);
    expect(player.cash).toBe(10000 - shop.targetPrice);
    shopSell(player, shop, 5);
    expect(player.targetSystem).toBe(false);
    expect(player.cash).toBe(10000);
  });

  test("currentAmount reports carried stock", () => {
    const player = makePlayer();
    player.weapons[WeaponId.Shotgun] = 1;
    player.bullets[BulletId.Shell] = 7;
    player.bullets[BulletId.Gas] = 20; // multiplier 10 => 2 units
    expect(currentAmount(player, 0, WeaponId.Shotgun - 1)).toBe(1);
    expect(currentAmount(player, 1, BulletId.Shell - 1)).toBe(7);
    expect(currentAmount(player, 1, BulletId.Gas - 1)).toBe(2);
  });
});
