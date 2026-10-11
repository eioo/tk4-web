# 03 — Simulation & Physics

Everything here runs once per **tick at 100 Hz**. Velocities/constants are therefore
"per tick" unless stated. Units are **pixels**; angles are **degrees** (0–359, 0 = +X,
clockwise on screen because Y grows downward). `ANGLEFIX(a)` normalises into
`[0,360)`.

## Coordinates & helpers

- `CCoord<T>` — simple `{x,y}` with `Add/Sub/Mul/Div`, `SetMovement(angle,speed)`,
  `AddMovement(angle,speed)`, `VectorAngle()`, `VectorLength()`.
- `CMath` — precomputed `iSine[360]`, `iCosine[360]` (float). `Sine/Cose` apply
  `ANGLEFIX`. `GetDist`, `GetAngle` (`atan2` in degrees).
- `CCoord<int>::Div` truncates toward zero. Level block lookups use
  `pos.Div(KBlockSpriteSize)` with `KBlockSpriteSize = 20`.
- `sign(a)` and `notnull(a)` macros; `abs` template.

## Tick model

- One tick = one `PerFrameCalc` iteration (see doc 02 for exact order).
- Movement, timers and animation counters all advance by 1 per tick.
- `TimerCounter` is the global tick counter.

## Character movement (`CCharacter::Move`)

`Move(angle, speed, dynData)`:

1. Footprint FX at specific walk phase points (25/50/75/100 % of `KWalkAnimationDelay`).
2. `newpos = location + SetMovement(angle, speed)`.
3. Eight probe points around the sprite (a 28×28 box inset by `reuna=6`, `reuna2=4`)
   are converted to block coordinates. The four axis moves are gated by the two
   relevant probes being `EBlockTypeFloor`, then a character-vs-character rectangle
   test (`CharCollision`) must also pass. Movement is applied **per axis independently**,
   so sliding along walls works.
4. Clamped to `[0, Width*20 - 28] × [0, Height*20 - 28]`.

`speed` for players: forward `iSpeed` (default `KPlayerNormalSpeed = 0.75`),
backward `0.75*iSpeed`, strafe-only `iSpeed`; rotation `KPlayerRotationSpeed = 3.4`
deg/tick. Enemies use their `iType->Speed()`.

`CPlayer::CheckKeys` converts input into `FAngle`:

- `FAngle = RealAngle()` when the player owns the mouse, else `SpriteAngle()*4.5`.
- forward adds 0, strafe left −45, strafe right +45; backward adds 180 (with strafe
  swapped); pure strafe adds ∓90.
- Auto-straighten snaps to 0/90/180/270 within `KStraightTolerance = 10` when neither
  turn key is held and target angle equals current angle.
- `SpriteAngle() = int(iAngle / 4.5f)` → 0–79 (80 sprite directions).

### Character-vs-character collision (`CDynGameData::CharCollision`)

Enemies are kept sorted by X; a binary search over `[left,right]` finds candidates,
then `CCharacter::CollisionCheck(rect)` = `rect.Inside((int)location)`. Players are
checked linearly (alive only). This is why entities are re-sorted by X each tick
(`PerFrameCalc`).

## Level collision (`CLevel`)

- `Collision(blockPos)` = `!(inLevel && block.iType == EBlockTypeFloor)`.
- `VisibilityCheck(src, dst, &collisionPoint)` — the pixel-accurate ray used by
  bullets, enemy sight and explosion pushes:
  1. `iterations = max(1, max(|dx|, |dy|))`, signed deltas `dx/iter`, `dy/iter`.
  2. Sample `iterations+1` points from `src` to `dst` (absolute, not incremental).
  3. Collision at a sample → fail, return last good point.
  4. Diagonal corner-cut check: if both orthogonal neighbours of the sample are
     blocked → fail.
  5. Success → return `dst`.
- `Reachable(blockPos)` reads the flood-filled reachability map (computed on load).
- `DustBlock(blockPos)` — block numbers that spawn footprints (`KDustBlocks[18]`).
- `FloorLevel(block)` = `type==Floor || height==0`.

## Bullets (`CBullet`, `src/CBullet.cpp`)

Constructor stores type, owner, `speed = iType->Speed()`, `angle`, `time =
iType->Time() + timeAdd`, `shareOfOriginalShot`.

`Move()` per tick:

1. `loopTimes = speed >> 2` (min 1); `time--`, `counter++`.
2. Spin setup: if `TimeBeforeSpin()>0` and `counter == TimeBeforeSpin()`, set
   `iSpriteAngleAdd = ±speed*15` depending on facing.
3. For each sub-step until hit/wall:
   - Proposal = `location + AddMovement(angle, speed/loopTimes)`.
   - `VisibilityCheck` fails →
     - if `CollisionTrigger()`: `hitwall = true`;
     - else `Bounce(bounceType, newPos)` then recompute the step; play bounce sound.
   - Move to new position (or collision point).
   - If `counter > SleepTime()` and not `hitwall`: test against all enemies then all
     players using a `[+5,+5 .. +22,+22]` box.
     - Enemy hit: `GotoBulletOrigin`, set push (`iPushAngle`, `iPushPower =
       PushPower*0.75` if greater), incendiary adds `iBurning += 15`, apply
       `GetDamage(Power)`; if it dies, `KillEnemy`.
     - Player hit (alive, box test, and not self-inflicted for incendiary/fist):
       add push, incendiary burning, `GetDamage(Power)`.
4. Post-loop:
   - Normal/fist bullets hitting a wall spawn `EEffectMetal` with `rand()%8==1`.
   - On `hit`: stops (`if Stop()`), blood effects for normal/fist, statistics hit
     report once, fist plays punch sound.
   - Spawns `Effect`/`Effect2` when `DoEffect(counter)`/`DoEffect2(counter)`.
   - Explosive types call `Explo()` when `(CollisionTrigger() && (hit||hitwall)) ||
     time==0`.
   - `speed += iType->Slow()`; clamp ≥0.
   - Grenade-style sprite angles ramp down by 0.4/tick toward 0.

`Bounce(type, newPos)`: measures distances to walls in the 4 directions
(`% 20` geometry), flips `angle = 360-angle` (up/down) or `180-angle` (left/right)
for `KBounceTypeNormal`; for `KBounceTypeFollowWall` zeroes the offending component
and recomputes angle/speed from the vector.

## Explosions (`CLevelRuntimeData::Explo` / `CDynGameData::Explo`)

- Sound by size: `<=1` small, `2–3` explosion, `>=4` big.
- `ray = size*5`; spawn `ray` `EBulletExplosionRay` bullets at
  angles `a*360/ray`, `timeAdd = size*2.5`, `share/ray`.
- Spawn `1–5` metal effects (yellow/red chosen by `rand()%2`).
- Body-part blast: `pushDist = 25*size`; for each body part within `2*pushDist`,
  visible from the centre, push away with a random magnitude proportional to
  `rand()%pushDist`.

## Effects (`CEffect`, `CEffectBase`)

- Parameterised by `TCount`, `Delay`, `Random`, `Sprite`, `XS/YS`, `Offset`,
  `Light*`, `AfterDeathEffect`.
- `Roll(dynData, amount)`: overload multiplier is 1; if
  `amount > KLightOverloadLimit (2000)` → `LightOverloadMul`, if
  `> KHeavyOverloadLimit (3000)` → `HeavyOverloadMul`. Counter advances by `mul` (or
  `rand()%(mul*3)` for `Random` types). Dies at `counter >= TCount*Delay`. Moves by
  its velocity vector; dies if it hits a wall. On death may spawn
  `AfterDeathEffect`. Effect list is capped at `KMaxEffectsInGame = 4000` (oldest
  dropped). Effects are **not** sorted.

## Body parts (`CBodyPart`)

- Only move while `speed > 0`. Each tick: integrate position; `DropBlood` types emit a
  blood-on-ground effect with `rand()%2 != 0`; per-axis block collision with
  `reuna=4, reuna2=2`; blocked axis either bounces (`iType->Bounce()`, angle flips) or
  is zeroed via `SetAngleAndSpeed`.
- `Push(vec)`/`SetAngleAndSpeed`: speed = vector length clamped to **5**; angle =
  vector angle.
- `Kick(angle)`: sets angle and `iType->Kickspeed()`.
- Ends with `speed += iType->Slow()` (all body parts slow down).

## Crates (`CCrate` + subclasses)

- Types: `EWeaponCrate, EBulletCrate, EHealthCrate, EMoneyCrate, ETargetCrate`.
- Base state: `iInUse`, `iTextCounter`/`iTextCounter2`/`iTextAngle` (floating pickup
  text), `iWakeUpCounter`.
- Pickup (`CPlayer::PickupCrates`): requires `InUse && TextCounter==0` and the
  crate centre `(+7,+7)` inside the player's `[X..X+28] × [Y..Y+28]` box; then
  `TryPickup`.
- Effects on pickup:
  - Weapon: `iWeapons[wno]++` if below `SingleHand()+1`.
  - Bullet: add `AmountInCrate`, clamped to `MaximumForPlayer*Multiplier`.
  - Health: `+40`, clamped to `100 + shield*10`.
  - Money: `iCash += amount`.
  - Target: `iTargetSystem = true`.
- `Taken()` floats a text label from the crate to the bottom-left of the draw area.
- Respawn (DM only): after being used, wake-up counter counts to `KCrateWakeupDelay =
  1250` ticks, then a teleport effect and the crate becomes active again.

## Damage & death

- `CPlayer::GetDamage(dmg, observer)`: returns early if dead; `iHit = 15` (flash);
  energy −= dmg; on `<= 0` either burns (explosions) or spawns 16 blood bursts +
  death sound; records death stats; `iDead = 1`; death animation runs
  `KDeadAnimationDelay = 75` ticks then `CharacterDied` fires.
- `CEnemy::GetDamage`: see doc 04.
- `iBurning` handled by `CCharacter::CheckBurning`: `iBurning--`; steam and flame
  effects throttled via `SteamAnimationCount(15)` / `(mod 2|3)`; deals `0.1` damage
  per tick while burning.

## Randomness & determinism (critical)

- Seed: `srand((unsigned int)time(NULL))` once in `CGameApp`.
- All randomness uses libc `rand()`. To reproduce a run, the port needs a
  glibc-`rand()`-compatible PRNG plus the same seed.
- RNG call sites and their **order** matter. Notable setup order:
  players → fixed enemies → random enemies → random crates → DM random player place.
  Per-tick order is defined by the update sequence in doc 02 and the call sites in
  doc 13 (which lists them exhaustively).
- **Hazards for exact parity:**
  - C++ argument evaluation order inside multi-`rand()` expressions is unspecified
    (e.g. `Explo`, `CBullet` blood, `CheckBurning`). The port must match a specific
    compiler's order — verified against a reference run.
  - `std::sort` is not stable; equal-X entities may reorder between runs. The port
    should replicate the exact sort used (or accept divergence and lock a reference).
  - Catch-up ticks consume RNG based on wall-clock pacing; parity is best verified in
    a fixed-tick replay (no catch-up), as the port does.

See doc 13 for the full RNG call inventory and the reference-capture methodology.
