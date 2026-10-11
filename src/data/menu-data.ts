/**
 * Menu sprites and palettes (`CGameData`): the logos, the menu background, the
 * shop/statistics/victory screens and the shared `rectangle.pcx`. Loaded
 * separately from the in-game sprites because `CGameData` uses them before a
 * level exists.
 */

import { decodeEfp, decodeEfpPalette, decodePcx, isEfp, type IndexedImage } from "./efp";
import { fourMultiply, type Palette } from "./palette";

/** `CGameData::TPaletteNo`. */
export const enum PaletteNo {
  Menu = 0,
  EFLogo,
  TKLogo,
  Shop,
  Statistics,
  Victory,
}

/** `TMenuSpriteNo`. */
export interface MenuSprites {
  efLogo: IndexedImage;
  menuBackground: IndexedImage;
  tkLogo: IndexedImage;
  statisticsBack: IndexedImage;
  shopBackNormal: IndexedImage;
  shopBackHilite: IndexedImage;
  shopBackHollow: IndexedImage;
  rectangle: IndexedImage;
  victoryScreen: IndexedImage;
}

export interface MenuData {
  sprites: MenuSprites;
  /** Palettes indexed by `PaletteNo`. */
  palettes: Palette[];
}

interface SpriteFile {
  key: keyof MenuSprites;
  file: string;
  palette?: PaletteNo;
}

const SPRITE_FILES: readonly SpriteFile[] = [
  { key: "efLogo", file: "efps/eflogo.pcx", palette: PaletteNo.EFLogo },
  { key: "menuBackground", file: "efps/menu.pcx", palette: PaletteNo.Menu },
  { key: "tkLogo", file: "efps/bslogo.pcx", palette: PaletteNo.TKLogo },
  { key: "statisticsBack", file: "efps/staticsback.efp", palette: PaletteNo.Statistics },
  { key: "shopBackNormal", file: "efps/shopback_normal.efp", palette: PaletteNo.Shop },
  { key: "shopBackHilite", file: "efps/shopback_hilite.efp" },
  { key: "shopBackHollow", file: "efps/shopback_hollow.efp" },
  { key: "rectangle", file: "efps/rectangle.pcx" },
  { key: "victoryScreen", file: "efps/victory.pcx", palette: PaletteNo.Victory },
];

export async function loadMenuData(load: (path: string) => Promise<Uint8Array>): Promise<MenuData> {
  const sprites = {} as MenuSprites;
  const palettes: Palette[] = [];
  for (let i = 0; i < 6; i++) palettes.push(new Uint8Array(768) as Palette);

  for (const entry of SPRITE_FILES) {
    const bytes = await load(entry.file);
    const image = isEfp(bytes) ? decodeEfp(bytes) : decodePcx(bytes);
    sprites[entry.key] = image;
    if (entry.palette !== undefined) {
      const palette = decodeEfpPalette(bytes);
      if (isEfp(bytes)) fourMultiply(palette);
      palettes[entry.palette] = palette;
    }
  }

  return { sprites, palettes };
}
