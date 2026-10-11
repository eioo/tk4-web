/**
 * Canvas2D presenter (`putImageData`): the default, dependency-free path.
 *
 * The canvas' backing store stays at the video-mode resolution; integer
 * upscaling to the window is done with CSS and `image-rendering: pixelated`
 * (see `index.html`). This keeps `putImageData` cheap and the pixels crisp.
 */

import type { Palette } from "../../data/palette";
import type { Framebuffer } from "../fb";
import type { Presenter } from "../presenter";

export class Canvas2DPresenter implements Presenter {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement("canvas");
    this.canvas.id = "screen";
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas2D context unavailable");
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.image = ctx.createImageData(width, height);
  }

  present(fb: Framebuffer, palette: Palette): void {
    fb.toRgba(palette, this.image.data);
    this.ctx.putImageData(this.image, 0, 0);
  }

  fit(): void {
    const sx = window.innerWidth / this.width;
    const sy = window.innerHeight / this.height;
    const fit = Math.min(sx, sy);
    const scale = fit >= 1 ? Math.floor(fit) : fit;
    this.canvas.style.width = `${Math.round(this.width * scale)}px`;
    this.canvas.style.height = `${Math.round(this.height * scale)}px`;
  }
}
