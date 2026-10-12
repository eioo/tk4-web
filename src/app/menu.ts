/**
 * Menu framework and menu trees (`CGameMenuBase`/`CGameMenuContainer`/
 * `CGameMenuItem` and `Menu.cpp`/`MenuItems.cpp`).
 *
 * The original draws into a dirty-rect list; this port always repaints the full
 * buffer, so the dirty-area bookkeeping is dropped and `Draw` simply blits the
 * background over the whole surface and then the items. `iSkipDraw` is kept
 * because it suppresses the menu for the frame that starts the game.
 */

import { fontWrite, HAlign, VAlign } from "../data/font";
import type { Framebuffer } from "../render/fb";
import type { Rect } from "../render/rect";
import { SystemFonts, GameFont, type FontHandle } from "./fonts";
import { keyToStr, SDLK } from "./keys";
import {
  KMaxLocalPlayers,
  KMouseSensitivityMax,
  KMouseSensitivityMin,
  KMouseSensitivityStep,
  KEY_TEXT,
  Options,
  TPlayerKeys,
  KPlayerNameMaxLength,
  KMusicVolumeMax,
  KMusicVolumeMin,
  KMusicVolumeStep,
  KEffectVolumeMax,
  KEffectVolumeMin,
  KEffectVolumeStep,
  DEFAULT_MUSICTHEME,
} from "./options";
import { KGameVersion } from "./version";

export const enum MenuState {
  Quit = -1,
  AudioOptions = 0,
  DeathMatchOptions,
  EpisodeSelect,
  GameOptions,
  Main,
  Multiplay,
  Options,
  PlayerOptions1,
  PlayerOptions2,
  PlayerOptions3,
  PlayerOptions4,
  ChangeKeys1,
  ChangeKeys2,
  ChangeKeys3,
  ChangeKeys4,
  NetOptions,
  Amount,
}

export const enum MenuAction {
  Processed = 0,
  Exit,
  NotProcessed,
}

export interface KeyPress {
  sym: number;
  unicode: number;
}

const MENUTEXT_VERTSEPARATION = 35;
const PARAM_SEPARATION = 5;
const KMenuItemRandomMin = 2;
const KMenuItemRandom = 16;
const KMenuItemVaimennus = 3;
const KBoolCatStr = ["off", "on"];
const KMaxEpisodeInList = 8;
const KKeySelectionText = "*Press a key*";

/** The host surface and controller the menus talk to (`CGameMenuContainer`). */
export interface MenuHost {
  options(): Options;
  fonts(): SystemFonts;
  buffer(): Framebuffer;
  playerName(index: number): string;
  setPlayerName(index: number, value: string): void;
  mouseModeText(): string;
  gameModeName(index: number): string;
  gameModeCount(): number;
  gameModeStartFromAnyLevel(index: number): boolean;
  gameModeDMEpisodes(index: number): boolean;
  changeState(state: MenuState): void;
  skipDrawOnce(): void;
  doFullRedraw(): void;
  valueUpdated(item: MenuItem): void;
  addMessage(message: string): void;
  execSingleGame(episode: number): void;
  execMultiplay(): void;
  rand(maxExclusive: number): number;
  timerCounter(): number;
  fullScreenChanged(): void;
  updateLargeTextMode(large: boolean): void;
  updateAudioChanges(): void;
  updateGammaChanges(): void;
  cycleResolution(forward: boolean): void;
  saveOptions(): void;
  optionsReset(): void;
  requestQuit(): void;
}

function bool(
  get: () => boolean,
  set: (v: boolean) => void,
): { get(): boolean; set(v: boolean): void } {
  return { get, set };
}

function num(get: () => number, set: (v: number) => void): { get(): number; set(v: number): void } {
  return { get, set };
}

/** `CGameMenuBase`. */
export abstract class MenuBase {
  protected readonly items: MenuItem[] = [];
  protected activeItem = 0;

  constructor(readonly host: MenuHost) {}

  abstract prevMenu(): MenuState;

  get background(): Framebuffer {
    return this.host.buffer();
  }

  activateMenu(): void {
    while (!this.items[this.activeItem].isEnabled() || !this.items[this.activeItem].isActive()) {
      this.activeItem++;
    }
    this.items[this.activeItem].activate();
  }

  /** `HandleKeyPress`; returns whether the key was consumed. */
  protected handleKeyPress(key: KeyPress): MenuAction {
    const ret = this.items[this.activeItem].handleKeyPress(key);
    switch (ret) {
      case MenuAction.Exit:
        this.host.changeState(this.prevMenu());
        return MenuAction.Exit;
      case MenuAction.Processed:
        return MenuAction.Processed;
      case MenuAction.NotProcessed:
        break;
    }

    const pl1 = this.host.options().data.keys[0];
    if (key.sym === SDLK.ESCAPE) {
      this.host.changeState(this.prevMenu());
      return MenuAction.Processed;
    }

    if (key.sym === SDLK.DOWN || key.sym === pl1[TPlayerKeys.DOWN]) {
      do {
        this.activeItem = (this.activeItem + 1) % this.items.length;
      } while (!this.items[this.activeItem].isEnabled() || !this.items[this.activeItem].isActive());
      this.items[this.activeItem].activate();
      return MenuAction.Processed;
    }

    if (key.sym === SDLK.UP || key.sym === pl1[TPlayerKeys.UP]) {
      do {
        this.activeItem--;
        if (this.activeItem < 0) this.activeItem += this.items.length;
      } while (!this.items[this.activeItem].isEnabled() || !this.items[this.activeItem].isActive());
      this.items[this.activeItem].activate();
      return MenuAction.Processed;
    }

    return MenuAction.NotProcessed;
  }

  runMenu(key: KeyPress | null): boolean {
    if (key === null) return false;
    return this.handleKeyPress(key) !== MenuAction.NotProcessed;
  }

  /** `CGameMenuBase::Draw` — background is already blitted by the container. */
  draw(): void {
    const buffer = this.host.buffer();
    const fonts = this.host.fonts();
    for (let a = 0; a < this.items.length; a++) {
      const y =
        Math.trunc(buffer.height / 2) +
        (a - Math.trunc(this.items.length / 2)) * MENUTEXT_VERTSEPARATION;
      this.items[a].beginDraw();
      this.items[a].draw(
        fonts,
        buffer,
        Math.trunc(buffer.width / 2),
        y,
        this.activeItem === a ? 1 : 0,
      );
    }

    // `CGameMenuBase::Draw` paints the version in the bottom-left corner.
    const version = fonts.get(GameFont.SmallMenuFontDark);
    fontWrite(
      version.font,
      buffer,
      0,
      buffer.height,
      KGameVersion,
      VAlign.Above,
      HAlign.ToRight,
      version.oneIsZero,
      version.scaleX,
      version.scaleY,
    );
  }

  valueUpdated(item: MenuItem): void {
    this.host.valueUpdated(item);
  }
}

/** `CGameMenuItem`. */
export abstract class MenuItem {
  protected text: string | null;
  protected paramStr: string | null = null;
  protected enabled = true;
  protected notActiveItem = false;
  protected displaceCounter = 0;
  private displaceX = 0;
  private displaceY = 0;
  private displaceTimerValue = 0;

  constructor(
    readonly parent: MenuBase,
    text: string | null,
  ) {
    this.text = text;
  }

  handleKeyPress(_key: KeyPress): MenuAction {
    return MenuAction.NotProcessed;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isActive(): boolean {
    return !this.notActiveItem;
  }

  activate(): void {
    this.displaceCounter = 0;
  }

  /** `CGameMenuItem::Draw`'s leading `iDisplaceCounter++`. */
  beginDraw(): void {
    this.displaceCounter++;
  }

  abstract draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect;

  protected setText(text: string | null): void {
    this.text = text;
  }

  private newDisplace(): void {
    const timer = this.parent.host.timerCounter();
    const delay = 0;
    if (this.displaceTimerValue > timer || this.displaceTimerValue + delay < timer) {
      const host = this.parent.host;
      const damp = 1 + Math.trunc(this.displaceCounter / KMenuItemVaimennus);
      this.displaceX =
        host.rand(KMenuItemRandomMin * 2 + 1) -
        KMenuItemRandomMin +
        Math.trunc((host.rand(KMenuItemRandom * 4 + 1) - KMenuItemRandom * 2) / damp);
      this.displaceY =
        host.rand(KMenuItemRandomMin * 2 + 1) -
        KMenuItemRandomMin +
        Math.trunc((host.rand(KMenuItemRandom * 2 + 1) - KMenuItemRandom) / damp);
      this.displaceTimerValue = timer;
    }
  }

  protected menuXDisplace(active: number): number {
    if (!active) return 0;
    this.newDisplace();
    return this.displaceX;
  }

  protected menuYDisplace(active: number): number {
    if (!active) return 0;
    this.newDisplace();
    return this.displaceY;
  }

  private pl1(): number[] {
    return this.parent.host.options().data.keys[0];
  }

  protected leftKey(key: KeyPress): boolean {
    const k = this.pl1();
    return (
      key.sym === SDLK.LEFT || key.sym === k[TPlayerKeys.LEFT] || key.sym === k[TPlayerKeys.LSTRAFE]
    );
  }

  protected rightKey(key: KeyPress): boolean {
    const k = this.pl1();
    return (
      key.sym === SDLK.RIGHT ||
      key.sym === k[TPlayerKeys.RIGHT] ||
      key.sym === k[TPlayerKeys.RSTRAFE]
    );
  }

  protected actionKey(key: KeyPress): boolean {
    return (
      key.sym === SDLK.RETURN || key.sym === SDLK.SPACE || key.sym === this.pl1()[TPlayerKeys.SHOOT]
    );
  }

  protected anyKey(key: KeyPress): boolean {
    return this.leftKey(key) || this.rightKey(key) || this.actionKey(key);
  }

  /** Default item draw (plain text, active = big light font). */
  protected drawText(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    if (this.text === null) return { left: 0, top: 0, right: 0, bottom: 0 };
    if (!this.enabled) {
      return this.write(
        fonts.get(GameFont.BigMenuFontGray),
        buffer,
        x,
        y,
        this.text,
        VAlign.Below,
        HAlign.InMiddle,
      );
    }
    if (active || this.notActiveItem) {
      return this.write(
        fonts.get(GameFont.BigMenuFont),
        buffer,
        x + this.menuXDisplace(active),
        y + this.menuYDisplace(active),
        this.text,
        VAlign.Below,
        HAlign.InMiddle,
      );
    }
    return this.write(
      fonts.get(GameFont.BigMenuFontDark),
      buffer,
      x,
      y,
      this.text,
      VAlign.Below,
      HAlign.InMiddle,
    );
  }

  /** `fontWrite` helper applying the handle's scale. */
  protected write(
    handle: FontHandle,
    buffer: Framebuffer,
    x: number,
    y: number,
    text: string,
    vAlign: VAlign,
    hAlign: HAlign,
  ): Rect {
    return fontWrite(
      handle.font,
      buffer,
      x,
      y,
      text,
      vAlign,
      hAlign,
      handle.oneIsZero,
      handle.scaleX,
      handle.scaleY,
    );
  }
}

/** `CGameMenuItemTitle`. */
export class TitleItem extends MenuItem {
  constructor(parent: MenuBase, text: string) {
    super(parent, text.toUpperCase());
    this.notActiveItem = true;
  }

  override draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    return this.drawText(fonts, buffer, x, y, active);
  }
}

/** `CGameMenuItemStartMenu`. */
export class StartMenuItem extends MenuItem {
  constructor(
    parent: MenuBase,
    text: string,
    private readonly next: MenuState,
  ) {
    super(parent, text);
  }

  override handleKeyPress(key: KeyPress): MenuAction {
    if (this.actionKey(key)) {
      this.parent.host.changeState(this.next);
      return MenuAction.Processed;
    }
    return MenuAction.NotProcessed;
  }

  override draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    return this.drawText(fonts, buffer, x, y, active);
  }
}

/** `CGameMenuItemExit`. */
export class ExitItem extends MenuItem {
  override handleKeyPress(key: KeyPress): MenuAction {
    return this.actionKey(key) ? MenuAction.Exit : MenuAction.NotProcessed;
  }

  override draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    return this.drawText(fonts, buffer, x, y, active);
  }
}

/** `CGameMenuItemResetOptions`. */
export class ResetOptionsItem extends MenuItem {
  override handleKeyPress(key: KeyPress): MenuAction {
    if (this.actionKey(key)) {
      this.parent.host.optionsReset();
      this.parent.host.addMessage("Options reset!");
      return MenuAction.Processed;
    }
    return MenuAction.NotProcessed;
  }

  override draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    return this.drawText(fonts, buffer, x, y, active);
  }
}

/** `CGameMenuItemExecSingleGame`. */
export class ExecSingleGameItem extends MenuItem {
  constructor(
    parent: MenuBase,
    text: string,
    private episode: number,
  ) {
    super(parent, text);
  }

  setEpisodeNo(value: number): void {
    this.episode = value;
  }

  setEpisodeName(name: string): void {
    this.setText(name);
  }

  override handleKeyPress(key: KeyPress): MenuAction {
    if (this.actionKey(key)) {
      this.parent.host.execSingleGame(this.episode);
      this.parent.host.skipDrawOnce();
      return MenuAction.Exit;
    }
    return MenuAction.NotProcessed;
  }

  override draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    return this.drawText(fonts, buffer, x, y, active);
  }
}

/** `CGameMenuItemExecMultiplay`. */
export class ExecMultiplayItem extends MenuItem {
  override handleKeyPress(key: KeyPress): MenuAction {
    if (this.actionKey(key)) {
      this.parent.host.execMultiplay();
      this.parent.host.skipDrawOnce();
      return MenuAction.Exit;
    }
    return MenuAction.NotProcessed;
  }

  override draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    return this.drawText(fonts, buffer, x, y, active);
  }
}

/** `CGameMenuItemBoolean` and its subclasses. */
export class BooleanItem extends MenuItem {
  constructor(
    parent: MenuBase,
    paramStr: string,
    protected value: { get(): boolean; set(v: boolean): void },
  ) {
    super(parent, null);
    this.paramStr = paramStr;
    this.updateText();
  }

  protected updateText(): void {
    this.setText(`${this.paramStr} ${KBoolCatStr[this.value.get() ? 1 : 0]}`);
  }

  override handleKeyPress(key: KeyPress): MenuAction {
    if (this.anyKey(key)) {
      this.value.set(!this.value.get());
      return MenuAction.Processed;
    }
    return MenuAction.NotProcessed;
  }

  override draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    this.updateText();
    return this.drawText(fonts, buffer, x, y, active);
  }
}

/** `CGameMenuItemPercent`. */
export class PercentItem extends MenuItem {
  constructor(
    parent: MenuBase,
    paramStr: string,
    private readonly value: { get(): number; set(v: number): void },
    private readonly low: number,
    private readonly high: number,
    private readonly step: number,
  ) {
    super(parent, null);
    this.paramStr = paramStr;
    this.updateText();
  }

  private updateText(): void {
    let v = this.value.get();
    if (v < this.low) {
      v = this.low;
      this.value.set(v);
    }
    if (v > this.high) {
      v = this.high;
      this.value.set(v);
    }
    this.setText(`${this.paramStr} ${Math.round(v * 100)}%`);
  }

  override handleKeyPress(key: KeyPress): MenuAction {
    if (this.leftKey(key)) {
      this.value.set(this.value.get() - this.step);
      this.updateText();
      this.parent.valueUpdated(this);
      return MenuAction.Processed;
    }
    if (this.rightKey(key)) {
      this.value.set(this.value.get() + this.step);
      this.updateText();
      this.parent.valueUpdated(this);
      return MenuAction.Processed;
    }
    return MenuAction.NotProcessed;
  }

  override draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    this.updateText();
    return this.drawText(fonts, buffer, x, y, active);
  }
}

/** `CGameMenuItemMouseMode` — two-part label, cycles 0..4. */
export class MouseModeItem extends MenuItem {
  override handleKeyPress(key: KeyPress): MenuAction {
    const data = this.parent.host.options().data;
    if (this.actionKey(key) || this.rightKey(key)) {
      data.mouseMode = (data.mouseMode + 1) % 5;
      return MenuAction.Processed;
    }
    if (this.leftKey(key)) {
      data.mouseMode--;
      if (data.mouseMode < 0) data.mouseMode = 4;
      return MenuAction.Processed;
    }
    return MenuAction.NotProcessed;
  }

  override draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    const xadd = this.menuXDisplace(active);
    const yadd = this.menuYDisplace(active);
    const value = this.parent.host.mouseModeText();
    const light = active || this.notActiveItem;
    const left = fonts.get(light ? GameFont.BigMenuFont : GameFont.BigMenuFontDark);
    const right = left;
    const lx = light ? x - PARAM_SEPARATION + xadd : x - PARAM_SEPARATION;
    const rx = light ? x + PARAM_SEPARATION + xadd : x + PARAM_SEPARATION;
    const ly = light ? y + yadd : y;
    const first = this.write(left, buffer, lx, ly, this.text ?? "", VAlign.Below, HAlign.ToLeft);
    const second = this.write(right, buffer, rx, ly, value, VAlign.Below, HAlign.ToRight);
    return union(first, second);
  }
}

/** `CGameMenuItemMusicTheme`. */
export class MusicThemeItem extends MenuItem {
  private selected = 0;

  constructor(parent: MenuBase, paramStr: string) {
    super(parent, paramStr);
    const opt = parent.host.options();
    const themes = opt.musicThemes;
    let idx = themes.indexOf(opt.data.musicTheme);
    if (idx === -1) idx = Math.max(themes.indexOf(DEFAULT_MUSICTHEME), 0);
    this.selected = idx;
  }

  private updateText(): void {
    const opt = this.parent.host.options();
    if (this.selected < 0) this.selected = opt.musicThemes.length - 1;
    if (this.selected >= opt.musicThemes.length) this.selected = 0;
    opt.data.musicTheme = opt.musicThemes[this.selected];
  }

  override handleKeyPress(key: KeyPress): MenuAction {
    if (this.leftKey(key)) {
      this.selected--;
      this.updateText();
      return MenuAction.Processed;
    }
    if (this.rightKey(key) || this.actionKey(key)) {
      this.selected++;
      this.updateText();
      return MenuAction.Processed;
    }
    return MenuAction.NotProcessed;
  }

  override draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    const xadd = this.menuXDisplace(active);
    const yadd = this.menuYDisplace(active);
    const theme = this.parent.host.options().data.musicTheme;
    const light = active || this.notActiveItem;
    const handle = fonts.get(light ? GameFont.BigMenuFont : GameFont.BigMenuFontDark);
    const lx = light ? x - PARAM_SEPARATION + xadd : x - PARAM_SEPARATION;
    const rx = light ? x + PARAM_SEPARATION + xadd : x + PARAM_SEPARATION;
    const ly = light ? y + yadd : y;
    const first = this.write(handle, buffer, lx, ly, this.text ?? "", VAlign.Below, HAlign.ToLeft);
    const second = this.write(handle, buffer, rx, ly, theme, VAlign.Below, HAlign.ToRight);
    return union(first, second);
  }
}

/** `CGameMenuItemString` — editable text field. */
export class StringItem extends MenuItem {
  private inputMode = 0;

  constructor(
    parent: MenuBase,
    title: string,
    private readonly get: () => string,
    private readonly set: (v: string) => void,
    private readonly maxLen: number,
  ) {
    super(parent, title);
  }

  override handleKeyPress(key: KeyPress): MenuAction {
    if (!this.inputMode) {
      if (this.actionKey(key)) {
        this.inputMode = 1;
        return MenuAction.Processed;
      }
      return MenuAction.NotProcessed;
    }
    if (key.sym === SDLK.RETURN || key.sym === SDLK.ESCAPE) {
      this.inputMode = 0;
      return MenuAction.Processed;
    }
    if (key.sym === SDLK.BACKSPACE) {
      const value = this.get();
      if (value.length > 0) {
        this.set(value.slice(0, -1));
        return MenuAction.Processed;
      }
      return MenuAction.NotProcessed;
    }
    if (this.get().length < this.maxLen - 1) {
      if (key.unicode === 0) return MenuAction.NotProcessed;
      this.set(this.get() + String.fromCharCode(key.unicode));
      return MenuAction.Processed;
    }
    return MenuAction.NotProcessed;
  }

  override draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    const xadd = this.inputMode ? 0 : this.menuXDisplace(active);
    const yadd = this.inputMode ? 0 : this.menuYDisplace(active);
    let value = this.get();
    if (this.inputMode && this.displaceCounter % 100 > 50) value += "|";
    if (this.text === null) return { left: 0, top: 0, right: 0, bottom: 0 };
    const light = active || this.notActiveItem;
    const handle = fonts.get(light ? GameFont.BigMenuFont : GameFont.BigMenuFontDark);
    const dx = light ? xadd : 0;
    const dy = light ? yadd : 0;
    const first = this.write(
      handle,
      buffer,
      x - PARAM_SEPARATION + dx,
      y + dy,
      this.text,
      VAlign.Below,
      HAlign.ToLeft,
    );
    const second = this.write(
      handle,
      buffer,
      x + PARAM_SEPARATION + dx,
      y + dy,
      value,
      VAlign.Below,
      HAlign.ToRight,
    );
    return union(first, second);
  }
}

/** `CGameMenuItemChangeKey`. */
export class ChangeKeyItem extends MenuItem {
  private keyInputMode = 0;

  constructor(
    parent: MenuBase,
    private readonly keys: number[],
    private readonly index: number,
  ) {
    super(parent, KEY_TEXT[index]);
  }

  override handleKeyPress(key: KeyPress): MenuAction {
    if (!this.keyInputMode) {
      if (this.actionKey(key)) {
        this.keyInputMode = 1;
        return MenuAction.Processed;
      }
      if (key.sym === SDLK.BACKSPACE) {
        this.keys[this.index] = 0;
        return MenuAction.Processed;
      }
      return MenuAction.NotProcessed;
    }
    const allKeys = this.parent.host.options().data.keys;
    for (let a = 0; a < KMaxLocalPlayers; a++) {
      for (let b = 0; b < TPlayerKeys.Amount; b++) {
        if ((allKeys[a] !== this.keys || b !== this.index) && allKeys[a][b] === key.sym) {
          allKeys[a][b] = 0;
        }
      }
    }
    this.keys[this.index] = key.sym;
    this.keyInputMode = 0;
    return MenuAction.Processed;
  }

  override draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    if (this.text === null) return { left: 0, top: 0, right: 0, bottom: 0 };
    const value = this.keyInputMode ? KKeySelectionText : keyToStr(this.keys[this.index]);
    const light = active || this.notActiveItem;
    const handle = fonts.get(light ? GameFont.BigMenuFont : GameFont.BigMenuFontDark);
    const dx = light ? this.menuXDisplace(active) : 0;
    const dy = light ? this.menuYDisplace(active) : 0;
    const first = this.write(
      handle,
      buffer,
      x - PARAM_SEPARATION + dx,
      y + dy,
      this.text,
      VAlign.Below,
      HAlign.ToLeft,
    );
    const second = this.write(
      handle,
      buffer,
      x + PARAM_SEPARATION + dx,
      y + dy,
      value,
      VAlign.Below,
      HAlign.ToRight,
    );
    return union(first, second);
  }
}

/** Union of two font-write rectangles (`CRect::Combine`). */
function union(a: Rect, b: Rect): Rect {
  if (a.right === 0 && a.bottom === 0) return b;
  if (b.right === 0 && b.bottom === 0) return a;
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/** `CGameMenuItemFullScreen`. */
export class FullScreenItem extends BooleanItem {
  override handleKeyPress(key: KeyPress): MenuAction {
    const before = this.value.get();
    const result = super.handleKeyPress(key);
    if (this.value.get() !== before) this.parent.host.fullScreenChanged();
    return result;
  }
}

/** `CGameMenuItemLargeText`. */
export class LargeTextItem extends BooleanItem {
  override handleKeyPress(key: KeyPress): MenuAction {
    const result = super.handleKeyPress(key);
    this.parent.host.updateLargeTextMode(this.value.get());
    return result;
  }
}

/** `CGameMenuItemResolution`. */
export class ResolutionItem extends MenuItem {
  constructor(
    parent: MenuBase,
    paramStr: string,
    private readonly mode: { x: number; y: number },
  ) {
    super(parent, null);
    this.paramStr = paramStr;
    this.updateText();
  }

  private updateText(): void {
    this.setText(`${this.paramStr}${this.mode.x}x${this.mode.y}`);
  }

  override handleKeyPress(key: KeyPress): MenuAction {
    if (this.actionKey(key) || this.rightKey(key)) {
      this.parent.host.cycleResolution(true);
      this.updateText();
      return MenuAction.Processed;
    }
    if (this.leftKey(key)) {
      this.parent.host.cycleResolution(false);
      this.updateText();
      return MenuAction.Processed;
    }
    return MenuAction.NotProcessed;
  }

  override draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    return this.drawText(fonts, buffer, x, y, active);
  }
}

/** `CGameMenuItemLevelSelect`. */
export class LevelSelectItem extends MenuItem {
  private selfDisabled = false;

  constructor(parent: MenuBase, paramStr: string) {
    super(parent, null);
    this.paramStr = paramStr;
    this.updateText();
  }

  override handleKeyPress(key: KeyPress): MenuAction {
    const data = this.parent.host.options().data;
    if (this.leftKey(key)) {
      data.multiPlayLevel--;
      this.updateText();
      return MenuAction.Processed;
    }
    if (this.rightKey(key) || this.actionKey(key)) {
      data.multiPlayLevel++;
      this.updateText();
      return MenuAction.Processed;
    }
    return MenuAction.NotProcessed;
  }

  resetLevel(): void {
    this.parent.host.doFullRedraw();
    const data = this.parent.host.options().data;
    data.multiPlayLevel = 0;
    this.updateText();
  }

  private updateText(): void {
    const opt = this.parent.host.options();
    const data = opt.data;
    const epi = opt.episode(data.multiPlayEpisode, data.multiPlayGameMode !== 0);
    if (data.multiPlayLevel >= epi.levels.length) data.multiPlayLevel = 0;
    if (data.multiPlayLevel < 0) data.multiPlayLevel = epi.levels.length - 1;
    this.checkDisable();
    this.setText(`${this.paramStr} ${epi.levels[data.multiPlayLevel]?.name ?? ""}`);
  }

  private checkDisable(): void {
    const opt = this.parent.host.options();
    const data = opt.data;
    const epi = opt.episode(data.multiPlayEpisode, data.multiPlayGameMode !== 0);
    if (epi.levels.length === 0 && this.enabled) {
      this.enabled = false;
      this.notActiveItem = true;
      this.selfDisabled = true;
    }
    if (epi.levels.length > 0 && this.selfDisabled) {
      this.enabled = true;
      this.notActiveItem = false;
      this.selfDisabled = false;
    }
  }

  setEnabled(enabled: boolean): void {
    this.selfDisabled = false;
    this.enabled = enabled;
    this.notActiveItem = !enabled;
    if (enabled) this.checkDisable();
  }

  override draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    return this.drawText(fonts, buffer, x, y, active);
  }
}

/** `CGameMenuItemEpisodeSelect` (the inline option, not the screen). */
export class EpisodeSelectOptionItem extends MenuItem {
  constructor(
    parent: MenuBase,
    paramStr: string,
    private readonly levelSelect: LevelSelectItem,
  ) {
    super(parent, null);
    this.paramStr = paramStr;
    this.updateText();
  }

  override handleKeyPress(key: KeyPress): MenuAction {
    const data = this.parent.host.options().data;
    if (this.leftKey(key)) {
      data.multiPlayEpisode--;
      this.updateText();
      this.levelSelect.resetLevel();
      return MenuAction.Processed;
    }
    if (this.rightKey(key) || this.actionKey(key)) {
      data.multiPlayEpisode++;
      this.updateText();
      this.levelSelect.resetLevel();
      return MenuAction.Processed;
    }
    return MenuAction.NotProcessed;
  }

  updateText(): void {
    const opt = this.parent.host.options();
    const data = opt.data;
    const dm = data.multiPlayGameMode !== 0;
    if (data.multiPlayEpisode >= opt.episodeAmount(dm)) data.multiPlayEpisode = 0;
    if (data.multiPlayEpisode < 0) data.multiPlayEpisode = opt.episodeAmount(dm) - 1;
    this.setText(`${this.paramStr} ${opt.episode(data.multiPlayEpisode, dm).name}`);
  }

  override draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    return this.drawText(fonts, buffer, x, y, active);
  }
}

/** `CGameMenuItemGameModeSelect`. */
export class GameModeSelectItem extends MenuItem {
  constructor(
    parent: MenuBase,
    paramStr: string,
    private readonly levelSelect: LevelSelectItem,
    private readonly episodeSelect: EpisodeSelectOptionItem,
  ) {
    super(parent, null);
    this.paramStr = paramStr;
    this.updateText();
    this.updateLevelSelect();
  }

  private updateText(): void {
    const data = this.parent.host.options().data;
    this.setText(`${this.paramStr}: ${this.parent.host.gameModeName(data.multiPlayGameMode)}`);
  }

  private updateLevelSelect(): void {
    const data = this.parent.host.options().data;
    if (data.multiPlayEpisode < 0) data.multiPlayEpisode = 0;
    this.parent.host.doFullRedraw();
    if (this.parent.host.gameModeStartFromAnyLevel(data.multiPlayGameMode)) {
      this.levelSelect.setEnabled(true);
    } else {
      this.levelSelect.setEnabled(false);
      this.levelSelect.resetLevel();
    }
    this.episodeSelect.updateText();
  }

  override handleKeyPress(key: KeyPress): MenuAction {
    const data = this.parent.host.options().data;
    const prev = data.multiPlayGameMode;
    let ok = false;
    if (this.leftKey(key)) {
      data.multiPlayGameMode++;
      ok = true;
    }
    if (this.rightKey(key)) {
      data.multiPlayGameMode--;
      ok = true;
    }
    if (!ok) return MenuAction.NotProcessed;
    const count = this.parent.host.gameModeCount();
    if (data.multiPlayGameMode >= count) data.multiPlayGameMode = 0;
    if (data.multiPlayGameMode < 0) data.multiPlayGameMode = count - 1;
    if (
      this.parent.host.gameModeDMEpisodes(prev) !==
      this.parent.host.gameModeDMEpisodes(data.multiPlayGameMode)
    ) {
      data.multiPlayEpisode += this.parent.host.gameModeDMEpisodes(data.multiPlayGameMode) ? 1 : -1;
    }
    this.updateLevelSelect();
    return MenuAction.Processed;
  }

  override draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    this.updateText();
    return this.drawText(fonts, buffer, x, y, active);
  }
}

/** `CGameMenuItemSplitSelect`. */
export class SplitSelectItem extends MenuItem {
  constructor(parent: MenuBase, paramStr: string) {
    super(parent, null);
    this.paramStr = paramStr;
    this.updateText();
  }

  private updateText(): void {
    const data = this.parent.host.options().data;
    if (data.multiPlayers < 1 || data.multiPlayers > 4) data.multiPlayers = 1;
    if (data.multiPlayers === 1) data.multiPlayers = 2;
    this.setText(`${this.paramStr}: ${data.multiPlayers} players`);
  }

  override handleKeyPress(key: KeyPress): MenuAction {
    const data = this.parent.host.options().data;
    if (this.actionKey(key) || this.rightKey(key)) {
      data.multiPlayers++;
      if (data.multiPlayers > KMaxLocalPlayers) data.multiPlayers = 1;
      return MenuAction.Processed;
    }
    if (this.leftKey(key)) {
      data.multiPlayers--;
      if (data.multiPlayers < 1) data.multiPlayers = KMaxLocalPlayers;
      return MenuAction.Processed;
    }
    return MenuAction.NotProcessed;
  }

  override draw(
    fonts: SystemFonts,
    buffer: Framebuffer,
    x: number,
    y: number,
    active: number,
  ): Rect {
    this.updateText();
    return this.drawText(fonts, buffer, x, y, active);
  }
}

// ---------------------------------------------------------------------------
// Menu trees (`Menu.cpp`)
// ---------------------------------------------------------------------------

/** `CGameMenuMain`. */
export class MainMenu extends MenuBase {
  constructor(host: MenuHost) {
    super(host);
    this.items.push(new TitleItem(this, "main menu"));
    this.items.push(new TitleItem(this, ""));
    this.items.push(new StartMenuItem(this, "single game", MenuState.EpisodeSelect));
    this.items.push(new StartMenuItem(this, "start multiplayer game", MenuState.Multiplay));
    this.items.push(new StartMenuItem(this, "options", MenuState.Options));
    this.items.push(new TitleItem(this, ""));
    this.items.push(new ExitItem(this, "exit"));
  }

  override prevMenu(): MenuState {
    return MenuState.Quit;
  }
}

/** `CGameMenuGameOptions`. */
export class GameOptionsMenu extends MenuBase {
  private readonly gammaItem: PercentItem;

  constructor(host: MenuHost) {
    super(host);
    const data = host.options().data;
    this.items.push(new TitleItem(this, "game options"));
    this.items.push(new TitleItem(this, ""));
    this.items.push(new MouseModeItem(this, "mouse controls: "));
    this.items.push(
      new PercentItem(
        this,
        "mouse sensitivity: ",
        num(
          () => data.mouseSensitivity,
          (v) => (data.mouseSensitivity = v),
        ),
        KMouseSensitivityMin,
        KMouseSensitivityMax,
        KMouseSensitivityStep,
      ),
    );
    this.gammaItem = new PercentItem(
      this,
      "gamma: ",
      num(
        () => data.gamma,
        (v) => (data.gamma = v),
      ),
      0.1,
      3.0,
      0.1,
    );
    this.items.push(this.gammaItem);
    this.items.push(new ResolutionItem(this, "game resolution: ", data.inGameVideoMode));
    this.items.push(
      new FullScreenItem(
        this,
        "fullscreen",
        bool(
          () => data.fullScreen,
          (v) => (data.fullScreen = v),
        ),
      ),
    );
    this.items.push(
      new LargeTextItem(
        this,
        "large text",
        bool(
          () => data.inGameLargeText,
          (v) => (data.inGameLargeText = v),
        ),
      ),
    );
    this.items.push(new TitleItem(this, ""));
    this.items.push(new ExitItem(this, "previous menu"));
  }

  override prevMenu(): MenuState {
    return MenuState.Options;
  }

  override valueUpdated(item: MenuItem): void {
    // `CGameMenuGameOptions::ValueUpdated` — the gamma slider updates the device.
    if (item === this.gammaItem) this.host.updateGammaChanges();
  }
}

/** `CGameMenuDeathMatchOptions`. */
export class DeathMatchOptionsMenu extends MenuBase {
  constructor(host: MenuHost) {
    super(host);
    const data = host.options().data;
    this.items.push(new TitleItem(this, "deathmatch options"));
    this.items.push(new TitleItem(this, ""));
    this.items.push(
      new PercentItem(
        this,
        "moving speed",
        num(
          () => data.dmSpeed,
          (v) => (data.dmSpeed = v),
        ),
        0.5,
        5.0,
        0.1,
      ),
    );
    this.items.push(
      new BooleanItem(
        this,
        "enemies",
        bool(
          () => data.enemiesOnGame,
          (v) => (data.enemiesOnGame = v),
        ),
      ),
    );
    this.items.push(
      new BooleanItem(
        this,
        "players always have target system",
        bool(
          () => data.dmTargetSystem,
          (v) => (data.dmTargetSystem = v),
        ),
      ),
    );
    this.items.push(new TitleItem(this, ""));
    this.items.push(new ExitItem(this, "previous menu"));
  }

  override prevMenu(): MenuState {
    return MenuState.Options;
  }
}

/** `CGameMenuAudioOptions`. */
export class AudioOptionsMenu extends MenuBase {
  constructor(host: MenuHost) {
    super(host);
    const data = host.options().data;
    this.items.push(new TitleItem(this, "audio options"));
    this.items.push(new TitleItem(this, ""));
    this.items.push(new MusicThemeItem(this, "music theme:"));
    this.items.push(
      new PercentItem(
        this,
        "music volume",
        num(
          () => data.musicVolume,
          (v) => (data.musicVolume = v),
        ),
        KMusicVolumeMin,
        KMusicVolumeMax,
        KMusicVolumeStep,
      ),
    );
    this.items.push(
      new PercentItem(
        this,
        "effects volume",
        num(
          () => data.effectsVolume,
          (v) => (data.effectsVolume = v),
        ),
        KEffectVolumeMin,
        KEffectVolumeMax,
        KEffectVolumeStep,
      ),
    );
    this.items.push(
      new BooleanItem(
        this,
        "reverse stereo",
        bool(
          () => data.stereo,
          (v) => (data.stereo = v),
        ),
      ),
    );
    this.items.push(new TitleItem(this, ""));
    this.items.push(new ExitItem(this, "previous menu"));
  }

  override prevMenu(): MenuState {
    return MenuState.Options;
  }

  override runMenu(key: KeyPress | null): boolean {
    const result = super.runMenu(key);
    if (key !== null) this.host.updateAudioChanges();
    return result;
  }
}

/** `CGameMenuOptions`. */
export class OptionsMenu extends MenuBase {
  constructor(host: MenuHost) {
    super(host);
    this.items.push(new TitleItem(this, "options"));
    this.items.push(new TitleItem(this, ""));
    this.items.push(new StartMenuItem(this, "game options", MenuState.GameOptions));
    this.items.push(new StartMenuItem(this, "network options", MenuState.NetOptions));
    this.items.push(new StartMenuItem(this, "player 1 options", MenuState.PlayerOptions1));
    this.items.push(new StartMenuItem(this, "player 2 options", MenuState.PlayerOptions2));
    this.items.push(new StartMenuItem(this, "player 3 options", MenuState.PlayerOptions3));
    this.items.push(new StartMenuItem(this, "player 4 options", MenuState.PlayerOptions4));
    this.items.push(new StartMenuItem(this, "deathmatch options", MenuState.DeathMatchOptions));
    this.items.push(new StartMenuItem(this, "audio options", MenuState.AudioOptions));
    this.items.push(new ResetOptionsItem(this, "reset options to default"));
    this.items.push(new TitleItem(this, ""));
    this.items.push(new ExitItem(this, "previous menu"));
  }

  override prevMenu(): MenuState {
    return MenuState.Main;
  }
}

/** `CGameMenuMultiplay` (network select is disabled, as in the original). */
export class MultiplayMenu extends MenuBase {
  constructor(host: MenuHost) {
    super(host);
    const levelSelect = new LevelSelectItem(this, "Level");
    const splitSelect = new SplitSelectItem(this, "Split screen");
    const episodeSelect = new EpisodeSelectOptionItem(this, "Episode", levelSelect);
    const gameMode = new GameModeSelectItem(this, "Game mode", levelSelect, episodeSelect);
    this.items.push(new TitleItem(this, "Start multiplay"));
    this.items.push(new TitleItem(this, ""));
    this.items.push(episodeSelect);
    this.items.push(levelSelect);
    this.items.push(gameMode);
    this.items.push(splitSelect);
    this.items.push(new TitleItem(this, ""));
    this.items.push(new ExecMultiplayItem(this, "Go!"));
    this.items.push(new TitleItem(this, ""));
    this.items.push(new ExitItem(this, "previous menu"));
  }

  override prevMenu(): MenuState {
    return MenuState.Main;
  }
}

/** `CGameMenuEpisodeSelect` — the scrolling episode chooser. */
export class EpisodeSelectMenu extends MenuBase {
  private subScroll = 0;
  private subItem = 0;
  private readonly total: number;

  constructor(host: MenuHost) {
    super(host);
    this.total = host.options().episodeAmount(false);
    const amount = Math.min(this.total, KMaxEpisodeInList);
    this.items.push(new TitleItem(this, "Choose episode"));
    this.items.push(new TitleItem(this, ""));
    for (let a = 0; a < amount; a++) {
      this.items.push(new ExecSingleGameItem(this, host.options().episode(a, false).name, a));
    }
    this.refreshLabels();
  }

  override prevMenu(): MenuState {
    return MenuState.Main;
  }

  private refreshLabels(): void {
    for (let a = 0; a < this.items.length - 2; a++) {
      const item = this.items[a + 2] as ExecSingleGameItem;
      item.setEpisodeNo(a + this.subScroll);
      item.setEpisodeName(this.host.options().episode(a + this.subScroll, false).name);
    }
  }

  protected override handleKeyPress(key: KeyPress): MenuAction {
    const ret = this.items[this.activeItem].handleKeyPress(key);
    if (ret === MenuAction.Exit) {
      this.host.changeState(this.prevMenu());
      return MenuAction.Exit;
    }
    if (ret === MenuAction.Processed) return MenuAction.Processed;

    const pl1 = this.host.options().data.keys[0];
    if (key.sym === SDLK.ESCAPE) {
      this.host.changeState(this.prevMenu());
      return MenuAction.Processed;
    }

    if (key.sym === SDLK.DOWN || key.sym === pl1[TPlayerKeys.DOWN]) {
      this.subItem++;
      if (this.subItem >= this.total) {
        this.subItem = 0;
        this.subScroll = 0;
      }
      if (this.subItem - this.subScroll >= this.items.length - 2) {
        this.subScroll = this.subItem - (this.items.length - 2) + 1;
      }
    } else if (key.sym === SDLK.UP || key.sym === pl1[TPlayerKeys.UP]) {
      this.subItem--;
      if (this.subItem < 0) {
        this.subItem += this.total;
        this.subScroll = this.subItem - (this.items.length - 2) + 1;
      }
      if (this.subItem - this.subScroll < 0) this.subScroll = this.subItem;
    } else {
      return MenuAction.NotProcessed;
    }

    this.activeItem = 2 + this.subItem - this.subScroll;
    if (key.sym === SDLK.UP || key.sym === SDLK.DOWN) {
      this.items[this.activeItem].activate();
    }
    this.refreshLabels();
    return MenuAction.Processed;
  }
}

/** `CGameMenuChangeKeys`. */
export class ChangeKeysMenu extends MenuBase {
  private readonly index: number;

  constructor(host: MenuHost, playerNo: number) {
    super(host);
    this.index = playerNo;
    this.items.push(new TitleItem(this, `Change Player ${playerNo} Keys`));
    this.items.push(new TitleItem(this, ""));
    const keys = host.options().data.keys[playerNo - 1];
    for (let a = 0; a < TPlayerKeys.Amount; a++) this.items.push(new ChangeKeyItem(this, keys, a));
    this.items.push(new TitleItem(this, ""));
    this.items.push(new ExitItem(this, "previous menu"));
  }

  override prevMenu(): MenuState {
    switch (this.index) {
      case 1:
        return MenuState.PlayerOptions1;
      case 2:
        return MenuState.PlayerOptions2;
      case 3:
        return MenuState.PlayerOptions3;
      default:
        return MenuState.PlayerOptions4;
    }
  }
}

/** `CGameMenuPlayerOptions`. */
export class PlayerOptionsMenu extends MenuBase {
  constructor(host: MenuHost, playerNo: number) {
    super(host);
    this.items.push(new TitleItem(this, `Player ${playerNo} options`));
    this.items.push(new TitleItem(this, ""));
    const keyStates = [
      MenuState.ChangeKeys1,
      MenuState.ChangeKeys2,
      MenuState.ChangeKeys3,
      MenuState.ChangeKeys4,
    ];
    this.items.push(new StartMenuItem(this, "define keys", keyStates[playerNo - 1]));
    this.items.push(
      new StringItem(
        this,
        "change name: ",
        () => host.playerName(playerNo - 1),
        (v) => host.setPlayerName(playerNo - 1, v),
        KPlayerNameMaxLength,
      ),
    );
    this.items.push(new TitleItem(this, ""));
    this.items.push(new ExitItem(this, "previous menu"));
  }

  override prevMenu(): MenuState {
    return MenuState.Options;
  }
}

/** `CGameMenuNetOptions`. */
export class NetOptionsMenu extends MenuBase {
  constructor(host: MenuHost) {
    super(host);
    const data = host.options().data;
    this.items.push(new TitleItem(this, "Network Options"));
    this.items.push(new TitleItem(this, ""));
    this.items.push(
      new BooleanItem(
        this,
        "Check Newest TK from Internet",
        bool(
          () => data.webVersionCheckingEnabled,
          (v) => (data.webVersionCheckingEnabled = v),
        ),
      ),
    );
    this.items.push(
      new BooleanItem(
        this,
        "Use HTTP Proxy",
        bool(
          () => data.proxyEnabled,
          (v) => (data.proxyEnabled = v),
        ),
      ),
    );
    this.items.push(
      new StringItem(
        this,
        "HTTP Proxy addr: ",
        () => data.proxyAddr,
        (v) => (data.proxyAddr = v),
        255,
      ),
    );
    this.items.push(
      new StringItem(
        this,
        "HTTP proxy port: ",
        () => data.proxyPort,
        (v) => (data.proxyPort = v),
        6,
      ),
    );
    this.items.push(new TitleItem(this, ""));
    this.items.push(new ExitItem(this, "exit"));
  }

  override prevMenu(): MenuState {
    return MenuState.Options;
  }
}

/** `CGameMenuContainer`. */
export class MenuContainer {
  private readonly menus: MenuBase[] = [];
  private state = MenuState.Main;
  private skipDraw = false;

  constructor(private readonly host: MenuHost) {
    this.menus[MenuState.AudioOptions] = new AudioOptionsMenu(host);
    this.menus[MenuState.DeathMatchOptions] = new DeathMatchOptionsMenu(host);
    this.menus[MenuState.EpisodeSelect] = new EpisodeSelectMenu(host);
    this.menus[MenuState.GameOptions] = new GameOptionsMenu(host);
    this.menus[MenuState.Main] = new MainMenu(host);
    this.menus[MenuState.Multiplay] = new MultiplayMenu(host);
    this.menus[MenuState.Options] = new OptionsMenu(host);
    this.menus[MenuState.PlayerOptions1] = new PlayerOptionsMenu(host, 1);
    this.menus[MenuState.PlayerOptions2] = new PlayerOptionsMenu(host, 2);
    this.menus[MenuState.PlayerOptions3] = new PlayerOptionsMenu(host, 3);
    this.menus[MenuState.PlayerOptions4] = new PlayerOptionsMenu(host, 4);
    this.menus[MenuState.ChangeKeys1] = new ChangeKeysMenu(host, 1);
    this.menus[MenuState.ChangeKeys2] = new ChangeKeysMenu(host, 2);
    this.menus[MenuState.ChangeKeys3] = new ChangeKeysMenu(host, 3);
    this.menus[MenuState.ChangeKeys4] = new ChangeKeysMenu(host, 4);
    this.menus[MenuState.NetOptions] = new NetOptionsMenu(host);
    this.state = MenuState.Main;
  }

  changeState(state: MenuState): void {
    if (state === MenuState.Quit) {
      this.host.requestQuit();
      return;
    }
    this.state = state;
    this.menus[this.state].activateMenu();
  }

  /** Returns true when the key was consumed (used for the click sound). */
  runFrame(key: KeyPress | null): boolean {
    this.skipDraw = false;
    return this.menus[this.state].runMenu(key);
  }

  draw(): void {
    if (this.skipDraw) return;
    this.menus[this.state].draw();
  }

  enterState(): void {
    this.menus[this.state].activateMenu();
  }

  skipDrawOnce(): void {
    this.skipDraw = true;
  }

  doFullRedraw(): void {
    // Always full redraws in this port.
  }

  currentMenu(): MenuBase {
    return this.menus[this.state];
  }
}
