import { describe, expect, test } from "bun:test";

import { readRef } from "../../data/__test__/helpers";
import { decodeFnt } from "../../data/font";
import { Framebuffer } from "../../render/fb";
import { FONT_FILES, SystemFonts } from "../fonts";
import { SDLK } from "../keys";
import { MenuContainer, MenuState, type MenuHost, type MenuItem } from "../menu";
import { Options } from "../options";

const fonts = new SystemFonts(
  await Promise.all(FONT_FILES.map(async (spec) => decodeFnt(await readRef(spec.file)))),
);

function makeHost(): { host: MenuHost; changes: MenuState[]; buffer: Framebuffer } {
  const buffer = new Framebuffer(640, 480);
  const changes: MenuState[] = [];
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
  };
  return { host, changes, buffer };
}

function key(sym: number): { sym: number; unicode: number } {
  return { sym, unicode: 0 };
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
});
