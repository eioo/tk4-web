/**
 * `CMath` plus the `CCoord` movement helpers (docs 03).
 *
 * Angles are integer degrees in [0, 360); `sine`/`cose` use the original's
 * precomputed 32-bit float tables, so every table value is rounded exactly
 * where the C++ `float` conversion happens. Float intermediates elsewhere use
 * `Math.fround` so results are bit-identical to the reference build.
 */

export const f32 = Math.fround;

/** C++ `pi` macro (`3.14159265358979f`). */
const PI_F32 = f32(Math.PI);

/**
 * `ANGLEFIX` — normalise into [0, 360). The C++ macro runs on the value's own
 * type, so for float angles each `-= 360` / `+= 360` rounds back to `float`;
 * `f32` reproduces that (a no-op for integer angles, which stay exact).
 */
export function angleFix(a: number): number {
  let v = a;
  while (v >= 360) v = f32(v - 360);
  while (v < 0) v = f32(v + 360);
  return v;
}

/** Integer division truncating toward zero (C++ `int` division). */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** `sign(a)` macro. */
export function sign(a: number): number {
  return a < 0 ? -1 : a > 0 ? 1 : 0;
}

/** `notnull(a)` macro. */
export function notnull(a: number): number {
  return a === 0 ? 1 : a;
}

function buildTables(): { sine: Float32Array; cosine: Float32Array } {
  const sinTable = new Float32Array(360);
  const cosTable = new Float32Array(360);
  for (let a = 0; a < 360; a++) {
    const angle = f32(f32(f32(a / 360) * 2) * PI_F32);
    sinTable[a] = f32(Math.sin(angle));
    cosTable[a] = f32(Math.cos(angle));
  }
  return { sine: sinTable, cosine: cosTable };
}

const TABLES = buildTables();

/** `CMath::Sine` — float sine table with angle normalisation. */
export function sine(a: number): number {
  return TABLES.sine[angleFix(a)];
}

/** `CMath::Cose` — float cosine table with angle normalisation. */
export function cose(a: number): number {
  return TABLES.cosine[angleFix(a)];
}

/** `CMath::GetDist` (float `sqrtf` of the squared distance). */
export function getDist(x1: number, y1: number, x2: number, y2: number): number {
  const xd = f32(x1 - x2);
  const yd = f32(y1 - y2);
  return f32(Math.sqrt(f32(f32(xd * xd) + f32(yd * yd))));
}

/** `CMath::GetAngle` — `atan2f` in degrees, normalised. */
export function getAngle(x: number, y: number, x2: number, y2: number): number {
  const tmp = f32(f32(f32(Math.atan2(y2 - y, x2 - x)) * 180) / PI_F32);
  return angleFix(tmp);
}

export interface Float2 {
  x: number;
  y: number;
}

export interface Int2 {
  x: number;
  y: number;
}

/** `CCoord<float>::AddMovement` — returns `pos + (cos*speed, sin*speed)`. */
export function addMovement(pos: Float2, angle: number, speed: number): Float2 {
  return {
    x: f32(pos.x + f32(cose(angle) * speed)),
    y: f32(pos.y + f32(sine(angle) * speed)),
  };
}

/** `CCoord<T>::SetMovement` — returns `(cos*speed, sin*speed)`. */
export function setMovement(angle: number, speed: number): Float2 {
  return { x: f32(cose(angle) * speed), y: f32(sine(angle) * speed) };
}

/**
 * `CCoord<int>::AddMovement` — the movement component is truncated to int
 * *before* being added to the integer position (unlike the float overload).
 */
export function addMovementI(pos: Int2, angle: number, speed: number): Int2 {
  return {
    x: pos.x + Math.trunc(f32(cose(angle) * speed)),
    y: pos.y + Math.trunc(f32(sine(angle) * speed)),
  };
}

/** `CCoord<int>::SetMovement`. */
export function setMovementI(angle: number, speed: number): Int2 {
  return { x: Math.trunc(f32(cose(angle) * speed)), y: Math.trunc(f32(sine(angle) * speed)) };
}

/** `CCoord<T>` → `CCoord<int>` conversion (truncation toward zero). */
export function toInt2(p: Float2): Int2 {
  return { x: Math.trunc(p.x), y: Math.trunc(p.y) };
}

/** `CCoord<float>::VectorLength` (`sqrtf`). */
export function vectorLength(v: Float2): number {
  return f32(Math.sqrt(f32(f32(v.x * v.x) + f32(v.y * v.y))));
}

/** `CCoord<float>::VectorAngle` (`GetAngle` from the origin). */
export function vectorAngle(v: Float2): number {
  return getAngle(0, 0, v.x, v.y);
}
