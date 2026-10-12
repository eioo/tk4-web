/**
 * Netplay wire protocol — shared by the client (`src/net/client.ts`) and the
 * servers (`tools/net-server.ts`, `tools/serve.ts`).
 *
 * Design: `docs/multiplayer/02-protocol.md`. JSON messages with a `t`
 * discriminant; `parse*` functions are defensive and return `null` for anything
 * malformed so callers can drop the message (or close the socket).
 */

/** Bumped on any breaking message change; mismatches are rejected. */
export const PROTOCOL_VERSION = 1;

export const KROOM_CODE_LENGTH = 5;
export const KROOM_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const KMIN_PLAYERS = 2;
export const KMAX_PLAYERS = 4;
export const KMAX_NAME_LENGTH = 15;
export const KDEFAULT_FRAG_LIMIT = 20;
export const KFRAG_LIMIT_MIN = 5;
export const KFRAG_LIMIT_MAX = 50;
/** Deathmatch move-speed range (`OptionsData.dmSpeed`). */
export const KDM_SPEED_MIN = 0.5;
export const KDM_SPEED_MAX = 5.0;

/** Reject oversized frames (a `ready` with two small arrays is well under). */
export const KMAX_MESSAGE_BYTES = 4096;

/** Server tick period: 100 Hz, matching `KTimerFreq`. */
export const KTICK_MS = 10;
/** How long an empty room survives before it is destroyed. */
export const KROOM_EMPTY_GRACE_MS = 30_000;

/** One seat's input for one tick (mirrors `src/sim/world.ts` `SimInput`). */
export interface SimInput {
  keys: number;
  mouseXRel: number;
  mouseButtons: number;
}

export const ZERO_INPUT: SimInput = { keys: 0, mouseXRel: 0, mouseButtons: 0 };

/** `IGameMode` selector on the wire (0 = cooperative, 1 = deathmatch). */
export const enum NetGameMode {
  Cooperative = 0,
  Deathmatch = 1,
}

export interface NetSettings {
  gameMode: number;
  episode: number;
  level: number;
  players: number;
  fragLimit: number;
  /** Sim-affecting host options, broadcast so every client matches. */
  enemies: boolean;
  dmSpeed: number;
  targetSystem: boolean;
}

export interface PlayerSlot {
  seat: number;
  name: string;
  connected: boolean;
}

export type RoomPhase = "lobby" | "playing" | "intermission";

export interface RoomInfo {
  code: string;
  hostSeat: number;
  settings: NetSettings;
  players: PlayerSlot[];
  phase: RoomPhase;
}

/** Persistent per-seat state carried across levels. */
export interface NetPlayerState {
  name: string;
  cash: number;
  weapons: number[];
  bullets: number[];
  shield: number;
  /** Equipped weapon / secondary (`CPlayer::iCurWeapon` / `iSecWeapon`). */
  curWeapon: number;
  secWeapon: number;
  frags: number;
}

export interface RosterEntry {
  seat: number;
  name: string;
}

export type MatchEndReason = "fragLimit" | "victory" | "quit";

/** Client → server. */
export type ClientMessage =
  | { t: "host"; v: number; name: string; settings: NetSettings }
  | { t: "join"; v: number; name: string; code: string }
  | { t: "settings"; settings: NetSettings }
  | { t: "input"; keys: number; mouseXRel: number; mouseButtons: number }
  | { t: "loaded" }
  | { t: "levelEnd"; last: boolean }
  | { t: "matchEnd"; reason: MatchEndReason }
  | { t: "ready"; state: NetPlayerState }
  | { t: "leave" };

/** Server → client. */
export type ServerMessage =
  | { t: "hosted"; code: string; seat: number; room: RoomInfo }
  | { t: "joined"; code: string; seat: number; room: RoomInfo }
  | { t: "lobby"; room: RoomInfo }
  | { t: "error"; code: string; message: string }
  | {
      t: "levelStart";
      index: number;
      seed: number;
      shopSeed: number;
      /**
       * Per-seat persistent state, seat-ordered. `null` (the whole array) means
       * the episode's first level: use the fresh start loadout. A `null` entry
       * means that seat has no known state (e.g. it left before its first
       * `ready`): the client substitutes a fresh loadout for it.
       *
       * Whether this is the episode's last level is derived by the client from
       * the episode length; the server has no level data.
       */
      states: (NetPlayerState | null)[] | null;
      roster: RosterEntry[];
    }
  | { t: "tick"; tick: number; inputs: SimInput[] }
  | { t: "seat"; seat: number }
  | { t: "peerLeft"; seat: number }
  | { t: "hostChanged"; seat: number }
  | { t: "matchEnded"; reason: MatchEndReason }
  | { t: "left" };

/** Error codes shared so the client can map them to readable text. */
export const enum NetErrorCode {
  BadVersion = "bad-version",
  NoRoom = "no-room",
  RoomFull = "room-full",
  InProgress = "in-progress",
  BadCode = "bad-code",
  BadSettings = "bad-settings",
  NotHost = "not-host",
}

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isFiniteNumber);
}

function isSettings(value: unknown): value is NetSettings {
  if (!isRecord(value)) return false;
  return (
    isNonNegativeInt(value.gameMode) &&
    isNonNegativeInt(value.episode) &&
    isNonNegativeInt(value.level) &&
    isNonNegativeInt(value.players) &&
    isNonNegativeInt(value.fragLimit) &&
    typeof value.enemies === "boolean" &&
    isFiniteNumber(value.dmSpeed) &&
    typeof value.targetSystem === "boolean"
  );
}

function isPlayerState(value: unknown): value is NetPlayerState {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === "string" &&
    isFiniteNumber(value.cash) &&
    isNumberArray(value.weapons) &&
    isNumberArray(value.bullets) &&
    isFiniteNumber(value.shield) &&
    isFiniteNumber(value.curWeapon) &&
    isFiniteNumber(value.secWeapon) &&
    isFiniteNumber(value.frags)
  );
}

function isMatchEndReason(value: unknown): value is MatchEndReason {
  return value === "fragLimit" || value === "victory" || value === "quit";
}

export function parseClientMessage(text: string): ClientMessage | null {
  const value = parseJson(text);
  if (!isRecord(value)) return null;
  switch (value.t) {
    case "host":
      if (!isNonNegativeInt(value.v) || typeof value.name !== "string") return null;
      if (!isSettings(value.settings)) return null;
      return { t: "host", v: value.v, name: value.name, settings: value.settings };
    case "join":
      if (!isNonNegativeInt(value.v) || typeof value.name !== "string") return null;
      if (typeof value.code !== "string") return null;
      return { t: "join", v: value.v, name: value.name, code: value.code };
    case "settings":
      if (!isSettings(value.settings)) return null;
      return { t: "settings", settings: value.settings };
    case "input":
      if (
        !isFiniteNumber(value.keys) ||
        !isFiniteNumber(value.mouseXRel) ||
        !isFiniteNumber(value.mouseButtons)
      )
        return null;
      return {
        t: "input",
        keys: value.keys,
        mouseXRel: value.mouseXRel,
        mouseButtons: value.mouseButtons,
      };
    case "levelEnd":
      if (typeof value.last !== "boolean") return null;
      return { t: "levelEnd", last: value.last };
    case "loaded":
      return { t: "loaded" };
    case "matchEnd":
      if (!isMatchEndReason(value.reason)) return null;
      return { t: "matchEnd", reason: value.reason };
    case "ready":
      if (!isPlayerState(value.state)) return null;
      return { t: "ready", state: value.state };
    case "leave":
      return { t: "leave" };
    default:
      return null;
  }
}

function isRoomInfo(value: unknown): value is RoomInfo {
  if (!isRecord(value)) return false;
  if (typeof value.code !== "string") return false;
  if (!isNonNegativeInt(value.hostSeat)) return false;
  if (!isSettings(value.settings)) return false;
  if (value.phase !== "lobby" && value.phase !== "playing" && value.phase !== "intermission")
    return false;
  if (!Array.isArray(value.players)) return false;
  return value.players.every(
    (p) =>
      isRecord(p) &&
      isNonNegativeInt(p.seat) &&
      typeof p.name === "string" &&
      typeof p.connected === "boolean",
  );
}

function isSimInput(value: unknown): value is SimInput {
  return (
    isRecord(value) &&
    isFiniteNumber(value.keys) &&
    isFiniteNumber(value.mouseXRel) &&
    isFiniteNumber(value.mouseButtons)
  );
}

export function parseServerMessage(text: string): ServerMessage | null {
  const value = parseJson(text);
  if (!isRecord(value)) return null;
  switch (value.t) {
    case "hosted":
    case "joined":
      if (typeof value.code !== "string" || !isNonNegativeInt(value.seat)) return null;
      if (!isRoomInfo(value.room)) return null;
      return { t: value.t, code: value.code, seat: value.seat, room: value.room };
    case "lobby":
      if (!isRoomInfo(value.room)) return null;
      return { t: "lobby", room: value.room };
    case "error":
      if (typeof value.code !== "string" || typeof value.message !== "string") return null;
      return { t: "error", code: value.code, message: value.message };
    case "levelStart": {
      if (
        !isNonNegativeInt(value.index) ||
        !isNonNegativeInt(value.seed) ||
        !isNonNegativeInt(value.shopSeed)
      )
        return null;
      let states: (NetPlayerState | null)[] | null = null;
      if (value.states !== null) {
        if (
          !Array.isArray(value.states) ||
          !value.states.every((s) => s === null || isPlayerState(s))
        )
          return null;
        states = value.states as (NetPlayerState | null)[];
      }
      if (!Array.isArray(value.roster)) return null;
      const roster = value.roster.every(
        (r) => isRecord(r) && isNonNegativeInt(r.seat) && typeof r.name === "string",
      );
      if (!roster) return null;
      return {
        t: "levelStart",
        index: value.index,
        seed: value.seed,
        shopSeed: value.shopSeed,
        states,
        roster: value.roster as RosterEntry[],
      };
    }
    case "tick":
      if (!isNonNegativeInt(value.tick)) return null;
      if (!Array.isArray(value.inputs) || !value.inputs.every(isSimInput)) return null;
      return { t: "tick", tick: value.tick, inputs: value.inputs };
    case "seat":
      if (!isNonNegativeInt(value.seat)) return null;
      return { t: "seat", seat: value.seat };
    case "peerLeft":
      if (!isNonNegativeInt(value.seat)) return null;
      return { t: "peerLeft", seat: value.seat };
    case "hostChanged":
      if (!isNonNegativeInt(value.seat)) return null;
      return { t: "hostChanged", seat: value.seat };
    case "matchEnded":
      if (!isMatchEndReason(value.reason)) return null;
      return { t: "matchEnded", reason: value.reason };
    case "left":
      return { t: "left" };
    default:
      return null;
  }
}
