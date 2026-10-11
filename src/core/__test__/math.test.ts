import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  addMovement,
  angleFix,
  cose,
  f32,
  getAngle,
  getDist,
  idiv,
  notnull,
  setMovement,
  sign,
  sine,
  vectorAngle,
  vectorLength,
} from "../math";

/**
 * SHA-256 of `tools/reference/sim_gen.cpp math` output: 360 sine floats then
 * 360 cosine floats (little-endian f32). The oracle compiles the same C++
 * `CMath` constructor the original uses, so matching this hash proves the
 * ported tables are bit-identical.
 *
 * Regenerate with: g++ -O2 -o /tmp/sim_gen tools/reference/sim_gen.cpp -lm
 *                  /tmp/sim_gen math /tmp/math.raw && sha256sum /tmp/math.raw
 */
const ORACLE_MATH_HASH = "6770e338b2309d5ff06f6cf6adfcbb436a056de3be1e81a012cd67e609e08d70";

describe("CMath", () => {
  test("sine/cosine tables match the C++ oracle", () => {
    const buf = Buffer.alloc(720 * 4);
    for (let a = 0; a < 360; a++) buf.writeFloatLE(sine(a), a * 4);
    for (let a = 0; a < 360; a++) buf.writeFloatLE(cose(a), (360 + a) * 4);
    expect(createHash("sha256").update(buf).digest("hex")).toBe(ORACLE_MATH_HASH);
  });

  test("representative table entries", () => {
    expect(sine(0)).toBe(0);
    expect(cose(0)).toBe(1);
    expect(sine(30)).toBe(0.5);
    expect(cose(30)).toBe(f32(0.8660253882408142));
    expect(sine(60)).toBe(f32(0.866025447845459));
    expect(cose(60)).toBe(f32(0.4999999701976776));
    expect(sine(90)).toBe(1);
    expect(cose(90)).toBe(f32(-4.371138828673793e-8));
    expect(cose(180)).toBe(-1);
    expect(sine(270)).toBe(-1);
  });

  test("sine/cose normalise their angle", () => {
    for (let a = -720; a <= 1080; a += 7) {
      expect(sine(a)).toBe(sine(angleFix(a)));
      expect(cose(a)).toBe(cose(angleFix(a)));
    }
  });
});

describe("angleFix", () => {
  test("normalises integers into [0, 360)", () => {
    expect(angleFix(0)).toBe(0);
    expect(angleFix(360)).toBe(0);
    expect(angleFix(359)).toBe(359);
    expect(angleFix(720)).toBe(0);
    expect(angleFix(-1)).toBe(359);
    expect(angleFix(-360)).toBe(0);
    expect(angleFix(1080)).toBe(0);
  });

  test("keeps float angles that are already in range bit-exact", () => {
    const v = f32(123.456);
    expect(angleFix(v)).toBe(v);
  });
});

describe("small helpers", () => {
  test("sign and notnull", () => {
    expect(sign(-5)).toBe(-1);
    expect(sign(0)).toBe(0);
    expect(sign(5)).toBe(1);
    expect(notnull(0)).toBe(1);
    expect(notnull(7)).toBe(7);
  });

  test("idiv truncates toward zero", () => {
    expect(idiv(7, 2)).toBe(3);
    expect(idiv(-7, 2)).toBe(-3);
    expect(idiv(20, 20)).toBe(1);
  });

  test("getDist / getAngle", () => {
    expect(getDist(0, 0, 3, 4)).toBe(5);
    expect(getAngle(0, 0, 10, 0)).toBe(0);
    expect(getAngle(0, 0, 0, 10)).toBe(90);
    expect(getAngle(0, 0, -10, 0)).toBe(180);
    expect(getAngle(0, 0, 0, -10)).toBe(270);
  });

  test("addMovement / setMovement / vector helpers", () => {
    expect(setMovement(0, 10)).toEqual({ x: 10, y: 0 });
    const p = addMovement({ x: 5, y: 5 }, 0, 10);
    expect(p).toEqual({ x: 15, y: 5 });
    expect(vectorLength({ x: 3, y: 4 })).toBe(5);
    expect(vectorAngle({ x: 0, y: 10 })).toBe(90);
  });
});
