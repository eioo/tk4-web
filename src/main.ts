import { createLoop } from "./core/loop";
import { decodePaletteTab } from "./data/color-tables";
import { mergeIni } from "./data/config";
import { decodeFnt, fontLength } from "./data/font";
import { loadIngameData } from "./data/ingame-data";
import { loadLevel } from "./data/level";
import { drawFrame, toDrawSprites } from "./render/draw-manager";
import { GameDrawer } from "./render/drawer";
import { Framebuffer } from "./render/fb";
import { Canvas2DPresenter } from "./render/presenters/canvas2d";
import { BulletId, WeaponId, WeaponTypes } from "./sim/types";
import { Key, MouseButton, SimPlayer, SimWorld, type SimInput } from "./sim/world";

/** Internal (video-mode) resolution — the original's in-game default. */
const WIDTH = 640;
const HEIGHT = 480;

/** Level shown at boot (M3 runs a playable single-player level). */
const LEVEL_PATH = "levs/default/level1.lev";

async function loadBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(`assets/${path}`);
  if (!res.ok) throw new Error(`missing asset "assets/${path}" — run "bun run assets" first`);
  return new Uint8Array(await res.arrayBuffer());
}

async function loadText(path: string): Promise<string> {
  const res = await fetch(`assets/${path}`);
  if (!res.ok) throw new Error(`missing asset "assets/${path}" — run "bun run assets" first`);
  return res.text();
}

/** Maps held physical keys (`KeyboardEvent.code`) to the simulation key bitmask. */
function keyMask(held: ReadonlySet<string>): number {
  let k = 0;
  if (held.has("KeyW") || held.has("ArrowUp")) k |= Key.Up;
  if (held.has("KeyS") || held.has("ArrowDown")) k |= Key.Down;
  if (held.has("ArrowLeft")) k |= Key.Left;
  if (held.has("ArrowRight")) k |= Key.Right;
  if (held.has("KeyA")) k |= Key.LeftStrafe;
  if (held.has("KeyD")) k |= Key.RightStrafe;
  if (held.has("Space")) k |= Key.Shoot;
  if (held.has("ShiftLeft") || held.has("ShiftRight")) k |= Key.Shift;
  return k;
}

function makePlayer(startX: number, startY: number): SimPlayer {
  const p = new SimPlayer();
  p.x = startX * 20;
  p.y = startY * 20;
  p.energy = 100;
  p.local = true;
  p.weapons[WeaponId.Fist] = 1;
  p.weapons[WeaponId.Pistol] = 1;
  p.weapons[WeaponId.Shotgun] = 1;
  p.weapons[WeaponId.Uzi] = 1;
  p.weapons[WeaponId.AutoRifle] = 1;
  p.weapons[WeaponId.RocketLauncher] = 1;
  p.weapons[WeaponId.GrenadeLauncher] = 1;
  p.weapons[WeaponId.FlameThrower] = 1;
  p.bullets[BulletId.B9mm] = 600;
  p.bullets[BulletId.Shell] = 300;
  p.bullets[BulletId.B12mm] = 600;
  p.bullets[BulletId.MediumRockets] = 50;
  p.bullets[BulletId.Grenades] = 50;
  p.bullets[BulletId.Gas] = 1200;
  p.curWeapon = WeaponId.Pistol;
  return p;
}

async function boot(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) throw new Error("#app element not found");

  const presenter = new Canvas2DPresenter(WIDTH, HEIGHT);
  presenter.fit();
  window.addEventListener("resize", () => presenter.fit());
  root.appendChild(presenter.canvas);

  const [cfgText, paletteTabBytes, levelBytes, fontBytes] = await Promise.all([
    loadText("default.ini"),
    loadBytes("palette.tab"),
    loadBytes(LEVEL_PATH),
    loadBytes("fnts/menu15x18dark.fnt"),
  ]);
  const level = loadLevel(levelBytes);
  const ingame = await loadIngameData(mergeIni(cfgText), loadBytes);
  const sprites = toDrawSprites(ingame);
  const font = decodeFnt(fontBytes);

  const fb = new Framebuffer(WIDTH, HEIGHT);
  const dark = new Uint8Array(WIDTH * HEIGHT);
  const drawer = new GameDrawer(decodePaletteTab(paletteTabBytes));
  const drawRect = fb.rect();

  const start = level.starts[0] ?? { x: level.width >> 1, y: level.height >> 1 };
  const world = new SimWorld(level, (Date.now() / 1000) >>> 0);
  world.mouseOwner = 0;
  world.mouseSensitivity = 0.5;
  world.textLength = (text) => fontLength(font, text);
  const player = makePlayer(start.x, start.y);
  world.players = [player];
  world.initScr(player, drawRect);
  world.spawnEntities();
  // ---- input ----
  const held = new Set<string>();
  let mouseDX = 0;
  let mouseButtons = 0;
  let wheelTicks = 0;
  const canvas = presenter.canvas;

  window.addEventListener("keydown", (e) => {
    held.add(e.code);
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  });
  window.addEventListener("keyup", (e) => held.delete(e.code));
  window.addEventListener("blur", () => {
    held.clear();
    mouseButtons = 0;
  });

  canvas.addEventListener("mousedown", (e) => {
    if (document.pointerLockElement !== canvas) {
      void canvas.requestPointerLock();
      return;
    }
    if (e.button === 0) mouseButtons |= MouseButton.Left;
    if (e.button === 2) mouseButtons |= MouseButton.Right;
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) mouseButtons &= ~MouseButton.Left;
    if (e.button === 2) mouseButtons &= ~MouseButton.Right;
  });
  window.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === canvas) mouseDX += e.movementX;
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      wheelTicks += e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0;
    },
    { passive: false },
  );

  const hint = root.ownerDocument.createElement("div");
  hint.textContent =
    "Click to play — WASD move, mouse aim, click/space shoot, wheel/Shift change weapon";
  Object.assign(hint.style, {
    font: "13px/1.5 monospace",
    color: "#9aa",
    padding: "8px",
    textAlign: "center",
  } satisfies Partial<CSSStyleDeclaration>);
  root.appendChild(hint);
  const updateHint = (): void => {
    hint.style.visibility = document.pointerLockElement === canvas ? "hidden" : "visible";
  };
  document.addEventListener("pointerlockchange", updateHint);

  // ---- loop ----
  const loop = createLoop({
    tick: () => {
      let buttons = mouseButtons;
      if (wheelTicks > 0) buttons |= MouseButton.WheelDown;
      else if (wheelTicks < 0) buttons |= MouseButton.WheelUp;
      wheelTicks = 0;
      const input: SimInput = { keys: keyMask(held), mouseXRel: mouseDX, mouseButtons: buttons };
      mouseDX = 0;
      world.tick(input, drawRect);
    },
    render: () => {
      fb.clear(0);
      dark.fill(0);
      drawFrame(
        {
          level,
          sprites,
          drawer,
          fb,
          dark,
          drawRect,
          screenPos: { x: player.screenX, y: player.screenY },
          playerLocation: { x: player.x, y: player.y },
          players: world.players,
          bullets: world.bullets,
          enemies: world.enemies,
          bodyparts: world.bodyparts,
          effects: world.effects,
          crates: world.crates,
        },
        HEIGHT,
      );
      presenter.present(fb, ingame.palette);
    },
  });
  loop.start();
  window.tk4Ready = true;
  window.tk4State = () => ({
    x: player.x,
    y: player.y,
    angle: player.angle,
    energy: player.energy,
    weapon: player.curWeapon,
    ammo: player.bullets[WeaponTypes[player.curWeapon].bulletType],
    bullets: world.bullets.length,
    enemies: world.enemies.length,
    crates: world.crates.filter((c) => c.inUse).length,
    bodyparts: world.bodyparts.length,
    effects: world.effects.length,
    cash: player.cash,
  });
}

boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  window.tk4Error = message;
  const root = document.getElementById("app");
  if (root) {
    root.innerHTML = `<pre style="color:#f66;font:14px/1.5 monospace;padding:16px;white-space:pre-wrap">Boot failed: ${message}</pre>`;
  }
  console.error(err);
});
