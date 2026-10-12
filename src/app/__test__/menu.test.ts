import { describe, expect, test } from "bun:test";

import { readRef } from "../../data/__test__/helpers";
import { decodeFnt } from "../../data/font";
import type { RoomInfo } from "../../net/protocol";
import { Framebuffer } from "../../render/fb";
import { FONT_FILES, SystemFonts } from "../fonts";
import { SDLK } from "../keys";
import { MenuContainer, MenuState, type MenuHost, type MenuItem, type KeyPress } from "../menu";
import { Options } from "../options";

const fonts = new SystemFonts(
  await Promise.all(FONT_FILES.map(async (spec) => decodeFnt(await readRef(spec.file)))),
);

interface NetCalls {
  hosting: number;
  joins: string[];
  leaves: number;
  starts: number;
}

function makeHost(): {
  host: MenuHost;
  changes: MenuState[];
  buffer: Framebuffer;
  netState: { lobby: RoomInfo | null; seat: number };
  calls: NetCalls;
} {
  const buffer = new Framebuffer(640, 480);
  const changes: MenuState[] = [];
  const netState: { lobby: RoomInfo | null; seat: number } = { lobby: null, seat: -1 };
  const calls: NetCalls = { hosting: 0, joins: [], leaves: 0, starts: 0 };
  const options = new Options(
    [],
    [{ name: "Test", levels: [{ file: "levs/test/level1.lev", name: "The Test" }] }],
    ["Default"],
  );
  const host: MenuHost = {
    options: () => options,
    fonts: () => fonts,
    buffer: () => buffer,
    playerName: () => "John",
    setPlayerName: () => {},
    mouseModeText: () => options.mouseModeText(),
    gameModeName: (index) => (index === 0 ? "cooperative" : "deathmatch"),
    gameModeCount: () => 2,
    gameModeStartFromAnyLevel: (index) => index !== 0,
    gameModeDMEpisodes: (index) => index !== 0,
    changeState: (state) => changes.push(state),
    skipDrawOnce: () => {},
    doFullRedraw: () => {},
    valueUpdated: (_item: MenuItem) => {},
    addMessage: () => {},
    execSingleGame: () => {},
    execMultiplay: () => {},
    rand: (max) => 0 % max,
    timerCounter: () => 0,
    fullScreenChanged: () => {},
    updateLargeTextMode: () => {},
    updateAudioChanges: () => {},
    updateGammaChanges: () => {},
    cycleResolution: () => {},
    saveOptions: () => {},
    optionsReset: () => options.reset(),
    requestQuit: () => {},
    startHosting: () => calls.hosting++,
    joinGame: (code) => calls.joins.push(code),
    leaveNet: () => calls.leaves++,
    startMatch: () => calls.starts++,
    netLobby: () => netState.lobby,
    netStatus: () => "lobby",
    netSeat: () => netState.seat,
  };
  return { host, changes, buffer, netState, calls };
}

function key(sym: number): KeyPress {
  return { sym, unicode: 0 };
}

function charKey(ch: string): KeyPress {
  return { sym: ch.toUpperCase().charCodeAt(0), unicode: ch.charCodeAt(0) };
}

describe("menu framework", () => {
  test("draws the main menu title and items", () => {
    const { host, buffer } = makeHost();
    const container = new MenuContainer(host);
    container.enterState();
    container.draw();
    const nonZero = buffer.pixels.some((v) => v !== 0);
    expect(nonZero).toBe(true);
  });

  test("draws the version string in the bottom-left corner", () => {
    const { host, buffer } = makeHost();
    const container = new MenuContainer(host);
    container.enterState();
    buffer.clear(0);
    container.draw();
    let found = false;
    for (let y = buffer.height - 18; y < buffer.height && !found; y++) {
      for (let x = 0; x < 80; x++) {
        if (buffer.pixels[y * buffer.width + x] !== 0) {
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
  });

  test("navigates to single game and opens the episode select", () => {
    const { host, changes } = makeHost();
    const container = new MenuContainer(host);
    container.enterState();
    expect(container.runFrame(key(SDLK.RETURN))).toBe(true);
    expect(changes).toEqual([MenuState.EpisodeSelect]);
  });

  test("escape returns to the previous menu", () => {
    const { host, changes } = makeHost();
    const container = new MenuContainer(host);
    container.changeState(MenuState.Options);
    container.runFrame(key(SDLK.ESCAPE));
    expect(changes).toEqual([MenuState.Main]);
  });

  test("a game start suspends the menu until the state changes", () => {
    const { host, buffer } = makeHost();
    const container = new MenuContainer(host);
    container.enterState();
    buffer.clear(40);
    container.skipDrawOnce();

    expect(container.isSuspended()).toBe(true);
    expect(container.runFrame(key(SDLK.RETURN))).toBe(false);
    buffer.clear(0);
    container.draw();
    expect(buffer.pixels.every((v) => v === 0)).toBe(true);

    container.enterState();
    expect(container.isSuspended()).toBe(false);
    container.draw();
    expect(buffer.pixels.some((v) => v !== 0)).toBe(true);
  });
});

describe("multiplayer menus", () => {
  test("main menu multiplayer entry opens the mode screen", () => {
    const { host, changes } = makeHost();
    const container = new MenuContainer(host);
    container.enterState();
    container.runFrame(key(SDLK.DOWN)); // single game -> multiplayer
    container.runFrame(key(SDLK.RETURN));
    expect(changes).toEqual([MenuState.MultiplayMode]);
  });

  test("mode -> online -> host setup draws each screen", () => {
    const { host, buffer } = makeHost();
    const container = new MenuContainer(host);
    for (const state of [MenuState.MultiplayMode, MenuState.Online, MenuState.HostSetup]) {
      container.changeState(state);
      container.enterState();
      buffer.clear(0);
      container.draw();
      expect(buffer.pixels.some((v) => v !== 0)).toBe(true);
    }
  });

  test("start hosting calls the host", () => {
    const { host, calls } = makeHost();
    const container = new MenuContainer(host);
    container.changeState(MenuState.HostSetup);
    container.enterState();
    // Active item is "start hosting" after the option items (the level select
    // is disabled in cooperative mode, so it is skipped).
    for (let i = 0; i < 4; i++) container.runFrame(key(SDLK.DOWN));
    container.runFrame(key(SDLK.RETURN));
    expect(calls.hosting).toBe(1);
  });

  test("join screen collects an uppercase code and joins", () => {
    const { host, calls } = makeHost();
    const container = new MenuContainer(host);
    container.changeState(MenuState.Join);
    container.enterState();
    container.runFrame(key(SDLK.RETURN)); // focus the code field
    for (const ch of "kqzab") container.runFrame(charKey(ch));
    container.runFrame(key(SDLK.ESCAPE)); // leave the field
    container.runFrame(key(SDLK.DOWN)); // code field -> join
    container.runFrame(key(SDLK.RETURN));
    expect(calls.joins).toEqual(["KQZAB"]);
  });

  test("lobby draws the code and roster and exits to the online menu", () => {
    const { host, buffer, netState, changes, calls } = makeHost();
    netState.lobby = {
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
        { seat: 1, name: "Paul", connected: true },
      ],
      phase: "lobby",
    };
    netState.seat = 1;
    const container = new MenuContainer(host);
    container.changeState(MenuState.Lobby);
    container.enterState();
    buffer.clear(0);
    container.draw();
    expect(buffer.pixels.some((v) => v !== 0)).toBe(true);
    container.runFrame(key(SDLK.RETURN)); // start game
    expect(calls.starts).toBe(1);
    container.runFrame(key(SDLK.DOWN));
    container.runFrame(key(SDLK.RETURN)); // leave lobby
    expect(changes).toEqual([MenuState.Online]);
    expect(host.netLobby()?.code).toBe("KQZAB");
  });
});
