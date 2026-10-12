/**
 * `CSoundPlayer` — positional sample playback.
 *
 * The pan/volume maths (`StereoShaper`) is copied from the original and kept
 * pure so it can be unit-tested without an `AudioContext`; the `SoundPlayer`
 * class wraps WebAudio with a `GainNode` + `StereoPannerNode` per shot.
 */

import { SoundEffect } from "../sim/types";

/**
 * `KEffectFiles` — the `default.ini` key naming each effect's `.wav`, indexed
 * by {@link SoundEffect}.
 */
export const KEffectFiles: readonly string[] = [
  "GameSoundEffectPistol",
  "GameSoundEffectShotgun",
  "GameSoundEffectUzi",
  "GameSoundEffectAutorifle",
  "GameSoundEffectBazooka",
  "GameSoundEffectHit",
  "GameSoundEffectSmallExplosion",
  "GameSoundEffectExplosion",
  "GameSoundEffectBigExplosion",
  "GameSoundEffectClick",
  "GameSoundEffectDeath",
  "GameSoundEffectWoosh",
  "GameSoundEffectFlame",
  "GameSoundEffectMetalhit",
  "GameSoundEffectGrenadeLauncher",
  "GameSoundEffectKickHead",
];

export interface Pan {
  left: number;
  right: number;
}

/** `CMath::GetDist` on `CCoord<float>`. */
function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * `CSoundPlayer::StereoShaper` — the per-channel volumes for a sound at
 * `(effectX, effectY)` heard from `(observerX, observerY)`. Values are 0..255
 * (SDL_mixer's `Mix_SetPanning` channel volumes).
 */
export function stereoShaper(
  observerX: number,
  observerY: number,
  effectX: number,
  effectY: number,
): Pan {
  const d = dist(observerX, observerY, effectX, effectY) / 2;
  const xdist = observerX - effectX;
  const ydist = (observerY - effectY) * 0.7;

  if (d <= 0) return { left: 128, right: 128 };

  const left = Math.min(
    Math.sqrt(Math.max(128 * 128 - ydist * ydist - (xdist - 64) * (xdist - 64), 0)) +
      10000 / Math.sqrt(ydist * ydist + (xdist - 64) * (xdist - 64)),
    255,
  );
  const right = Math.min(
    Math.sqrt(Math.max(128 * 128 - ydist * ydist - (xdist + 64) * (xdist + 64), 0)) +
      10000 / Math.sqrt(ydist * ydist + (xdist + 64) * (xdist + 64)),
    255,
  );

  let l = Math.trunc(left);
  let r = Math.trunc(right);
  // "Cut the heaps..." — keep the two channels from both being loud.
  if (l + r > 256) {
    const dif = Math.trunc((l + r - 256) / 2);
    l -= dif;
    r -= dif;
  }
  return { left: l, right: r };
}

/**
 * Converts SDL_mixer channel volumes to a WebAudio `StereoPannerNode.pan`
 * value in −1..1 (constant-power approximation). `reverse` flips the image.
 */
export function panValue(pan: Pan, reverse = false): number {
  const total = pan.left + pan.right;
  if (total <= 0) return 0;
  let panv = (pan.right - pan.left) / total;
  if (panv > 1) panv = 1;
  if (panv < -1) panv = -1;
  return reverse ? -panv : panv;
}

export const PAN_MIDDLE: Pan = { left: 128, right: 128 };

type Loader = (path: string) => Promise<Uint8Array>;

/**
 * A single audible event from the simulation or UI. Positional events are
 * panned around the observer; flat events (menu clicks, the local player's own
 * death) play centred.
 */
export interface SoundEvent {
  effect: SoundEffect;
  volume: number;
  x: number;
  y: number;
  positional: boolean;
}

/**
 * `CSoundPlayer`. The `AudioContext` is created lazily; browsers start it
 * suspended until a user gesture, so `resume()` must be called from an input
 * handler.
 */
export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private readonly buffers: (AudioBuffer | null)[] = Array.from(
    { length: SoundEffect.Amount },
    () => null,
  );
  private fxVolume = 1;
  private reverseStereo = false;
  private loadPromise: Promise<void> | null = null;

  /** True once an `AudioContext` exists (regardless of suspended state). */
  get initialized(): boolean {
    return this.ctx !== null;
  }

  /** `CSoundPlayer::Initialize`. */
  initialize(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof AudioContext === "undefined") return null;
    this.ctx = new AudioContext();
    return this.ctx;
  }

  /** Creates/resumes the context; call from a user-gesture handler. */
  resume(): void {
    const ctx = this.initialize();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  /** `CSoundPlayer::SetFXVolume` (clamped 0..1). */
  setFxVolume(value: number): void {
    this.fxVolume = value < 0 ? 0 : value > 1 ? 1 : value;
  }

  /** `CSoundPlayer::SetReverseStereo`. */
  setReverseStereo(value: number): void {
    this.reverseStereo = value !== 0;
  }

  /**
   * Loads and decodes every effect named in `cfg` (`KEffectFiles` order).
   * Missing/failed effects stay silent; the promise always resolves.
   */
  load(cfg: { get(key: string): string | undefined }, load: Loader): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    const ctx = this.initialize();
    if (!ctx) {
      this.loadPromise = Promise.resolve();
      return this.loadPromise;
    }
    this.loadPromise = Promise.all(
      KEffectFiles.map(async (key, index) => {
        const path = cfg.get(key);
        if (!path) return;
        try {
          const bytes = await load(path);
          const copy = bytes.slice();
          this.buffers[index] = await ctx.decodeAudioData(copy.buffer as ArrayBuffer);
        } catch {
          // Non-fatal: the effect simply won't play.
        }
      }),
    ).then(() => undefined);
    return this.loadPromise;
  }

  private play(effect: SoundEffect, volume: number, left: number, right: number): void {
    if (effect === SoundEffect.NoSound) return;
    const ctx = this.ctx;
    const buffer = this.buffers[effect];
    if (!ctx || !buffer || ctx.state === "closed") return;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(volume * this.fxVolume, 1));
    src.connect(gain);

    let tail: AudioNode = gain;
    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = panValue({ left, right }, this.reverseStereo);
      gain.connect(panner);
      tail = panner;
    }
    tail.connect(ctx.destination);
    src.start();
  }

  /** `CSoundPlayer::PlaySample` — centred. */
  playSample(effect: SoundEffect, volume: number, pan: Pan = PAN_MIDDLE): void {
    this.play(effect, volume, pan.left, pan.right);
  }

  /** `CSoundPlayer::PlayPosSample`. */
  playPosSample(
    effect: SoundEffect,
    volume: number,
    effectX: number,
    effectY: number,
    observerX: number,
    observerY: number,
  ): void {
    if (effect === SoundEffect.NoSound) return;
    const pan = stereoShaper(observerX, observerY, effectX, effectY);
    this.play(effect, volume, pan.left, pan.right);
  }
}
