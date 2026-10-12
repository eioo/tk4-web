/**
 * `CGameSubStateShop` + `CDynShopData` — the between-levels shop.
 *
 * The browser has no dirty-area system, so the static background is redrawn
 * every frame instead of being cached in a `iBackgroundPicture`; the visible
 * result is the same. Pricing, selection wrapping and the buy/sell rules are
 * ported from `CDynShopData` / `CPlayer::ShopBuy` / `CPlayer::ShopSell`.
 */

import type { GlibcRandom } from "../core/rng";
import { fontWrite, HAlign, VAlign } from "../data/font";
import type { MenuData } from "../data/menu-data";
import type { Framebuffer } from "../render/fb";
import { BulletTypes, EWeaponAmount, WeaponTypes } from "../sim/types";
import type { SimPlayer } from "../sim/world";
import { GameFont, type SystemFonts } from "./fonts";

const KSHOP_INSTRUCTION_LINE0 = "Press ESC to exit the shop.";
const KSHOP_INSTRUCTION_LINE1 =
  "Press ARROWS to navigate. RETURN to buy item, BACKSPACE to sell item";
const KSHOP_INSTRUCTION_LINE2 = "Press PAGEUP to buy 25 items and PAGEDOWN to sell 25 items";
const KSHOP_TITLE = "The Shop";

const KSHOP_DESCRIPTION_START_Y = 10;
const KSHOPITEMS_START_X = 5;
const KSHOPITEMS_START_Y = 78;
const KSHOPITEM_SPRITE_WIDTH = 70;
const KSHOPITEM_SPRITE_HEIGHT = 50;
const KSHOPITEM_NEXT_SPRITE_START_X = KSHOPITEM_SPRITE_WIDTH + 10;
const KSHOPITEM_NEXT_SPRITE_START_Y = KSHOPITEM_SPRITE_HEIGHT + 10;
const KSHOP_NEXT_CATEGORY_START = 126;

/** `KCategories`. */
export const KCategories = 3;
/** `KItemsInCategories`. */
export const KItemsInCategories: readonly number[] = [EWeaponAmount - 1, BulletTypes.length - 2, 2];

/** `CBasicShield::Cost` / `Maximum`. */
export const KShieldCost = 160;
export const KShieldMaximum = 30;

/** `CPlayer::ShieldPrice`. */
export function shieldPrice(shield: number): number {
  return KShieldCost + shield * 15;
}

/** `CDynShopData`. */
export class DynShopData {
  cat = 0;
  item = 0;
  player = 0;
  playerDone = false;
  private skipOnce = false;

  weaponSellPrice: number[] = Array.from({ length: EWeaponAmount - 1 }, () => 0);
  shieldSellPrice = 0;
  targetSellPrice = 0;
  targetPrice = 500;

  resetSelection(): void {
    this.cat = 0;
    this.item = 0;
  }

  incItem(): void {
    this.item++;
    this.alignItemAndCat(false);
  }

  decItem(): void {
    this.item--;
    this.alignItemAndCat(false);
  }

  bigIncItem(): void {
    this.item += 8;
    this.alignItemAndCat(true);
  }

  bigDecItem(): void {
    this.item -= 8;
    this.alignItemAndCat(true);
  }

  /** `CDynShopData::AlignItemAndCat`. */
  private alignItemAndCat(bigStep: boolean): void {
    const items = KItemsInCategories;

    if (this.item >= items[this.cat]) {
      if (this.cat < KCategories - 1) {
        if (!(bigStep && (this.item & 7) >= (items[this.cat] & 7))) {
          this.cat++;
          if (bigStep) this.item &= 0x7;
          else this.item = 0;
        }
        if (this.item >= items[this.cat]) this.item = items[this.cat] - 1;
      } else {
        this.item = items[this.cat] - 1;
      }
    }

    if (this.item < 0) {
      if (this.cat) {
        this.cat--;
        this.item = 8 + this.item + (items[this.cat] & 0xf8);
        if (this.item >= items[this.cat]) this.item = items[this.cat] - 1;
      } else {
        this.item = 0;
      }
    }
  }

  /** `CDynShopData::UpdatePrices`. */
  updatePrices(rng: GlibcRandom): void {
    for (let a = 0; a < EWeaponAmount - 1; a++) {
      const cost = WeaponTypes[a + 1].cost;
      this.weaponSellPrice[a] = Math.trunc(0.8 * cost - (rng.rand() % Math.trunc(cost / 2)));
    }
    this.shieldSellPrice = Math.trunc(
      0.8 * KShieldCost - (rng.rand() % Math.trunc(KShieldCost / 2)),
    );
    this.targetSellPrice = Math.trunc(
      0.8 * this.targetPrice - (rng.rand() % Math.trunc(this.targetPrice / 2)),
    );
  }

  setSkipOnce(): void {
    this.skipOnce = true;
  }

  takeSkipOnce(): boolean {
    if (!this.skipOnce) return false;
    this.skipOnce = false;
    return true;
  }
}

/** `CPlayer::ShopBuy`. */
export function shopBuy(player: SimPlayer, shop: DynShopData, amount: number): void {
  for (let a = 0; a < amount; a++) {
    if (shop.cat === 0) {
      const t = WeaponTypes[shop.item + 1];
      if (t.cost > player.cash) return;
      if (player.weapons[shop.item + 1] < (t.singleHand ? 2 : 1)) {
        player.cash -= t.cost;
        player.weapons[shop.item + 1]++;
      } else return;
    }
    if (shop.cat === 1) {
      const t = BulletTypes[shop.item + 1];
      if (t.cost > player.cash) return;
      if (player.bullets[shop.item + 1] < t.maximumForPlayer * t.multiplier) {
        player.cash -= t.cost;
        player.bullets[shop.item + 1] += t.multiplier;
      } else return;
    }
    if (shop.cat === 2 && shop.item === 0) {
      if (shieldPrice(player.shield) > player.cash) return;
      if (player.shield < KShieldMaximum) {
        player.cash -= shieldPrice(player.shield);
        player.shield++;
      } else return;
    }
    if (shop.cat === 2 && shop.item === 1) {
      if (shop.targetPrice > player.cash) return;
      if (!player.targetSystem) {
        player.cash -= shop.targetPrice;
        player.targetSystem = true;
      } else return;
    }
  }
}

/** `CPlayer::ShopSell`. */
export function shopSell(player: SimPlayer, shop: DynShopData, amount: number): void {
  for (let a = 0; a < amount; a++) {
    if (shop.cat === 0) {
      if (player.weapons[shop.item + 1]) {
        player.cash += shop.weaponSellPrice[shop.item];
        player.weapons[shop.item + 1]--;
      } else return;
    }
    if (shop.cat === 1) {
      if (player.bullets[shop.item + 1] > 0) {
        const t = BulletTypes[shop.item + 1];
        player.cash += t.cost;
        player.bullets[shop.item + 1] -= t.multiplier;
        if (player.bullets[shop.item + 1] < 0) player.bullets[shop.item + 1] = 0;
      } else return;
    }
    if (shop.cat === 2 && shop.item === 0) {
      if (player.shield) {
        player.cash += Math.trunc(shieldPrice(player.shield) / 2);
        player.shield--;
      } else return;
    }
    if (shop.cat === 2 && shop.item === 1) {
      if (player.targetSystem) {
        player.cash += shop.targetPrice;
        player.targetSystem = false;
      } else return;
    }
  }
}

/** Amount of `cat`/`item` the player currently carries (`CDynGameStateShop::Draw`). */
export function currentAmount(player: SimPlayer, cat: number, item: number): number {
  if (cat === 0) return player.weapons[item + 1];
  if (cat === 1) return Math.trunc(player.bullets[item + 1] / BulletTypes[item + 1].multiplier);
  return item === 0 ? player.shield : player.targetSystem ? 1 : 0;
}

function copyRegion(
  fb: Framebuffer,
  img: { width: number; pixels: Uint8Array },
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  for (let row = 0; row < h; row++) {
    const src = (y + row) * img.width + x;
    fb.pixels.set(img.pixels.subarray(src, src + w), (y + row) * fb.width + x);
  }
}

function blitTransparent(
  fb: Framebuffer,
  img: { width: number; height: number; pixels: Uint8Array },
  dx: number,
  dy: number,
  transparent: number,
): void {
  for (let row = 0; row < img.height; row++) {
    const py = dy + row;
    if (py < 0 || py >= fb.height) continue;
    for (let col = 0; col < img.width; col++) {
      const c = img.pixels[row * img.width + col];
      if (c === transparent) continue;
      const px = dx + col;
      if (px < 0 || px >= fb.width) continue;
      fb.pixels[py * fb.width + px] = c;
    }
  }
}

export interface ShopContext {
  readonly fb: Framebuffer;
  readonly menuData: MenuData;
  readonly fonts: SystemFonts;
  readonly player: SimPlayer;
  readonly playerName: string;
}

/** `CGameSubStateShop::DrawStaticToBackground` + `Draw`. */
export function drawShop(ctx: ShopContext, shop: DynShopData): void {
  const { fb, menuData, fonts, player } = ctx;
  const small = fonts.get(GameFont.SmallMenuFontDark);
  const big = fonts.get(GameFont.BigMenuFont);

  fb.pixels.set(menuData.sprites.shopBackNormal.pixels);

  fontWrite(
    big.font,
    fb,
    Math.trunc(fb.width / 2),
    10,
    KSHOP_TITLE,
    VAlign.Below,
    HAlign.InMiddle,
    big.oneIsZero,
    big.scaleX,
    big.scaleY,
  );

  const lineY = fb.height - small.font.height * 3;
  fontWrite(
    small.font,
    fb,
    KSHOPITEMS_START_X,
    lineY,
    KSHOP_INSTRUCTION_LINE0,
    VAlign.Below,
    HAlign.ToRight,
    small.oneIsZero,
    small.scaleX,
    small.scaleY,
  );
  fontWrite(
    small.font,
    fb,
    KSHOPITEMS_START_X,
    lineY + small.font.height,
    KSHOP_INSTRUCTION_LINE1,
    VAlign.Below,
    HAlign.ToRight,
    small.oneIsZero,
    small.scaleX,
    small.scaleY,
  );
  fontWrite(
    small.font,
    fb,
    KSHOPITEMS_START_X,
    lineY + small.font.height * 2,
    KSHOP_INSTRUCTION_LINE2,
    VAlign.Below,
    HAlign.ToRight,
    small.oneIsZero,
    small.scaleX,
    small.scaleY,
  );

  const playerText =
    ctx.playerName.length > 0
      ? `Player ${shop.player + 1}: ${ctx.playerName}`
      : `Player ${shop.player + 1}`;
  fontWrite(
    small.font,
    fb,
    fb.width - KSHOPITEMS_START_X,
    KSHOP_DESCRIPTION_START_Y + small.font.height,
    playerText,
    VAlign.Below,
    HAlign.ToLeft,
    small.oneIsZero,
    small.scaleX,
    small.scaleY,
  );

  for (let cat = 0; cat < KCategories; cat++) {
    for (let item = 0; item < KItemsInCategories[cat]; item++) {
      const y =
        KSHOPITEMS_START_Y +
        cat * KSHOP_NEXT_CATEGORY_START +
        (item >> 3) * KSHOPITEM_NEXT_SPRITE_START_Y;
      const x = KSHOPITEMS_START_X + (item & 7) * KSHOPITEM_NEXT_SPRITE_START_X;
      const amount = currentAmount(player, cat, item);

      if (amount > 0) {
        copyRegion(
          fb,
          menuData.sprites.shopBackHilite,
          x,
          y,
          KSHOPITEM_SPRITE_WIDTH,
          KSHOPITEM_SPRITE_HEIGHT,
        );
      } else if (isTooExpensive(player, shop, cat, item)) {
        copyRegion(
          fb,
          menuData.sprites.shopBackHollow,
          x,
          y,
          KSHOPITEM_SPRITE_WIDTH,
          KSHOPITEM_SPRITE_HEIGHT,
        );
      }

      if (cat === shop.cat && item === shop.item) {
        blitTransparent(fb, menuData.sprites.rectangle, x - 5, y - 5, 0);
      }

      drawWareInfo(fb, fonts, player, shop);

      if (amount > 0) {
        fontWrite(
          small.font,
          fb,
          x + KSHOPITEM_SPRITE_WIDTH,
          y + KSHOPITEM_SPRITE_HEIGHT,
          String(amount),
          VAlign.Above,
          HAlign.ToLeft,
          small.oneIsZero,
          small.scaleX,
          small.scaleY,
        );
      }
    }
  }

  fontWrite(
    small.font,
    fb,
    fb.width - KSHOPITEMS_START_X,
    KSHOP_DESCRIPTION_START_Y,
    `Your cash: ${player.cash}`,
    VAlign.Below,
    HAlign.ToLeft,
    small.oneIsZero,
    small.scaleX,
    small.scaleY,
  );
}

/** Reference condition for the hollow sprite: item is *unaffordable*. */
function isTooExpensive(player: SimPlayer, shop: DynShopData, cat: number, item: number): boolean {
  if (cat === 0) return WeaponTypes[item + 1].cost > player.cash;
  if (cat === 1) return BulletTypes[item + 1].cost > player.cash;
  if (item === 0) return shieldPrice(player.shield) > player.cash;
  return shop.targetPrice > player.cash;
}

/** `CGameSubStateShop::DrawWareInfo`. */
function drawWareInfo(
  fb: Framebuffer,
  fonts: SystemFonts,
  player: SimPlayer,
  shop: DynShopData,
): void {
  const font = fonts.get(GameFont.SmallMenuFontDark);
  const x = KSHOPITEMS_START_X;
  const y = KSHOP_DESCRIPTION_START_Y;
  const write = (dy: number, text: string): void => {
    fontWrite(
      font.font,
      fb,
      x,
      y + dy,
      text,
      VAlign.Below,
      HAlign.ToRight,
      font.oneIsZero,
      font.scaleX,
      font.scaleY,
    );
  };

  if (shop.cat === 0) {
    const t = WeaponTypes[shop.item + 1];
    write(0, t.name);
    write(20, `Cost: ${t.cost}`);
    write(30, `Sell price: ${shop.weaponSellPrice[shop.item]}`);
    write(40, `Bullet type: ${BulletTypes[t.bulletType].name}`);
    return;
  }
  if (shop.cat === 1) {
    const t = BulletTypes[shop.item + 1];
    write(0, t.name);
    write(20, `Cost: ${t.cost}`);
    return;
  }
  if (shop.cat === 2 && shop.item === 0) {
    write(0, "Shield");
    write(20, `Cost: ${shieldPrice(player.shield)}`);
    write(30, `Sell price: ${shop.shieldSellPrice + Math.trunc(shieldPrice(player.shield) / 2)}`);
    return;
  }
  if (shop.cat === 2 && shop.item === 1) {
    write(0, "Target system");
    write(20, `Cost: ${shop.targetPrice}`);
    write(30, `Sell price: ${shop.targetSellPrice}`);
  }
}
