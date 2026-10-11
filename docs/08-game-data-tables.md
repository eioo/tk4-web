# 08 — Game Data Tables

Authoritative source: `src/common/types.cpp` (values) and
`src/common/CGameTypeData.cpp` (registration). These values **must** be copied
verbatim; they define weapon feel, bullet behaviour, enemy toughness and effects.

Addressing: `CGameTypeData::iWeaponType[EWeaponAmount]`, `iBulletType[EBulletAmount]`,
`iEnemyType[EEnemyAmount]`, `iEffectType[EEffectAmount]`, `iBodyPartType[EBodyPartAmount]`,
plus `iShieldType`. Enum orders are in `src/common/defines.h`.

## Shield (`CBasicShield`)

| Field | Value |
|-------|-------|
| Name | "Shield" |
| Cost | 160 |
| Maximum | 30 |

## Body parts (`CBodyPartBase`)

Fields: `iSlow`, `iKickspeed`, `iBounce`, `iDropBlood`, `iSound`, `iSpriteOffset`.
Defaults (base class): all 0, no sound.

| Part | Slow | Kick | Bounce | DropBlood | Sound | SpriteOffset |
|------|-----:|-----:|:------:|:---------:|-------|-------------:|
| Head | -0.04 | 3.8 | 1 | 1 | KickHead | 0 |
| Arm | -0.05 | 2.8 | 0 | 1 | Hit | 21 |
| Chest | -0.07 | 2.5 | 0 | 1 | Hit | 42 |
| Entrails | -0.06 | 2.5 | 0 | 1 | Hit | 63 |
| LeftLeg | -0.05 | 2.8 | 0 | 1 | Hit | 84 |
| RightLeg | -0.05 | 2.8 | 0 | 1 | Hit | 105 |
| Shit | -0.05 | 2.8 | 0 | 1 | Hit | 126 |
| BurnedChest | -0.05 | 3.0 | 0 | 0 | KickHead | 252 |
| Skull | -0.04 | 4.0 | 1 | 0 | KickHead | 273 |
| Bones | -0.05 | 3.0 | 0 | 0 | KickHead | 294 |

(SpriteOffset is `index*21`; the body-part sheet is 320×20 with 20×20 cells, offsets
factor into the drawing routine.)

## Effects (`CEffectBase`)

Fields: `iTCount`, `iOrder` (draw layer 0/1), `iDelay`, `iRandom`, `iSprite`,
`iXS`/`iYS`, `iOffset`, `iTransparentSprite`, light params (`iLightSize`,
`iLightAdd`, `iLightAddConst`, `iLightAddMultiplier`, `iLightLuminance`), overload
multipliers, `iAfterDeathEffect`. Defaults: `iLightOLMul=1`, `iHeavyOLMul=1`,
`iAfterDeathEffect=NoEffect`.

| Effect | TCount | Order | Delay | Random | Sprite | XS×YS | Offset | Notes |
|--------|:------:|:-----:|:-----:|:------:|:------:|:-----:|-------:|-------|
| Blood | 4 | 1 | 5 | 0 | 1 | 12×12 | — | after-death → BloodOnGround |
| Smoke | 4 | 0 | 5 | 0 | 1 | 12×12 | 13*4 | light size 1, add −1 |
| Explo | 9 | 1 | 8 | 0 | 0 | 25×25 | 320*13 | light size 7, add +5, mult −0.8 |
| Metal | 8 | 1 | 5 | 0 | 1 | 12×12 | 13*8 | add mult −1 |
| MetalYellow | (Metal) | | | | | | | light table Yellow |
| MetalRed | (Metal) | | | | | | | light table Red |
| Smoke2 | 12 | 1 | 12 | 1 | 1 | 20×20 | 320*39 | transparent |
| BloodOnGround | 8 | 0 | 250 | 1 | 1 | 6×6 | 13*20 | transparent, OL 2/H 3 |
| GunSmoke | 4 | 1 | 5 | 0 | 1 | 12×12 | 13*16 | transparent |
| Steam | 12 | 1 | 5 | 0 | 1 | 20×20 | 320*39 | transparent |
| Teleport | 7 | 1 | 5 | 0 | 1 | 20×20 | 320*60 | light size 4 |
| Footprint | 4 | 0 | 250 | 1 | 1 | 6×6 | 13*20+320*7 | transparent, OL 2/H 3 |
| Flame | 1 | 1 | 12 | 0 | 0 | — | — | add mult −1, const −5 |
| Flame2 | 1 | 1 | 38 | 0 | 0 | — | — | add mult −0.33, const −5 |

## Enemies

See doc 04 for the full enemy stat table.

## Weapons (`CWeaponBase`)

Fields: `iName`, `iSprite`, `iSingleHand`, `iConsumesBullets`, `iCost`, `iLoadingTime`,
`iSmoke`, `iBulletAmount`, `iAngleAdd`, `iGun`, `iBulletType`, `iSound`, `iPriority`.

| Weapon | Name | Sprite | Single | Cost | Load | Smoke | Amount | AngleAdd | Gun | Bullet | Sound | Priority |
|--------|------|:------:|:------:|-----:|-----:|:-----:|:------:|:--------:|:---:|--------|-------|:--------:|
| Fist | Fist | 0 | | 0 | 25 | 0 | 1 | 1 | no | Fist | Hit | 1 |
| Pistol | Pistol | 1 | yes | 400 | 25 | 1 | 1 | 10 | yes | 9mm | Pistol | 2 |
| Shotgun | Shotgun | 3 | | 1000 | 43 | 1 | 6 | 20 | yes | ShotgunShells | Shotgun | 3 |
| Uzi | Uzi | 1 | yes | 2000 | 10 | 1 | 1 | 10 | yes | 9mm | Uzi | 4 |
| AutoRifle | Auto Rifle | 3 | | 4000 | 12 | 1 | 1 | 10 | yes | 12mm | Autorifle | 5 |
| RocketLauncher | Rocket Launcher | 3 | | 4000 | 75 | 0 | 1 | 10 | yes | MediumRockets | Bazooka | 0 |
| AutoLauncher | Auto Launcher | 3 | | 6000 | 25 | 0 | 1 | 10 | yes | LightRockets | Bazooka | 0 |
| HeavyLauncher | Heavy Launcher | 3 | | 6000 | 100 | 0 | 1 | 10 | yes | HeavyRockets | Bazooka | 0 |
| AutoShotgun | Auto Shotgun | 3 | | 6000 | 12 | 1 | 6 | 20 | yes | ShotgunShells | Shotgun | 6 |
| C4Activator | C4-Activator | 0 | | 1000 | 25 | 0 | 1 | 1 | no | C4Explosives | none | 0 |
| FlameThrower | Flame Thrower | 3 | | 3000 | 3 | 0 | 1 | 10 | yes | Gas | Flame | 4 |
| MineDropper | Mine Dropper | 0 | | 1000 | 50 | 0 | 1 | 1 | no | Mines | none | 0 |
| GrenadeLauncher | Grenade Launcher | 3 | | 2000 | 50 | 1 | 1 | 10 | yes | Grenades | GrenadeLauncher | 0 |

`iConsumesBullets` defaults true; Fist explicitly `false`.

## Bullets (`CBulletBase`)

Fields default 0 unless noted: `iName`, `iType` (`EBulletType*`), `iStop`, `iSpeed`,
`iPower`, `iPushPower`, `iTime`, `iCost`, `iAmountInCrate`, `iMaximumForPlayer`,
`iMultiplier`, `iExplosion`, `iRocketLength`, `iLight`, `iLightSize`, `iSprite`,
`iXS/iYS`, `iSpriteAngles`, `iSleepTime`, `iSlow`, `iTimeBeforeSpin`, `iBounceType`,
`iCollisionTrigger` (default true), `iBounceSound`, `iEffect/iEffect2`, etc.

| Bullet | Name | Type | Stop | Speed | Power | Push | Time | Cost | Crate | MaxForPlayer | Multiplier |
|--------|------|------|:----:|------:|------:|-----:|-----:|-----:|------:|-------------:|-----------:|
| Fist | Fist | Fist | 1 | 5 | 3 | 2 | 1 | | | | |
| 9mm | 9mm Bullets | Normal | 1 | 6*18=108 | 5 | 1 | 1 | 3 | 50 | 300 | |
| 12mm | 12mm Bullets | Normal | 1 | 8*18=144 | 9 | 1.5 | 1 | 5 | 50 | 300 | |
| ShotgunShells | Shotgun Shells | Normal | 1 | 6*18=108 | 3 | 1.5 | 1 | 6 | 20 | 300 | |
| LightRockets | Light Rockets | Explosive | 1 | 3 | | | 90 | 70 | 15 | 150 | Explosion 1, RocketLen 10, Light 3 |
| MediumRockets | Medium Rockets | Explosive | 1 | 3 | | | 90 | 100 | 10 | 125 | Explosion 2, RocketLen 13, Light 3 |
| HeavyRockets | Heavy Rockets | Explosive | 1 | 3 | | | 90 | 200 | 5 | 100 | Explosion 4, RocketLen 16, Light 6 |
| C4Explosives | C4-Explosives | Explosive | 1 | | | | 250 | 150 | 5 | 100 | Explosion 4, sprite C4, 8×8, no collision trigger, bounce normal |
| Gas | Gas | Incendiary | 1 | int(3*0.75)=2 | 0.2 | | 37 | 6 | 500 | 300 | Multiplier 10, Sleep 1, light Explosion |
| Mines | Mines | Explosive | 1 | | | | 6250 | 150 | 10 | 100 | Explosion 1, sprite Mine, 7×7, Sleep 62 |
| Grenades | Grenades | Explosive | 1 | 3 | | | 125 | 60 | 10 | 100 | Explosion 2, sprite Grenade, 7×7, SpriteAngles 40, Slow −0.0225, TimeBeforeSpin 38, bounce metal |
| ExplosionRay | Explosive ray | Normal | 1 | 8 | 30 | 5 | 0 | | | | bounce normal, Effect Explo |

Bullet base `CBulletRocketBase`: type Explosive, stop 1, speed 3, time `(15*18)/3 = 90`,
light Normal, `Effect2 = Flame`, `Effect = Smoke2`, 7×7. `EffectAngle = angle + 90 +
rand()%180`, `EffectSpeed = 0.1`, `DoEffect = (counter%2==0)`.
`ExplosiveRay`: `EffectAngle = angle+180`, `EffectSpeed = rand()%2`.

### Bullet type classes (`IBulletType::EBulletType`)

`EBulletTypeNormal`, `EBulletTypeFist`, `EBulletTypeExplosive`, `EBulletTypeIncendiary`.
Bounce types: `KBounceTypeNone`, `KBounceTypeNormal`, `KBounceTypeFollowWall`.

## Notes for the port

- Copy these tables into a data module (e.g. `src/game/data/types.ts`) as plain objects;
  do not invent numbers.
- `ApproxDistance` (used by enemy AI) and `Multiplier` come from `CBulletBase`; verify
  their formulas in `src/common/CBulletBase.h`/`.cpp` when implementing AI range checks.
- `iOrder` splits effects into a low layer (drawn before crates/actors) and a high
  layer (drawn after shadows), matching the draw order in doc 05.
