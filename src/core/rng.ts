/**
 * glibc-compatible `rand()` / `srand()` (docs 03, 13).
 *
 * The original calls `srand((unsigned)time(NULL))` and then libc `rand()`
 * everywhere. To reproduce a run we need glibc's exact generator, which is
 * the TYPE_3 additive-feedback generator (degree 31, separation 3):
 *
 *   state[i] = state[i-31] + state[i-3]        (mod 2^32, stored signed)
 *   result   = state[i] >>> 1                   (discard the low bit)
 *
 * `srand(seed)` seeds `state[0..30]` with the Park-Miller LCG and then discards
 * the first 310 outputs (31 * 10), exactly like `__srandom_r`.
 *
 * Verified against glibc: `srand(1); rand()` == 1804289383.
 */

const DEG = 31;
const SEP = 3;
const PARK_MILLER_M = 2147483647;

export class GlibcRandom {
  private readonly state = new Int32Array(DEG);
  private fptr = SEP;
  private rptr = 0;

  constructor(seed: number) {
    this.seed(seed);
  }

  /** `srand(seed)`. A seed of 0 is treated as 1, as glibc does. */
  seed(seed: number): void {
    let s = seed >>> 0;
    if (s === 0) s = 1;

    let word = s | 0;
    this.state[0] = word;
    for (let i = 1; i < DEG; i++) {
      const hi = Math.trunc(word / 127773);
      const lo = word % 127773;
      let next = 16807 * lo - 2836 * hi;
      if (next < 0) next += PARK_MILLER_M;
      word = next | 0;
      this.state[i] = word;
    }

    this.fptr = SEP;
    this.rptr = 0;
    for (let i = 0; i < DEG * 10; i++) this.next();
  }

  /** libc `rand()`: a non-negative 31-bit integer. */
  rand(): number {
    return this.next();
  }

  private next(): number {
    const state = this.state;
    const f = this.fptr;
    const r = this.rptr;

    const val = (state[f] + state[r]) >>> 0;
    state[f] = val | 0;

    let nf = f + 1;
    let nr = r + 1;
    if (nf >= DEG) {
      nf = 0;
    } else if (nr >= DEG) {
      nr = 0;
    }
    this.fptr = nf;
    this.rptr = nr;

    return val >>> 1;
  }
}
