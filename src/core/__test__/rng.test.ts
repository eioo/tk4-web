import { describe, expect, test } from "bun:test";

import { GlibcRandom } from "../rng";

// Reference values produced by glibc's `rand()` (see docs/13-parity-testing-and-risks.md).
const CASES: Array<[number, number[]]> = [
  [1, [1804289383, 846930886, 1681692777, 1714636915, 1957747793]],
  [42, [71876166, 708592740, 1483128881, 907283241, 442951012]],
  [12345, [383100999, 858300821, 357768173, 455528251, 133005921]],
  [0, [1804289383, 846930886, 1681692777, 1714636915, 1957747793]],
  [7, [1045618677, 1863967299, 1272579899, 461085871, 21961325]],
];

describe("GlibcRandom", () => {
  for (const [seed, expected] of CASES) {
    test(`srand(${seed}) reproduces glibc`, () => {
      const rng = new GlibcRandom(seed);
      expect(expected.map(() => rng.rand())).toEqual(expected);
    });
  }

  test("a seed of 0 is treated as 1", () => {
    const zero = new GlibcRandom(0);
    const one = new GlibcRandom(1);
    for (let i = 0; i < 8; i++) expect(zero.rand()).toBe(one.rand());
  });

  test("re-seeding resets the stream", () => {
    const rng = new GlibcRandom(1);
    const first = Array.from({ length: 5 }, () => rng.rand());
    rng.seed(1);
    expect(Array.from({ length: 5 }, () => rng.rand())).toEqual(first);
  });

  test("values stay in the 31-bit non-negative range", () => {
    const rng = new GlibcRandom(999);
    for (let i = 0; i < 50_000; i++) {
      const v = rng.rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 31);
    }
  });
});
