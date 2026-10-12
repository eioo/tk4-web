import { describe, expect, test } from "bun:test";

import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type NetPlayerState,
  type NetSettings,
  type ServerMessage,
} from "../protocol";
import { RoomManager, normalizeCode, normalizeName, normalizeSettings, type Peer } from "../room";

class FakePeer implements Peer {
  readonly sent: ServerMessage[] = [];
  closed = false;
  constructor(readonly id: string) {}
  send(message: ServerMessage): void {
    this.sent.push(message);
  }
  close(): void {
    this.closed = true;
  }
  take(): ServerMessage[] {
    const messages = this.sent.slice();
    this.sent.length = 0;
    return messages;
  }
}

function ofType<T extends ServerMessage["t"]>(
  peer: FakePeer,
  t: T,
): Extract<ServerMessage, { t: T }>[] {
  return peer.sent.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
}

function makeHarness(): {
  manager: RoomManager;
  advance: (ms: number) => void;
} {
  let clock = 0;
  let rng = 1;
  const manager = new RoomManager({
    now: () => clock,
    random32: () => {
      rng = (rng * 1664525 + 1013904223) >>> 0;
      return rng;
    },
  });
  return {
    manager,
    advance: (ms: number): void => {
      clock += ms;
      manager.advance(clock);
    },
  };
}

const coop: NetSettings = { gameMode: 0, episode: 1, level: 0, players: 2, fragLimit: 20 };

function host(name: string, settings: NetSettings = coop): ClientMessage {
  return { t: "host", v: PROTOCOL_VERSION, name, settings };
}

function join(name: string, code: string): ClientMessage {
  return { t: "join", v: PROTOCOL_VERSION, name, code };
}

function readyState(name: string, cash = 500): NetPlayerState {
  return {
    name,
    cash,
    weapons: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bullets: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    shield: 0,
    curWeapon: 0,
    secWeapon: 0,
    frags: 0,
  };
}

/** Host + one joiner, auto-started (players = 2). */
function startedRoom(settings: NetSettings = coop): {
  manager: RoomManager;
  advance: (ms: number) => void;
  a: FakePeer;
  b: FakePeer;
  code: string;
} {
  const { manager, advance } = makeHarness();
  const a = new FakePeer("a");
  const b = new FakePeer("b");
  manager.handleMessage(a, host("John", settings));
  const code = ofType(a, "hosted")[0].code;
  manager.handleMessage(b, join("Paul", code));
  // Clients report the level loaded; the server then starts ticking.
  manager.handleMessage(a, { t: "loaded" });
  manager.handleMessage(b, { t: "loaded" });
  return { manager, advance, a, b, code };
}

describe("host and join", () => {
  test("host creates a room with a 5-letter code and seat 0", () => {
    const { manager } = makeHarness();
    const a = new FakePeer("a");
    manager.handleMessage(a, host("John"));
    const hosted = ofType(a, "hosted")[0];
    expect(hosted.code).toMatch(/^[A-Z]{5}$/);
    expect(hosted.seat).toBe(0);
    expect(hosted.room.players).toEqual([{ seat: 0, name: "John", connected: true }]);
    expect(manager.roomCount()).toBe(1);
  });

  test("join is case-insensitive and announces the roster", () => {
    const { manager } = makeHarness();
    const a = new FakePeer("a");
    const b = new FakePeer("b");
    manager.handleMessage(a, host("John"));
    const code = ofType(a, "hosted")[0].code;
    manager.handleMessage(b, join("Paul", code.toLowerCase()));
    expect(ofType(b, "joined")[0].seat).toBe(1);
    expect(ofType(a, "lobby").at(-1)?.room.players).toHaveLength(2);
  });

  test("auto-starts exactly when the roster is full", () => {
    const { manager } = makeHarness();
    const settings: NetSettings = { ...coop, players: 3 };
    const a = new FakePeer("a");
    const b = new FakePeer("b");
    const c = new FakePeer("c");
    manager.handleMessage(a, host("John", settings));
    const code = ofType(a, "hosted")[0].code;
    manager.handleMessage(b, join("Paul", code));
    expect(ofType(a, "levelStart")).toHaveLength(0);
    expect(ofType(a, "lobby")).toHaveLength(1); // b's arrival
    manager.handleMessage(c, join("Ringo", code));
    const start = ofType(a, "levelStart")[0];
    expect(start.index).toBe(0);
    expect(start.states).toBeNull();
    expect(start.roster).toHaveLength(3);
    expect(ofType(c, "levelStart")).toHaveLength(1);
  });

  test("rejects joining a room whose match has already started", () => {
    const { manager } = makeHarness();
    const a = new FakePeer("a");
    const b = new FakePeer("b");
    const c = new FakePeer("c");
    manager.handleMessage(a, host("John"));
    const code = ofType(a, "hosted")[0].code;
    manager.handleMessage(b, join("Paul", code)); // fills the room → auto-start
    manager.handleMessage(c, join("Ringo", code));
    expect(ofType(c, "error")[0].code).toBe("in-progress");
  });

  test("rejects an unknown code and a bad version", () => {
    const { manager } = makeHarness();
    const a = new FakePeer("a");
    manager.handleMessage(a, join("Paul", "ZZZZZ"));
    expect(ofType(a, "error")[0].code).toBe("no-room");

    const b = new FakePeer("b");
    manager.handleMessage(b, { t: "host", v: 999, name: "X", settings: coop });
    expect(ofType(b, "error")[0].code).toBe("bad-version");
  });
});

describe("tick master", () => {
  test("emits one tick per 10 ms with sampled inputs", () => {
    const { advance, a, b } = startedRoom();
    a.take();
    b.take();
    advance(10);
    const first = ofType(a, "tick")[0];
    expect(first.inputs).toEqual([
      { keys: 0, mouseXRel: 0, mouseButtons: 0 },
      { keys: 0, mouseXRel: 0, mouseButtons: 0 },
    ]);
    expect(ofType(b, "tick")).toHaveLength(1);
  });

  test("waits for every seat to report the level loaded", () => {
    const { manager, advance } = makeHarness();
    const a = new FakePeer("a");
    const b = new FakePeer("b");
    manager.handleMessage(a, host("John"));
    const code = ofType(a, "hosted")[0].code;
    manager.handleMessage(b, join("Paul", code));
    a.take();
    b.take();
    advance(10);
    expect(ofType(a, "tick")).toHaveLength(0);

    manager.handleMessage(a, { t: "loaded" });
    advance(10);
    expect(ofType(a, "tick")).toHaveLength(0);

    manager.handleMessage(b, { t: "loaded" });
    advance(10);
    expect(ofType(a, "tick")).toHaveLength(1);
  });

  test("uses the seat's pending input once, then zero", () => {
    const { manager, advance, a, b } = startedRoom();
    a.take();
    b.take();
    manager.handleMessage(a, { t: "input", keys: 8, mouseXRel: -3, mouseButtons: 1 });
    advance(10);
    expect(ofType(a, "tick")[0].inputs[0]).toEqual({ keys: 8, mouseXRel: -3, mouseButtons: 1 });
    expect(ofType(a, "tick")[0].inputs[1]).toEqual({ keys: 0, mouseXRel: 0, mouseButtons: 0 });
    advance(10);
    expect(ofType(a, "tick")[1].inputs[0]).toEqual({ keys: 0, mouseXRel: 0, mouseButtons: 0 });
  });

  test("caps catch-up ticks per advance", () => {
    const { advance, a } = startedRoom();
    a.take();
    advance(1000);
    expect(ofType(a, "tick")).toHaveLength(5);
  });
});

describe("progression barriers", () => {
  test("levelEnd then all ready starts the next level with consolidated states", () => {
    const { manager, a, b } = startedRoom();
    a.take();
    b.take();
    manager.handleMessage(a, { t: "levelEnd", last: false });
    manager.handleMessage(a, { t: "ready", state: readyState("John", 700) });
    expect(ofType(a, "levelStart")).toHaveLength(0);
    manager.handleMessage(b, { t: "ready", state: readyState("Paul", 900) });
    const start = ofType(a, "levelStart")[0];
    expect(start.index).toBe(1);
    expect(start.states?.[0]?.cash).toBe(700);
    expect(start.states?.[1]?.cash).toBe(900);
    expect(ofType(b, "levelStart")).toHaveLength(1);
  });

  test("the last level resolves to victory", () => {
    const { manager, a, b } = startedRoom();
    a.take();
    b.take();
    manager.handleMessage(a, { t: "levelEnd", last: true });
    manager.handleMessage(a, { t: "ready", state: readyState("John") });
    manager.handleMessage(b, { t: "ready", state: readyState("Paul") });
    expect(ofType(a, "matchEnded")[0].reason).toBe("victory");
    expect(ofType(b, "matchEnded")[0].reason).toBe("victory");
    expect(ofType(a, "lobby").length).toBeGreaterThan(0);
  });

  test("matchEnd ends the match for everyone", () => {
    const { manager, a, b } = startedRoom({ ...coop, gameMode: 1 });
    a.take();
    b.take();
    manager.handleMessage(b, { t: "matchEnd", reason: "fragLimit" });
    expect(ofType(a, "matchEnded")[0].reason).toBe("fragLimit");
    expect(ofType(b, "matchEnded")[0].reason).toBe("fragLimit");
  });

  test("a disconnected seat is auto-ready", () => {
    const { manager, a, b } = startedRoom();
    a.take();
    b.take();
    manager.handleClose(b);
    manager.handleMessage(a, { t: "levelEnd", last: false });
    manager.handleMessage(a, { t: "ready", state: readyState("John", 700) });
    const start = ofType(a, "levelStart")[0];
    expect(start.index).toBe(1);
    expect(start.states?.[1]).toBeNull();
  });
});

describe("roster changes", () => {
  test("leaving the lobby removes the seat and re-indexes", () => {
    const { manager } = makeHarness();
    const settings: NetSettings = { ...coop, players: 4 };
    const a = new FakePeer("a");
    const b = new FakePeer("b");
    const c = new FakePeer("c");
    manager.handleMessage(a, host("John", settings));
    const code = ofType(a, "hosted")[0].code;
    manager.handleMessage(b, join("Paul", code));
    manager.handleMessage(c, join("Ringo", code));
    a.take();
    b.take();
    c.take();
    manager.handleMessage(b, { t: "leave" });
    expect(ofType(b, "left")).toHaveLength(1);
    expect(ofType(c, "seat")[0].seat).toBe(1);
    expect(
      ofType(a, "lobby")
        .at(-1)
        ?.room.players.map((p) => p.name),
    ).toEqual(["John", "Ringo"]);
  });

  test("migrates host when the host leaves the lobby", () => {
    const { manager } = makeHarness();
    const settings: NetSettings = { ...coop, players: 4 };
    const a = new FakePeer("a");
    const b = new FakePeer("b");
    manager.handleMessage(a, host("John", settings));
    const code = ofType(a, "hosted")[0].code;
    manager.handleMessage(b, join("Paul", code));
    b.take();
    manager.handleClose(a);
    expect(ofType(b, "hostChanged")[0].seat).toBe(0);
    manager.handleMessage(b, {
      t: "settings",
      settings: { ...settings, episode: 5, players: 3 },
    });
    expect(ofType(b, "error")).toHaveLength(0);
    expect(manager.room(code)?.settings.episode).toBe(5);
  });

  test("an idle seat keeps its slot and receives zero input", () => {
    const { manager, advance, a, b } = startedRoom();
    a.take();
    b.take();
    manager.handleClose(a);
    expect(ofType(b, "peerLeft")[0].seat).toBe(0);
    expect(ofType(b, "hostChanged")[0].seat).toBe(1);
    advance(10);
    const tick = ofType(b, "tick")[0];
    expect(tick.inputs).toHaveLength(2);
    expect(tick.inputs[0]).toEqual({ keys: 0, mouseXRel: 0, mouseButtons: 0 });
  });

  test("destroys an empty room after the grace period", () => {
    const { manager, advance, a, b } = startedRoom();
    manager.handleClose(a);
    manager.handleClose(b);
    advance(29_999);
    expect(manager.roomCount()).toBe(1);
    advance(2);
    expect(manager.roomCount()).toBe(0);
  });
});

describe("normalisation", () => {
  test("clamps settings", () => {
    expect(
      normalizeSettings({ gameMode: 7, episode: -1, level: 2.9, players: 9, fragLimit: 1000 }),
    ).toEqual({ gameMode: 0, episode: 0, level: 2, players: 4, fragLimit: 50 });
    expect(
      normalizeSettings({ gameMode: 1, episode: 0, level: 0, players: 1, fragLimit: 1 }),
    ).toEqual({ gameMode: 1, episode: 0, level: 0, players: 2, fragLimit: 5 });
  });

  test("normalises names and codes", () => {
    expect(normalizeName("  John  ")).toBe("John");
    expect(normalizeName("")).toBe("Player");
    expect(normalizeName("x".repeat(40))).toHaveLength(15);
    expect(normalizeCode(" kqzab ")).toBe("KQZAB");
  });
});
