/**
 * `CGameApp` — the application shell and main state machine.
 *
 * Owns the framebuffer/presenter, the graphics fader effects, the message
 * board, the options/menu tree and the in-game sub-state flow. The state
 * machine mirrors `CGameApp::Loop` / `CGameState`: a state change either runs
 * the current state or, while a fade/zoom effect is active, warps the frozen
 * frame until the effect completes and installs the next state.
 */

import { createLoop, type Loop } from "../core/loop";
import { GlibcRandom } from "../core/rng";
import { decodePaletteTab } from "../data/color-tables";
import { mergeIni, type ConfigFile } from "../data/config";
import { decodeFnt, fontWrite, fontLength, HAlign, VAlign } from "../data/font";
import { ingameSignature, loadIngameData, type IngameData } from "../data/ingame-data";
import { loadLevel, type Level } from "../data/level";
import { loadMenuData, PaletteNo, type MenuData } from "../data/menu-data";
import { createPalette, type Palette } from "../data/palette";
import { toDrawSprites } from "../render/draw-manager";
import { GameDrawer } from "../render/drawer";
import { GraphicsFader, scalePalette } from "../render/fader";
import { Framebuffer } from "../render/fb";
import { MessageBoard } from "../render/message-board";
import { Canvas2DPresenter } from "../render/presenters/canvas2d";
import { GameStatistics } from "../sim/statistics";
import { EnemyTypes, WeaponId, WeaponTypes } from "../sim/types";
import { Key, MouseButton, type SimInput, type SimPlayer } from "../sim/world";
import { FONT_FILES, GameFont, SystemFonts } from "./fonts";
import { GameSession, makeStartPlayer } from "./game-session";
import { codeToSdlKey, SDLK } from "./keys";
import { MenuContainer, MenuState, type KeyPress, type MenuHost, type MenuItem } from "./menu";
import { Options, TPlayerKeys } from "./options";
import { drawShop, DynShopData, shopBuy, shopSell, type ShopContext } from "./shop";
import { drawStatistics, givePlayerPrize, type StatisticsContext } from "./statistics";

const WIDTH = 640;
const HEIGHT = 480;
const KLevelCompleteDelay = 940;
const KTimerFreq = 100;

/** `CState::TMainState`. */
const enum MainState {
  Logo1 = 0,
  Logo2,
  Menu,
  Game,
  Quit,
  ConfirmedQuit,
}

/** `TGameState`. */
const enum GameState {
  None = -1,
  OnGoing = 0,
  Shop,
  Victory,
  Statistics,
  NextLevel,
  LevelInfo,
  Quit,
  Amount,
}

/** `IGameMode` — cooperative (attack) or deathmatch. */
class GameMode {
  constructor(readonly dm: boolean) {}

  name(): string {
    return this.dm ? "deathmatch" : "cooperative";
  }
  startFromAnyLevel(): boolean {
    return this.dm;
  }
  frags(): boolean {
    return this.dm;
  }
  dmEpisodes(): boolean {
    return this.dm;
  }
  crateRespawn(): boolean {
    return this.dm;
  }
  actionTimeMatters(): boolean {
    return !this.dm;
  }
  disableEnemiesPossible(): boolean {
    return this.dm;
  }
  shopEnabled(level: number): boolean {
    return !this.dm && level >= 1;
  }
  hidePlayersFromMap(): boolean {
    return this.dm;
  }
}

interface EffectState {
  enabled: boolean;
  fadeIn: boolean;
  stateTransition: boolean;
  started: number;
  duration: number;
  palette: Palette;
  nextMain: MainState;
  nextSub: number;
  method: "in" | "out" | "zoom";
  /** Palette multiplier for the frozen frame (0..256). */
  mul: number;
  /** Set when the effect began this tick, so the new frame is drawn first. */
  fresh: boolean;
}

function makeEffect(): EffectState {
  return {
    enabled: false,
    fadeIn: false,
    stateTransition: false,
    started: 0,
    duration: 0,
    palette: createPalette(),
    nextMain: MainState.Menu,
    nextSub: 0,
    method: "in",
    mul: 256,
    fresh: false,
  };
}

export class App implements MenuHost {
  private readonly presenter = new Canvas2DPresenter(WIDTH, HEIGHT);
  private readonly fb = new Framebuffer(WIDTH, HEIGHT);
  private readonly post = new Framebuffer(WIDTH, HEIGHT);
  private readonly dark = new Uint8Array(WIDTH * HEIGHT);
  private readonly fader = new GraphicsFader();

  private opts!: Options;
  private menuData!: MenuData;
  private fontSet!: SystemFonts;
  private drawer!: GameDrawer;
  private ingame!: IngameData;
  private ingamePalette: Palette = createPalette();
  private readonly messageBoard = new MessageBoard();
  private readonly effect = makeEffect();
  private readonly menuRng = new GlibcRandom((Date.now() / 1000) >>> 0);
  private menuContainer!: MenuContainer;

  private mainState = MainState.Logo1;
  private gameState: GameState = GameState.None;
  private stateChanged = true;
  private savedState: { main: MainState; sub: number } | null = null;

  private gameMode = new GameMode(false);
  private episode = 0;
  private currentLevel = 0;
  private levelsInEpisode = 0;
  private rootCfgText = "";
  private levelConfigs = new Map<string, Promise<ConfigFile>>();
  private ingameSignature = "";
  private nextLevelPending = false;
  private levelBytes = new Map<number, Uint8Array>();
  private levelData = new Map<number, Level>();
  private session: GameSession | null = null;
  private userQuit = false;
  private gameOver = false;

  /** `CDynGameData::iLocalPlayer[0]` + `Statistics()` — persist across levels. */
  private player: SimPlayer | null = null;
  private stats = new GameStatistics();
  private completeTime = 0;
  private timeBonus = 0;
  private shop = new DynShopData();
  private shopRng = new GlibcRandom((Date.now() / 1000) >>> 0);

  private logoStart = 0;
  private ongoingShowMap = false;
  private ongoingDrawFrames = false;

  private palette: Palette = createPalette();
  private faded = createPalette();
  private clock = 0;
  private timerSave = 0;
  private fps = 0;
  private loopRef: Loop | null = null;

  private readonly heldCodes = new Set<string>();
  private readonly keyQueue: KeyPress[] = [];
  private mouseDX = 0;
  private rawButtons = 0;
  private wheelTicks = 0;

  constructor(private readonly loadBytes: (path: string) => Promise<Uint8Array>) {}

  private loadText(path: string): Promise<string> {
    return this.loadBytes(path).then((bytes) => new TextDecoder().decode(bytes));
  }

  // ------------------------------------------------------------------
  // boot
  // ------------------------------------------------------------------

  async boot(root: HTMLElement): Promise<void> {
    this.presenter.fit();
    window.addEventListener("resize", () => this.presenter.fit());
    root.appendChild(this.presenter.canvas);

    const [cfgText, paletteTabBytes] = await Promise.all([
      this.loadText("default.ini"),
      this.loadBytes("palette.tab"),
    ]);
    this.rootCfgText = cfgText;
    const rootCfg = mergeIni(cfgText);
    this.menuData = await loadMenuData(this.loadBytes);
    const paletteTab = decodePaletteTab(paletteTabBytes);
    void paletteTab;
    this.ingame = await loadIngameData(rootCfg, this.loadBytes);
    this.ingameSignature = ingameSignature(rootCfg);
    this.ingamePalette = this.ingame.palette;
    this.drawer = new GameDrawer(paletteTab);

    const fontBytes = await Promise.all(FONT_FILES.map((spec) => this.loadBytes(spec.file)));
    this.fontSet = new SystemFonts(fontBytes.map(decodeFnt));

    const manifest = JSON.parse(await this.loadText("manifest.json")) as {
      deathmatchLevels: { file: string; logical?: string }[];
      episodes: { name: string; levels: { file: string; logical?: string }[] }[];
      musicThemes: string[];
    };
    this.opts = new Options(
      manifest.deathmatchLevels.map((l) => ({ file: l.file, name: l.logical ?? l.file })),
      manifest.episodes.map((e) => ({
        name: e.name,
        levels: e.levels.map((l) => ({ file: l.file, name: l.logical ?? l.file })),
      })),
      manifest.musicThemes,
    );

    this.menuContainer = new MenuContainer(this);
    this.installInput();
    this.enterState(this.mainState);
    this.fb.clear(0);
    this.present(this.fb, this.palette, 256);

    this.loopRef = createLoop({
      tick: () => this.tick(),
      render: (info) => {
        this.fps = info.fps;
        this.render();
      },
    });
    this.loopRef.start();
  }

  // ------------------------------------------------------------------
  // loop
  // ------------------------------------------------------------------

  private tick(): void {
    this.clock++;
    if (this.effect.enabled) this.runEffect();
    else this.runState();
    this.messageBoard.run(this.clock);
    this.keyQueue.length = 0;
    this.wheelTicks = 0;
    this.mouseDX = 0;
  }

  private render(): void {
    if (this.effect.enabled && !this.effect.fresh) {
      this.present(this.post, this.effect.palette, this.effect.mul);
      this.effect.fresh = false;
      return;
    }
    this.effect.fresh = false;
    this.fb.clear(0);
    this.drawState();
    this.messageBoard.draw(this.fontSet.get(GameFont.SmallFont).font, this.fb);
    this.present(this.fb, this.palette, 256);
  }

  private present(buffer: Framebuffer, palette: Palette, mul: number): void {
    if (mul >= 256) {
      this.presenter.present(buffer, palette);
    } else {
      scalePalette(palette, mul, this.faded);
      this.presenter.present(buffer, this.faded);
    }
  }

  // ------------------------------------------------------------------
  // effects (`CGameApp::StartFadeIn/Out/ZoomOut`)
  // ------------------------------------------------------------------

  private startFadeIn(palette: Palette): void {
    this.effect.method = "in";
    this.effect.started = this.clock;
    this.effect.duration = KTimerFreq / 2;
    this.effect.palette = palette;
    this.effect.stateTransition = false;
    this.effect.fadeIn = true;
    this.effect.enabled = true;
    this.effect.mul = 0;
    this.effect.fresh = true;
    this.palette = palette;
    this.timerSave = this.clock;
  }

  private startFadeOut(main: MainState, sub: number): void {
    this.effect.method = "out";
    this.effect.started = this.clock;
    this.effect.duration = KTimerFreq / 2;
    this.effect.palette = this.palette;
    this.effect.nextMain = main;
    this.effect.nextSub = sub;
    this.effect.stateTransition = true;
    this.effect.fadeIn = false;
    this.effect.enabled = true;
    this.effect.mul = 255;
    this.effect.fresh = true;
    this.timerSave = this.clock;
  }

  private startZoomOut(main: MainState, sub: number): void {
    this.effect.method = "zoom";
    this.effect.started = this.clock;
    this.effect.duration = KTimerFreq / 2;
    this.effect.palette = this.palette;
    this.effect.nextMain = main;
    this.effect.nextSub = sub;
    this.effect.stateTransition = true;
    this.effect.fadeIn = false;
    this.effect.enabled = true;
    this.effect.mul = 255;
    this.effect.fresh = true;
    this.timerSave = this.clock;
  }

  private runEffect(): void {
    const time = this.clock;
    if (time > this.effect.started + this.effect.duration) {
      this.effect.enabled = false;
      this.effect.mul = this.effect.fadeIn ? 256 : 0;
      this.clock = this.timerSave;
      if (this.effect.stateTransition) this.setState(this.effect.nextMain, this.effect.nextSub);
      this.effect.fresh = true;
      return;
    }
    if (time >= this.effect.started) {
      const args: [Framebuffer, Framebuffer, number, number, number] = [
        this.fb,
        this.post,
        this.effect.started,
        this.effect.duration,
        time,
      ];
      if (this.effect.method === "in") this.effect.mul = this.fader.fadeIn(...args);
      else if (this.effect.method === "out") this.effect.mul = this.fader.fadeOut(...args);
      else this.effect.mul = this.fader.fadeZoomOut(...args);
    }
  }

  // ------------------------------------------------------------------
  // state machine (`CGameState`)
  // ------------------------------------------------------------------

  private setState(main: MainState, sub: number): void {
    const mainChange = this.mainState !== main;
    this.exitSubState();
    if (mainChange) this.exitState();
    this.mainState = main;
    this.gameState = main === MainState.Game ? (sub as GameState) : GameState.None;
    this.palette = this.defaultPalette(main, sub);
    this.stateChanged = true;
    if (mainChange) this.enterState(main);
    this.enterSubState();
  }

  private setStateAndSave(main: MainState, sub: number): void {
    this.savedState = { main: this.mainState, sub: this.gameState };
    this.setState(main, sub);
  }

  private restoreState(): void {
    // `CGameState::RestoreState` only restores the saved state; it does **not**
    // re-enter the sub-state, so an in-progress level continues uninterrupted.
    if (!this.savedState) return;
    this.mainState = this.savedState.main;
    this.gameState = this.savedState.sub as GameState;
    this.palette = this.defaultPalette(this.mainState, this.gameState);
    this.stateChanged = false;
  }

  private first(): boolean {
    return this.stateChanged;
  }

  private defaultPalette(main: MainState, sub: number): Palette {
    switch (main) {
      case MainState.Logo1:
        return this.menuData.palettes[PaletteNo.EFLogo];
      case MainState.Logo2:
        return this.menuData.palettes[PaletteNo.TKLogo];
      case MainState.Menu:
        return this.menuData.palettes[PaletteNo.Menu];
      case MainState.Game:
        switch (sub as GameState) {
          case GameState.OnGoing:
            return this.ingamePalette;
          case GameState.Victory:
            return this.menuData.palettes[PaletteNo.Victory];
          default:
            return this.menuData.palettes[PaletteNo.Menu];
        }
      default:
        return this.palette;
    }
  }

  private enterState(main: MainState): void {
    switch (main) {
      case MainState.Logo1:
      case MainState.Logo2:
        this.logoStart = this.clock;
        break;
      case MainState.Menu:
        this.menuContainer.enterState();
        break;
      default:
        break;
    }
  }

  private exitState(): void {
    if (this.mainState === MainState.Game) {
      this.session = null;
      this.levelData.clear();
    }
  }

  private enterSubState(): void {
    if (this.mainState !== MainState.Game) return;
    switch (this.gameState) {
      case GameState.NextLevel:
        this.session = null;
        break;
      case GameState.LevelInfo:
        this.resetKeyQueue();
        this.startFadeIn(this.menuData.palettes[PaletteNo.Menu]);
        break;
      case GameState.OnGoing:
        this.enterOngoing();
        break;
      case GameState.Quit:
        this.resetKeyQueue();
        break;
      default:
        break;
    }
  }

  private exitSubState(): void {
    // Per-sub-state teardown lives in `exitState`/`setState` for now.
  }

  private runState(): void {
    switch (this.mainState) {
      case MainState.Logo1:
      case MainState.Logo2:
        this.runLogo();
        break;
      case MainState.Menu:
        this.runMenu();
        break;
      case MainState.Game:
        this.runGame();
        break;
      case MainState.Quit:
        this.runQuitMenu();
        break;
      case MainState.ConfirmedQuit:
        this.loopRef?.stop();
        break;
    }
  }

  private drawState(): void {
    switch (this.mainState) {
      case MainState.Logo1:
        this.fb.pixels.set(this.menuData.sprites.efLogo.pixels);
        break;
      case MainState.Logo2:
        this.fb.pixels.set(this.menuData.sprites.tkLogo.pixels);
        break;
      case MainState.Menu:
        this.fb.pixels.set(this.menuData.sprites.menuBackground.pixels);
        this.menuContainer.draw();
        break;
      case MainState.Game:
        this.drawGame();
        break;
      case MainState.Quit:
        // `CGUIStateQuit` draws over the last frame; approximate it with the
        // menu background underneath the confirmation box.
        this.fb.pixels.set(this.menuData.sprites.menuBackground.pixels);
        this.drawQuitMenu();
        break;
      default:
        break;
    }
    this.stateChanged = false;
  }

  // ------------------------------------------------------------------
  // logo (`CGUIStateLogo`)
  // ------------------------------------------------------------------

  private runLogo(): void {
    const next = this.mainState === MainState.Logo1 ? MainState.Logo2 : MainState.Menu;
    if (this.first()) {
      const pal =
        this.mainState === MainState.Logo1
          ? this.menuData.palettes[PaletteNo.EFLogo]
          : this.menuData.palettes[PaletteNo.TKLogo];
      this.startFadeIn(pal);
    }
    if (Math.trunc((this.clock - this.logoStart) / KTimerFreq) > 2) {
      this.startFadeOut(next, 0);
    } else if (this.keyQueue.length > 0) {
      this.startFadeOut(MainState.Menu, 0);
    }
  }

  // ------------------------------------------------------------------
  // menus (`CGameMenuContainer`, `CGUIStateQuit`)
  // ------------------------------------------------------------------

  private runMenu(): void {
    if (this.first()) this.startFadeIn(this.menuData.palettes[PaletteNo.Menu]);
    this.menuContainer.runFrame(this.nextKey());
  }

  private runQuitMenu(): void {
    const key = this.nextKey();
    if (key) {
      if (key.sym === "y".charCodeAt(0)) this.setState(MainState.ConfirmedQuit, 0);
      else this.setState(MainState.Menu, 0);
    }
  }

  private drawQuitMenu(): void {
    const handle = this.fontSet.get(GameFont.BigMenuFont);
    const text = "Quit TK? (Y/N)";
    const lineWidth = fontLength(handle.font, text) * handle.scaleX;
    const startx = Math.trunc(this.fb.width / 2 - lineWidth / 2);
    const starty = Math.trunc(this.fb.height / 2 - handle.font.height / 2);
    const endx = Math.trunc(this.fb.width / 2 + lineWidth / 2);
    const endy = Math.trunc(this.fb.height / 2 + handle.font.height / 2);
    this.fb.drawBox(
      { left: startx - 10, top: starty - 10, right: endx + 10, bottom: endy + 10 },
      10,
    );
    this.writeText(handle, startx, starty, text, VAlign.Below, HAlign.ToRight);
  }

  // ------------------------------------------------------------------
  // in-game sub-state flow (`CGameSystem` + sub-states)
  // ------------------------------------------------------------------

  /** `CGameSystem::Init` — kicks off an async level preload, then fades out. */
  private startGame(mode: GameMode, episode: number, startLevel: number): void {
    this.gameMode = mode;
    this.episode = episode;
    const epi = this.opts.episode(episode, mode.dmEpisodes());
    this.levelsInEpisode = epi.levels.length;
    if (this.levelsInEpisode <= 0 || startLevel >= this.levelsInEpisode) {
      this.messageBoard.addMessage(
        "Error: Cannot start episode from the specified level.",
        this.clock,
      );
      this.messageBoard.addMessage("Please contact Errorfree for more information!", this.clock);
      return;
    }
    this.currentLevel = startLevel;
    this.userQuit = false;
    this.gameOver = false;
    this.player = makeStartPlayer();
    this.stats = new GameStatistics();
    this.stats.addPlayer(this.opts.data.name[0] || "Unknown soldier");
    this.stats.recording = startLevel;
    this.shop = new DynShopData();
    this.shopRng = new GlibcRandom((Date.now() / 1000) >>> 0);
    this.levelBytes.clear();
    this.levelData.clear();
    const files = epi.levels.map((l) => l.file);
    void Promise.all(
      files.map(async (file, index) => {
        this.levelBytes.set(index, await this.loadBytes(file));
      }),
    )
      .then(() => this.ensureLevelIngame(episode, startLevel))
      .then(() => this.startFadeOut(MainState.Game, GameState.NextLevel));
  }

  private levelFor(index: number): Level | null {
    const cached = this.levelData.get(index);
    if (cached) return cached;
    const bytes = this.levelBytes.get(index);
    if (!bytes) return null;
    const level = loadLevel(bytes);
    this.levelData.set(index, level);
    return level;
  }

  /**
   * `CIngameData::LoadIngameData` config resolution: the merged root
   * `default.ini`, the episode `<dir>/default.ini` and the level `<file>.ini`
   * (level wins, then episode, then root). Cached per episode/level.
   */
  private levelConfig(episode: number, levelIndex: number): Promise<ConfigFile> {
    const key = `${this.gameMode.dmEpisodes() ? "dm" : "sp"}:${episode}:${levelIndex}`;
    const cached = this.levelConfigs.get(key);
    if (cached) return cached;
    const promise = this.loadLevelConfig(episode, levelIndex);
    this.levelConfigs.set(key, promise);
    return promise;
  }

  private async loadLevelConfig(episode: number, levelIndex: number): Promise<ConfigFile> {
    const epi = this.opts.episode(episode, this.gameMode.dmEpisodes());
    const level = epi.levels[levelIndex];
    const slash = level.file.lastIndexOf("/");
    const dir = slash >= 0 ? level.file.slice(0, slash) : "";
    const episodeText = dir ? await this.loadOptionalText(`${dir}/default.ini`) : undefined;
    const levelText = await this.loadOptionalText(level.file.replace(/\.lev$/i, ".ini"));
    return mergeIni(levelText, episodeText, this.rootCfgText);
  }

  private async loadOptionalText(path: string): Promise<string | undefined> {
    try {
      return await this.loadText(path);
    } catch {
      return undefined;
    }
  }

  /**
   * Loads the level's in-game sprite set, honouring per-level/episode `.ini`
   * overrides. The generated sheets are only rebuilt when the resolved sprite
   * paths actually changed (the shipped episodes never override them).
   */
  private async ensureLevelIngame(episode: number, levelIndex: number): Promise<void> {
    try {
      const cfg = await this.levelConfig(episode, levelIndex);
      const signature = ingameSignature(cfg);
      if (signature === this.ingameSignature) return;
      this.ingame = await loadIngameData(cfg, this.loadBytes);
      this.ingameSignature = signature;
      this.ingamePalette = this.ingame.palette;
    } catch (err) {
      // Fall back to the already-loaded set rather than stalling the level flow.
      this.messageBoard.addMessage(
        `Ingame data load failed: ${err instanceof Error ? err.message : String(err)}`,
        this.clock,
      );
    }
  }

  private runNextLevel(): void {
    if (this.nextLevelPending) return;
    this.nextLevelPending = true;
    void this.ensureLevelIngame(this.episode, this.currentLevel).then(() => {
      this.nextLevelPending = false;
      this.setState(MainState.Game, GameState.LevelInfo);
    });
  }

  private runLevelInfo(): void {
    const key = this.nextKey();
    if (!key) return;
    if (key.sym === SDLK.ESCAPE) {
      this.setStateAndSave(MainState.Game, GameState.Quit);
      return;
    }
    if (this.gameMode.shopEnabled(this.currentLevel)) {
      this.startFadeOut(MainState.Game, GameState.Shop);
    } else {
      this.startFadeOut(MainState.Game, GameState.OnGoing);
    }
  }

  private drawLevelInfo(): void {
    this.fb.pixels.set(this.menuData.sprites.menuBackground.pixels);
    const big = this.fontSet.get(GameFont.BigMenuFont);
    const smallDark = this.fontSet.get(GameFont.SmallMenuFontDark);
    const level = this.levelFor(this.currentLevel);
    this.writeText(big, 16, 13, `Level ${this.currentLevel + 1}`, VAlign.Below, HAlign.ToRight);
    this.writeText(
      big,
      Math.trunc(this.fb.width / 2),
      53,
      level?.general.comment ?? "",
      VAlign.Below,
      HAlign.InMiddle,
    );
    this.writeText(smallDark, 16, 96, "The killing list:", VAlign.Below, HAlign.ToRight);

    let b = 96 + smallDark.font.height * 2;
    if (!this.opts.data.enemiesOnGame && this.gameMode.disableEnemiesPossible()) {
      this.writeText(smallDark, 16, b, "Enemies disabled", VAlign.Below, HAlign.ToRight);
      return;
    }
    if (!level) return;
    for (let a = 0; a < EnemyTypes.length; a++) {
      let total = 0;
      for (const e of level.enemies) if (e.type === a) total++;
      total += level.general.enemies[a] ?? 0;
      if (total > 0) {
        const suffix = total > 1 ? "s" : "";
        this.writeText(
          smallDark,
          16,
          b,
          `${total} ${EnemyTypes[a].name}${suffix}`,
          VAlign.Below,
          HAlign.ToRight,
        );
        b += smallDark.font.height;
      }
    }
    if (this.gameMode.actionTimeMatters()) {
      this.writeText(
        smallDark,
        16,
        b + 50,
        `Your action time is: ${formatTime(level.general.timeLimit)}`,
        VAlign.Below,
        HAlign.ToRight,
      );
    }
  }

  private enterOngoing(): void {
    const level = this.levelFor(this.currentLevel);
    const player = this.player;
    if (!level || !player) return;
    const f = this.fontSet.get(GameFont.SmallFont);
    this.stats.recording = this.currentLevel;
    this.session = new GameSession(
      level,
      toDrawSprites(this.ingame),
      this.ingame,
      this.drawer,
      this.fb,
      this.dark,
      this.fb.rect(),
      {
        font: f.font,
        oneIsZero: f.oneIsZero,
        scaleX: f.scaleX,
        scaleY: f.scaleY,
        frags: this.gameMode.frags(),
        showMap: this.ongoingShowMap,
        drawFrames: this.ongoingDrawFrames,
        actionTimeMatters: this.gameMode.actionTimeMatters(),
        currentFps: Math.trunc(this.fps),
        nextLevel: 0,
        completeTime: 0,
        timeLimit: level.general.timeLimit,
        hidePlayersFromMap: this.gameMode.hidePlayersFromMap(),
        drawEnemiesOnMap: !this.gameMode.hidePlayersFromMap(),
        reachableOnMap: false,
        names: [this.opts.data.name[0]],
        kills: [0],
      },
      (Date.now() / 1000) >>> 0,
      player,
      this.stats,
    );
    this.messageBoard.setDrawOffset(this.gameMode.frags() ? 16 : 0);
    this.resetKeyQueue();
    this.startFadeIn(this.ingamePalette);
  }

  /** `CDynGameData::NextLevel` + `SetLatestLevel` at the level transition. */
  private finishLevel(): void {
    this.completeTime = this.session?.completeTime ?? 0;
    this.stats.latest = this.currentLevel;
    this.currentLevel++;
  }

  private runOngoing(): void {
    const session = this.session;
    if (!session) return;
    session.currentFps = Math.trunc(this.fps);
    session.step(this.gameInput());
    if (session.allPlayersDead()) {
      session.completeTime = session.timeLimit;
      this.gameOver = true;
      this.finishLevel();
      this.startZoomOut(MainState.Game, GameState.Statistics);
      return;
    }
    if (session.nextLevel >= KLevelCompleteDelay || this.userQuit) {
      this.finishLevel();
      this.startFadeOut(MainState.Game, GameState.Statistics);
    }
  }

  private runShop(): void {
    const player = this.player;
    if (!player) return;
    if (this.first()) {
      this.shop.playerDone = false;
      this.shop.resetSelection();
      this.shop.updatePrices(this.shopRng);
      this.resetKeyQueue();
      this.startFadeIn(this.menuData.palettes[PaletteNo.Shop]);
    }
    const keys = this.opts.data.keys[0];
    let key = this.nextKey();
    while (key) {
      const sym = key.sym;
      if (sym === SDLK.ESCAPE) this.shop.playerDone = true;
      else if (sym === SDLK.DOWN || sym === keys[TPlayerKeys.DOWN]) this.shop.bigIncItem();
      else if (sym === SDLK.UP || sym === keys[TPlayerKeys.UP]) this.shop.bigDecItem();
      else if (
        sym === SDLK.LEFT ||
        sym === keys[TPlayerKeys.LEFT] ||
        sym === keys[TPlayerKeys.LSTRAFE]
      )
        this.shop.decItem();
      else if (
        sym === SDLK.RIGHT ||
        sym === keys[TPlayerKeys.RIGHT] ||
        sym === keys[TPlayerKeys.RSTRAFE]
      )
        this.shop.incItem();
      else if (
        sym === SDLK.RETURN ||
        (sym === keys[TPlayerKeys.SHOOT] && keys[TPlayerKeys.SHIFT] !== SDLK.BACKSPACE)
      )
        shopBuy(player, this.shop, 1);
      else if (
        sym === SDLK.BACKSPACE ||
        (sym === keys[TPlayerKeys.SHIFT] && keys[TPlayerKeys.SHIFT] !== SDLK.RETURN)
      )
        shopSell(player, this.shop, 1);
      else if (sym === SDLK.PAGEDOWN) shopSell(player, this.shop, 25);
      else if (sym === SDLK.PAGEUP) shopBuy(player, this.shop, 25);
      key = this.nextKey();
    }

    if (this.shop.playerDone) {
      this.shop.playerDone = false;
      this.shop.setSkipOnce();
      this.startFadeOut(MainState.Game, GameState.OnGoing);
    }
  }

  private runStatistics(): void {
    if (this.first()) {
      this.resetKeyQueue();
      if (this.player) {
        const level = this.levelFor(this.stats.latest);
        this.timeBonus = givePlayerPrize(
          this.player,
          this.stats,
          level?.general.timeLimit ?? 0,
          this.completeTime,
          this.gameOver,
          this.userQuit,
        );
      }
      this.startFadeIn(this.menuData.palettes[PaletteNo.Shop]);
    }
    if (!this.nextKey()) return;
    if (this.gameOver || this.userQuit) {
      this.gameOver = false;
      this.userQuit = false;
      this.startFadeOut(MainState.Menu, 0);
      return;
    }
    if (this.currentLevel >= this.levelsInEpisode) {
      this.startFadeOut(MainState.Game, GameState.Victory);
    } else {
      this.startFadeOut(MainState.Game, GameState.NextLevel);
    }
  }

  private runVictory(): void {
    if (this.first()) this.startFadeIn(this.menuData.palettes[PaletteNo.Victory]);
    if (this.nextKey()) this.startFadeOut(MainState.Menu, 0);
  }

  private runGameQuit(): void {
    const key = this.nextKey();
    if (!key) return;
    if (key.sym !== "y".charCodeAt(0)) {
      this.restoreState();
      this.resetKeyQueue();
      return;
    }
    this.restoreState();
    if (this.gameState !== GameState.OnGoing) {
      this.startFadeOut(MainState.Menu, 0);
    } else {
      // `CDynGameData::iUserQuit` — the ongoing state then rolls to statistics.
      this.userQuit = true;
    }
  }

  private drawGameQuit(): void {
    const f = this.fontSet.get(GameFont.SmallFont);
    fontWrite(
      f.font,
      this.fb,
      Math.trunc(this.fb.width / 2),
      Math.trunc(this.fb.height / 2),
      "REALLY WANNA QUIT ?(y)",
      VAlign.InVertMiddle,
      HAlign.InMiddle,
      f.oneIsZero,
      f.scaleX,
      f.scaleY,
    );
  }

  private runGame(): void {
    switch (this.gameState) {
      case GameState.NextLevel:
        this.runNextLevel();
        break;
      case GameState.LevelInfo:
        this.runLevelInfo();
        break;
      case GameState.OnGoing:
        this.runOngoing();
        break;
      case GameState.Quit:
        this.runGameQuit();
        break;
      case GameState.Statistics:
        this.runStatistics();
        break;
      case GameState.Victory:
        this.runVictory();
        break;
      case GameState.Shop:
        this.runShop();
        break;
      default:
        break;
    }
  }

  private drawGame(): void {
    switch (this.gameState) {
      case GameState.LevelInfo:
        this.drawLevelInfo();
        break;
      case GameState.OnGoing:
        this.session?.draw();
        break;
      case GameState.Victory:
        this.fb.pixels.set(this.menuData.sprites.victoryScreen.pixels);
        break;
      case GameState.Quit:
        this.session?.draw();
        this.drawGameQuit();
        break;
      case GameState.Statistics:
        this.drawStatisticsScreen();
        break;
      case GameState.Shop:
        this.drawShopScreen();
        break;
      default:
        break;
    }
  }

  private drawStatisticsScreen(): void {
    const ctx: StatisticsContext = {
      fb: this.fb,
      menuData: this.menuData,
      fonts: this.fontSet,
      stats: this.stats,
      playerName: this.stats.player(0)?.name ?? "",
      actionTimeMatters: this.gameMode.actionTimeMatters(),
      frags: this.gameMode.frags(),
      gameOver: this.gameOver,
      userQuit: this.userQuit,
      timeBonus: this.timeBonus,
      timeLimit: this.levelFor(this.stats.latest)?.general.timeLimit ?? 0,
      completeTime: this.completeTime,
      playerCash: this.player?.cash ?? 0,
    };
    drawStatistics(ctx);
  }

  private drawShopScreen(): void {
    if (!this.player) return;
    const ctx: ShopContext = {
      fb: this.fb,
      menuData: this.menuData,
      fonts: this.fontSet,
      player: this.player,
      playerName: this.stats.player(this.shop.player)?.name ?? "",
    };
    drawShop(ctx, this.shop);
  }

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  private writeText(
    handle: ReturnType<SystemFonts["get"]>,
    x: number,
    y: number,
    text: string,
    v: VAlign,
    h: HAlign,
  ): void {
    fontWrite(
      handle.font,
      this.fb,
      x,
      y,
      text,
      v,
      h,
      handle.oneIsZero,
      handle.scaleX,
      handle.scaleY,
    );
  }

  private resetKeyQueue(): void {
    this.keyQueue.length = 0;
  }

  private nextKey(): KeyPress | null {
    return this.keyQueue.length > 0 ? this.keyQueue.shift()! : null;
  }

  private get canvas(): HTMLCanvasElement {
    return this.presenter.canvas;
  }

  // ------------------------------------------------------------------
  // MenuHost
  // ------------------------------------------------------------------

  options(): Options {
    return this.opts;
  }
  fonts(): SystemFonts {
    return this.fontSet;
  }
  buffer(): Framebuffer {
    return this.fb;
  }
  playerName(index: number): string {
    return this.opts.data.name[index];
  }
  setPlayerName(index: number, value: string): void {
    this.opts.data.name[index] = value;
  }
  mouseModeText(): string {
    return this.opts.mouseModeText();
  }
  gameModeName(index: number): string {
    return index === 0 ? "cooperative" : "deathmatch";
  }
  gameModeCount(): number {
    return 2;
  }
  gameModeStartFromAnyLevel(index: number): boolean {
    return index !== 0;
  }
  gameModeDMEpisodes(index: number): boolean {
    return index !== 0;
  }
  changeState(state: MenuState): void {
    if (state === MenuState.Quit) {
      this.setState(MainState.Quit, 0);
      return;
    }
    this.menuContainer.changeState(state);
  }
  skipDrawOnce(): void {
    this.menuContainer?.skipDrawOnce();
  }
  doFullRedraw(): void {
    this.menuContainer?.doFullRedraw();
  }
  valueUpdated(_item: MenuItem): void {
    // Gamma/audio side effects are handled by the items themselves.
  }
  addMessage(message: string): void {
    this.messageBoard.addMessage(message, this.clock);
  }
  execSingleGame(episode: number): void {
    this.startGame(new GameMode(false), episode, 0);
  }
  execMultiplay(): void {
    const opt = this.opts.data;
    this.startGame(
      new GameMode(opt.multiPlayGameMode !== 0),
      opt.multiPlayEpisode,
      opt.multiPlayLevel,
    );
  }
  rand(maxExclusive: number): number {
    return this.menuRng.rand() % maxExclusive;
  }
  timerCounter(): number {
    return this.clock;
  }
  fullScreenChanged(): void {}
  updateLargeTextMode(large: boolean): void {
    this.fontSet.updateLargeTextMode(large);
  }
  updateAudioChanges(): void {}
  cycleResolution(_forward: boolean): void {}
  requestQuit(): void {
    this.setState(MainState.Quit, 0);
  }

  // ------------------------------------------------------------------
  // input
  // ------------------------------------------------------------------

  private installInput(): void {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const sym = codeToSdlKey(e.code);
      this.heldCodes.add(e.code);
      this.keyQueue.push({ sym, unicode: e.key.length === 1 ? e.key.charCodeAt(0) : 0 });
      this.handleGlobalKey(e.code);
    });
    window.addEventListener("keyup", (e) => this.heldCodes.delete(e.code));
    window.addEventListener("blur", () => {
      this.heldCodes.clear();
      this.rawButtons = 0;
    });
    this.canvas.addEventListener("mousedown", (e) => {
      if (this.inOngoing()) {
        if (document.pointerLockElement !== this.canvas) {
          void this.canvas.requestPointerLock();
          return;
        }
      }
      if (e.button === 0) this.rawButtons |= MouseButton.Left;
      if (e.button === 2) this.rawButtons |= MouseButton.Right;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.rawButtons &= ~MouseButton.Left;
      if (e.button === 2) this.rawButtons &= ~MouseButton.Right;
    });
    window.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement === this.canvas) this.mouseDX += e.movementX;
    });
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.wheelTicks += e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0;
      },
      { passive: false },
    );
  }

  private inOngoing(): boolean {
    return this.mainState === MainState.Game && this.gameState === GameState.OnGoing;
  }

  private handleGlobalKey(code: string): void {
    if (this.inOngoing()) {
      switch (code) {
        case "F5":
          this.ongoingShowMap = !this.ongoingShowMap;
          break;
        case "F6":
          this.ongoingDrawFrames = !this.ongoingDrawFrames;
          break;
        case "PageUp":
        case "PageDown": {
          const world = this.session?.world;
          if (!world) break;
          const delta = code === "PageUp" ? 0.05 : -0.05;
          world.mouseSensitivity = Math.min(Math.max(world.mouseSensitivity + delta, 0), 10);
          this.messageBoard.addMessage(
            `Mouse sensitivity ${(world.mouseSensitivity * 100).toFixed(2)}`,
            this.clock,
          );
          break;
        }
        case "Escape":
          if (document.pointerLockElement === this.canvas) void document.exitPointerLock();
          this.setStateAndSave(MainState.Game, GameState.Quit);
          break;
        default:
          break;
      }
      return;
    }
    if (code === "PageUp" || code === "PageDown") {
      this.messageBoard.addMessage("Mouse sensitivity", this.clock);
    }
  }

  private gameInput(): SimInput {
    let buttons = 0;
    if (this.rawButtons & MouseButton.Left) buttons |= MouseButton.Left;
    if (this.rawButtons & MouseButton.Right) buttons |= MouseButton.Right;
    if (this.wheelTicks > 0) buttons |= MouseButton.WheelDown;
    else if (this.wheelTicks < 0) buttons |= MouseButton.WheelUp;
    return { keys: keyMask(this.heldCodes), mouseXRel: this.mouseDX, mouseButtons: buttons };
  }

  // ------------------------------------------------------------------
  // dev hooks
  // ------------------------------------------------------------------

  installDevHooks(): void {
    window.tk4Ready = true;
    window.tk4App = this;
    window.tk4Give = (weapon: number, ammo = 500) => {
      const session = this.session;
      if (!session) return;
      session.player.weapons[weapon] = 1;
      session.player.bullets[WeaponTypes[weapon].bulletType] = ammo;
      session.player.curWeapon = weapon as typeof session.player.curWeapon;
    };
    window.tk4Msg = (message: string) => this.messageBoard.addMessage(message, this.clock);
    window.tk4State = () => {
      const session = this.session;
      if (!session) {
        return {
          x: 0,
          y: 0,
          angle: 0,
          energy: 0,
          weapon: WeaponId.Pistol,
          ammo: 0,
          bullets: 0,
          enemies: 0,
          crates: 0,
          bodyparts: 0,
          effects: 0,
          cash: this.player?.cash ?? 0,
          state: this.mainState,
          sub: this.gameState,
        };
      }
      const p = session.player;
      return {
        x: p.x,
        y: p.y,
        angle: p.angle,
        energy: p.energy,
        weapon: p.curWeapon,
        ammo: p.bullets[WeaponTypes[p.curWeapon].bulletType],
        bullets: session.world.bullets.length,
        enemies: session.world.enemies.length,
        crates: session.world.crates.filter((c) => c.inUse).length,
        bodyparts: session.world.bodyparts.length,
        effects: session.world.effects.length,
        cash: p.cash,
        state: this.mainState,
        sub: this.gameState,
      };
    };
    window.tk4Start = (episode = 0) => this.execSingleGame(episode);
  }
}

function keyMask(held: ReadonlySet<string>): number {
  let k = 0;
  if (held.has("KeyW") || held.has("ArrowUp")) k |= Key.Up;
  if (held.has("KeyS") || held.has("ArrowDown")) k |= Key.Down;
  if (held.has("ArrowLeft")) k |= Key.Left;
  if (held.has("ArrowRight")) k |= Key.Right;
  if (held.has("KeyA")) k |= Key.LeftStrafe;
  if (held.has("KeyD")) k |= Key.RightStrafe;
  if (held.has("Space")) k |= Key.Shoot;
  if (held.has("ShiftLeft") || held.has("ShiftRight")) k |= Key.Shift;
  return k;
}

function formatTime(seconds: number): string {
  return `${Math.trunc(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
