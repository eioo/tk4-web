/**
 * Presentation boundary (doc 10). The renderer owns an 8-bit index
 * framebuffer; a `Presenter` converts it to pixels on a `<canvas>`. Two
 * implementations are planned: Canvas2D (`putImageData`, default) and a WebGL
 * palette shader (fallback for large modes). Both consume the same framebuffer
 * and palette, so they are interchangeable.
 */

import type { Palette } from "../data/palette";
import type { Framebuffer } from "./fb";

export interface Presenter {
  /** The DOM canvas; append it to the page. */
  readonly canvas: HTMLCanvasElement;
  /** Blits `fb` to the canvas using `palette`. */
  present(fb: Framebuffer, palette: Palette): void;
  /** Recomputes the integer upscale to fit the window. */
  fit(): void;
}
