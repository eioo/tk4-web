/**
 * Server-side room logic: lobby, roster, the 100 Hz tick master and the
 * progression barriers. Pure TypeScript over a small `Peer` interface so it can
 * be unit-tested without Bun or sockets (the transport adapters live in
 * `tools/net-server.ts` and `tools/serve.ts`).
 *
 * Design: `docs/multiplayer/03-server.md`.
 */

import {
  KDM_SPEED_MAX,
  KDM_SPEED_MIN,
  KFRAG_LIMIT_MAX,
  KFRAG_LIMIT_MIN,
  KMAX_NAME_LENGTH,
  KMAX_PLAYERS,
  KMIN_PLAYERS,
  KROOM_CODE_ALPHABET,
  KROOM_CODE_LENGTH,
  KROOM_EMPTY_GRACE_MS,
  KTICK_MS,
  NetErrorCode,
  PROTOCOL_VERSION,
  ZERO_INPUT,
  type ClientMessage,
  type MatchEndReason,
  type NetPlayerState,
  type NetSettings,
  type PlayerSlot,
  type RoomInfo,
  type RoomPhase,
  type ServerMessage,
  type SimInput,
} from "./protocol";

/** A connected client, as seen by the room manager. */
export interface Peer {
  readonly id: string;
  send(message: ServerMessage): void;
  close(): void;
}

export interface RoomManagerOptions {
  /** Uniform 32-bit unsigned source; injectable for deterministic tests. */
  random32?: () => number;
  /** Millisecond clock; injectable for tests. */
  now?: () => number;
}

const KMAX_TICKS_PER_ADVANCE = 5;
const KMAX_ROOMS = 500;
/** Start ticking anyway if a client never reports its level loaded. */
const KLEVEL_LOAD_TIMEOUT_MS = 15000;
/** Proceed to the next level if a client never reports ready. */
const KREADY_TIMEOUT_MS = 60000;
/** Accept a predicted input at most this many ticks ahead of the server. */
const KMAX_INPUT_LOOKAHEAD = 120;

function cryptoRandom32(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

export function normalizeSettings(raw: NetSettings): NetSettings {
  return {
    gameMode: raw.gameMode === 1 ? 1 : 0,
    episode: Math.max(0, Math.trunc(raw.episode)),
    level: Math.max(0, Math.trunc(raw.level)),
    players: clamp(Math.trunc(raw.players), KMIN_PLAYERS, KMAX_PLAYERS),
    fragLimit: clamp(Math.trunc(raw.fragLimit), KFRAG_LIMIT_MIN, KFRAG_LIMIT_MAX),
    enemies: raw.enemies === true,
    dmSpeed: clamp(raw.dmSpeed, KDM_SPEED_MIN, KDM_SPEED_MAX),
    targetSystem: raw.targetSystem === true,
  };
}

export function normalizeName(name: string): string {
  const trimmed = name.trim().slice(0, KMAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : "Player";
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().slice(0, KROOM_CODE_LENGTH);
}

interface Slot {
  seat: number;
  name: string;
  peer: Peer | null;
  /** Tick-numbered inputs the client predicted, waiting to be emitted. */
  inputs: Map<number, SimInput>;
  lastState: NetPlayerState | null;
  ready: boolean;
}

function makeSlot(seat: number, name: string, peer: Peer): Slot {
  return { seat, name, peer, inputs: new Map(), lastState: null, ready: false };
}

export class Room {
  readonly seats: Slot[] = [];
  settings: NetSettings;
  phase: RoomPhase = "lobby";
  hostSeat = 0;
  private tickCounter = 0;
  private lastTickAt: number;
  private emptySince: number | null = null;
  private levelIndex = 0;
  private levelLast = false;
  /** Ticking is gated until every connected seat reports its level loaded. */
  private tickEnabled = false;
  private levelStartedAt = 0;
  private intermissionSince = 0;
  private readonly loadedSeats = new Set<number>();

  constructor(
    private readonly manager: RoomManager,
    readonly code: string,
    settings: NetSettings,
    hostPeer: Peer,
    hostName: string,
  ) {
    this.settings = normalizeSettings(settings);
    this.seats.push(makeSlot(0, normalizeName(hostName), hostPeer));
    this.lastTickAt = manager.now();
  }

  // ------------------------------------------------------------------
  // queries
  // ------------------------------------------------------------------

  info(): RoomInfo {
    return {
      code: this.code,
      hostSeat: this.hostSeat,
      settings: { ...this.settings },
      players: this.seats.map((s): PlayerSlot => ({
        seat: s.seat,
        name: s.name,
        connected: s.peer !== null,
      })),
      phase: this.phase,
    };
  }

  connectedCount(): number {
    let n = 0;
    for (const s of this.seats) if (s.peer) n++;
    return n;
  }

  isEmpty(): boolean {
    return this.connectedCount() === 0;
  }

  private slotOf(peer: Peer): Slot | null {
    return this.seats.find((s) => s.peer === peer) ?? null;
  }

  private send(peer: Peer, message: ServerMessage): void {
    peer.send(message);
  }

  private sendError(peer: Peer, code: NetErrorCode, message: string): void {
    peer.send({ t: "error", code, message });
  }

  private broadcast(message: ServerMessage): void {
    for (const s of this.seats) if (s.peer) this.send(s.peer, message);
  }

  private broadcastLobby(): void {
    this.broadcast({ t: "lobby", room: this.info() });
  }

  // ------------------------------------------------------------------
  // membership
  // ------------------------------------------------------------------

  join(peer: Peer, name: string): void {
    if (this.phase !== "lobby") {
      this.sendError(peer, NetErrorCode.InProgress, "A match is already in progress.");
      return;
    }
    if (this.seats.length >= this.settings.players) {
      this.sendError(peer, NetErrorCode.RoomFull, "Room is full.");
      return;
    }
    const seat = this.seats.length;
    this.seats.push(makeSlot(seat, normalizeName(name), peer));
    this.manager.attach(peer, this);
    // Confirm the seat before any `lobby`/`levelStart` broadcast can overtake it.
    peer.send({ t: "joined", code: this.code, seat, room: this.info() });
    this.broadcastLobby();
    this.maybeAutoStart();
  }

  /** Explicit `leave` (acks the peer); a socket close goes through `disconnect`. */
  leave(peer: Peer): void {
    this.remove(peer);
    this.send(peer, { t: "left" });
  }

  disconnect(peer: Peer): void {
    this.remove(peer);
  }

  private remove(peer: Peer): void {
    const index = this.seats.findIndex((s) => s.peer === peer);
    if (index < 0) return;
    this.manager.detach(peer);
    const hostPeer = this.seats[this.hostSeat]?.peer ?? null;

    if (this.phase === "lobby") {
      this.seats.splice(index, 1);
      for (let i = 0; i < this.seats.length; i++) {
        const slot = this.seats[i];
        if (slot.seat !== i) {
          slot.seat = i;
          if (slot.peer) this.send(slot.peer, { t: "seat", seat: i });
        }
      }
    } else {
      const slot = this.seats[index];
      slot.peer = null;
      slot.inputs.clear();
      this.broadcast({ t: "peerLeft", seat: slot.seat });
      // A disconnected seat no longer blocks the load barrier, and if this was
      // the last unready seat the intermission barrier resolves here.
      this.checkLoaded();
      this.checkReady();
    }

    // Host migration: keep the same host if it is still connected, else promote
    // the lowest connected seat.
    const hostIndex = hostPeer ? this.seats.findIndex((s) => s.peer === hostPeer) : -1;
    if (hostIndex >= 0) {
      this.hostSeat = hostIndex;
    } else {
      const first = this.seats.find((s) => s.peer);
      this.hostSeat = first ? first.seat : -1;
      if (this.hostSeat >= 0) {
        this.broadcast({ t: "hostChanged", seat: this.hostSeat });
      }
    }

    if (this.phase === "lobby") this.broadcastLobby();
    this.updateEmpty(this.manager.now());
  }

  private maybeAutoStart(): void {
    if (this.phase === "lobby" && this.connectedCount() >= this.settings.players) {
      // Coop starts at the host's chosen level; deathmatch is one level.
      const startIndex = this.settings.gameMode === 1 ? 0 : this.settings.level;
      this.startLevel(startIndex, true);
    }
  }

  // ------------------------------------------------------------------
  // messages
  // ------------------------------------------------------------------

  handleInput(peer: Peer, message: Extract<ClientMessage, { t: "input" }>): void {
    const slot = this.slotOf(peer);
    if (!slot || this.phase !== "playing") return;
    // Clients predict ahead, so an input is stamped with the tick it applies
    // to. Already-emitted and implausibly-far ticks are ignored.
    if (message.tick < this.tickCounter || message.tick > this.tickCounter + KMAX_INPUT_LOOKAHEAD)
      return;
    slot.inputs.set(message.tick, {
      keys: message.keys,
      mouseXRel: message.mouseXRel,
      mouseButtons: message.mouseButtons,
    });
  }

  handleSettings(peer: Peer, message: Extract<ClientMessage, { t: "settings" }>): void {
    const slot = this.slotOf(peer);
    if (!slot) return;
    if (this.hostSeat !== slot.seat) {
      this.sendError(peer, NetErrorCode.NotHost, "Only the host can change settings.");
      return;
    }
    if (this.phase !== "lobby") {
      this.sendError(peer, NetErrorCode.InProgress, "Settings can only change in the lobby.");
      return;
    }
    const next = normalizeSettings(message.settings);
    if (next.players < this.seats.length) {
      this.sendError(peer, NetErrorCode.BadSettings, "Too many players are already in the room.");
      return;
    }
    this.settings = next;
    this.broadcastLobby();
    this.maybeAutoStart();
  }

  handleLevelEnd(_peer: Peer, message: Extract<ClientMessage, { t: "levelEnd" }>): void {
    if (this.phase !== "playing") return;
    this.phase = "intermission";
    this.levelLast = message.last;
    this.tickEnabled = false;
    this.intermissionSince = this.manager.now();
    for (const s of this.seats) s.ready = false;
    // Tell everyone, including stragglers that had not reached the objective
    // when the tick loop stopped, so they can leave the level too.
    this.broadcast({ t: "levelEnded", last: message.last });
  }

  /** A seat finished loading the level; start ticking once they all have. */
  handleLoaded(peer: Peer): void {
    if (this.phase !== "playing" || this.tickEnabled) return;
    const slot = this.slotOf(peer);
    if (!slot) return;
    this.loadedSeats.add(slot.seat);
    this.checkLoaded();
  }

  private checkLoaded(): void {
    if (this.tickEnabled) return;
    for (const s of this.seats) {
      if (s.peer && !this.loadedSeats.has(s.seat)) return;
    }
    this.enableTicking();
  }

  private enableTicking(): void {
    this.tickEnabled = true;
    this.lastTickAt = this.manager.now();
  }

  handleReady(peer: Peer, message: Extract<ClientMessage, { t: "ready" }>): void {
    if (this.phase !== "intermission") return;
    const slot = this.slotOf(peer);
    if (!slot) return;
    slot.ready = true;
    slot.lastState = message.state;
    this.checkReady();
  }

  /** Resolve the intermission barrier once every seat is ready or gone. */
  private checkReady(): void {
    if (this.phase !== "intermission") return;
    if (this.seats.every((s) => s.ready || s.peer === null)) this.resolveBarrier();
  }

  handleMatchEnd(_peer: Peer, message: Extract<ClientMessage, { t: "matchEnd" }>): void {
    if (this.phase === "lobby") return;
    this.endMatch(message.reason);
  }

  private resolveBarrier(): void {
    if (this.levelLast) {
      this.endMatch("victory");
      return;
    }
    this.startLevel(this.levelIndex + 1, false);
  }

  private startLevel(index: number, first: boolean): void {
    this.levelIndex = index;
    this.phase = "playing";
    this.tickCounter = 0;
    this.tickEnabled = false;
    this.loadedSeats.clear();
    this.levelStartedAt = this.manager.now();
    this.lastTickAt = this.manager.now();
    for (const s of this.seats) {
      s.ready = false;
      s.inputs.clear();
    }
    const states = first ? null : this.seats.map((s) => s.lastState);
    this.broadcast({
      t: "levelStart",
      index,
      seed: this.manager.random32(),
      shopSeed: this.manager.random32(),
      states,
      roster: this.seats.map((s) => ({ seat: s.seat, name: s.name })),
    });
  }

  private endMatch(reason: MatchEndReason): void {
    this.phase = "lobby";
    this.levelIndex = 0;
    this.tickEnabled = false;
    this.loadedSeats.clear();
    for (const s of this.seats) {
      s.ready = false;
      s.inputs.clear();
    }
    this.broadcast({ t: "matchEnded", reason });
    this.broadcastLobby();
  }

  // ------------------------------------------------------------------
  // tick master
  // ------------------------------------------------------------------

  advance(now: number): void {
    if (this.emptySince !== null && now - this.emptySince >= KROOM_EMPTY_GRACE_MS) {
      this.manager.destroy(this);
      return;
    }
    if (this.phase === "intermission" && now - this.intermissionSince >= KREADY_TIMEOUT_MS) {
      // A client never reported ready (e.g. it froze): move on rather than
      // hanging the room forever.
      this.resolveBarrier();
    }
    if (this.phase !== "playing") {
      this.lastTickAt = now;
      return;
    }
    if (!this.tickEnabled) {
      // Wait for every connected seat to finish loading the level; the timeout
      // is a safety valve so one stalled client cannot freeze the room.
      if (now - this.levelStartedAt >= KLEVEL_LOAD_TIMEOUT_MS) this.enableTicking();
      else return;
    }
    let ticks = 0;
    while (now - this.lastTickAt >= KTICK_MS && ticks < KMAX_TICKS_PER_ADVANCE) {
      this.emitTick();
      this.lastTickAt += KTICK_MS;
      ticks++;
    }
    if (now - this.lastTickAt >= KTICK_MS) this.lastTickAt = now;
  }

  private emitTick(): void {
    const tick = this.tickCounter;
    const inputs: SimInput[] = [];
    for (const slot of this.seats) {
      const input = slot.peer ? slot.inputs.get(tick) : undefined;
      inputs.push(input ?? ZERO_INPUT);
    }
    if (tick % 64 === 0) {
      // Drop inputs for ticks already emitted.
      for (const slot of this.seats) {
        for (const key of slot.inputs.keys()) if (key < tick) slot.inputs.delete(key);
      }
    }
    this.tickCounter++;
    this.broadcast({ t: "tick", tick, inputs });
  }

  private updateEmpty(now: number): void {
    if (this.isEmpty()) {
      if (this.emptySince === null) this.emptySince = now;
    } else {
      this.emptySince = null;
    }
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly peerRoom = new Map<string, Room>();
  private readonly randomFn: () => number;
  private readonly nowFn: () => number;

  constructor(options: RoomManagerOptions = {}) {
    this.randomFn = options.random32 ?? cryptoRandom32;
    this.nowFn = options.now ?? (() => Date.now());
  }

  now(): number {
    return this.nowFn();
  }

  random32(): number {
    return this.randomFn() >>> 0;
  }

  roomCount(): number {
    return this.rooms.size;
  }

  room(code: string): Room | undefined {
    return this.rooms.get(normalizeCode(code));
  }

  attach(peer: Peer, room: Room): void {
    this.peerRoom.set(peer.id, room);
  }

  detach(peer: Peer): void {
    this.peerRoom.delete(peer.id);
  }

  destroy(room: Room): void {
    this.rooms.delete(room.code);
    for (const slot of room.seats) {
      if (slot.peer) {
        this.peerRoom.delete(slot.peer.id);
        slot.peer.close();
      }
    }
  }

  advance(now: number): void {
    // Deleting the current room during iteration is safe in JS maps.
    for (const room of this.rooms.values()) room.advance(now);
  }

  /** Route one decoded client message. */
  handleMessage(peer: Peer, message: ClientMessage): void {
    if (message.t === "host") {
      this.handleHost(peer, message);
      return;
    }
    if (message.t === "join") {
      this.handleJoin(peer, message);
      return;
    }
    if (message.t === "ping") {
      // Round-trip probe; answered outside any room so it works while loading.
      peer.send({ t: "pong", id: message.id });
      return;
    }

    const room = this.peerRoom.get(peer.id);
    if (!room) return;
    switch (message.t) {
      case "settings":
        room.handleSettings(peer, message);
        break;
      case "input":
        room.handleInput(peer, message);
        break;
      case "loaded":
        room.handleLoaded(peer);
        break;
      case "levelEnd":
        room.handleLevelEnd(peer, message);
        break;
      case "ready":
        room.handleReady(peer, message);
        break;
      case "matchEnd":
        room.handleMatchEnd(peer, message);
        break;
      case "leave":
        room.leave(peer);
        break;
      default:
        break;
    }
  }

  handleClose(peer: Peer): void {
    const room = this.peerRoom.get(peer.id);
    if (room) room.disconnect(peer);
  }

  private handleHost(peer: Peer, message: Extract<ClientMessage, { t: "host" }>): void {
    if (message.v !== PROTOCOL_VERSION) {
      peer.send({ t: "error", code: NetErrorCode.BadVersion, message: "Version mismatch." });
      return;
    }
    if (this.peerRoom.has(peer.id)) {
      peer.send({ t: "error", code: NetErrorCode.InProgress, message: "Already in a room." });
      return;
    }
    if (this.rooms.size >= KMAX_ROOMS) {
      peer.send({ t: "error", code: NetErrorCode.RoomFull, message: "Server is busy." });
      return;
    }
    const code = this.makeCode();
    const room = new Room(this, code, message.settings, peer, message.name);
    this.rooms.set(code, room);
    this.peerRoom.set(peer.id, room);
    peer.send({ t: "hosted", code, seat: 0, room: room.info() });
  }

  private handleJoin(peer: Peer, message: Extract<ClientMessage, { t: "join" }>): void {
    if (message.v !== PROTOCOL_VERSION) {
      peer.send({ t: "error", code: NetErrorCode.BadVersion, message: "Version mismatch." });
      return;
    }
    if (this.peerRoom.has(peer.id)) {
      peer.send({ t: "error", code: NetErrorCode.InProgress, message: "Already in a room." });
      return;
    }
    const code = normalizeCode(message.code);
    const room = this.rooms.get(code);
    if (!room) {
      peer.send({ t: "error", code: NetErrorCode.NoRoom, message: "No such room." });
      return;
    }
    room.join(peer, message.name);
  }

  private makeCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < KROOM_CODE_LENGTH; i++) {
        code += KROOM_CODE_ALPHABET[this.random32() % KROOM_CODE_ALPHABET.length];
      }
      if (!this.rooms.has(code)) return code;
    }
  }
}
