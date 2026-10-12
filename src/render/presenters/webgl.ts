/**
 * WebGL presenter (docs/10, approach B): upload the 8-bit index framebuffer as a
 * single-channel `LUMINANCE` texture and a 256×1 palette LUT, and let a fragment
 * shader do `color = texture(palette, index)`. Both textures use `NEAREST`
 * filtering, so the result is byte-identical to the Canvas2D path while moving
 * the per-pixel work off the CPU (useful for large video modes).
 *
 * The canvas' backing store stays at the video-mode resolution and integer
 * upscaling to the window is done with CSS (as in `Canvas2DPresenter`).
 */

import type { Palette } from "../../data/palette";
import type { Framebuffer } from "../fb";
import type { Presenter } from "../presenter";

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  // Flip V: framebuffer row 0 is the top, WebGL texture row 0 is the bottom.
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uIndex;
uniform sampler2D uPalette;
void main() {
  float idx = texture2D(uIndex, vUv).r; // byte / 255
  float u = (idx * 255.0 + 0.5) / 256.0;
  gl_FragColor = texture2D(uPalette, vec2(u, 0.5));
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL: createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`WebGL: shader compile failed: ${log}`);
  }
  return shader;
}

export class WebGLPresenter implements Presenter {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly indexTex: WebGLTexture;
  private readonly paletteTex: WebGLTexture;
  private readonly palRgba = new Uint8Array(256 * 4);
  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement("canvas");
    this.canvas.id = "screen";
    this.canvas.width = width;
    this.canvas.height = height;

    const gl = this.canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error("WebGL context unavailable");
    this.gl = gl;

    const program = gl.createProgram();
    if (!program) throw new Error("WebGL: createProgram failed");
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`WebGL: link failed: ${gl.getProgramInfoLog(program)}`);
    }
    gl.useProgram(program);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.uniform1i(gl.getUniformLocation(program, "uIndex"), 0);
    gl.uniform1i(gl.getUniformLocation(program, "uPalette"), 1);

    this.indexTex = this.makeTexture(width, height, gl.LUMINANCE);
    this.paletteTex = this.makeTexture(256, 1, gl.RGBA);
  }

  private makeTexture(width: number, height: number, format: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error("WebGL: createTexture failed");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, gl.UNSIGNED_BYTE, null);
    return tex;
  }

  present(fb: Framebuffer, palette: Palette): void {
    const gl = this.gl;
    for (let i = 0; i < 256; i++) {
      this.palRgba[i * 4] = palette[i * 3];
      this.palRgba[i * 4 + 1] = palette[i * 3 + 1];
      this.palRgba[i * 4 + 2] = palette[i * 3 + 2];
      this.palRgba[i * 4 + 3] = 255;
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.indexTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.width,
      this.height,
      gl.LUMINANCE,
      gl.UNSIGNED_BYTE,
      fb.pixels,
    );

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.palRgba);

    gl.viewport(0, 0, this.width, this.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
