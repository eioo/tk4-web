/**
 * Global type augmentations. This file has no imports/exports, so top-level
 * declarations merge with the global scope.
 */

interface Window {
  /**
   * Set by `main.ts` once boot (asset load + loop start) has completed.
   * Browser smoke tests await this instead of guessing a delay.
   */
  tk4Ready?: boolean;
  /** Set by `main.ts` if boot fails; holds the error message. */
  tk4Error?: string;
  /** Dev-only snapshot of the running simulation (for browser verification). */
  tk4State?: () => {
    x: number;
    y: number;
    angle: number;
    energy: number;
    weapon: number;
    ammo: number;
    bullets: number;
    enemies: number;
    crates: number;
    bodyparts: number;
    effects: number;
    cash: number;
    /** Main state / sub-state (`CState` values). */
    state?: number;
    sub?: number;
  };
  /** Dev-only: give the local player a weapon (and ammo) and equip it. */
  tk4Give?: (weapon: number, ammo?: number) => void;
  /** Dev-only: post a transient message to the on-screen message board. */
  tk4Msg?: (message: string) => void;
  /** Dev-only: start a single-player game on an episode. */
  tk4Start?: (episode?: number) => void;
  /** Dev-only: the running `App` instance (for scripted verification). */
  tk4App?: unknown;
}
