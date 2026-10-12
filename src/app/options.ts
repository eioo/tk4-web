/**
 * `COptionsData` / `COptions` — the in-memory options plus the episode and
 * music-theme lists. Persistence to disk (`options.cfg`) is M8; here the
 * defaults come from `COptionsData::Reset` and the lists from the asset
 * manifest (the browser cannot `scandir`, so `tools/build-assets.ts` emits the
 * same listing the original builds from `levs/` and `music/`).
 */

import { SDLK } from "./keys";

/** `KMaxLocalPlayers`. */
export const KMaxLocalPlayers = 4;
/** `KPlayerRunSpeed`. */
export const KPlayerRunSpeed = 1.0;

export const KMusicVolumeMin = 0.0;
export const KMusicVolumeMax = 1.0;
export const KMusicVolumeStep = 0.05;
export const KEffectVolumeMin = 0.0;
export const KEffectVolumeMax = 1.0;
export const KEffectVolumeStep = 0.05;
export const KMouseSensitivityMin = 0.0;
export const KMouseSensitivityMax = 10.0;
export const KMouseSensitivityStep = 0.05;
export const KPlayerNameMaxLength = 15;
export const DEFAULT_MUSICTHEME = "default";

/**
 * `CGraphicsDevice::iResolutions` for the browser (the original queries SDL).
 * Ascending, deduplicated, ≥ 320×200, as `ListVideoModes` builds it. The port's
 * framebuffer stays at 640×480 and the presenter scales to the window, so this
 * is a stored preference only (docs/12).
 */
export const VIDEO_MODES: readonly { readonly x: number; readonly y: number }[] = [
  { x: 320, y: 200 },
  { x: 320, y: 240 },
  { x: 400, y: 300 },
  { x: 512, y: 384 },
  { x: 640, y: 480 },
  { x: 800, y: 600 },
  { x: 1024, y: 768 },
  { x: 1152, y: 864 },
  { x: 1280, y: 960 },
  { x: 1600, y: 1200 },
];

/** `KDefaultResolution`. */
export const KDefaultResolution = { x: 640, y: 480 } as const;

/** `CGraphicsDevice::NextRes` / `PrevRes`. */
export function stepResolution(
  current: { x: number; y: number },
  forward: boolean,
): { x: number; y: number } {
  const index = VIDEO_MODES.findIndex((m) => m.x === current.x && m.y === current.y);
  if (index === -1) return { ...KDefaultResolution };
  const next = forward
    ? (index + 1) % VIDEO_MODES.length
    : (index - 1 + VIDEO_MODES.length) % VIDEO_MODES.length;
  return { x: VIDEO_MODES[next].x, y: VIDEO_MODES[next].y };
}

/** `TPlayerKeys`. */
export const enum TPlayerKeys {
  LEFT = 0,
  RIGHT,
  UP,
  DOWN,
  SHOOT,
  SHIFT,
  STRAFE,
  LSTRAFE,
  RSTRAFE,
  Amount,
}

/** `k_text` — labels for the key-binding menu. */
export const KEY_TEXT: readonly string[] = [
  "turn c.clockw.",
  "turn clockw.",
  "walk forward",
  "walk backward",
  "fire",
  "change weapon",
  "strafe",
  "strafe left",
  "strafe right",
];

export type Keys = number[];

export interface EpisodeLevel {
  file: string;
  name: string;
}

export interface Episode {
  name: string;
  /** Present for directory episodes; omitted for the synthesized Deathmatch one. */
  dir?: string;
  levels: EpisodeLevel[];
}

const KDefaultName = ["John", "Paul", "George", "Ringo"];

export class OptionsData {
  keys: Keys[] = [];
  name: string[] = [];

  gamma = 1.0;
  musicVolume = 1.0;
  effectsVolume = 1.0;

  enemiesOnGame = true;
  multiPlayLevel = 0;
  multiPlayGameMode = 0;
  multiPlayers = 2;
  multiPlayEpisode = 1;
  dmSpeed = KPlayerRunSpeed;
  dmTargetSystem = false;

  stereo = false;
  fullScreen = true;
  mouseSensitivity = 0.5;
  mouseMode = 1;
  inGameVideoMode = { x: 640, y: 480 };
  inGameLargeText = false;
  musicTheme = DEFAULT_MUSICTHEME;
  webVersionCheckingEnabled = false;
  proxyEnabled = false;
  proxyAddr = "";
  proxyPort = "";

  constructor() {
    this.reset();
  }

  /** `COptionsData::Reset`. */
  reset(): void {
    this.gamma = 1.0;
    this.musicVolume = 1.0;
    this.effectsVolume = 1.0;
    this.enemiesOnGame = true;
    this.dmSpeed = KPlayerRunSpeed;
    this.stereo = false;
    this.fullScreen = true;
    this.mouseSensitivity = 0.5;
    this.mouseMode = 1;
    this.inGameVideoMode = { x: 640, y: 480 };
    this.inGameLargeText = false;
    this.webVersionCheckingEnabled = false;
    this.proxyEnabled = false;
    this.proxyAddr = "";
    this.proxyPort = "";
    this.multiPlayGameMode = 0;
    this.multiPlayEpisode = 1;
    this.multiPlayLevel = 0;
    this.multiPlayers = 2;
    this.musicTheme = DEFAULT_MUSICTHEME;
    this.dmTargetSystem = false;
    this.name = KDefaultName.slice();

    this.keys = [];
    for (let a = 0; a < KMaxLocalPlayers; a++) {
      this.keys.push(Array.from({ length: TPlayerKeys.Amount }, () => SDLK.UNKNOWN));
    }

    const k0 = this.keys[0];
    k0[TPlayerKeys.UP] = "w".charCodeAt(0);
    k0[TPlayerKeys.DOWN] = "s".charCodeAt(0);
    k0[TPlayerKeys.SHOOT] = SDLK.SPACE;
    k0[TPlayerKeys.LSTRAFE] = "a".charCodeAt(0);
    k0[TPlayerKeys.RSTRAFE] = "d".charCodeAt(0);

    const k1 = this.keys[1];
    k1[TPlayerKeys.LEFT] = "j".charCodeAt(0);
    k1[TPlayerKeys.RIGHT] = "l".charCodeAt(0);
    k1[TPlayerKeys.UP] = "i".charCodeAt(0);
    k1[TPlayerKeys.DOWN] = "k".charCodeAt(0);
    k1[TPlayerKeys.SHOOT] = "y".charCodeAt(0);
    k1[TPlayerKeys.SHIFT] = "t".charCodeAt(0);
    k1[TPlayerKeys.STRAFE] = "h".charCodeAt(0);
    k1[TPlayerKeys.LSTRAFE] = "u".charCodeAt(0);
    k1[TPlayerKeys.RSTRAFE] = "o".charCodeAt(0);
  }
}

export class Options {
  readonly data = new OptionsData();
  readonly episodes: Episode[];
  readonly dmEpisodes: Episode[];
  readonly musicThemes: string[];

  constructor(
    deathmatchLevels: EpisodeLevel[],
    episodes: Episode[],
    musicThemes: string[] = [DEFAULT_MUSICTHEME],
  ) {
    this.episodes = episodes;
    this.dmEpisodes = [{ name: "Deathmatch", levels: deathmatchLevels }, ...episodes];
    this.musicThemes = musicThemes.length > 0 ? musicThemes : [DEFAULT_MUSICTHEME];
    this.sanityCheck();
  }

  private dm(): boolean {
    return this.data.multiPlayGameMode !== 0;
  }

  private sanityCheck(): void {
    if (this.episodeAmount(this.dm()) <= this.data.multiPlayEpisode) {
      this.data.multiPlayEpisode = 0;
      this.data.multiPlayLevel = 0;
    }
    if (
      this.episode(this.data.multiPlayEpisode, this.dm()).levels.length <= this.data.multiPlayLevel
    ) {
      this.data.multiPlayLevel = 0;
    }
  }

  /** `CEpisodeList::Episode` (DM list is only used by deathmatch). */
  episode(index: number, dm: boolean): Episode {
    return dm ? this.dmEpisodes[index] : this.episodes[index];
  }

  /** `CEpisodeList::Amount`. */
  episodeAmount(dm: boolean): number {
    return dm ? this.dmEpisodes.length : this.episodes.length;
  }

  /** `COptions::MouseModeText`. */
  mouseModeText(): string {
    switch (this.data.mouseMode) {
      case 0:
        return "None";
      case 1:
        return "Player 1";
      case 2:
        return "Player 2";
      case 3:
        return "Player 3";
      case 4:
        return "Player 4";
      default:
        return "None";
    }
  }

  /** `COptions::Reset`. */
  reset(): void {
    this.data.reset();
  }

  /** Re-runs the DM episode/level sanity checks (after loading saved options). */
  validate(): void {
    this.sanityCheck();
  }
}
