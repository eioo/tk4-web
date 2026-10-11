/**
 * The seven system fonts (`CGameGraphicsInterface::iSystemFonts`) and the
 * "large text" scale toggle. A `FontHandle` bundles the decoded font with the
 * `iOneIsZero` flag and current scale, so `fontWrite` calls read like the
 * original `Font(font)->Write(...)`.
 */

import type { Font } from "../data/font";

/** `CGameGraphicsInterface::TGameFont`. */
export const enum GameFont {
  BigMenuFont = 0,
  BigMenuFontDark,
  BigMenuFontGray,
  SmallMenuFont,
  SmallMenuFontDark,
  SmallFont,
  ShopNumberFont,
  Amount,
}

export interface FontHandle {
  readonly font: Font;
  readonly oneIsZero: boolean;
  readonly scaleX: number;
  readonly scaleY: number;
}

interface FontSpec {
  file: string;
  oneIsZero: boolean;
}

/** File per font, in `TGameFont` order (`CGameGraphicsInterface` ctor). */
export const FONT_FILES: readonly FontSpec[] = [
  { file: "fnts/menu25x30light.fnt", oneIsZero: false },
  { file: "fnts/menu25x30dark.fnt", oneIsZero: false },
  { file: "fnts/menu25x30gray.fnt", oneIsZero: false },
  { file: "fnts/menu15x18light.fnt", oneIsZero: false },
  { file: "fnts/menu15x18dark.fnt", oneIsZero: false },
  { file: "fnts/8x8b.fnt", oneIsZero: true },
  { file: "fnts/snumbers.fnt", oneIsZero: false },
];

export class SystemFonts {
  private readonly fonts: Font[];
  private readonly oneIsZero: boolean[];
  private readonly scale: number[];

  constructor(fonts: Font[]) {
    this.fonts = fonts.slice(0, GameFont.Amount);
    this.oneIsZero = FONT_FILES.map((spec) => spec.oneIsZero);
    this.scale = Array.from({ length: GameFont.Amount }, () => 1);
  }

  get(font: GameFont): FontHandle {
    return {
      font: this.fonts[font],
      oneIsZero: this.oneIsZero[font],
      scaleX: this.scale[font],
      scaleY: this.scale[font],
    };
  }

  /** `CGameGraphicsInterface::UpdateLargeTextMode`. */
  updateLargeTextMode(large: boolean): void {
    this.scale[GameFont.SmallFont] = large ? 2 : 1;
  }
}
