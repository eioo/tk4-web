import { describe, expect, test } from "bun:test";

import { readRef } from "../../data/__test__/helpers";
import { type Level, loadLevel } from "../../data/level";
import { makeRect } from "../../render/rect";
import { GameStatistics, type StatisticsState } from "../../sim/statistics";
import { BulletId, WeaponId } from "../../sim/types";
import {
  Key,
  MouseButton,
  SimPlayer,
  SimWorld,
  type SimInput,
  type WorldState,
} from "../../sim/world";
import { LockstepClient, type LockstepSession } from "../lockstep";

/**
 * End-to-end rollback against the real `SimWorld`: two clients predicting their
 * own seats with different latencies must both converge to the authoritative
 * world a plain in-order client produces.
 */

const SEED = 0x0bad_c0de;
const DRAW_RECT = makeRect(0, 0, 640, 480);
const TICKS = 240;

interface SimSnapshot {
  world: WorldState;
  stats: StatisticsState | null;
}

class WorldSession implements LockstepSession<SimSnapshot> {
  constructor(readonly world: SimWorld) {}
  saveState(): SimSnapshot {
    return { world: this.world.saveState(), stats: this.world.stats?.saveState() ?? null };
  }
  loadState(state: SimSnapshot): void {
    this.world.loadState(state.world);
    if (state.stats && this.world.stats) this.world.stats.loadState(state.stats);
  }
  step(inputs: readonly SimInput[]): void {
    this.world.tick(inputs);
  }
  discardOutput(): void {
    this.world.messages.length = 0;
    this.world.sounds.length = 0;
  }
}

function makePlayer(): SimPlayer {
  const p = new SimPlayer();
  p.x = 120;
  p.y = 120;
  p.angle = 0;
  p.energy = 100;
  p.local = true;
  p.weapons = Array.from({ length: 13 }, () => 0);
  p.weapons[WeaponId.Fist] = 1;
  p.weapons[WeaponId.Pistol] = 1;
  p.curWeapon = WeaponId.Pistol;
  p.bullets = Array.from({ length: 12 }, () => 0);
  p.bullets[BulletId.Fist] = 1;
  p.bullets[BulletId.B9mm] = 500;
  p.drawRect = DRAW_RECT;
  return p;
}

function makeWorld(level: Level): SimWorld {
  const world = new SimWorld(level, SEED);
  world.perSeatMouse = true;
  world.mouseSensitivity = 1;
  world.players = [makePlayer(), makePlayer()];
  const stats = new GameStatistics();
  stats.addPlayer("A");
  stats.addPlayer("B");
  world.stats = stats;
  world.spawnEntities();
  for (const p of world.players) world.initScr(p);
  return world;
}

function script(t: number): SimInput[] {
  return [
    {
      keys: t % 10 < 5 ? Key.Up : Key.Down,
      mouseXRel: Math.sin(t / 6) * 7,
      mouseButtons: t % 7 === 0 ? MouseButton.Left : 0,
    },
    {
      keys: t % 12 < 6 ? Key.RightStrafe : Key.LeftStrafe,
      mouseXRel: Math.cos(t / 5) * 7,
      mouseButtons: t % 9 === 0 ? MouseButton.Left : 0,
    },
  ];
}

function snapshot(world: SimWorld): number[] {
  const out: number[] = [];
  for (const p of world.players) out.push(p.x, p.y, p.angle, p.energy, p.curWeapon, p.dead);
  out.push(world.bullets.length, world.enemies.length, world.crates.length);
  for (const b of world.bullets) out.push(b.x, b.y, b.angle, b.typeId);
  // Statistics are mutated by the sim too, so rollback must restore them.
  const stats = world.stats;
  if (stats) {
    for (let i = 0; i < stats.players.length; i++) {
      out.push(stats.players[i].levelOfDeath, stats.currentPlayerKills(i));
    }
  }
  return out;
}

/** Drive one client with `latency` ticks of one-way delay; returns its world. */
function drive(level: Level, latency: number, localSeat: number): SimWorld {
  const world = makeWorld(level);
  const session = new WorldSession(world);
  const client = new LockstepClient(session, {
    seats: 2,
    localSeat,
    keyframeInterval: 2,
    maxHistory: 80,
    maxStepsPerUpdate: 1,
  });
  client.setLead(1);

  for (let now = 0; now < TICKS; now++) {
    const serverTick = now - latency;
    if (serverTick >= 0) client.receive(serverTick, script(serverTick));
    client.update(script(Math.min(client.tick, TICKS - 1))[localSeat]);
  }
  for (let t = Math.max(0, TICKS - latency); t < TICKS; t++) client.receive(t, script(t));
  for (let i = 0; i < 20; i++) client.update(script(Math.min(client.tick, TICKS - 1))[localSeat]);

  expect(client.tick).toBe(TICKS);
  return world;
}

describe("rollback against the real sim world", () => {
  test("two latent clients converge to the authoritative world", async () => {
    const level = loadLevel(await readRef("levs/small.lev"));

    const reference = makeWorld(level);
    for (let t = 0; t < TICKS; t++) reference.tick(script(t));
    const expected = snapshot(reference);

    // Different one-way latencies and different local seats.
    expect(snapshot(drive(level, 2, 0))).toEqual(expected);
    expect(snapshot(drive(level, 7, 1))).toEqual(expected);
  });
});
