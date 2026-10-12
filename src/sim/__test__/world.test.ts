import { describe, expect, test } from "bun:test";

import { readRef } from "../../data/__test__/helpers";
import { type Level, loadLevel } from "../../data/level";
import { makeRect } from "../../render/rect";
import { BulletId, WeaponId } from "../types";
import { Key, MouseButton, SimPlayer, SimWorld, type SimInput } from "../world";

/**
 * Netplay determinism guards (docs/multiplayer/architecture.md). Online every client runs the
 * same world from the same seed and input bundles, so `perSeatMouse` must not
 * introduce nondeterminism and must let each seat drive its own rotation.
 */

const DRAW_RECT = makeRect(0, 0, 640, 480);

function makePlayer(): SimPlayer {
  const p = new SimPlayer();
  p.x = 100;
  p.y = 100;
  p.angle = 0;
  p.energy = 100;
  p.local = true;
  p.weapons = Array.from({ length: 13 }, () => 0);
  p.weapons[WeaponId.Fist] = 1;
  p.weapons[WeaponId.Pistol] = 1;
  p.curWeapon = WeaponId.Pistol;
  p.bullets = Array.from({ length: 12 }, () => 0);
  p.bullets[BulletId.Fist] = 1;
  p.bullets[BulletId.B9mm] = 100;
  p.drawRect = DRAW_RECT;
  return p;
}

function makeWorld(level: Level, seed: number, perSeatMouse: boolean, mouseOwner = -1): SimWorld {
  const world = new SimWorld(level, seed);
  world.perSeatMouse = perSeatMouse;
  world.mouseSensitivity = 0.5;
  world.mouseOwner = mouseOwner;
  world.players = [makePlayer(), makePlayer()];
  world.spawnEntities();
  for (const p of world.players) world.initScr(p);
  return world;
}

function frames(ticks: number): SimInput[][] {
  const out: SimInput[][] = [];
  for (let t = 0; t < ticks; t++) {
    out.push([
      { keys: t < ticks / 2 ? Key.Up : 0, mouseXRel: 3, mouseButtons: 0 },
      { keys: 0, mouseXRel: -3, mouseButtons: t % 20 === 0 ? MouseButton.WheelUp : 0 },
    ]);
  }
  return out;
}

/** Both seats walk, turn and fire; exactly what a real online match does. */
function combatFrames(ticks: number): SimInput[][] {
  const out: SimInput[][] = [];
  for (let t = 0; t < ticks; t++) {
    out.push([
      {
        keys: t % 8 < 4 ? Key.Up : Key.Down,
        mouseXRel: Math.sin(t / 7) * 6,
        mouseButtons: MouseButton.Left,
      },
      {
        keys: t % 12 < 6 ? Key.RightStrafe : Key.LeftStrafe,
        mouseXRel: Math.cos(t / 5) * 6,
        mouseButtons: MouseButton.Left | MouseButton.Right,
      },
    ]);
  }
  return out;
}

function snapshot(world: SimWorld): number[] {
  const out: number[] = [];
  for (const p of world.players) {
    out.push(p.x, p.y, p.angle, p.energy, p.shootCount, p.curWeapon, p.loadCounter);
  }
  out.push(world.bullets.length);
  for (const b of world.bullets) out.push(b.x, b.y, b.angle);
  return out;
}

describe("per-seat mouse determinism", () => {
  test("two worlds with the same bundles stay byte-identical", async () => {
    const level = loadLevel(await readRef("levs/small.lev"));
    const a = makeWorld(level, 0x1234_5678, true);
    const b = makeWorld(level, 0x1234_5678, true);
    for (const input of frames(200)) {
      a.tick(input);
      b.tick(input);
    }
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  test("two clients with different mouse owners stay identical", async () => {
    const level = loadLevel(await readRef("levs/small.lev"));
    // Each client sets `mouseOwner` to its own seat (see GameSession). With
    // per-seat mouse they must still simulate the exact same world.
    const clientA = makeWorld(level, 0x5134, true, 0);
    const clientB = makeWorld(level, 0x5134, true, 1);
    for (const input of combatFrames(160)) {
      clientA.tick(input);
      clientB.tick(input);
    }
    expect(snapshot(clientA)).toEqual(snapshot(clientB));
  });

  test("each seat rotates from its own mouse", async () => {
    const level = loadLevel(await readRef("levs/small.lev"));
    const world = makeWorld(level, 7, true);
    for (const input of frames(10)) world.tick(input);
    expect(world.players[0].angle).not.toBe(0);
    expect(world.players[1].angle).not.toBe(0);
    expect(world.players[0].angle).not.toBe(world.players[1].angle);
  });

  test("local play still uses only the mouse owner", async () => {
    const level = loadLevel(await readRef("levs/small.lev"));
    const world = makeWorld(level, 7, false);
    world.mouseOwner = 0;
    for (const input of frames(10)) world.tick(input);
    expect(world.players[0].angle).not.toBe(0);
    expect(world.players[1].angle).toBe(0);
  });
});
