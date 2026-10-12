# Enemy AI

Source: `src/CEnemy.cpp`, `src/common/CEnemyBase.cpp`, `src/common/types.cpp`.

## Class & state

`CEnemy : CCharacter`. State machine (`CEnemy.h`):

```
EStill         — parked, scans for players, does not wander
EAssault       — hostile, actively chasing/targeting a player
EWanderAround  — passive wandering (civilian flight, or "nothing seen")
```

Spawn: fixed level enemies spawn `EStill` with `aWaitStill=1`; random extra enemies
spawn `EWanderAround`. `iAngle = iTargetAngle = aAngle` where `aAngle = rand()%360`.
`iEnergy = iType->Energy()`; weapon = `iType->CurrentWeapon()`.

Per-tick driver (`CLevelRuntimeData::EnemyUpdate`, only when
`NetworkMode() != Client`):

```
DecideAndMove()
if (iPushPower > 0) { Move(iPushAngle, iPushPower); iPushPower -= 0.075f; }
EnemyCheck()
Animate()
```

## Senses

- **FOV = 180°** centred on `iAngle` (`min = int(iAngle)-90`, `max = int(iAngle)+90`,
  with 270/90 wraparound).
- **Sight distance** = `iType->SightDistance()` = `10*KBlockSpriteSize = 200` px
  (inherited `CEnemyBase`).
- A player is "seen" if in FOV, within sight distance, **and**
  `Level().VisibilityCheck(enemy+14, player+14)`. The closest seen player becomes the
  target; `iTargetAngle` points at them.
- Non-hostile enemies (civilian) that see a player switch to `EWanderAround` and flee
  (no shooting).

## `DecideAndMove` (`CEnemy.cpp`)

- If hostile and any player is seen → `EAssault`.
- Wander: when idle (`iWalkCounter == 0`) and `rand()%125 == 1` →
  `iWalkCounter = rand()%40 + 20`, then `Move(iAngle, 0)` each tick while >0.
- Idle random turn: if `iTargetAngle == iAngle && !iWalkCounter` and state is
  `EAssault`/`EStill`/`EWanderAround` and `rand()%50 == 1` →
  `iTargetAngle = rand()%360`.
- `TargetAngle(KEnemyRotationSpeed)` rotates `iAngle` toward `iTargetAngle` by 3.4°/tick
  and snaps when within 3.4°.

## Movement (`CEnemy::Move`)

- Same `CCharacter::Move` as players, with `speed = iType->Speed()` when passed 0.
- Wounded enemies (`iEnergy < 10`) drip blood: every `iWalk%4==0 &&
  rand()%3==0` → `EEffectBloodOnGround`.
- Footprints same as players.

## Shooting (`CEnemy::CheckForShoot` / `Shoot`)

Requirements:

- Has a seen player `iSeePlayer[a]`, and aim is within **10°**
  (`abs(iTargetAngle - iAngle) < 10`).
- Distance `<= iBulletType[...]->ApproxDistance() + 20`.
- Fires when `iLoadCounter == iCurrentWeapon->LoadingTime()`.
- `iWalkCounter = int(20 / Speed())` after shooting.
- While not wishing to shoot, `iShootCount = 0`.

`Shoot(hand)` mirrors the player: spreads `BulletAmount` bullets by
`r = (AngleAdd()/2) - rand()%AngleAdd()`, plays sound only when
`iShootCount % iBulletType->Multiplier() == 0`, and emits gun smoke if the weapon
smokes.

## Reactions

- **Bullet origin** (`GotoBulletOrigin`, called on any bullet overlap):
  - Hostile and not already `EAssault`: turn opposite to the bullet
    (`iTargetAngle = bullet.Angle()+180`), walk toward it for
    `int(ApproxDistance/Speed)` ticks, → `EAssault`.
  - Non-hostile: turn along the bullet (`iTargetAngle = bullet.Angle()`), flee,
    → `EWanderAround`.
  - The hit also applies push/burning/damage ([Simulation & Physics](simulation-and-physics.md)).
- **Sound** (`SoundHeard`, invoked from the sound player): non-hostile ignores; already
  `EAssault` ignores; `ESoundEffectClick` ignored. If
  `GetDist < SightDistance && VisibilityCheck` → `EAssault`, `iTargetAngle` toward the
  sound, and walk `(dist - ApproxDistance*0.75)/Speed` ticks toward it. Sound does not
  pass through walls.

## Death (`CEnemy::GetDamage`)

`spd = clamp(1 + iPushPower/1.5, ?, 4.5)`. On energy ≤ 0:

- **Burning** (non-explosive type): woosh sound, 3 explosions, 3 burned-chest parts.
- **Normal**: death sound, 16 blood bursts at random angles, 3 body parts of types
  `(a + alku) % 7` (where `alku = rand()%7`) with `speed = spd + (rand()%2)*0.3`.
- **Explosion death** (`ExplosionDeath()`): `Explo(loc+4, size=2)` + 3 burned chests.

Then `aObserver->BulletEnemyKill(this)` and return death; the caller erases the enemy
immediately (`KillEnemy` records its location in `iDeadEnemies`). **Enemies have no
death animation.**

## Animation (`CEnemy::Animate`)

- Walk cycle over `KWalkAnimationDelay = 50`: `iAnim = (iWalk-1)/(50/4)`, clamped to
  `<3`.
- Firing (`iFire` counts to 6) → `iAnim = 3`.
- Wounded (`iEnergy < 10`) → `iAnim += 4` (a second animation bank).

## Per-type stats (`src/common/types.cpp`)

| Idx | Enum | Name | Sprite | Speed | Weapon | Hostile | Energy | Reward | ExplosionDeath |
|----:|------|------|:------:|:-----:|--------|:-------:|:------:|:------:|:--------------:|
| 0 | `EEnemyPistolboy` | Pistol Boy | 0 | 0.75 | Pistol | yes | 18 | 200 | no |
| 1 | `EEnemyShotgunManiac` | Shotgun Maniac | 1 | 0.75 | Shotgun | yes | 28 | 350 | no |
| 2 | `EEnemyUziRebel` | Uzi Rebel | 2 | 0.75 | Uzi | yes | 40 | 400 | no |
| 3 | `EEnemyCommando` | Commando | 3 | 1.0 | Auto Rifle | yes | 50 | 600 | no |
| 4 | `EEnemyBazookaBoy` | Bazooka Boy | 4 | 0.75 | Rocket Launcher | yes | 40 | 700 | yes |
| 5 | `EEnemyCivilian` | Civilian | 5 | 0.75 | Fist | **no** | 18 | 50 | no |
| 6 | `EEnemyPunisher` | Punisher | 6 | **0.5** | Auto Shotgun | yes | **150** | 650 | no |
| 7 | `EEnemyFlamer` | Flamer | 7 | 0.75 | Flame Thrower | yes | 100 | 600 | yes |
| 8 | `EEnemyPunk` | Punk | 8 | 1.0 | Fist | yes | 30 | 100 | no |
| 9 | `EEnemyGrenadeGay` | Grenade Gay | 9 | 0.75 | Grenade Launcher | yes | 70 | 500 | yes |

Besides stats, the only behavioural differentiators are `Hostile()` (civilian flees)
and `ExplosionDeath()` (area blast). All share `SightDistance = 200`.

## Spawn placement (`CLevelRuntimeData`)

- Fixed enemies are tried at their authored positions (`TestEnemyLocation(pos,false)`),
  spawned if free, else logged and skipped.
- Random enemies: for each enemy type, place `iGeneralLevelInfo.iEnemies[type]` of
  them via `PlaceEnemy` (up to `KTooManyTries = 100000`): pick
  `((rand()%(W-2))+1, (rand()%(H-2))+1) * 20`, test location.
- `TestEnemyLocation`: rejects if another enemy within 18 px, if not on a reachable
  block, if too close to a start point (strict mode), or within 140 px (`5*28`) of a
  player (strict mode).
