/**
 * Deterministic replay harness for M3 (docs 13). Defines a fixed scripted
 * input for a level, serialises it in the format `tools/reference/sim_gen.cpp`
 * reads, and serialises the resulting per-tick state trace in the format the
 * oracle writes — so the two can be compared byte-for-byte.
 *
 * The script itself is a test fixture: it drives forward/strafe/turn/shoot and
 * a weapon switch so movement, camera, shooting, bullet physics, bouncing,
 * collisions and damage are all exercised.
 */

import { decodeFnt, fontLength } from "../data/font";
import { type Level, loadLevel } from "../data/level";
import { makeRect } from "../render/rect";
import { BulletId, WeaponId } from "./types";
import { SimWorld, SimPlayer, type SimInput, Key, MouseButton } from "./world";

export const SCRIPT_VERSION = 1;
export const DRAW_RECT = makeRect(0, 0, 640, 480);

export interface ReplayPlayer {
  x: number;
  y: number;
  angle: number;
  energy: number;
  local: boolean;
  weapons: number[];
  bullets: number[];
}

export interface ReplayScript {
  seed: number;
  ticks: number;
  levelName: string;
  sensitivity: number;
  mouseOwner: number;
  players: ReplayPlayer[];
  inputs: SimInput[];
}

function emptyWeapons(): number[] {
  return Array.from({ length: 13 }, (): number => 0);
}
function emptyBullets(): number[] {
  return Array.from({ length: 12 }, (): number => 0);
}

/** Builds the deterministic replay used by the tests and the oracle. */
export function buildScript(): ReplayScript {
  const ticks = 400;
  const inputs: SimInput[] = [];

  const p0weapons = emptyWeapons();
  p0weapons[WeaponId.AutoRifle] = 1;
  p0weapons[WeaponId.Pistol] = 1;
  p0weapons[WeaponId.Shotgun] = 1;
  const p0bullets = emptyBullets();
  p0bullets[BulletId.B12mm] = 500;
  p0bullets[BulletId.B9mm] = 500;
  p0bullets[BulletId.Shell] = 100;

  for (let t = 0; t < ticks; t++) {
    let keys = 0;
    let mouseXRel = 0;
    let mouseButtons: number = MouseButton.Left;

    if (t < 12) {
      // let the auto rifle load (loadingTime 12)
    } else if (t < 60) {
      keys |= Key.Up;
    } else if (t < 100) {
      keys |= Key.Up | Key.LeftStrafe;
    } else if (t < 140) {
      mouseXRel = 4;
    } else if (t < 180) {
      keys |= Key.Down;
    } else if (t < 220) {
      keys |= Key.Up;
      mouseXRel = -3;
    } else if (t < 260) {
      keys |= Key.Up;
      if (t === 220) keys |= Key.Shift; // weapon switch
      if (t === 240) mouseButtons |= MouseButton.Right; // switch back
    } else if (t < 300) {
      keys |= Key.Up | Key.RightStrafe;
    } else if (t < 340) {
      mouseXRel = 6;
    } else {
      keys |= Key.Left; // turn with keys
      mouseButtons = 0;
    }

    inputs.push({ keys, mouseXRel, mouseButtons });
  }

  return {
    seed: 12345,
    ticks,
    levelName: "levs/default/level1.lev",
    sensitivity: 0.5,
    mouseOwner: 0,
    players: [
      {
        x: 250,
        y: 190,
        angle: 0,
        energy: 100,
        local: true,
        weapons: p0weapons,
        bullets: p0bullets,
      },
      {
        x: 370,
        y: 190,
        angle: 180,
        energy: 5,
        local: false,
        weapons: emptyWeapons(),
        bullets: emptyBullets(),
      },
    ],
    inputs,
  };
}

function replayPlayer(
  x: number,
  y: number,
  angle: number,
  energy: number,
  weapons: number[],
  bullets: number[],
): ReplayPlayer {
  return { x, y, angle, energy, local: true, weapons, bullets };
}

function allWeapons(amount: number): number[] {
  return emptyWeapons().map(() => amount);
}

function allBullets(amount: number): number[] {
  return emptyBullets().map(() => amount);
}

/** Bullet-physics sweep: every weapon fires in an open arena. */
export function buildWeaponsScenario(): ReplayScript {
  const ticks = 900;
  const inputs: SimInput[] = [];
  for (let t = 0; t < ticks; t++) {
    // Hold Shift for one tick periodically to cycle to the next weapon.
    const keys = t > 20 && t % 60 === 0 ? Key.Shift : 0;
    const mouseXRel = Math.floor(t / 60) % 2 === 0 ? 1 : -1;
    inputs.push({ keys, mouseXRel, mouseButtons: MouseButton.Left });
  }
  return {
    seed: 22222,
    ticks,
    levelName: "levs/small.lev",
    sensitivity: 0.5,
    mouseOwner: 0,
    players: [replayPlayer(300, 190, 0, 100, allWeapons(1), allBullets(500))],
    inputs,
  };
}

/** Hostile engagement: a heavily-armed player fights the placed enemies. */
export function buildCombatScenario(): ReplayScript {
  const ticks = 800;
  const weapons = emptyWeapons();
  weapons[WeaponId.AutoRifle] = 1;
  const bullets = emptyBullets();
  bullets[BulletId.B12mm] = 500;
  const inputs: SimInput[] = [];
  for (let t = 0; t < ticks; t++) {
    // One Shift press at t=0 selects the only owned weapon (the auto rifle).
    // Firing east down the corridor makes the enemies hear it and shoot back.
    const keys = t === 0 ? Key.Shift : 0;
    inputs.push({ keys, mouseXRel: 0, mouseButtons: MouseButton.Left });
  }
  return {
    seed: 33333,
    ticks,
    levelName: "levs/jailbreak/level1.lev",
    sensitivity: 0.5,
    mouseOwner: 0,
    players: [replayPlayer(110, 135, 0, 1000, weapons, bullets)],
    inputs,
  };
}

/** Crate pickup: walk over a placed crate and bank the pickup text. */
export function buildCrateScenario(): ReplayScript {
  const ticks = 300;
  const inputs: SimInput[] = [];
  for (let t = 0; t < ticks; t++) {
    inputs.push({ keys: t < 240 ? Key.Up : 0, mouseXRel: 0, mouseButtons: 0 });
  }
  return {
    seed: 44444,
    ticks,
    levelName: "levs/jailbreak/level1.lev",
    sensitivity: 0.5,
    mouseOwner: 0,
    players: [replayPlayer(280, 360, 0, 100, emptyWeapons(), emptyBullets())],
    inputs,
  };
}

export interface ReplayScenario {
  /** Fixture base name (`fixtures/<name>.script` / `.trace`). */
  name: string;
  /** Level path relative to the reference `data/` dir. */
  level: string;
  /** Builds a fresh script (the registry is immutable; scripts are not). */
  build: () => ReplayScript;
}

/** Parity scenarios, each mirrored by a C++ oracle trace (`bun run parity`). */
export const SCENARIOS: readonly ReplayScenario[] = [
  { name: "replay1", level: "levs/default/level1.lev", build: buildScript },
  { name: "weapons", level: "levs/small.lev", build: buildWeaponsScenario },
  { name: "combat", level: "levs/jailbreak/level1.lev", build: buildCombatScenario },
  { name: "crates", level: "levs/jailbreak/level1.lev", build: buildCrateScenario },
];

/** Serialises a script to the binary `sim_gen replay` expects. */
export function serializeScript(s: ReplayScript): Uint8Array {
  const nameBytes = new TextEncoder().encode(s.levelName);
  const size =
    4 * 4 + // version, seed, ticks, nameLen
    nameBytes.length +
    4 + // sensitivity
    4 + // mouseOwner
    4 + // playerCount
    s.players.length * (4 * 4 + 4 + 13 * 4 + 12 * 4) +
    s.inputs.length * 3 * 4;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  let o = 0;
  const i32 = (v: number): void => {
    dv.setInt32(o, v, true);
    o += 4;
  };
  const u32 = (v: number): void => {
    dv.setUint32(o, v, true);
    o += 4;
  };
  const f32 = (v: number): void => {
    dv.setFloat32(o, v, true);
    o += 4;
  };
  u32(SCRIPT_VERSION);
  i32(s.seed);
  u32(s.ticks);
  u32(nameBytes.length);
  new Uint8Array(buf, o, nameBytes.length).set(nameBytes);
  o += nameBytes.length;
  f32(s.sensitivity);
  i32(s.mouseOwner);
  u32(s.players.length);
  for (const p of s.players) {
    f32(p.x);
    f32(p.y);
    f32(p.angle);
    f32(p.energy);
    i32(p.local ? 1 : 0);
    for (let a = 0; a < 13; a++) i32(p.weapons[a] ?? 0);
    for (let a = 0; a < 12; a++) i32(p.bullets[a] ?? 0);
  }
  for (const inp of s.inputs) {
    u32(inp.keys);
    i32(inp.mouseXRel);
    u32(inp.mouseButtons);
  }
  return new Uint8Array(buf, 0, o);
}

function worldFromScript(level: Level, s: ReplayScript, fontBytes?: Uint8Array): SimWorld {
  const w = new SimWorld(level, s.seed);
  if (fontBytes) {
    const font = decodeFnt(fontBytes);
    w.textLength = (text) => fontLength(font, text);
  }
  w.mouseSensitivity = s.sensitivity;
  w.mouseOwner = s.mouseOwner;
  w.players = s.players.map((rp) => {
    const p = new SimPlayer();
    p.x = rp.x;
    p.y = rp.y;
    p.angle = rp.angle;
    p.energy = rp.energy;
    p.local = rp.local;
    p.weapons = rp.weapons.slice();
    p.bullets = rp.bullets.slice();
    if (p.local) w.initScr(p, DRAW_RECT);
    return p;
  });
  w.spawnEntities();
  return w;
}

/** Runs the replay and returns the same trace bytes `sim_gen` writes. */
export function runReplay(
  levelBytes: Uint8Array,
  s: ReplayScript,
  fontBytes?: Uint8Array,
): Uint8Array {
  const level = loadLevel(levelBytes);
  const w = worldFromScript(level, s, fontBytes);

  const parts: number[] = [];
  const pushI32 = (v: number): void => {
    parts.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  };
  const pushF32 = (v: number): void => {
    const b = new ArrayBuffer(4);
    new DataView(b).setFloat32(0, v, true);
    const u = new Uint8Array(b);
    parts.push(u[0], u[1], u[2], u[3]);
  };

  for (let t = 0; t < s.ticks; t++) {
    w.tick(s.inputs[t], DRAW_RECT);
    pushI32(t);
    pushI32(w.players.length);
    for (const p of w.players) {
      pushF32(p.x);
      pushF32(p.y);
      pushF32(p.angle);
      pushF32(p.energy);
      pushF32(p.pushPower);
      pushI32(p.screenX);
      pushI32(p.screenY);
      pushI32(p.curWeapon);
      pushI32(p.secWeapon);
      pushI32(p.anim);
      pushI32(p.dead);
      pushI32(p.hit);
      pushI32(p.walk);
      pushI32(p.shootCount);
      pushI32(p.loadCounter);
      pushI32(p.loadCounter2);
      pushI32(p.secondaryCounter);
      pushI32(p.targetAngle);
      pushI32(p.kick);
      pushI32(p.burning);
      pushI32(p.cash);
      pushI32(p.targetSystem ? 1 : 0);
      for (let a = 0; a < 13; a++) pushI32(p.weapons[a] ?? 0);
      for (let a = 0; a < 12; a++) pushI32(p.bullets[a] ?? 0);
    }
    pushI32(w.bullets.length);
    for (const b of w.bullets) {
      pushF32(b.x);
      pushF32(b.y);
      pushF32(b.spriteAngle);
      pushF32(b.speed);
      pushF32(b.share);
      pushI32(b.angle);
      pushI32(b.counter);
      pushI32(b.typeId);
      pushI32(b.ownerId);
    }
    pushI32(w.enemies.length);
    for (const e of w.enemies) {
      pushF32(e.x);
      pushF32(e.y);
      pushF32(e.angle);
      pushF32(e.energy);
      pushF32(e.pushPower);
      pushI32(e.targetAngle);
      pushI32(e.pushAngle);
      pushI32(e.walk);
      pushI32(e.fire);
      pushI32(e.anim);
      pushI32(e.loadCounter);
      pushI32(e.shootCount);
      pushI32(e.burning);
      pushI32(e.state);
      pushI32(e.walkCounter);
      pushI32(e.curWeapon);
    }
    pushI32(w.bodyparts.length);
    for (const bp of w.bodyparts) {
      pushF32(bp.x);
      pushF32(bp.y);
      pushF32(bp.speed);
      pushI32(bp.angle);
      pushI32(bp.typeId);
    }
    pushI32(w.effects.length);
    for (const eff of w.effects) {
      pushF32(eff.x);
      pushF32(eff.y);
      pushI32(eff.counter);
      pushI32(eff.typeId);
    }
    pushI32(w.crates.length);
    for (const c of w.crates) {
      pushF32(c.textCounter);
      pushF32(c.textCounter2);
      pushI32(c.x);
      pushI32(c.y);
      pushI32(c.inUse);
      pushI32(c.textAngle);
      pushI32(c.wakeUpCounter);
      pushI32(c.kind);
      pushI32(c.value);
    }
    pushI32(w.deadEnemies.length);
    for (const d of w.deadEnemies) {
      pushI32(d.x);
      pushI32(d.y);
    }
    pushI32(w.steamAnimationCount);
  }
  return new Uint8Array(parts);
}
