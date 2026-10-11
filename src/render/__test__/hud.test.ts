import { describe, expect, test } from "bun:test";

import { GlibcRandom } from "../../core/rng";
import { readRef, readRefText, sha256 } from "../../data/__test__/helpers";
import { decodePaletteTab } from "../../data/color-tables";
import { mergeIni } from "../../data/config";
import { decodeFnt } from "../../data/font";
import { loadIngameData } from "../../data/ingame-data";
import { loadLevel } from "../../data/level";
import { SimCrate, SimEnemy } from "../../sim/entities";
import { BulletId, CrateKind, WeaponId } from "../../sim/types";
import { SimPlayer } from "../../sim/world";
import { drawHudFrame, toDrawSprites, type ActorScene } from "../draw-manager";
import { GameDrawer } from "../drawer";
import { Framebuffer } from "../fb";
import { resetTargetPlotCount } from "../hud";

// SHA-256 of the frame produced by the C++ oracle
// (`/tmp/render_gen hud <leveldump> <datadir> <out.raw>`), which composes the
// same HUD primitives for a synthetic player on level1.
const HASH = "78d3d331c3e598aecb0e12325c9cee068e2b820018a0739ba070ce27718830a2";

const paletteTab = decodePaletteTab(await readRef("palette.tab"));
const ingame = await loadIngameData(mergeIni(await readRefText("default.ini")), readRef);
const sprites = toDrawSprites(ingame);
const hudFont = decodeFnt(await readRef("fnts/8x8b.fnt"));

describe("HUD matches the C++ oracle byte-for-byte", () => {
  test("hits, target laser, energy, infos, kills, crate texts, map, fps, time, complete", async () => {
    const level = loadLevel(await readRef("levs/default/level1.lev"));
    const start = level.starts[0];

    const width = 640;
    const height = 480;
    const fb = new Framebuffer(width, height);
    for (let i = 0; i < width * height; i++) fb.pixels[i] = (i * 13) & 0xff;
    const drawRect = fb.rect();

    const player = new SimPlayer();
    player.x = start.x * 20;
    player.y = start.y * 20;
    player.angle = 0;
    player.energy = 73.5;
    player.shield = 2;
    player.hit = 7;
    player.targetSystem = true;
    player.curWeapon = WeaponId.FlameThrower;
    player.secWeapon = 1;
    player.bullets[BulletId.Gas] = 4567;
    player.color = 16 * 3;

    const energy = new SimCrate(CrateKind.Health, 0, 0, 0);
    energy.textX = 100;
    energy.textY = 200;
    energy.textCounter = 1;
    const money = new SimCrate(CrateKind.Money, 123, 0, 0);
    money.textX = 300;
    money.textY = 250;
    money.textCounter = 1;

    const enemyA = new SimEnemy();
    enemyA.x = 100;
    enemyA.y = 100;
    const enemyB = new SimEnemy();
    enemyB.x = 305;
    enemyB.y = 245;

    const scene: ActorScene = {
      level,
      sprites,
      drawer: new GameDrawer(paletteTab),
      fb,
      dark: new Uint8Array(width * height),
      drawRect,
      screenPos: { x: Math.trunc(player.x - width / 2), y: Math.trunc(player.y - height / 2) },
      playerLocation: { x: player.x, y: player.y },
      players: [player],
      bullets: [],
      enemies: [enemyA, enemyB],
      bodyparts: [],
      effects: [],
      crates: [energy, money],
      spotLights: [],
      deadEnemies: [{ x: 400, y: 80 }],
      renderRng: new GlibcRandom(1),
      hud: {
        font: hudFont,
        oneIsZero: true,
        scaleX: 1,
        scaleY: 1,
        videoWidth: width,
        videoHeight: height,
        frags: true,
        showMap: true,
        drawFrames: true,
        actionTimeMatters: true,
        currentFps: 57,
        nextLevel: 37,
        completeTime: 123,
        startTime: 0,
        timerCounter: 12300,
        timeLimit: 0,
        hidePlayersFromMap: false,
        drawEnemiesOnMap: true,
        reachableOnMap: true,
        names: ["Pekka", "Jussi", "Matti"],
        kills: [5, 12, 3],
      },
    };

    resetTargetPlotCount();
    drawHudFrame(scene);

    expect(sha256(fb.pixels)).toBe(HASH);
  });
});
