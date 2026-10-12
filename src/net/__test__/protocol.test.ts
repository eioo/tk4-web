import { describe, expect, test } from "bun:test";

import {
  encodeMessage,
  parseClientMessage,
  parseServerMessage,
  type ClientMessage,
  type NetPlayerState,
  type ServerMessage,
} from "../protocol";

const state: NetPlayerState = {
  name: "John",
  cash: 500,
  weapons: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bullets: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  shield: 0,
  curWeapon: 0,
  secWeapon: 0,
  frags: 0,
};

describe("client messages", () => {
  const messages: ClientMessage[] = [
    {
      t: "host",
      v: 1,
      name: "John",
      settings: {
        gameMode: 0,
        episode: 1,
        level: 0,
        players: 2,
        fragLimit: 20,
        enemies: true,
        dmSpeed: 1,
        targetSystem: false,
      },
    },
    { t: "join", v: 1, name: "Paul", code: "KQZAB" },
    {
      t: "settings",
      settings: {
        gameMode: 1,
        episode: 2,
        level: 3,
        players: 4,
        fragLimit: 30,
        enemies: false,
        dmSpeed: 2.5,
        targetSystem: true,
      },
    },
    { t: "input", keys: 8, mouseXRel: 3, mouseButtons: 1 },
    { t: "loaded" },
    { t: "levelEnd", last: false },
    { t: "matchEnd", reason: "fragLimit" },
    { t: "ready", state },
    { t: "leave" },
  ];

  for (const message of messages) {
    test(`round-trips ${message.t}`, () => {
      expect(parseClientMessage(encodeMessage(message))).toEqual(message);
    });
  }

  test("rejects malformed input", () => {
    const bad = [
      "{",
      "null",
      "[]",
      "42",
      '{"t":"nope"}',
      '{"t":"input"}',
      '{"t":"input","keys":1}',
      '{"t":"join","v":1}',
      '{"t":"join","v":1,"name":"Paul"}',
      '{"t":"host","v":1,"name":"John","settings":{}}',
      '{"t":"ready","state":{"name":"x"}}',
      '{"t":"levelEnd","last":"yes"}',
    ];
    for (const text of bad) expect(parseClientMessage(text)).toBeNull();
  });

  test("accepts an integer-valued non-negative protocol field", () => {
    const ok = parseClientMessage('{"t":"join","v":1,"name":"Paul","code":"ABCDE"}');
    expect(ok?.t).toBe("join");
  });
});

describe("server messages", () => {
  const room = {
    code: "KQZAB",
    hostSeat: 0,
    settings: {
      gameMode: 0,
      episode: 1,
      level: 0,
      players: 2,
      fragLimit: 20,
      enemies: true,
      dmSpeed: 1,
      targetSystem: false,
    },
    players: [
      { seat: 0, name: "John", connected: true },
      { seat: 1, name: "Paul", connected: false },
    ],
    phase: "lobby" as const,
  };

  const messages: ServerMessage[] = [
    { t: "hosted", code: "KQZAB", seat: 0, room },
    { t: "joined", code: "KQZAB", seat: 1, room },
    { t: "lobby", room },
    { t: "error", code: "no-room", message: "No such room." },
    {
      t: "levelStart",
      index: 0,
      seed: 1,
      shopSeed: 2,
      states: null,
      roster: [{ seat: 0, name: "John" }],
    },
    {
      t: "levelStart",
      index: 1,
      seed: 3,
      shopSeed: 4,
      states: [state, null],
      roster: [{ seat: 0, name: "John" }],
    },
    {
      t: "tick",
      tick: 5,
      inputs: [
        { keys: 0, mouseXRel: 0, mouseButtons: 0 },
        { keys: 8, mouseXRel: -2, mouseButtons: 1 },
      ],
    },
    { t: "seat", seat: 1 },
    { t: "peerLeft", seat: 1 },
    { t: "hostChanged", seat: 1 },
    { t: "matchEnded", reason: "victory" },
    { t: "left" },
  ];

  for (const message of messages) {
    const label = message.t === "levelStart" ? `levelStart(${message.index})` : message.t;
    test(`round-trips ${label}`, () => {
      expect(parseServerMessage(encodeMessage(message))).toEqual(message);
    });
  }

  test("rejects malformed input", () => {
    const bad = [
      "{",
      "null",
      '{"t":"nope"}',
      '{"t":"hosted"}',
      '{"t":"hosted","code":"X","seat":0}',
      '{"t":"tick","tick":0,"inputs":[{}]}',
      '{"t":"levelStart","index":0,"seed":1,"shopSeed":2,"states":{},"roster":[]}',
      '{"t":"seat","seat":-1}',
      '{"t":"error","code":"x"}',
    ];
    for (const text of bad) expect(parseServerMessage(text)).toBeNull();
  });
});
