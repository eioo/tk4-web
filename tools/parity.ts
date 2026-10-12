/**
 * CI-style parity task (docs 13). Builds the C++ oracles, regenerates every
 * scenario's state trace and each static frame from the reference, runs the
 * same inputs through the TypeScript port, and reports any drift byte-by-byte.
 *
 *   bun run parity              run all scenarios + frames (builds oracles)
 *   bun run parity --no-build   skip the oracle build (reuse /tmp binaries)
 *   bun run parity <name>       run only the named scenario/frame group
 *   bun run parity --update     rewrite the committed fixtures from the port
 *
 * The committed fixtures under `tools/reference/fixtures/` let `bun test` run
 * without a C++ compiler; this task is what keeps them honest. Exits non-zero
 * on any drift.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readRef, readRefText, sha256 } from "../src/data/__test__/helpers";
import { decodePaletteTab } from "../src/data/color-tables";
import { mergeIni } from "../src/data/config";
import { loadIngameData } from "../src/data/ingame-data";
import { loadLevel } from "../src/data/level";
import { drawStaticFrame, screenPosFor, toDrawSprites } from "../src/render/draw-manager";
import { GameDrawer } from "../src/render/drawer";
import { Framebuffer } from "../src/render/fb";
import { FRAME_CASES } from "../src/render/frames";
import { runReplay, SCENARIOS, serializeScript } from "../src/sim/replay";
import { dumpLevel } from "./reference/dump-level";

const SIM_GEN = "/tmp/sim_gen";
const RENDER_GEN = "/tmp/render_gen";
const DATA_DIR = fileURLToPath(new URL("../tapankaikki4/data", import.meta.url));
const FIXTURE_DIR = new URL("./reference/fixtures/", import.meta.url);

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const filter = args.find((a) => !a.startsWith("--"));
const update = flags.has("--update");
const doBuild = !flags.has("--no-build");

const tmp = mkdtempSync(join(tmpdir(), "tk4-parity-"));
let failures = 0;

function report(label: string, ok: boolean, detail: string): void {
  console.log(`  ${label.padEnd(16)} ${ok ? "ok   " : "DRIFT"} ${detail}`);
  if (!ok) failures++;
}

/** First differing byte offset between two buffers, or -1. */
function firstDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

function compare(label: string, want: Uint8Array, got: Uint8Array): boolean {
  const at = firstDiff(want, got);
  if (at === -1) {
    report(label, true, `${got.length} B, sha256 ${sha256(got).slice(0, 12)}…`);
    return true;
  }
  report(
    label,
    false,
    `byte ${at} of ${got.length}/${want.length} (want ${want[at]}, got ${got[at]})`,
  );
  return false;
}

function run(cmd: string[], cwd?: string): number {
  const proc = Bun.spawnSync({ cmd, cwd, stdout: "inherit", stderr: "inherit" });
  return proc.exitCode ?? 1;
}

// ---------------------------------------------------------------------------
// simulation scenarios
// ---------------------------------------------------------------------------

async function simScenarios(fontBytes: Uint8Array): Promise<void> {
  console.log("simulation traces");
  for (const scenario of SCENARIOS) {
    if (filter && scenario.name !== filter) continue;

    const levelBytes = await readRef(scenario.level);
    const script = scenario.build();
    const scriptBytes = serializeScript(script);
    const dumpPath = join(tmp, `${scenario.name}.dump`);
    const scriptPath = join(tmp, `${scenario.name}.script`);
    const tracePath = join(tmp, `${scenario.name}.trace`);
    await Bun.write(dumpPath, dumpLevel(loadLevel(levelBytes)));
    await Bun.write(scriptPath, scriptBytes);

    const code = run([SIM_GEN, "replay", dumpPath, scriptPath, tracePath, DATA_DIR]);
    if (code !== 0) {
      report(scenario.name, false, `oracle exited ${code}`);
      continue;
    }

    const oracle = new Uint8Array(await Bun.file(tracePath).arrayBuffer());
    const port = runReplay(levelBytes, script, fontBytes);

    const ok = compare(scenario.name, oracle, port);
    if (!ok) continue;

    const traceFixture = Bun.file(new URL(`${scenario.name}.trace`, FIXTURE_DIR));
    const scriptFixture = Bun.file(new URL(`${scenario.name}.script`, FIXTURE_DIR));
    if (update) {
      await Bun.write(scriptFixture, scriptBytes);
      await Bun.write(traceFixture, oracle);
      console.log(`  ${scenario.name.padEnd(16)} updated fixtures`);
    } else if (!(await traceFixture.exists()) || !(await scriptFixture.exists())) {
      report(scenario.name, false, "missing committed fixture (run --update)");
    } else {
      const wantScript = new Uint8Array(await scriptFixture.arrayBuffer());
      const wantTrace = new Uint8Array(await traceFixture.arrayBuffer());
      if (firstDiff(wantScript, scriptBytes) !== -1)
        report(`${scenario.name}.script`, false, "stale");
      if (firstDiff(wantTrace, oracle) !== -1) report(`${scenario.name}.trace`, false, "stale");
    }
  }
}

// ---------------------------------------------------------------------------
// static frames
// ---------------------------------------------------------------------------

const paletteTab = decodePaletteTab(await readRef("palette.tab"));
const ingame = await loadIngameData(mergeIni(await readRefText("default.ini")), readRef);
const sprites = toDrawSprites(ingame);

function portFrame(levelBytes: Uint8Array): Uint8Array {
  const level = loadLevel(levelBytes);
  const start = level.starts[0];
  const location = { x: start.x * 20 + 10, y: start.y * 20 + 10 };
  const fb = new Framebuffer(640, 480);
  const dark = new Uint8Array(640 * 480);
  const drawRect = fb.rect();
  drawStaticFrame({
    level,
    sprites,
    drawer: new GameDrawer(paletteTab),
    fb,
    dark,
    drawRect,
    screenPos: screenPosFor(location, drawRect),
    playerLocation: location,
  });
  return fb.pixels;
}

async function frames(): Promise<void> {
  console.log("static frames");
  for (const { file, hash } of FRAME_CASES) {
    const name = file.replace(/^.*\//, "").replace(/\.lev$/, "");
    if (filter && name !== filter) continue;

    const levelBytes = await readRef(`levs/${file}`);
    const level = loadLevel(levelBytes);
    const start = level.starts[0];
    const locX = start.x * 20 + 10;
    const locY = start.y * 20 + 10;

    const dumpPath = join(tmp, `${name}.dump`);
    const outPath = join(tmp, `${name}.raw`);
    await Bun.write(dumpPath, dumpLevel(level));
    const code = run([
      RENDER_GEN,
      dumpPath,
      DATA_DIR,
      outPath,
      String(locX),
      String(locY),
      "640",
      "480",
    ]);
    if (code !== 0) {
      report(name, false, `render oracle exited ${code}`);
      continue;
    }

    const oracleFull = new Uint8Array(await Bun.file(outPath).arrayBuffer());
    const oracle = oracleFull.subarray(8); // skip uint32 width + height
    const port = portFrame(levelBytes);

    const ok = compare(name, oracle, port);
    if (ok && sha256(port) !== hash) report(`${name}.hash`, false, "committed frame hash stale");
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

if (doBuild) {
  console.log("building oracles…");
  if (run(["sh", "tools/build-reference.sh"]) !== 0) {
    console.error("oracle build failed");
    process.exit(1);
  }
}
for (const bin of [SIM_GEN, RENDER_GEN]) {
  if (!existsSync(bin)) {
    console.error(`missing ${bin} (run without --no-build)`);
    process.exit(1);
  }
}

try {
  await simScenarios(await readRef("fnts/menu15x18dark.fnt"));
  await frames();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nparity: OK" : `\nparity: ${failures} drift(s)`);
process.exit(failures === 0 ? 0 : 1);
