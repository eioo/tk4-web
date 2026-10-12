# Tooling & Environment

## Needed for the web port itself

| Tool | Why | Install |
|------|-----|---------|
| **Bun** (≥ 1.x) | Package manager, runtime, test runner, build | `curl -fsSL https://bun.sh/install \| bash` |
| **oxlint** | Fast JS/TS linter (dev dependency) | `bun add -d oxlint` |
| **oxfmt** | Fast Prettier-compatible formatter (dev dependency) | `bun add -d oxfmt` |
| **Vite** | Dev server + HMR + production bundling (dev dependency) | `bun add -d vite` |
| **TypeScript** | Type checking (dev dependency) | `bun add -d typescript` |
| **Git** | Version control | distro package |
| Node.js (optional) | Some tooling expects `node`; Bun can usually cover it | — |
| `ffmpeg` (optional) | Audio transcoding (MP3 fallback, normalisation), video capture of reference | distro package |
| ImageMagick / `compare` (optional) | Pixel-diffing screenshots | distro package |

There is **no game-framework dependency**. Everything runs on browser platform APIs
(Canvas2D/WebGL, WebAudio, Pointer Lock) plus Bun tooling.

Lint and format are handled by the Oxc tools, configured by `.oxlintrc.json` and
`.oxfmtrc.json`:

| Command | Purpose |
|---------|---------|
| `bun run dev` | Ensure assets, then Vite (HMR) + netplay WebSocket server in parallel |
| `bun run assets` | Rebuild `public/assets` from `tapankaikki4/data` (clones it if missing) |
| `bun run assets:ensure` | Build `public/assets` only if it is missing |
| `bun run assets:source` | Fetch only the `tapankaikki4/` checkout (cloned if missing) |
| `bun run lint` | Lint (`oxlint`) |
| `bun run lint:fix` | Lint and apply safe fixes |
| `bun run fmt` | Format (`oxfmt`) |
| `bun run fmt:check` | Check formatting without writing |
| `bun run reference` | Build the standalone C++ oracles (`/tmp/{rotate,render,sim}_gen`) |
| `bun run parity` | Build the oracles and diff every scenario trace + static frame ([Parity, Testing & Risks](parity-testing-and-risks.md)) |
| `bun run perf` | Time the presentation-path CPU against its 60 fps budget ([Parity, Testing & Risks](parity-testing-and-risks.md)) |
| `bun run serve` | Host an existing `dist/` build (`Bun.serve`; `--port`/`--host`, default `0.0.0.0:4173`) |
| `bun run start` | Ensure assets, `bun run build`, then serve — the production command ([Web Port Architecture](web-port-architecture.md)) |

## Continuous integration

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every push to
`master` and on every pull request: `bun install --frozen-lockfile`, then
`bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun test` and
`bun run build`. Before the tests it runs `bun run assets:source` to fetch the
upstream checkout, because the suite reads the original data directly from
`tapankaikki4/data/`. Parity (`bun run parity`) is deliberately **not** in CI — it
compiles the C++ oracle and needs `g++` — so run it locally whenever simulation code
changes.

## Needed to build & run the ORIGINAL (the "reference oracle")

**Strongly recommended early.** A running original lets us capture golden screenshots and
state traces, and resolves format ambiguities (see [Parity, Testing & Risks](parity-testing-and-risks.md)). The original uses **SDL 1.2**
(not SDL2) plus SDL_image, SDL_mixer, SDL_net.

Debian/Ubuntu package names:

```
build-essential cmake
libsdl1.2-dev
libsdl-image1.2-dev
libsdl-mixer1.2-dev
libsdl-net1.2-dev
# editor only (optional): libgtk2.0-dev
# headless capture:
xvfb
imagemagick
```

macOS (Homebrew) equivalents exist (`sdl`, `sdl_image`, `sdl_mixer`, `sdl_net` via
`sdl12-compat`), but Linux is the path of least resistance for the reference build.

Build and run:

```
cd tapankaikki4
cmake . && make          # produces tk4, tk4-editor, efpconv
cd data && ../tk4        # run with data/ as the working directory
```

For headless capture: `xvfb-run -s "-screen 0 640x480x16" ../tk4` plus a screenshot tool
(e.g. `import -window root`, or SDL's own screenshot path if a key is bound).

> CMake note: `CMakeLists.txt` links SDL 1.2 (`find_package(SDL 1 ...)`). If a distro only
> ships SDL2, install `sdl12-compat` (`libsdl1.2-compat-dev`) which provides the SDL 1.2
> API/ABI on top of SDL2.

## Do we need Ghidra / a disassembler?

**No.** The game's full C++ source is available in `tapankaikki4/src/`. There is nothing
to reverse-engineer at the binary level for a faithful port. The only reason to touch a
binary would be to diff against the *original closed-source* commercial build, which is
neither available nor necessary. Skip Ghidra.

## Other useful (optional) tools

- **Python 3** — used to bootstrap/verify decoders (the EFP/level analysis in these docs
  was done with small Python scripts). Keep as a reference implementation.
- **`xxd` / `hexdump`** — inspecting binary formats.
- **SDL_mixer's trackers** — for `.ogg` playback there is nothing special; browsers handle
  OGG Vorbis natively.
- **`bun test`** and **`vite`** — testing and dev server (both driven by Bun).
- **`wasmtime`/Emscripten** — *not* planned; the project is a TS reimplementation, not a
  WASM compile. Mentioned only because it is an alternative route we are deliberately not
  taking.

## Summary of what to install now

Minimum to start M0–M1:

```
bun, git
```

Recommended to start reference capture in parallel (M1 onward):

```
build-essential cmake xvfb imagemagick \
libsdl1.2-dev libsdl-image1.2-dev libsdl-mixer1.2-dev libsdl-net1.2-dev
```

Optional but handy: `ffmpeg`, `python3`.
