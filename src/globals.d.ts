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
}
