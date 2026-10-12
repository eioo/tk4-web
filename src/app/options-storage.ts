/**
 * `COptions` persistence (`options.cfg`). The original serialises the raw
 * `COptionsData` struct; the browser port stores the same fields as versioned
 * JSON under a `localStorage` key. Loading is defensive: unknown fields are
 * ignored, numeric fields are clamped to the menu ranges, and a missing or
 * malformed entry leaves the defaults from `COptionsData::Reset` untouched.
 */

import { KFRAG_LIMIT_MAX, KFRAG_LIMIT_MIN } from "../net/protocol";
import {
  KEffectVolumeMax,
  KEffectVolumeMin,
  KMaxLocalPlayers,
  KMouseSensitivityMax,
  KMouseSensitivityMin,
  KMusicVolumeMax,
  KMusicVolumeMin,
  KPlayerNameMaxLength,
  type OptionsData,
  TPlayerKeys,
} from "./options";

/** Versioned storage key (docs/12 recommends pinning a version). */
export const OPTIONS_STORAGE_KEY = "tk4-web.options.v1";
const OPTIONS_VERSION = 1;

/** `SDL_SetGamma` clamps. */
export const KMinGamma = 0.1;
export const KMaxGamma = 3.0;

/** The minimal `localStorage` surface we use (injectable for tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Returns `localStorage` when available (it can throw in private modes). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isStr = (v: unknown): v is string => typeof v === "string";

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Serialises the options to versioned JSON (trailing name spaces trimmed). */
export function serializeOptions(data: OptionsData): string {
  return JSON.stringify({
    version: OPTIONS_VERSION,
    gamma: data.gamma,
    musicVolume: data.musicVolume,
    effectsVolume: data.effectsVolume,
    enemiesOnGame: data.enemiesOnGame,
    multiPlayLevel: data.multiPlayLevel,
    multiPlayGameMode: data.multiPlayGameMode,
    multiPlayers: data.multiPlayers,
    multiPlayEpisode: data.multiPlayEpisode,
    dmSpeed: data.dmSpeed,
    dmTargetSystem: data.dmTargetSystem,
    dmFragLimit: data.dmFragLimit,
    stereo: data.stereo,
    fullScreen: data.fullScreen,
    mouseSensitivity: data.mouseSensitivity,
    mouseMode: data.mouseMode,
    inGameVideoMode: { x: data.inGameVideoMode.x, y: data.inGameVideoMode.y },
    inGameLargeText: data.inGameLargeText,
    musicTheme: data.musicTheme,
    webVersionCheckingEnabled: data.webVersionCheckingEnabled,
    proxyEnabled: data.proxyEnabled,
    proxyAddr: data.proxyAddr,
    proxyPort: data.proxyPort,
    name: data.name.map((n) => n.replace(/\s+$/, "")),
    keys: data.keys.map((row) => row.slice()),
  });
}

/**
 * Applies a stored blob onto `data`, field by field. Returns `false` (leaving
 * `data` untouched) when the entry is missing, malformed or a different
 * version; otherwise returns `true` even if only some fields were valid.
 */
export function applyOptions(data: OptionsData, raw: string | null): boolean {
  if (!raw) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== OPTIONS_VERSION) return false;

  if (isNum(obj.gamma)) data.gamma = clampNum(obj.gamma, KMinGamma, KMaxGamma);
  if (isNum(obj.musicVolume))
    data.musicVolume = clampNum(obj.musicVolume, KMusicVolumeMin, KMusicVolumeMax);
  if (isNum(obj.effectsVolume))
    data.effectsVolume = clampNum(obj.effectsVolume, KEffectVolumeMin, KEffectVolumeMax);
  if (isBool(obj.enemiesOnGame)) data.enemiesOnGame = obj.enemiesOnGame;
  if (isNum(obj.multiPlayLevel)) data.multiPlayLevel = Math.max(0, Math.trunc(obj.multiPlayLevel));
  if (isNum(obj.multiPlayGameMode)) data.multiPlayGameMode = obj.multiPlayGameMode === 0 ? 0 : 1;
  if (isNum(obj.multiPlayers))
    data.multiPlayers = clampNum(Math.trunc(obj.multiPlayers), 1, KMaxLocalPlayers);
  if (isNum(obj.multiPlayEpisode))
    data.multiPlayEpisode = Math.max(0, Math.trunc(obj.multiPlayEpisode));
  if (isNum(obj.dmSpeed)) data.dmSpeed = clampNum(obj.dmSpeed, 0.5, 5.0);
  if (isBool(obj.dmTargetSystem)) data.dmTargetSystem = obj.dmTargetSystem;
  if (isNum(obj.dmFragLimit))
    data.dmFragLimit = Math.min(
      Math.max(Math.trunc(obj.dmFragLimit), KFRAG_LIMIT_MIN),
      KFRAG_LIMIT_MAX,
    );
  if (isBool(obj.stereo)) data.stereo = obj.stereo;
  if (isBool(obj.fullScreen)) data.fullScreen = obj.fullScreen;
  if (isNum(obj.mouseSensitivity))
    data.mouseSensitivity = clampNum(
      obj.mouseSensitivity,
      KMouseSensitivityMin,
      KMouseSensitivityMax,
    );
  if (isNum(obj.mouseMode)) data.mouseMode = clampNum(Math.trunc(obj.mouseMode), 0, 4);
  if (isBool(obj.inGameLargeText)) data.inGameLargeText = obj.inGameLargeText;
  if (isStr(obj.musicTheme) && obj.musicTheme.length > 0) data.musicTheme = obj.musicTheme;
  if (isBool(obj.webVersionCheckingEnabled))
    data.webVersionCheckingEnabled = obj.webVersionCheckingEnabled;
  if (isBool(obj.proxyEnabled)) data.proxyEnabled = obj.proxyEnabled;
  if (isStr(obj.proxyAddr)) data.proxyAddr = obj.proxyAddr;
  if (isStr(obj.proxyPort)) data.proxyPort = obj.proxyPort;

  const mode = obj.inGameVideoMode;
  if (typeof mode === "object" && mode !== null) {
    const m = mode as Record<string, unknown>;
    if (isNum(m.x) && isNum(m.y) && m.x > 0 && m.y > 0) {
      data.inGameVideoMode = { x: Math.trunc(m.x), y: Math.trunc(m.y) };
    }
  }

  if (Array.isArray(obj.name)) {
    for (let i = 0; i < KMaxLocalPlayers; i++) {
      const value = obj.name[i];
      if (isStr(value)) data.name[i] = value.slice(0, KPlayerNameMaxLength - 1);
    }
  }

  if (Array.isArray(obj.keys)) {
    for (let p = 0; p < KMaxLocalPlayers; p++) {
      const row = obj.keys[p];
      if (!Array.isArray(row)) continue;
      for (let k = 0; k < TPlayerKeys.Amount; k++) {
        const value = row[k];
        if (isNum(value) && Number.isInteger(value) && value >= 0) data.keys[p][k] = value;
      }
    }
  }

  // Theme names are validated by the caller (it owns the theme list).
  return true;
}
