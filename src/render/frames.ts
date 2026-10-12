/**
 * Static-frame parity cases (docs 13). Each entry is a level file (relative to
 * the reference `data/` dir) and the SHA-256 of the frame the C++ rendering
 * oracle (`tools/reference/render_gen.cpp`) produces at the level's first start
 * point. `src/render/__test__/static-frame.test.ts` and `tools/parity.ts` both
 * consume this registry.
 */
export interface FrameCase {
  /** Level path relative to the reference `data/` dir. */
  file: string;
  /** SHA-256 of the oracle's 640×480 index frame. */
  hash: string;
}

export const FRAME_CASES: readonly FrameCase[] = [
  {
    file: "default/level1.lev",
    hash: "f766ff22e80b770d1f0819c17563ff76064c641cdf86915ebc5d061e957c4099",
  },
  {
    file: "default/level5.lev",
    hash: "a4df518f682ddfd0f01d51d3f57a3a336c813bb6597a3a797a1d33043d2e64a9",
  },
  { file: "cave.lev", hash: "6ab0e73a4a9afe7cf1219b10599616644a0045411b5aac14df135d07fd5eeabe" },
  { file: "dm.lev", hash: "a36dcbd8719f209f974d199e0b4de914fd3c59f9923667bfea2a62156eb6cbab" },
  {
    file: "jailbreak/level3.lev",
    hash: "8fa4175218247dc0259f3f870f92224362eb0e4bc8150e4d12e1989783a5af6a",
  },
  { file: "small.lev", hash: "e599f19e28a946c2f8ecd72102211ee8557a5f7c41d0e27a41f24c2337720d1e" },
];
