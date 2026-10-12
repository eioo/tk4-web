/**
 * Presenter selection (docs/10). The Canvas2D `putImageData` path is the
 * default; `?presenter=webgl` picks the index-texture + palette-shader path
 * (approach B), which transparently falls back to Canvas2D when WebGL is
 * unavailable or fails to initialise.
 */

import type { Presenter } from "../presenter";
import { Canvas2DPresenter } from "./canvas2d";
import { WebGLPresenter } from "./webgl";

function requestedWebgl(): boolean {
  try {
    return new URLSearchParams(globalThis.location?.search ?? "").get("presenter") === "webgl";
  } catch {
    return false;
  }
}

export function createPresenter(width: number, height: number): Presenter {
  if (requestedWebgl()) {
    try {
      return new WebGLPresenter(width, height);
    } catch (err) {
      console.warn("WebGL presenter unavailable, using Canvas2D", err);
    }
  }
  return new Canvas2DPresenter(width, height);
}
