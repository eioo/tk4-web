// SPDX-License-Identifier: GPL-2.0-only
// Derived from Tapan Kaikki 4 (GPLv2); see LICENSE.

// Shared simulation reference for the Tapan Kaikki 4 -> TypeScript port.
//
// Near-verbatim copies of the original gameplay maths: CMath tables, glibc
// rand(), the weapon/bullet type tables, CCharacter::Move, CPlayer (movement,
// input, shooting, damage), CBullet::Move and enough of CDynGameData /
// CLevelRuntimeData to run a deterministic per-tick replay.
//
// Compiler-unspecified multi-rand argument order is made explicit here (g++
// evaluates arguments right-to-left) so the oracle does not depend on the
// compiler; the TypeScript port uses the same explicit order.
//
// Included by sim_gen.cpp. Needs only tkreference.h (no SDL).

#ifndef SIMREFERENCE_H
#define SIMREFERENCE_H

#include "tkreference.h"
#include <cstdint>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <cmath>

#ifndef ANGLEFIX
#define ANGLEFIX(a) { while (a >= 360) a -= 360; while (a < 0) a += 360; }
#endif

// ---- enum-ish constants (defines.h) ----
enum SimWeapon { W_FIST = 0, W_PISTOL, W_SHOTGUN, W_UZI, W_AUTORIFLE, W_ROCKET, W_AUTOLAUNCH,
	W_HEAVYLAUNCH, W_AUTOSHOTGUN, W_C4, W_FLAME, W_MINE, W_GRENADE, W_AMOUNT };
enum SimBulletId { B_FIST = 0, B_9MM, B_12MM, B_SHELL, B_LIGHTR, B_MEDR, B_HEAVYR, B_C4, B_GAS,
	B_MINES, B_GREN, B_RAY, B_AMOUNT };
enum SimBulletKind { BK_NORMAL = 0, BK_EXPLOSIVE, BK_INCENDIARY, BK_FIST };
enum SimBounce { SB_NONE = 0, SB_NORMAL, SB_FOLLOWWALL };
enum SimEffect { SE_NONE = -1, SE_BLOOD = 0, SE_SMOKE, SE_EXPLO, SE_METAL, SE_METALY, SE_METALR,
	SE_SMOKE2, SE_BLOODG, SE_GUNSMOKE, SE_STEAM, SE_TELEPORT, SE_FOOTPRINT, SE_FLAME, SE_FLAME2 };
enum SimEffectKind { EK_DEFAULT = 0, EK_ROCKET, EK_RAY };

// TIngameSoundEffect (defines.h) — positional sample ids. Only the id matters
// for parity (CEnemy::SoundHeard); the samples themselves live in the port.
enum SimSoundEffect {
	SSE_NOSOUND = -1, SSE_PISTOL = 0, SSE_SHOTGUN, SSE_UZI, SSE_AUTORIFLE, SSE_BAZOOKA,
	SSE_HIT, SSE_SMALL_EXPLOSION, SSE_EXPLOSION, SSE_BIG_EXPLOSION, SSE_CLICK, SSE_DEATH,
	SSE_WOOSH, SSE_FLAME, SSE_METAL_HIT, SSE_GRENADE_LAUNCHER, SSE_KICK_HEAD, SSE_AMOUNT
};

enum SimDirection { SD_NOWHERE = -1, SD_UP, SD_DOWN, SD_LEFT, SD_RIGHT };

// Input key/button bits (scripted, matches the port's input mapping).
enum SimKey { SK_UP = 1, SK_DOWN = 2, SK_LEFT = 4, SK_RIGHT = 8, SK_STRAFE = 16,
	SK_LSTRAFE = 32, SK_RSTRAFE = 64, SK_SHOOT = 128, SK_SHIFT = 256 };
enum SimMouse { SM_LEFT = 1, SM_RIGHT = 2, SM_WHEEL_DOWN = 4, SM_WHEEL_UP = 8 };

const int KPlayerSpriteAmount = 80;
const int KWalkAnimationDelay = 50;
const int KDeadAnimationDelay = 75;
const float KPlayerNormalSpeed = 0.75f;
const float KPlayerRotationSpeed = 3.4f;
const int KPlayerMaxEnergy = 100;
const int KStraightTolerance = 10;
const int KShieldEnergyAmount = 10;
const int KBodyPartSpriteSize = 20;
const int KEnemyRotSpeedInt = 3;
const int KMaxEffectsInGame = 4000;
const int KLightOverloadLimit = 2000;
const int KHeavyOverloadLimit = 3000;
const int KTooManyTries = 100000;
const int KCrateWakeupDelay = 1250;
static const int KSteamRates[8] = { 30, 20, 10, 10, 8, 8, 6, 6 };

// ---- CMath (float sine/cosine tables) ----
struct SimMath {
	float iSine[360], iCosine[360];
	SimMath() {
		for (int a = 0; a < 360; a++) {
			iSine[a] = (float)sin((float)a / 360 * 2 * pi);
			iCosine[a] = (float)cos((float)a / 360 * 2 * pi);
		}
	}
	float Sine(int a) const { ANGLEFIX(a); return iSine[a]; }
	float Cose(int a) const { ANGLEFIX(a); return iCosine[a]; }
};
static SimMath gMath;

static float GetDistF(float x1, float y1, float x2, float y2) {
	float xd = x1 - x2, yd = y1 - y2;
	return sqrtf(xd * xd + yd * yd);
}
static float GetAngleF(float x, float y, float x2, float y2) {
	float tmp = atan2f(y2 - y, x2 - x) * 180.0f / pi;
	ANGLEFIX(tmp);
	return tmp;
}
static CoordF AddMovF(CoordF pos, int angle, float speed) {
	CoordF r; r.x = pos.x + gMath.Cose(angle) * speed; r.y = pos.y + gMath.Sine(angle) * speed; return r;
}
static CoordF SetMovF(int angle, float speed) {
	CoordF r; r.x = gMath.Cose(angle) * speed; r.y = gMath.Sine(angle) * speed; return r;
}
static CoordI ToInt2(CoordF p) { CoordI r; r.x = (int)p.x; r.y = (int)p.y; return r; }
static CoordF ToFloat2(CoordI p) { CoordF r; r.x = (float)p.x; r.y = (float)p.y; return r; }
static float VectorLenF(CoordF v) { return sqrtf(v.x * v.x + v.y * v.y); }
static float VectorAngF(CoordF v) { return GetAngleF(0, 0, v.x, v.y); }

// ---- glibc random() (TYPE_3) ----
struct GlibcRandom {
	int32_t state[31];
	int fptr, rptr;
	void Seed(unsigned int seed) {
		if (seed == 0) seed = 1;
		int32_t word = (int32_t)seed;
		state[0] = word;
		for (int i = 1; i < 31; i++) {
			long hi = word / 127773;
			long lo = word % 127773;
			long t = 16807 * lo - 2836 * hi;
			if (t < 0) t += 2147483647;
			word = (int32_t)t;
			state[i] = word;
		}
		fptr = 3; rptr = 0;
		for (int i = 0; i < 310; i++) Next();
	}
	int Next() {
		uint32_t val = (uint32_t)state[fptr] + (uint32_t)state[rptr];
		state[fptr] = (int32_t)val;
		int nf = fptr + 1, nr = rptr + 1;
		if (nf >= 31) nf = 0; else if (nr >= 31) nr = 0;
		fptr = nf; rptr = nr;
		return (int)(val >> 1);
	}
	int Rand() { return Next(); }
};

// ---- bullet types (CBulletBase + types.cpp) ----
struct BulletType {
	const char* name;
	int type; int stop; bool collisionTrigger; int bounceType; int bounceSound;
	int speed; int timeBeforeSpin; float slow; float power; int time; int explosion;
	float pushPower; int cost; int amountInCrate; int multiplier; int sleepTime; int maxForPlayer;
	int rocketLength; int rocketColor; int light; int lightSize; int lightLuminance; float lightAdd;
	int effect; int effect2; int effectKind;
};

static BulletType MakeBullet(const char* name) {
	BulletType b;
	b.name = name; b.type = BK_NORMAL; b.stop = 0; b.collisionTrigger = true; b.bounceType = SB_NONE;
	b.bounceSound = -1; b.speed = 0; b.timeBeforeSpin = 0; b.slow = 0.0f; b.power = 0.0f; b.time = 0;
	b.explosion = 0; b.pushPower = 0.0f; b.cost = 0; b.amountInCrate = 0; b.multiplier = 1;
	b.sleepTime = 0; b.maxForPlayer = 0; b.rocketLength = 0; b.rocketColor = 32; b.light = -1;
	b.lightSize = 0; b.lightLuminance = 0; b.lightAdd = 0.0f; b.effect = SE_NONE; b.effect2 = SE_NONE;
	b.effectKind = EK_DEFAULT;
	return b;
}

static BulletType gBullets[B_AMOUNT];
static void InitBulletTypes() {
	for (int i = 0; i < B_AMOUNT; i++) gBullets[i] = MakeBullet("");
	{ BulletType& b = gBullets[B_FIST]; b.name = "Fist"; b.type = BK_FIST; b.stop = 1; b.speed = 5; b.power = 3; b.pushPower = 2; b.time = 1; }
	{ BulletType& b = gBullets[B_9MM]; b.name = "9mm Bullets"; b.type = BK_NORMAL; b.stop = 1; b.speed = 6 * 18; b.power = 5; b.pushPower = 1; b.time = 1; b.cost = 3; b.amountInCrate = 50; b.maxForPlayer = 300; }
	{ BulletType& b = gBullets[B_12MM]; b.name = "12mm Bullets"; b.type = BK_NORMAL; b.stop = 1; b.speed = 8 * 18; b.power = 9; b.pushPower = 1.5f; b.time = 1; b.cost = 5; b.amountInCrate = 50; b.maxForPlayer = 300; }
	{ BulletType& b = gBullets[B_SHELL]; b.name = "Shotgun Shells"; b.type = BK_NORMAL; b.stop = 1; b.speed = 6 * 18; b.power = 3; b.pushPower = 1.5f; b.time = 1; b.cost = 6; b.amountInCrate = 20; b.maxForPlayer = 300; }
	{ BulletType& b = gBullets[B_LIGHTR]; b.name = "Light Rockets"; b.type = BK_EXPLOSIVE; b.stop = 1; b.speed = 3; b.time = (15 * 18) / 3; b.light = 0; b.effect2 = SE_FLAME; b.effect = SE_SMOKE2; b.explosion = 1; b.rocketLength = 10; b.lightSize = 3; b.cost = 70; b.amountInCrate = 15; b.maxForPlayer = 150; b.effectKind = EK_ROCKET; }
	{ BulletType& b = gBullets[B_MEDR]; b.name = "Medium Rockets"; b.type = BK_EXPLOSIVE; b.stop = 1; b.speed = 3; b.time = (15 * 18) / 3; b.light = 0; b.effect2 = SE_FLAME; b.effect = SE_SMOKE2; b.explosion = 2; b.rocketLength = 13; b.lightSize = 3; b.cost = 100; b.amountInCrate = 10; b.maxForPlayer = 125; b.effectKind = EK_ROCKET; }
	{ BulletType& b = gBullets[B_HEAVYR]; b.name = "Heavy Rockets"; b.type = BK_EXPLOSIVE; b.stop = 1; b.speed = 3; b.time = (15 * 18) / 3; b.light = 0; b.effect2 = SE_FLAME; b.effect = SE_SMOKE2; b.explosion = 4; b.rocketLength = 16; b.lightSize = 6; b.cost = 200; b.amountInCrate = 5; b.maxForPlayer = 100; b.effectKind = EK_ROCKET; }
	{ BulletType& b = gBullets[B_C4]; b.name = "C4-Explosives"; b.type = BK_EXPLOSIVE; b.collisionTrigger = false; b.bounceType = SB_NORMAL; b.stop = 1; b.time = 250; b.explosion = 4; b.cost = 150; b.amountInCrate = 5; b.maxForPlayer = 100; }
	{ BulletType& b = gBullets[B_GAS]; b.name = "Gas"; b.type = BK_INCENDIARY; b.collisionTrigger = false; b.bounceType = SB_FOLLOWWALL; b.stop = 1; b.speed = (int)(3 * 0.75); b.power = 0.2f; b.time = 112 / 3; b.explosion = 0; b.light = 1; b.lightSize = 2; b.lightLuminance = -10; b.lightAdd = 0.4f; b.cost = 6; b.amountInCrate = 500; b.multiplier = 10; b.sleepTime = 1; b.maxForPlayer = 300; }
	{ BulletType& b = gBullets[B_MINES]; b.name = "Mines"; b.type = BK_EXPLOSIVE; b.stop = 1; b.time = 6250; b.explosion = 1; b.cost = 150; b.amountInCrate = 10; b.sleepTime = 62; b.maxForPlayer = 100; }
	{ BulletType& b = gBullets[B_GREN]; b.name = "Grenades"; b.type = BK_EXPLOSIVE; b.stop = 1; b.timeBeforeSpin = 38; b.collisionTrigger = false; b.bounceType = SB_NORMAL; b.speed = 3; b.slow = -0.0225f; b.time = (int)((10 * 20 * 1.25f) / 2); b.explosion = 2; b.lightSize = 0; b.cost = 60; b.amountInCrate = 10; b.maxForPlayer = 100; }
	{ BulletType& b = gBullets[B_RAY]; b.name = "Explosive ray"; b.type = BK_NORMAL; b.bounceType = SB_NORMAL; b.collisionTrigger = false; b.stop = 1; b.speed = 8; b.power = 30; b.pushPower = 5; b.time = 0; b.effect = SE_EXPLO; b.effectKind = EK_RAY; }
}

// ---- weapon types (CWeaponBase + types.cpp) ----
struct WeaponType {
	const char* name; int sprite; bool singleHand; int cost; int loadingTime; int smoke;
	int bulletAmount; int angleAdd; bool gun; int bulletType; int priority; bool consumesBullets;
	int sound;
};

static WeaponType gWeapons[W_AMOUNT];
static void InitWeaponTypes() {
	for (int i = 0; i < W_AMOUNT; i++) {
		WeaponType& w = gWeapons[i];
		w.name = ""; w.sprite = 0; w.singleHand = false; w.cost = 0; w.loadingTime = 0;
		w.smoke = 0; w.bulletAmount = 1; w.angleAdd = 1; w.gun = false; w.bulletType = B_FIST;
		w.priority = 0; w.consumesBullets = true;
	}
	gWeapons[W_FIST] = { "Fist", 0, false, 0, 25, 0, 1, 1, false, B_FIST, 1, false };
	gWeapons[W_PISTOL] = { "Pistol", 1, true, 400, 25, 1, 1, 10, true, B_9MM, 2, true };
	gWeapons[W_SHOTGUN] = { "Shotgun", 3, false, 1000, 43, 1, 6, 20, true, B_SHELL, 3, true };
	gWeapons[W_UZI] = { "Uzi", 1, true, 2000, 10, 1, 1, 10, true, B_9MM, 4, true };
	gWeapons[W_AUTORIFLE] = { "Auto Rifle", 3, false, 4000, 12, 1, 1, 10, true, B_12MM, 5, true };
	gWeapons[W_ROCKET] = { "Rocket Launcher", 3, false, 4000, 75, 0, 1, 10, true, B_MEDR, 0, true };
	gWeapons[W_AUTOLAUNCH] = { "Auto Launcher", 3, false, 6000, 25, 0, 1, 10, true, B_LIGHTR, 0, true };
	gWeapons[W_HEAVYLAUNCH] = { "Heavy Launcher", 3, false, 6000, 100, 0, 1, 10, true, B_HEAVYR, 0, true };
	gWeapons[W_AUTOSHOTGUN] = { "Auto Shotgun", 3, false, 6000, 12, 1, 6, 20, true, B_SHELL, 6, true };
	gWeapons[W_C4] = { "C4-Activator", 0, false, 1000, 25, 0, 1, 1, false, B_C4, 0, true };
	gWeapons[W_FLAME] = { "Flame Thrower", 3, false, 3000, 3, 0, 1, 10, true, B_GAS, 4, true };
	gWeapons[W_MINE] = { "Mine Dropper", 0, false, 1000, 50, 0, 1, 1, false, B_MINES, 0, true };
	gWeapons[W_GRENADE] = { "Grenade Launcher", 3, false, 2000, 50, 1, 1, 10, true, B_GREN, 0, true };
	for (int i = 0; i < W_AMOUNT; i++) gWeapons[i].sound = SSE_NOSOUND;
	gWeapons[W_FIST].sound = SSE_HIT;
	gWeapons[W_PISTOL].sound = SSE_PISTOL;
	gWeapons[W_SHOTGUN].sound = SSE_SHOTGUN;
	gWeapons[W_UZI].sound = SSE_UZI;
	gWeapons[W_AUTORIFLE].sound = SSE_AUTORIFLE;
	gWeapons[W_ROCKET].sound = SSE_BAZOOKA;
	gWeapons[W_AUTOLAUNCH].sound = SSE_BAZOOKA;
	gWeapons[W_HEAVYLAUNCH].sound = SSE_BAZOOKA;
	gWeapons[W_AUTOSHOTGUN].sound = SSE_SHOTGUN;
	gWeapons[W_FLAME].sound = SSE_FLAME;
	gWeapons[W_GRENADE].sound = SSE_GRENADE_LAUNCHER;
	gBullets[B_GREN].bounceSound = SSE_METAL_HIT;
}

// ---- effect / body part / enemy type tables ----
enum SimBodyPartId { BP_HEAD = 0, BP_ARM, BP_CHEST, BP_ENTRAILS, BP_LLEG, BP_RLEG, BP_SHIT,
	BP_BURNED, BP_SKULL, BP_BONES, BP_AMOUNT };
enum SimEnemyId { EN_PISTOL = 0, EN_SHOTGUN, EN_UZI, EN_COMMANDO, EN_BAZOOKA, EN_CIVILIAN,
	EN_PUNISHER, EN_FLAMER, EN_PUNK, EN_GRENADE, EN_AMOUNT };
enum SimEnemyState { ES_STILL = 0, ES_ASSAULT, ES_WANDER };
enum SimCrateKind { CK_WEAPON = 0, CK_BULLET, CK_HEALTH, CK_MONEY, CK_TARGET };
enum SimLightTable { SL_NOLIGHT = -1, SL_NORMAL = 0, SL_EXPLOSION, SL_YELLOW, SL_RED };

struct EffectType {
	int tCount, order, delay; bool random; bool sprite; int xs, ys, offset;
	int lightTable, lightSize, lightAddConst; float lightAddMul;
	int lightOLMul, heavyOLMul; int afterDeath; bool transparent;
};

static EffectType MakeEffect() {
	EffectType e;
	e.tCount = 0; e.order = 0; e.delay = 0; e.random = false; e.sprite = false; e.xs = 0; e.ys = 0;
	e.offset = 0; e.lightTable = SL_NOLIGHT; e.lightSize = 0; e.lightAddConst = 0; e.lightAddMul = 0;
	e.lightOLMul = 1; e.heavyOLMul = 1; e.afterDeath = SE_NONE; e.transparent = false;
	return e;
}

static EffectType gEffects[14];
static void InitEffectTypes() {
	for (int i = 0; i < 14; i++) gEffects[i] = MakeEffect();
	{ EffectType& e = gEffects[SE_BLOOD]; e.tCount = 4; e.order = 1; e.delay = 5; e.sprite = true; e.xs = 12; e.ys = 12; e.afterDeath = SE_BLOODG; }
	{ EffectType& e = gEffects[SE_SMOKE]; e.tCount = 4; e.order = 0; e.delay = 5; e.sprite = true; e.xs = 12; e.ys = 12; e.offset = 13 * 4; e.lightTable = SL_NORMAL; e.lightSize = 1; e.lightAddMul = -1; }
	{ EffectType& e = gEffects[SE_EXPLO]; e.tCount = 9; e.order = 1; e.delay = 8; e.xs = 25; e.ys = 25; e.offset = 320 * 13; e.lightTable = SL_EXPLOSION; e.lightSize = 7; e.lightAddConst = 5; e.lightAddMul = -0.8f; }
	{ EffectType& e = gEffects[SE_METAL]; e.tCount = 8; e.order = 1; e.delay = 5; e.sprite = true; e.xs = 12; e.ys = 12; e.offset = 13 * 8; e.lightTable = SL_NORMAL; e.lightAddMul = -1; }
	{ EffectType& e = gEffects[SE_METALY]; e.tCount = 8; e.order = 1; e.delay = 5; e.sprite = true; e.xs = 12; e.ys = 12; e.offset = 13 * 8; e.lightTable = SL_YELLOW; e.lightAddMul = -1; }
	{ EffectType& e = gEffects[SE_METALR]; e.tCount = 8; e.order = 1; e.delay = 5; e.sprite = true; e.xs = 12; e.ys = 12; e.offset = 13 * 8; e.lightTable = SL_RED; e.lightAddMul = -1; }
	{ EffectType& e = gEffects[SE_SMOKE2]; e.tCount = 12; e.order = 1; e.delay = 12; e.random = true; e.sprite = true; e.xs = 20; e.ys = 20; e.offset = 320 * 39; e.transparent = true; }
	{ EffectType& e = gEffects[SE_BLOODG]; e.tCount = 8; e.order = 0; e.delay = 250; e.random = true; e.sprite = true; e.xs = 6; e.ys = 6; e.offset = 13 * 20; e.lightOLMul = 2; e.heavyOLMul = 3; e.transparent = true; }
	{ EffectType& e = gEffects[SE_GUNSMOKE]; e.tCount = 4; e.order = 1; e.delay = 5; e.sprite = true; e.xs = 12; e.ys = 12; e.offset = 13 * 16; e.transparent = true; }
	{ EffectType& e = gEffects[SE_STEAM]; e.tCount = 12; e.order = 1; e.delay = 5; e.sprite = true; e.xs = 20; e.ys = 20; e.offset = 320 * 39; e.transparent = true; }
	{ EffectType& e = gEffects[SE_TELEPORT]; e.tCount = 7; e.order = 1; e.delay = 5; e.sprite = true; e.xs = 20; e.ys = 20; e.offset = 320 * 60; e.lightTable = SL_NORMAL; e.lightSize = 4; }
	{ EffectType& e = gEffects[SE_FOOTPRINT]; e.tCount = 4; e.order = 0; e.delay = 250; e.random = true; e.sprite = true; e.xs = 6; e.ys = 6; e.offset = 13 * 20 + 320 * 7; e.lightOLMul = 2; e.heavyOLMul = 3; e.transparent = true; }
	{ EffectType& e = gEffects[SE_FLAME]; e.tCount = 1; e.order = 1; e.delay = 12; e.lightTable = SL_EXPLOSION; e.lightAddConst = -5; e.lightAddMul = -1; }
	{ EffectType& e = gEffects[SE_FLAME2]; e.tCount = 1; e.order = 1; e.delay = 38; e.lightTable = SL_EXPLOSION; e.lightAddConst = -5; e.lightAddMul = -0.33f; }
}

struct BodyPartType { float slow, kickspeed; int bounce, dropBlood, spriteOffset; int sound; };
static BodyPartType gBodyParts[BP_AMOUNT];
static void InitBodyPartTypes() {
	gBodyParts[BP_HEAD] = { -0.04f, 3.8f, 1, 1, 0 };
	gBodyParts[BP_ARM] = { -0.05f, 2.8f, 0, 1, 21 };
	gBodyParts[BP_CHEST] = { -0.07f, 2.5f, 0, 1, 42 };
	gBodyParts[BP_ENTRAILS] = { -0.06f, 2.5f, 0, 1, 63 };
	gBodyParts[BP_LLEG] = { -0.05f, 2.8f, 0, 1, 84 };
	gBodyParts[BP_RLEG] = { -0.05f, 2.8f, 0, 1, 105 };
	gBodyParts[BP_SHIT] = { -0.05f, 2.8f, 0, 1, 126 };
	gBodyParts[BP_BURNED] = { -0.05f, 3.0f, 0, 0, 252 };
	gBodyParts[BP_SKULL] = { -0.04f, 4.0f, 1, 0, 273 };
	gBodyParts[BP_BONES] = { -0.05f, 3.0f, 0, 0, 294 };
	for (int i = 0; i < BP_AMOUNT; i++) gBodyParts[i].sound = SSE_HIT;
	gBodyParts[BP_HEAD].sound = SSE_KICK_HEAD;
	gBodyParts[BP_BURNED].sound = SSE_KICK_HEAD;
	gBodyParts[BP_SKULL].sound = SSE_KICK_HEAD;
	gBodyParts[BP_BONES].sound = SSE_KICK_HEAD;
}

struct EnemyType {
	const char* name; int sprite; float speed; int currentWeapon; int hostile;
	int energy, reward, explosionDeath, sightDistance;
};
static EnemyType gEnemies[EN_AMOUNT];
static void InitEnemyTypes() {
	for (int i = 0; i < EN_AMOUNT; i++)
		gEnemies[i] = { "", 0, 0, W_FIST, 0, 0, 0, 0, 10 * KBlockSpriteSize };
	gEnemies[EN_PISTOL] = { "Pistol Boy", 0, 0.75f, W_PISTOL, 1, 18, 200, 0, 200 };
	gEnemies[EN_SHOTGUN] = { "Shotgun Maniac", 1, 0.75f, W_SHOTGUN, 1, 28, 350, 0, 200 };
	gEnemies[EN_UZI] = { "Uzi Rebel", 2, 0.75f, W_UZI, 1, 40, 400, 0, 200 };
	gEnemies[EN_COMMANDO] = { "Commando", 3, 1.0f, W_AUTORIFLE, 1, 50, 600, 0, 200 };
	gEnemies[EN_BAZOOKA] = { "Bazooka Boy", 4, 0.75f, W_ROCKET, 1, 40, 700, 1, 200 };
	gEnemies[EN_CIVILIAN] = { "Civilian", 5, 0.75f, W_FIST, 0, 18, 50, 0, 200 };
	gEnemies[EN_PUNISHER] = { "Punisher", 6, 0.5f, W_AUTOSHOTGUN, 1, 150, 650, 0, 200 };
	gEnemies[EN_FLAMER] = { "Flamer", 7, 0.75f, W_FLAME, 1, 100, 600, 1, 200 };
	gEnemies[EN_PUNK] = { "Punk", 8, 1.0f, W_FIST, 1, 30, 100, 0, 200 };
	gEnemies[EN_GRENADE] = { "Grenade Gay", 9, 0.75f, W_GRENADE, 1, 70, 500, 1, 200 };
}

static int SimApproxDistance(const BulletType& t) {
	int a1 = t.speed, n = t.time;
	float an = a1 + (float)(n - 1) * t.slow;
	return (int)(n * ((a1 + an) / 2));
}

// ---- entity state ----
struct SimFx { int type = -1; CoordF loc; CoordF vec; int counter = 0; };
struct SimBodyPart { CoordF loc; int type = 0; int angle = 0; float speed = 0; };
struct SimEnemy {
	int uid = -1; int type = 0; CoordF loc; float angle = 0; int targetAngle = 0;
	float energy = 0; float pushPower = 0; int pushAngle = 0;
	int walk = 0, fire = 0, anim = 0, loadCounter = 0, shootCount = 0;
	int burning = 0; int fryingObserver = -1;
	int state = ES_WANDER; int walkCounter = 0;
	int seePlayer[16] = {0}; int curWeapon = 0;
};
struct SimCrate {
	int kind = 0; int value = 0; CoordI loc; int inUse = 1;
	float textCounter = 0, textCounter2 = 0; int textAngle = 0; CoordF textPos; int wakeUpCounter = 0;
};

// ---- small font (CFonts::Length / Write) ----
struct SimFont {
	int w = 0, h = 0;
	int iScaleX = 1, iScaleY = 1;
	bool oneIsZero = false;
	std::vector<unsigned char> glyphs;
	int Width() const { return w * iScaleX; }
	int Height() const { return h * iScaleY; }
	bool Load(const char* path, bool aOneIsZero = false) {
		FILE* f = fopen(path, "rb");
		if (!f) return false;
		int a = fgetc(f); int b = fgetc(f);
		w = a; h = b;
		glyphs.assign((size_t)256 * w * h, 0);
		fseek(f, 512, SEEK_SET);
		size_t rd = fread(glyphs.data(), 1, glyphs.size(), f);
		fclose(f);
		oneIsZero = aOneIsZero;
		return rd == glyphs.size();
	}
	int Length(const char* s) const {
		int length = 0;
		for (int a = 0; s[a] != 0; a++) {
			int c = 0, col = 0;
			while (col == 0 && c < w) {
				for (int d = 0; d < h; d++)
					if (glyphs[(size_t)(unsigned char)s[a] * (w * h) + d * w + c] != 0) col = 1;
				if (col == 0) c++;
			}
			int xpos1 = c;
			c = w - 1; col = 0;
			while (col == 0 && c > 0) {
				for (int d = 0; d < h; d++)
					if (glyphs[(size_t)(unsigned char)s[a] * (w * h) + d * w + c] != 0) col = 1;
				if (col == 0) c--;
			}
			int xpos2 = c;
			if (xpos1 > xpos2) { xpos1 = 0; xpos2 = w / 2; }
			length += (xpos2 - xpos1) + 1;
		}
		return length * iScaleX;
	}
};

// CFonts::Write — near-verbatim. Vertical align 0=below,1=middle,2=above;
// horizontal 0=right,1=middle,2=left.
static RectI SimFontWrite(const SimFont& f, int aX, int aY, const unsigned char* aStr,
	int aVAlign, int aHAlign, GfxBuffer* aTarget) {
	int a, c, d, xpos1, xpos2, col, textcnt = 0, fsize = f.w * f.h;
	int maxX = aX, maxY = aY;
	RectI empty; empty.l = 0; empty.t = 0; empty.r = 0; empty.b = 0;
	if (aStr[0] == 0) return empty;
	if (aVAlign == 1) aY -= f.Height() / 2;
	else if (aVAlign == 2) aY -= f.Height();
	if (aHAlign == 1) aX -= f.Length((const char*)aStr) / 2;
	else if (aHAlign == 2) aX -= f.Length((const char*)aStr);
	for (a = 0; aStr[a] != 0; a++) {
		c = 0; col = 0;
		while (col == 0 && c < f.w) {
			for (d = 0; d < f.h; d++) if (f.glyphs[(size_t)aStr[a] * fsize + d * f.w + c] != 0) col = 1;
			if (col == 0) c++;
		}
		xpos1 = c;
		c = f.w; col = 0;
		while (col == 0 && c > 0) {
			for (d = 0; d < f.h; d++) if (f.glyphs[(size_t)aStr[a] * fsize + d * f.w + (c - 1)] != 0) col = 1;
			if (col == 0) c--;
		}
		xpos2 = c;
		if (xpos1 > xpos2) { xpos1 = 0; xpos2 = f.w / 2; }
		for (d = 0; d < f.h * f.iScaleY; d += f.iScaleY)
			for (c = xpos1; c < xpos2; c++)
				if (f.glyphs[(size_t)aStr[a] * fsize + (d / f.iScaleY * f.w) + c] != 0)
					if ((d + aY) < aTarget->Height() && (d + aY) >= 0 &&
						(c - xpos1) + aX + textcnt < aTarget->Width() &&
						(c - xpos1) + aX + textcnt >= 0) {
						char pixel = (char)f.glyphs[(size_t)aStr[a] * fsize + (d / f.iScaleY * f.w) + c];
						if (pixel == 1 && f.oneIsZero) pixel = 0;
						for (int subX = 0; subX < f.iScaleX; ++subX)
							for (int subY = 0; subY < f.iScaleY; ++subY) {
								int tx = (c - xpos1) * f.iScaleX + aX + textcnt + subX;
								int ty = d + aY + subY;
								if (tx >= 0 && tx < aTarget->Width() && ty >= 0 && ty < aTarget->Height())
									aTarget->iBuf[ty * aTarget->Width() + tx] = pixel;
							}
						if ((c - xpos1) * f.iScaleX + aX + textcnt > maxX) maxX = (c - xpos1) * f.iScaleX + aX + textcnt;
						if (d + aY > maxY) maxY = d + aY;
					}
		textcnt += (xpos2 - xpos1) * f.iScaleX;
	}
	RectI r; r.l = aX; r.t = aY; r.r = maxX + 1; r.b = maxY + 1; return r;
}

// ---- simulation state ----
struct SimInput { unsigned int keys = 0; int mouseXRel = 0; unsigned int mouseButtons = 0; };

struct SimBullet {
	float speed = 0; int angle = 0; float spriteAngle = 0; float spriteAngleAdd = 0;
	int time = 0; int counter = 0; float share = 0; int ownerId = -1; bool hitReported = false;
	CoordF location; int typeId = 0;
};

struct SimPlayer {
	CoordF location; float angle = 0; int targetAngle = 0; float energy = 0;
	float pushPower = 0; int pushAngle = 0; int dead = 0; int hit = 0; float speed = KPlayerNormalSpeed;
	int shield = 0; int cash = 0; int kick = 0; int walk = 0; int fire = 0; int fire2 = 0; int anim = 0;
	int shootCount = 0; bool weaponInHand = false; bool noDamage = false;
	int weapons[W_AMOUNT] = {0}; int bullets[B_AMOUNT] = {0};
	int loadCounter = 0, loadCounter2 = 0, secondaryCounter = 0;
	int curWeapon = 0, secWeapon = 0;
	CoordI screenPos;
	int burning = 0; int fryingObserver = -1;
	bool targetSystem = false;
	bool local = true;
};

struct SimWorld {
	Level level;
	GlibcRandom rng;
	std::vector<SimPlayer> players;
	std::vector<SimBullet> bullets;
	std::vector<SimFx> effects;
	std::vector<SimFx> newEffects;
	std::vector<SimBodyPart> bodyparts;
	std::vector<SimEnemy> enemies;
	std::vector<SimCrate> crates;
	std::vector<CoordI> deadEnemies;
	int mouseOwner = -1;
	float mouseSensitivity = 0.5f;
	bool mouseRightPressed = false;
	bool coopFrags = false;
	bool networkNone = true;
	bool crateRespawn = false;
	int steamAnimationCount = 0;
	int nextEnemyUid = 0;
	long effectSpawns = 0;
	SimFont font;
};

// forward decls
static void SimNewEffect(SimWorld&, int type, float x, float y, int angle, float speed);
static void SimNewBullet(SimWorld&, int type, CoordF pos, int angle, int timeAdd, float share, int owner);
static void SimGetDamage(SimWorld&, SimPlayer&, float damage, int observer);
static void SimExplo(SimWorld&, CoordI pos, int size, float share, int owner);
static int SimMoveBullet(SimWorld&, SimBullet&);
static bool SimCollision(SimWorld&, CoordI p);
static bool SimVisibility(SimWorld&, CoordF src, CoordF dst, CoordF* out);
static bool SimCharCollision(SimWorld&, int l, int t, int r, int b, SimPlayer* selfP, SimEnemy* selfE);
static bool SimEnemyGetDamage(SimWorld&, SimEnemy&, float damage, int observer);
static void SimKillEnemy(SimWorld&, size_t index);
static void SimEnemyGotoBulletOrigin(SimWorld&, SimEnemy&, const SimBullet&);
static void SimBodyPartPush(SimBodyPart&, float vx, float vy);
static void SimPlayerFootprint(SimWorld&, SimPlayer&, int side);
static void SimEnemyFootprint(SimWorld&, SimEnemy&, int side);
static void SimPickupCrates(SimWorld&, SimPlayer&, const RectI&);
static void SimKickBodyParts(SimWorld&, SimPlayer&);

static int SimEnemyOwnerId(const SimEnemy& e) { return -e.uid - 2; }

// CEnemy::SoundHeard (+ CGameSubStateOngoing::SoundHeard). A positional sample
// (`CSoundPlayer::PlayPosSample`) notifies every enemy: a hostile enemy that is
// not already assaulting, within sight distance and with line of sight to the
// source, starts an assault towards it.
static void SimSoundHeard(SimWorld& w, int aEffect, int posX, int posY) {
	if (aEffect == SSE_NOSOUND || aEffect == SSE_CLICK) return;
	for (size_t i = 0; i < w.enemies.size(); i++) {
		SimEnemy& e = w.enemies[i];
		const EnemyType& t = gEnemies[e.type];
		if (!t.hostile) continue;
		if (e.state == ES_ASSAULT) continue;
		float dist = GetDistF((float)posX, (float)posY, e.loc.x, e.loc.y);
		if (dist < (float)t.sightDistance &&
			w.level.VisibilityCheck({ (float)((int)e.loc.x + 14), (float)((int)e.loc.y + 14) },
				{ (float)posX, (float)posY }, NULL)) {
			e.state = ES_ASSAULT;
			e.targetAngle = (int)GetAngleF(e.loc.x, e.loc.y, (float)posX, (float)posY);
			int wc = (int)((dist -
				(float)SimApproxDistance(gBullets[gWeapons[t.currentWeapon].bulletType]) * 0.75f) /
				t.speed);
			if (wc < 0) wc = 0;
			e.walkCounter = wc;
		}
	}
}

static void SimNewEffect(SimWorld& w, int type, float x, float y, int angle, float speed) {
	if (type == SE_NONE) return;
	float w2 = (float)(w.level.iWidth * KBlockSpriteSize);
	float h2 = (float)(w.level.iHeight * KBlockSpriteSize);
	if (x >= 0 && x < w2 && y >= 0 && y < h2) {
		SimFx e;
		e.type = type; e.loc.x = x; e.loc.y = y; e.counter = 0;
		e.vec = SetMovF(angle, speed);
		w.newEffects.push_back(e);
	}
}

static void SimNewBodyPart(SimWorld& w, float x, float y, int angle, float speed, int num) {
	SimBodyPart p;
	p.loc.x = x; p.loc.y = y; p.angle = angle; p.speed = speed; p.type = num;
	w.bodyparts.push_back(p);
}

static void SimNewEnemy(SimWorld& w, int type, bool waitStill, int x, int y, int angle) {
	SimEnemy e;
	e.uid = w.nextEnemyUid++;
	e.type = type;
	e.state = waitStill ? ES_STILL : ES_WANDER;
	e.angle = (float)angle; e.targetAngle = angle;
	e.loc.x = (float)x; e.loc.y = (float)y;
	e.curWeapon = gEnemies[type].currentWeapon;
	e.energy = (float)gEnemies[type].energy;
	for (int i = 0; i < 16; i++) e.seePlayer[i] = 0;
	w.enemies.push_back(e);
}

static void SimNewCrate(SimWorld& w, int x, int y, int kind, int value) {
	SimCrate c;
	c.kind = kind; c.value = value; c.loc.x = x; c.loc.y = y;
	w.crates.push_back(c);
}

static bool SimCollision(SimWorld& w, CoordI p) { return w.level.Collision(p.x, p.y); }
static bool SimVisibility(SimWorld& w, CoordF src, CoordF dst, CoordF* out) {
	return w.level.VisibilityCheck(src, dst, out);
}

static bool SimCharCollision(SimWorld& w, int l, int t, int r, int b, SimPlayer* selfP, SimEnemy* selfE) {
	for (size_t i = 0; i < w.enemies.size(); i++) {
		SimEnemy& e = w.enemies[i];
		if (&e == selfE) continue;
		CoordI p = ToInt2(e.loc);
		if (p.x >= l && p.x < r && p.y >= t && p.y < b) return true;
	}
	for (size_t i = 0; i < w.players.size(); i++) {
		SimPlayer& pl = w.players[i];
		if (&pl == selfP) continue;
		if (pl.dead) continue;
		CoordI p = ToInt2(pl.location);
		if (p.x >= l && p.x < r && p.y >= t && p.y < b) return true;
	}
	return false;
}

// CCoord<int> movement helpers (the movement component truncates first).
static CoordI MovIAdd(CoordI p, int angle, float speed) {
	CoordI r; r.x = p.x + (int)(gMath.Cose(angle) * speed); r.y = p.y + (int)(gMath.Sine(angle) * speed);
	return r;
}
static CoordI MovISet(int angle, float speed) {
	CoordI r; r.x = (int)(gMath.Cose(angle) * speed); r.y = (int)(gMath.Sine(angle) * speed);
	return r;
}

static void SimNewBullet(SimWorld& w, int type, CoordF aPos, int aAngle, int aTimeAdd, float aShare, int owner) {
	CoordI realPos = ToInt2(aPos);
	int cnt = 1;
	while (w.level.Collision(realPos.x / KBlockSpriteSize, realPos.y / KBlockSpriteSize) && cnt < (int)(KBlockSpriteSize * 1.4)) {
		realPos = ToInt2(AddMovF(aPos, aAngle, (float)(-cnt)));
		cnt++;
	}
	if (cnt >= (int)(KBlockSpriteSize * 1.4)) realPos = ToInt2(aPos);

	SimBullet b;
	b.typeId = type;
	b.location = ToFloat2(realPos);
	int ang = aAngle; ANGLEFIX(ang); b.angle = ang;
	b.spriteAngle = (float)ang; b.spriteAngleAdd = 0.0f;
	b.speed = (float)gBullets[type].speed;
	b.time = gBullets[type].time + aTimeAdd;
	b.counter = 0; b.share = aShare; b.ownerId = owner; b.hitReported = false;
	w.bullets.push_back(b);
}

static void SimExplo(SimWorld& w, CoordI pos, int size, float share, int owner) {
	int ray = size * 5;
	for (int a = 0; a < ray; a++)
		SimNewBullet(w, B_RAY, ToFloat2(pos), (int)(a * 360.0f / ray), (int)(size * 2.5f), share / ray, owner);

	int dst = (w.rng.Rand() % 5) + 1;
	for (int a = 0; a < dst; a++) {
		// NewEffect(rand()%2 ? Yellow : Red, aPos, rand()%360, (rand()%2)+2)
		// g++ evaluates right-to-left: speed, angle, then type.
		float sp = (float)((w.rng.Rand() % 2) + 2);
		int ang = w.rng.Rand() % 360;
		int t = (w.rng.Rand() % 2) ? SE_METALY : SE_METALR;
		SimNewEffect(w, t, (float)pos.x, (float)pos.y, ang, sp);
	}

	// Move body parts near the blast (CLevelRuntimeData::Explo).
	int pushDist = 25 * size;
	float left = (float)(pos.x - pushDist * 2);
	float right = (float)(pos.x + pushDist * 2);
	for (size_t i = 0; i < w.bodyparts.size(); i++) {
		SimBodyPart& bp = w.bodyparts[i];
		if (bp.loc.x < left || bp.loc.x > right) continue; // X-sorted range
		float vx = bp.loc.x - (float)pos.x;
		float vy = bp.loc.y - (float)pos.y;
		float dist = sqrtf(vx * vx + vy * vy);
		if (dist < (float)(pushDist * 2)) {
			if (w.level.VisibilityCheck(ToFloat2(pos), bp.loc, NULL)) {
				if (dist) {
					dist = dist * (dist / 2);
					float nx = (float)(w.rng.Rand() % pushDist) * vx / dist;
					float ny = (float)(w.rng.Rand() % pushDist) * vy / dist;
					SimBodyPartPush(bp, nx, ny);
				}
			}
		}
	}
	int fx = (size <= 1) ? SSE_SMALL_EXPLOSION : (size <= 3 ? SSE_EXPLOSION : SSE_BIG_EXPLOSION);
	SimSoundHeard(w, fx, pos.x, pos.y);
}

static int SimCheckWalls(SimWorld& w, int mode, CoordI newLoc) {
	switch (mode) {
	case SD_UP: return w.level.Collision(newLoc.x, newLoc.y - 1) ? 1 : 0;
	case SD_LEFT: return w.level.Collision(newLoc.x - 1, newLoc.y) ? 1 : 0;
	case SD_DOWN: return w.level.Collision(newLoc.x, newLoc.y + 1) ? 1 : 0;
	case SD_RIGHT: return w.level.Collision(newLoc.x + 1, newLoc.y) ? 1 : 0;
	}
	return 0;
}

static void SimBounce(SimWorld& w, SimBullet& b, int bounceType, CoordI newLoc) {
	const int KIso = 10000;
	int distUp = KIso, distLeft = KIso, distDown = KIso, distRight = KIso;
	if (SimCheckWalls(w, SD_UP, newLoc)) distUp = newLoc.y % KBlockSpriteSize;
	if (SimCheckWalls(w, SD_LEFT, newLoc)) distLeft = newLoc.x % KBlockSpriteSize;
	if (SimCheckWalls(w, SD_DOWN, newLoc)) distDown = KBlockSpriteSize - newLoc.y % KBlockSpriteSize;
	if (SimCheckWalls(w, SD_RIGHT, newLoc)) distRight = KBlockSpriteSize - newLoc.x % KBlockSpriteSize;
	int mn = distUp;
	if (distLeft < mn) mn = distLeft;
	if (distDown < mn) mn = distDown;
	if (distRight < mn) mn = distRight;

	if (distUp != KIso || distLeft != KIso || distDown != KIso || distRight != KIso) {
		if (bounceType == SB_NORMAL) {
			if (mn == distUp || mn == distDown) b.angle = 360 - b.angle;
			if (mn == distLeft || mn == distRight) b.angle = 180 - b.angle;
		} else {
			CoordF tmp = SetMovF(b.angle, b.speed);
			if (mn == distUp || mn == distDown) tmp.y = 0;
			if (mn == distLeft || mn == distRight) tmp.x = 0;
			b.angle = (int)VectorAngF(tmp);
			b.speed = VectorLenF(tmp);
		}
		ANGLEFIX(b.angle);
		if (b.angle < 180) b.spriteAngleAdd = -b.speed * 15; else b.spriteAngleAdd = b.speed * 15;
	} else {
		b.speed = 0;
	}
}

static void SimGetDamage(SimWorld& w, SimPlayer& p, float damage, int observer) {
	if (p.dead) return;
	if (p.noDamage) return;
	p.hit = 15;
	p.energy -= damage;
	if (p.energy <= 0) {
		p.energy = 0;
		(void)observer; // coop: Frags()==false
		if (p.burning) {
			SimNewEffect(w, SE_EXPLO, p.location.x + 12, p.location.y + 12, 0, 0);
			SimNewEffect(w, SE_EXPLO, p.location.x + 18, p.location.y + 12, 0, 0);
			SimNewEffect(w, SE_EXPLO, p.location.x + 15, p.location.y + 18, 0, 0);
		} else {
			for (int a = 0; a < 16; a++)
				if (w.rng.Rand() % 2)
					SimNewEffect(w, SE_BLOOD, p.location.x + 15, p.location.y + 15, (int)(a * 22.5f), 2);
		}
		p.dead = 1;
	}
}

static int SimMoveBullet(SimWorld& w, SimBullet& b) {
	int a;
	bool hit = false, hitwall = false;
	CoordI rpos = ToInt2(b.location);
	CoordI vpos; vpos.x = 0; vpos.y = 0;
	const BulletType& t = gBullets[b.typeId];

	int loopTimes = (int)b.speed >> 2;
	if (loopTimes < 1) loopTimes = 1;
	b.time--;
	b.counter++;

	if (t.timeBeforeSpin > 0)
		if (b.counter == t.timeBeforeSpin) {
			if (b.angle < 180) b.spriteAngleAdd = -b.speed * 15; else b.spriteAngleAdd = b.speed * 15;
		}

	for (a = 0; a < loopTimes && !hit && !hitwall; a++) {
		if (b.speed > 0.001f) {
			CoordF proposal = AddMovF(b.location, b.angle, b.speed / loopTimes);
			CoordF newPos;
			if (!w.level.VisibilityCheck(b.location, proposal, &newPos)) {
				if (t.collisionTrigger) {
					hitwall = true;
				} else {
					SimBounce(w, b, t.bounceType, ToInt2(newPos));
					SimSoundHeard(w, t.bounceSound, (int)b.location.x, (int)b.location.y);
					newPos = AddMovF(b.location, b.angle, b.speed / loopTimes);
				}
			}
			b.location = newPos;
			rpos = ToInt2(b.location);
		}

		if (b.counter > t.sleepTime && !hitwall) {
			for (size_t ei = 0; ei < w.enemies.size(); ) {
				SimEnemy& e = w.enemies[ei];
				CoordI loc = ToInt2(e.loc);
				int l = loc.x + 5, tt = loc.y + 5, r = loc.x + 22, bb = loc.y + 22;
				bool inside = rpos.x >= l && rpos.x < r && rpos.y >= tt && rpos.y < bb;
				bool selfOk = (b.ownerId != SimEnemyOwnerId(e)) || (t.type != BK_INCENDIARY && t.type != BK_FIST);
				if (inside && selfOk) {
					hit = true;
					SimEnemyGotoBulletOrigin(w, e, b);
					vpos = ToInt2(AddMovF({ e.loc.x + 14, e.loc.y + 14 }, b.angle, 4));
					e.pushAngle = b.angle;
					if (t.pushPower > e.pushPower) e.pushPower = t.pushPower * 0.75f;
					if (t.type == BK_INCENDIARY) { e.burning += 15; e.fryingObserver = b.ownerId; }
					bool dead = false;
					if (t.power > 0) dead = SimEnemyGetDamage(w, e, t.power, b.ownerId);
					if (dead) SimKillEnemy(w, ei);
					else ei++;
				} else ei++;
			}

			for (size_t bi = 0; bi < w.players.size(); bi++) {
				SimPlayer& pl = w.players[bi];
				CoordI loc = ToInt2(pl.location);
				int l = loc.x + 5, tt = loc.y + 5, r = loc.x + 22, bb = loc.y + 22;
				bool inside = rpos.x >= l && rpos.x < r && rpos.y >= tt && rpos.y < bb;
				bool selfOk = (b.ownerId != (int)bi) || (t.type != BK_INCENDIARY && t.type != BK_FIST);
				if (!pl.dead && inside && selfOk) {
					hit = true;
					vpos = ToInt2(AddMovF({ pl.location.x + 14, pl.location.y + 14 }, b.angle, 4));
					if (w.networkNone) {
						pl.pushAngle = b.angle;
						if (t.pushPower > pl.pushPower) pl.pushPower = t.pushPower * 0.75f;
						if (t.type == BK_INCENDIARY) { pl.burning += 15; pl.fryingObserver = b.ownerId; }
						if (t.power > 0) SimGetDamage(w, pl, t.power, b.ownerId);
					}
				}
			}
		}
	}

	if ((t.type == BK_NORMAL || t.type == BK_FIST) && hitwall)
		if (w.rng.Rand() % 8 == 1) {
			// NewEffect(Metal, rpos, rand()%360, (rand()%2)+2) — right-to-left.
			float sp = (float)((w.rng.Rand() % 2) + 2);
			int ang = w.rng.Rand() % 360;
			SimNewEffect(w, SE_METAL, (float)rpos.x, (float)rpos.y, ang, sp);
		}

	if (hit) {
		if (t.stop) b.speed = 0;
		if (t.type == BK_NORMAL || t.type == BK_FIST) {
			float bp = 0.5f + (t.power / 2) + (float)(w.rng.Rand() % 2);
			if (bp > 4) bp = 4;
			for (a = 0; a < (int)(t.power / 5) + 1; a++) {
				// NewEffect(Blood, vpos.Add((rand()%6)-3,(rand()%6)-3), iAngle+((rand()%30)-15), bp)
				// right-to-left: bp, angle, then Add's y then x.
				int ang = b.angle + ((w.rng.Rand() % 30) - 15);
				float yy = (float)vpos.y + (float)((w.rng.Rand() % 6) - 3);
				float xx = (float)vpos.x + (float)((w.rng.Rand() % 6) - 3);
				SimNewEffect(w, SE_BLOOD, xx, yy, ang, bp);
			}
		}
		if (b.ownerId >= 0 && t.power > 0 && !b.hitReported) b.hitReported = true;
		if (t.type == BK_FIST) SimSoundHeard(w, gWeapons[W_FIST].sound, rpos.x, rpos.y);
	}

	if ((t.type == BK_NORMAL || t.type == BK_FIST) && (b.time == 0 || hitwall) && !hit && t.speed > 10)
		SimNewEffect(w, SE_SMOKE, (float)rpos.x, (float)rpos.y, 0, 0);

	bool alive = true;
	if ((t.collisionTrigger && (hit || hitwall)) || b.time == 0) {
		if (t.type == BK_EXPLOSIVE) {
			// rpos.AddMovement(-1): the int overload truncates the movement first.
			CoordI ep = MovIAdd(rpos, b.angle, -1.0f);
			SimExplo(w, ep, t.explosion, b.share, b.ownerId);
		}
		alive = false;
	}

	{
		bool doE = (t.effectKind != EK_ROCKET) || (b.counter % 2 == 0);
		if (doE) {
			int ea = (t.effectKind == EK_ROCKET) ? (b.angle + 90 + w.rng.Rand() % 180) : (t.effectKind == EK_RAY ? b.angle + 180 : b.angle);
			float es = (t.effectKind == EK_ROCKET) ? 0.1f : (t.effectKind == EK_RAY ? (float)(w.rng.Rand() % 2) : 0.0f);
			SimNewEffect(w, t.effect, (float)rpos.x, (float)rpos.y, ea, es);
		}
	}
	SimNewEffect(w, t.effect2, (float)rpos.x, (float)rpos.y, b.angle, 0.0f);

	if (b.speed > 0) b.speed += t.slow;
	if (b.speed < 0) b.speed = 0;

	b.spriteAngle += b.spriteAngleAdd;
	ANGLEFIX(b.spriteAngle);
	if (b.spriteAngleAdd > 0) b.spriteAngleAdd -= 0.4f;
	if (b.spriteAngleAdd < 0) b.spriteAngleAdd += 0.4f;
	if (b.spriteAngleAdd >= -0.4f && b.spriteAngleAdd <= 0.4f) b.spriteAngleAdd = 0;

	return alive ? 0 : 1;
}

// ---- player ----
static int SimSpriteAngle(const SimPlayer& p) { return (int)(p.angle / 4.5f); }

static void SimSetCurrentWeapon(SimPlayer& p, int idx) { p.curWeapon = idx; }
static void SimSetSecondaryWeapon(SimPlayer& p, int idx) { p.secWeapon = (idx == 0) ? 0 : idx; }

static void SimSetAngle(SimPlayer& p, float a) {
	float ang = a; ANGLEFIX(ang); p.angle = ang; p.targetAngle = (int)ang;
}
static void SimRotate(SimPlayer& p, float c) { SimSetAngle(p, p.angle + c); }

static void SimStraighten(SimPlayer& p) {
	if (p.angle >= 360 - KStraightTolerance || p.angle <= KStraightTolerance) { SimSetAngle(p, 0); return; }
	if (p.angle >= 90 - KStraightTolerance && p.angle <= 90 + KStraightTolerance) { SimSetAngle(p, 90); return; }
	if (p.angle >= 180 - KStraightTolerance && p.angle <= 180 + KStraightTolerance) { SimSetAngle(p, 180); return; }
	if (p.angle >= 270 - KStraightTolerance && p.angle <= 270 + KStraightTolerance) { SimSetAngle(p, 270); return; }
}

static void SimPlayerFootprint(SimWorld& w, SimPlayer& p, int side) {
	CoordI fp = ToInt2(AddMovF({ p.location.x + 15, p.location.y + 15 }, (int)p.angle + 90 + side * 180, 4.0f));
	if (w.level.LevelData(fp.x / KBlockSpriteSize, fp.y / KBlockSpriteSize).iType == 0)
		if (w.level.DustBlock(fp.x / KBlockSpriteSize, fp.y / KBlockSpriteSize))
			SimNewEffect(w, SE_FOOTPRINT, (float)fp.x, (float)fp.y, 0, 0);
}

static void SimEnemyFootprint(SimWorld& w, SimEnemy& e, int side) {
	// NB: the enemy version multiplies the whole angle by 4 (original quirk).
	CoordI fp = ToInt2(AddMovF({ e.loc.x + 15, e.loc.y + 15 }, ((int)e.angle + 90 + side * 180) * 4, 4.0f));
	if (w.level.LevelData(fp.x / KBlockSpriteSize, fp.y / KBlockSpriteSize).iType == 0)
		if (w.level.DustBlock(fp.x / KBlockSpriteSize, fp.y / KBlockSpriteSize))
			SimNewEffect(w, SE_FOOTPRINT, (float)fp.x, (float)fp.y, 0, 0);
}

// CCharacter::Move, shared by players and enemies.
static void SimCharMoveCommon(SimWorld& w, CoordF& loc, int& walk, int aAngle, float aSpeed,
		SimPlayer* selfP, SimEnemy* selfE, bool isEnemy) {
	const int reuna = 6, reuna2 = 4;
	if (walk == (int)(KWalkAnimationDelay * 0.25) || walk == (int)(KWalkAnimationDelay * 0.75)) {
		if (isEnemy) SimEnemyFootprint(w, *selfE, 0); else SimPlayerFootprint(w, *selfP, 0);
	}
	if (walk == (int)(KWalkAnimationDelay * 0.5) || walk == KWalkAnimationDelay - 1) {
		if (isEnemy) SimEnemyFootprint(w, *selfE, 1); else SimPlayerFootprint(w, *selfP, 1);
	}

	CoordF newpos = AddMovF(loc, aAngle, aSpeed);
	CoordI testpos = ToInt2(newpos);
	CoordI bp[8];
	bp[0].x = (testpos.x + 14 - reuna2) / KBlockSpriteSize; bp[0].y = (testpos.y + reuna) / KBlockSpriteSize;
	bp[1].x = (testpos.x + 14 + reuna2) / KBlockSpriteSize; bp[1].y = (testpos.y + reuna) / KBlockSpriteSize;
	bp[2].x = (testpos.x + 14 - reuna2) / KBlockSpriteSize; bp[2].y = (testpos.y + KCharacterSpriteSize - reuna) / KBlockSpriteSize;
	bp[3].x = (testpos.x + 14 + reuna2) / KBlockSpriteSize; bp[3].y = (testpos.y + KCharacterSpriteSize - reuna) / KBlockSpriteSize;
	bp[4].x = (testpos.x + reuna) / KBlockSpriteSize; bp[4].y = (testpos.y + 14 - reuna2) / KBlockSpriteSize;
	bp[5].x = (testpos.x + reuna) / KBlockSpriteSize; bp[5].y = (testpos.y + 14 + reuna2) / KBlockSpriteSize;
	bp[6].x = (testpos.x + KCharacterSpriteSize - reuna) / KBlockSpriteSize; bp[6].y = (testpos.y + 14 - reuna2) / KBlockSpriteSize;
	bp[7].x = (testpos.x + KCharacterSpriteSize - reuna) / KBlockSpriteSize; bp[7].y = (testpos.y + 14 + reuna2) / KBlockSpriteSize;

	if (newpos.y < loc.y &&
		w.level.LevelData(bp[0].x, bp[0].y).iType == 0 && w.level.LevelData(bp[1].x, bp[1].y).iType == 0) {
		if (!SimCharCollision(w, testpos.x - 15, testpos.y + 2 * reuna - KCharacterSpriteSize, testpos.x + 15, testpos.y, selfP, selfE)) {
			if (newpos.y < 0) loc.y = 0; else loc.y = newpos.y;
		}
	}
	if (newpos.y > loc.y &&
		w.level.LevelData(bp[2].x, bp[2].y).iType == 0 && w.level.LevelData(bp[3].x, bp[3].y).iType == 0) {
		if (!SimCharCollision(w, testpos.x - 15, testpos.y, testpos.x + 15, testpos.y + KCharacterSpriteSize - 2 * reuna, selfP, selfE)) {
			if (newpos.y > w.level.iHeight * KBlockSpriteSize - KCharacterSpriteSize) loc.y = (float)(w.level.iHeight * KBlockSpriteSize - KCharacterSpriteSize);
			else loc.y = newpos.y;
		}
	}
	if (newpos.x < loc.x &&
		w.level.LevelData(bp[4].x, bp[4].y).iType == 0 && w.level.LevelData(bp[5].x, bp[5].y).iType == 0) {
		if (!SimCharCollision(w, testpos.x + 2 * reuna - KCharacterSpriteSize, testpos.y - 15, testpos.x, testpos.y + 15, selfP, selfE)) {
			if (newpos.x < 0) loc.x = 0; else loc.x = newpos.x;
		}
	}
	if (newpos.x > loc.x &&
		w.level.LevelData(bp[6].x, bp[6].y).iType == 0 && w.level.LevelData(bp[7].x, bp[7].y).iType == 0) {
		if (!SimCharCollision(w, testpos.x, testpos.y - 15, testpos.x + KCharacterSpriteSize - 2 * reuna, testpos.y + 15, selfP, selfE)) {
			if (newpos.x > w.level.iWidth * KBlockSpriteSize - KCharacterSpriteSize) loc.x = (float)(w.level.iWidth * KBlockSpriteSize - KCharacterSpriteSize);
			else loc.x = newpos.x;
		}
	}
}

static void SimPlayerCharMove(SimWorld& w, SimPlayer& p, int aAngle, float aSpeed) {
	SimCharMoveCommon(w, p.location, p.walk, aAngle, aSpeed, &p, NULL, false);
}
static void SimEnemyMoveChar(SimWorld& w, SimEnemy& e, int aAngle, float aSpeed) {
	SimCharMoveCommon(w, e.loc, e.walk, aAngle, aSpeed, NULL, &e, true);
}

static void SimPlayerMove(SimWorld& w, SimPlayer& p, int aAngle, float aSpeed, const RectI& drawRect) {
	// CPlayer::Move blood effect while hurt.
	if (p.energy < 20 && p.walk % 4 == 0 && w.rng.Rand() % 3 == 0)
		SimNewEffect(w, SE_BLOODG, p.location.x + 15, p.location.y + 15, 0, 0);
	SimPlayerCharMove(w, p, aAngle, aSpeed);
	SimPickupCrates(w, p, drawRect);
}

static void SimChooseBestWeapon(SimWorld& w, SimPlayer& p) {
	int best = 0, selection = 0;
	for (int a = 0; a < W_AMOUNT; a++)
		if (p.weapons[a] > 0 && gWeapons[a].priority > best && p.bullets[gWeapons[a].bulletType] > 0) {
			best = gWeapons[a].priority; selection = a;
		}
	SimSetCurrentWeapon(p, selection);
}

static void SimChangeWeapon(SimPlayer& p, bool reverse) {
	int curWeapIndex = p.curWeapon;
	if (!reverse) {
		if (gWeapons[curWeapIndex].singleHand && p.weapons[curWeapIndex] == 2 && p.secWeapon == 0)
			p.secWeapon = p.curWeapon;
		else {
			curWeapIndex++;
			curWeapIndex %= W_AMOUNT;
			p.secWeapon = 0;
		}
		while (p.weapons[curWeapIndex % W_AMOUNT] == 0) { curWeapIndex++; curWeapIndex %= W_AMOUNT; }
		p.curWeapon = curWeapIndex;
	} else {
		if (p.secWeapon != 0) p.secWeapon = 0;
		else {
			curWeapIndex--;
			if (curWeapIndex < 0) curWeapIndex += W_AMOUNT;
			while (p.weapons[curWeapIndex % W_AMOUNT] == 0) { curWeapIndex--; curWeapIndex %= W_AMOUNT; }
			p.curWeapon = curWeapIndex;
			if (gWeapons[p.curWeapon].singleHand && p.weapons[curWeapIndex] == 2) p.secWeapon = curWeapIndex;
		}
	}
	p.loadCounter = 0;
	p.loadCounter2 = 0;
}

static void SimShoot(SimWorld& w, SimPlayer& p, int hand, int owner) {
	CoordI rpos = ToInt2(p.location);
	int wt = (hand == 1) ? p.curWeapon : p.secWeapon;
	const WeaponType& weaponPtr = gWeapons[wt];

	if (hand == 1) {
		p.fire = 1; p.loadCounter = 0;
		p.secondaryCounter = weaponPtr.loadingTime / 2;
	} else {
		p.fire2 = 1; p.loadCounter2 = 0;
	}

	for (int a = 0; a < weaponPtr.bulletAmount; a++) {
		int r;
		if (p.secWeapon == 0) r = (weaponPtr.angleAdd >> 1) - w.rng.Rand() % weaponPtr.angleAdd;
		else r = weaponPtr.angleAdd - w.rng.Rand() % (2 * weaponPtr.angleAdd);
		CoordI spawnI = ToInt2(AddMovF({ (float)(rpos.x + 14), (float)(rpos.y + 14) }, (int)p.angle, 10.0f));
		SimNewBullet(w, weaponPtr.bulletType, ToFloat2(spawnI), (int)p.angle + r, 0, 1.0f / weaponPtr.bulletAmount, owner);
	}

	if (weaponPtr.consumesBullets) p.bullets[weaponPtr.bulletType]--;

	if (p.shootCount % gBullets[weaponPtr.bulletType].multiplier == 0) {
		SimSoundHeard(w, weaponPtr.sound, rpos.x, rpos.y);
		if (weaponPtr.smoke) {
			int ra = (int)p.angle;
			CoordI ofs = MovISet(ra, 8);
			ofs = MovIAdd(ofs, ra + (hand == 2 ? 270 : 90), 4);
			SimNewEffect(w, SE_GUNSMOKE, (float)(rpos.x + 14 + ofs.x), (float)(rpos.y + 14 + ofs.y), ra, 1.0f);
		}
	}
}

static void SimPlayerCheckKeys(SimWorld& w, int index, SimPlayer& p, const SimInput& in, const RectI& drawRect) {
	int walk_chk = 0;
	float speedi = 0;
	int strafe = SD_NOWHERE, forward = SD_NOWHERE;
	int FAngle = 0;

	p.noDamage = false;

	if (w.mouseOwner != index && !(in.keys & SK_LEFT) && !(in.keys & SK_RIGHT) && p.targetAngle == (int)p.angle)
		SimStraighten(p);

	if (in.keys & SK_LEFT) if (!(in.keys & SK_STRAFE)) SimRotate(p, -KPlayerRotationSpeed);
	if (in.keys & SK_RIGHT) if (!(in.keys & SK_STRAFE)) SimRotate(p, KPlayerRotationSpeed);

	if ((in.keys & SK_STRAFE && in.keys & SK_LEFT) || (in.keys & SK_LSTRAFE)) { strafe = SD_LEFT; walk_chk = 1; }
	if ((in.keys & SK_STRAFE && in.keys & SK_RIGHT) || (in.keys & SK_RSTRAFE)) { strafe = SD_RIGHT; walk_chk = 1; }

	if (in.keys & SK_UP) { forward = SD_UP; walk_chk = 1; if (w.rng.Rand() % 40 == 0) SimKickBodyParts(w, p); }
	if (in.keys & SK_DOWN) { forward = SD_DOWN; walk_chk = 1; }

	if (w.mouseOwner == index) FAngle = (int)p.angle;
	else FAngle = (int)(SimSpriteAngle(p) * 4.5f);

	if (forward == SD_UP) {
		if (strafe == SD_LEFT) FAngle -= 45;
		if (strafe == SD_RIGHT) FAngle += 45;
		speedi = p.speed;
	}
	if (forward == SD_DOWN) {
		FAngle += 180;
		if (strafe == SD_LEFT) FAngle += 45;
		if (strafe == SD_RIGHT) FAngle -= 45;
		speedi = p.speed * 0.75f;
	}
	if (forward == SD_NOWHERE) {
		if (strafe == SD_LEFT) FAngle -= 90;
		if (strafe == SD_RIGHT) FAngle += 90;
		if (strafe > 0) speedi = p.speed; else speedi = 0;
	}

	ANGLEFIX(FAngle);
	if (speedi != 0) SimPlayerMove(w, p, FAngle, speedi, drawRect);

	if (walk_chk && p.walk == 0) p.walk = 1;
	if (!walk_chk) p.walk = 0;

	if ((in.keys & SK_SHOOT) || (w.mouseOwner == index && (in.mouseButtons & SM_LEFT))) {
		p.shootCount++;
		if (gWeapons[p.curWeapon].bulletType != B_FIST)
			if (p.loadCounter == gWeapons[p.curWeapon].loadingTime) {
				if (p.bullets[gWeapons[p.curWeapon].bulletType] > 0) { SimShoot(w, p, 1, index); p.weaponInHand = true; }
				else { SimSetSecondaryWeapon(p, 0); p.loadCounter2 = 0; p.loadCounter = 0; SimChooseBestWeapon(w, p); }
			}
		if (p.secWeapon != 0)
			if (p.secondaryCounter == 0)
				if (p.loadCounter2 == gWeapons[p.secWeapon].loadingTime) {
					if (p.bullets[gWeapons[p.secWeapon].bulletType] > 0) SimShoot(w, p, 2, index);
					else { SimSetSecondaryWeapon(p, 0); p.loadCounter2 = 0; }
				}
		if (gWeapons[p.curWeapon].bulletType == B_FIST)
			if (p.loadCounter >= gWeapons[p.curWeapon].loadingTime) { SimShoot(w, p, 1, index); SimKickBodyParts(w, p); }
	} else {
		p.shootCount = 0;
		p.weaponInHand = false;
	}

	if (!(in.mouseButtons & SM_RIGHT)) w.mouseRightPressed = false;
	if ((in.keys & SK_SHIFT) || (w.mouseOwner == index && (in.mouseButtons & SM_RIGHT) && !w.mouseRightPressed)) {
		SimChangeWeapon(p, false);
		if (w.mouseOwner == index) w.mouseRightPressed = true;
	}
}

static void SimLoadWeapons(SimPlayer& p) {
	if (p.loadCounter < gWeapons[p.curWeapon].loadingTime) p.loadCounter++;
	if (p.secWeapon != 0)
		if (p.loadCounter2 < gWeapons[p.secWeapon].loadingTime) p.loadCounter2++;
	if (p.secondaryCounter > 0) p.secondaryCounter--;
}

static void SimPlayerAnimate(SimPlayer& p) {
	p.anim = 1;
	if (p.walk) {
		if (p.walk - 1 < KWalkAnimationDelay) p.walk++;
		else p.walk = 1;
		p.anim = (p.walk - 1) / (KWalkAnimationDelay / 4);
		if (p.anim >= 3) p.anim = 1;
	}
	if (!p.fire && p.weaponInHand) p.anim = 3;
	if (p.fire) { p.fire++; if (p.fire > 7) p.fire = 0; p.anim = 4; }
	if (p.fire2) { p.fire2++; if (p.fire2 > 7) p.fire2 = 0; p.anim = 5; }
	if (p.dead) {
		if (p.dead - 1 < KDeadAnimationDelay) p.dead++;
		p.anim = (int)(6 + ((float)(p.dead - 1) / KDeadAnimationDelay) * 3);
		if (p.anim > 8) p.anim = 8;
	}
	if (p.kick) { p.kick++; if (p.kick > 6) p.kick = 0; p.anim = (p.secWeapon == 0) ? 5 : 6; }
}

static void SimMoveScr(SimPlayer& p, const RectI& drawRect) {
	int spd;
	int halfW = (drawRect.r - drawRect.l) / 2;
	int halfH = (drawRect.b - drawRect.t) / 2;

	if (fabs((double)(p.screenPos.x + halfW) - ((double)p.location.x + 14)) > 100)
		p.screenPos.x = (int)(p.location.x - halfW);
	spd = (int)(fabs((double)(p.screenPos.x + halfW) - (double)((35 * gMath.Cose((int)p.angle)) + p.location.x + 14)) / 4);
	if ((p.screenPos.x + halfW) < (25 * gMath.Cose((int)p.angle)) + p.location.x + 14) p.screenPos.x += spd;
	if ((p.screenPos.x + halfW) > (25 * gMath.Cose((int)p.angle)) + p.location.x + 14) p.screenPos.x -= spd;

	spd = (int)(fabs((double)(p.screenPos.y + halfH) - (double)((25 * gMath.Sine((int)p.angle)) + p.location.y + 14)) / 4);
	if ((p.screenPos.y + halfH) < (25 * gMath.Sine((int)p.angle)) + p.location.y + 14) p.screenPos.y += spd;
	if (p.screenPos.y + halfH > (25 * gMath.Sine((int)p.angle)) + p.location.y + 14) p.screenPos.y -= spd;
	if (fabs((double)(p.screenPos.y + halfH) - ((double)p.location.y + 14)) > 100)
		p.screenPos.y = (int)(p.location.y - halfH);
}

static void SimInitScr(SimPlayer& p, const RectI& drawRect) {
	p.screenPos.x = (int)(p.location.x - (drawRect.r - drawRect.l) / 2);
	p.screenPos.y = (int)(p.location.y - (drawRect.b - drawRect.t) / 2);
}

static void SimDecHits(SimPlayer& p) { if (p.hit > 0) p.hit--; }

// ===========================================================================
// Body parts
// ===========================================================================
static void SimBodyPartSetAngleAndSpeed(SimBodyPart& bp, CoordF v) {
	float s = VectorLenF(v);
	if (s > 5) s = 5;
	bp.speed = s;
	bp.angle = (int)VectorAngF(v);
}
static void SimBodyPartPush(SimBodyPart& bp, float vx, float vy) {
	CoordF v; v.x = vx; v.y = vy;
	CoordF m = AddMovF(v, bp.angle, bp.speed);
	SimBodyPartSetAngleAndSpeed(bp, m);
}
static void SimBodyPartBounce(SimWorld& w, SimBodyPart& bp, int side) {
	if (side == SD_DOWN || side == SD_UP) bp.angle = 360 - bp.angle;
	else if (side == SD_RIGHT || side == SD_LEFT) bp.angle = 270 + (270 - bp.angle);
	SimSoundHeard(w, gBodyParts[bp.type].sound, (int)bp.loc.x, (int)bp.loc.y);
}
static void SimBodyPartKick(SimBodyPart& bp, int angle) {
	bp.angle = angle;
	bp.speed = gBodyParts[bp.type].kickspeed;
}
static void SimBodyPartMove(SimWorld& w, SimBodyPart& bp) {
	const int reuna = 4, reuna2 = 2;
	if (bp.speed <= 0) return;
	CoordF vec = SetMovF(bp.angle, bp.speed);
	float npx = bp.loc.x + vec.x, npy = bp.loc.y + vec.y;
	int tx = (int)npx, ty = (int)npy;
	const BodyPartType& bt = gBodyParts[bp.type];
	if (bt.dropBlood)
		if (w.rng.Rand() % 2 != 0)
			SimNewEffect(w, SE_BLOODG, bp.loc.x + 10, bp.loc.y + 10, 0, 0);

	if (npy < bp.loc.y) {
		if (w.level.LevelData((tx + 10 - reuna2) / KBlockSpriteSize, (ty + reuna) / KBlockSpriteSize).iType == 0 &&
			w.level.LevelData((tx + 10 + reuna2) / KBlockSpriteSize, (ty + reuna) / KBlockSpriteSize).iType == 0)
			bp.loc.y = npy;
		else if (bt.bounce) SimBodyPartBounce(w, bp, SD_DOWN);
		else { vec.y = 0; SimBodyPartSetAngleAndSpeed(bp, vec); }
	} else if (npy > bp.loc.y) {
		if (w.level.LevelData((tx + 10 - reuna2) / KBlockSpriteSize, (ty + 20 - reuna) / KBlockSpriteSize).iType == 0 &&
			w.level.LevelData((tx + 10 + reuna2) / KBlockSpriteSize, (ty + 20 - reuna) / KBlockSpriteSize).iType == 0)
			bp.loc.y = npy;
		else if (bt.bounce) SimBodyPartBounce(w, bp, SD_UP);
		else { vec.y = 0; SimBodyPartSetAngleAndSpeed(bp, vec); }
	}
	if (npx < bp.loc.x) {
		if (w.level.LevelData((tx + reuna) / KBlockSpriteSize, (ty + 10 - reuna2) / KBlockSpriteSize).iType == 0 &&
			w.level.LevelData((tx + reuna) / KBlockSpriteSize, (ty + 10 + reuna2) / KBlockSpriteSize).iType == 0)
			bp.loc.x = npx;
		else if (bt.bounce) SimBodyPartBounce(w, bp, SD_RIGHT);
		else { vec.x = 0; SimBodyPartSetAngleAndSpeed(bp, vec); }
	} else if (npx > bp.loc.x) {
		if (w.level.LevelData((tx + 20 - reuna) / KBlockSpriteSize, (ty + 10 - reuna2) / KBlockSpriteSize).iType == 0 &&
			w.level.LevelData((tx + 20 - reuna) / KBlockSpriteSize, (ty + 10 + reuna2) / KBlockSpriteSize).iType == 0)
			bp.loc.x = npx;
		else if (bt.bounce) SimBodyPartBounce(w, bp, SD_LEFT);
		else { vec.x = 0; SimBodyPartSetAngleAndSpeed(bp, vec); }
	}
	bp.speed += bt.slow;
}
static void SimKickBodyParts(SimWorld& w, SimPlayer& p) {
	const int lx = KCharacterSpriteSize / 2 - KBodyPartSpriteSize;
	const int rx = KCharacterSpriteSize / 2;
	for (size_t i = 0; i < w.bodyparts.size(); i++) {
		SimBodyPart& bp = w.bodyparts[i];
		if (bp.loc.x < p.location.x + lx || bp.loc.x > p.location.x + rx) continue;
		if (p.location.x + rx > bp.loc.x && p.location.x + lx < bp.loc.x &&
			p.location.y + rx > bp.loc.y && p.location.y + lx < bp.loc.y) {
			p.kick = 1;
			int ang = ((int)p.angle - 5) + w.rng.Rand() % 10;
			ANGLEFIX(ang);
			SimBodyPartKick(bp, ang);
		}
	}
}

// ===========================================================================
// Enemies
// ===========================================================================
static void SimKillEnemy(SimWorld& w, size_t index) {
	CoordI p = ToInt2(w.enemies[index].loc);
	w.deadEnemies.push_back(p);
	w.enemies.erase(w.enemies.begin() + index);
}
static void SimEnemyGotoBulletOrigin(SimWorld& w, SimEnemy& e, const SimBullet& b) {
	const EnemyType& t = gEnemies[e.type];
	int walkCounter = (int)((float)SimApproxDistance(gBullets[b.typeId]) / t.speed);
	if (t.hostile) {
		if (e.state != ES_ASSAULT) {
			int ta = b.angle + 180; ANGLEFIX(ta);
			e.targetAngle = ta; e.walkCounter = walkCounter; e.state = ES_ASSAULT;
		}
	} else {
		int ta = b.angle; ANGLEFIX(ta);
		e.targetAngle = ta; e.walkCounter = walkCounter; e.state = ES_WANDER;
	}
}
static bool SimEnemyGetDamage(SimWorld& w, SimEnemy& e, float damage, int observer) {
	const EnemyType& t = gEnemies[e.type];
	int alku = w.rng.Rand() % 7;
	float spd = 1 + e.pushPower / 1.5f;
	if (spd > 4.5f) spd = 4.5f;
	e.energy -= damage;
	if (e.energy <= 0) {
		if (e.burning && !t.explosionDeath) {
			SimSoundHeard(w, SSE_WOOSH, (int)e.loc.x, (int)e.loc.y);
			SimNewEffect(w, SE_EXPLO, e.loc.x + 12, e.loc.y + 12, 0, 0);
			SimNewEffect(w, SE_EXPLO, e.loc.x + 18, e.loc.y + 12, 0, 0);
			SimNewEffect(w, SE_EXPLO, e.loc.x + 15, e.loc.y + 18, 0, 0);
			for (int a = 0; a < 3; a++)
				SimNewBodyPart(w, e.loc.x + 4, e.loc.y + 4, w.rng.Rand() % 360, 2.5f, a + BP_BURNED);
		}
		if (!e.burning && !t.explosionDeath) {
			for (int a = 0; a < 16; a++)
				if (w.rng.Rand() % 2) SimNewEffect(w, SE_BLOOD, e.loc.x + 15, e.loc.y + 15, (int)(a * 22.5f), 2);
			for (int a = 0; a < 3; a++) {
				float spd2 = spd + (float)(w.rng.Rand() % 2) * 0.3f;
				SimNewBodyPart(w, e.loc.x + 4, e.loc.y + 4, w.rng.Rand() % 360, spd2, (a + alku) % 7);
			}
			SimSoundHeard(w, SSE_DEATH, (int)e.loc.x, (int)e.loc.y);
		}
		if (t.explosionDeath) {
			SimExplo(w, ToInt2({ e.loc.x + 4, e.loc.y + 4 }), 2, 1.0f, observer);
			for (int a = 0; a < 3; a++)
				SimNewBodyPart(w, e.loc.x + 4, e.loc.y + 4, w.rng.Rand() % 360, 3, a + BP_BURNED);
		}
		return true;
	}
	return false;
}
static void SimEnemyMove(SimWorld& w, SimEnemy& e, int aAngle, float aSpeed) {
	if (e.energy < 10 && e.walk % 4 == 0 && w.rng.Rand() % 3 == 0)
		SimNewEffect(w, SE_BLOODG, e.loc.x + 15, e.loc.y + 15, 0, 0);
	float speedi = (aSpeed == 0) ? gEnemies[e.type].speed : aSpeed;
	SimEnemyMoveChar(w, e, aAngle, speedi);
}
static void SimEnemyTargetAngle(SimEnemy& e, int aSpeed) {
	if (e.angle != (float)e.targetAngle) {
		if (e.angle < 180) {
			if (e.targetAngle < e.angle + 180 && e.targetAngle > e.angle) e.angle += aSpeed;
			else e.angle -= aSpeed;
		} else {
			if (e.targetAngle > e.angle - 180 && e.targetAngle < e.angle) e.angle -= aSpeed;
			else e.angle += aSpeed;
		}
		ANGLEFIX(e.angle);
		if (fabsf(e.angle - e.targetAngle) < aSpeed || fabsf((e.angle + 360) - e.targetAngle) < aSpeed)
			e.angle = (float)e.targetAngle;
	}
}
static void SimEnemyCheckPlayerVisibility(SimWorld& w, SimEnemy& e) {
	const EnemyType& t = gEnemies[e.type];
	int min = (int)e.angle - 90; ANGLEFIX(min);
	int maximum = (int)e.angle + 90; ANGLEFIX(maximum);
	if (e.state != ES_STILL && !t.hostile) return;

	bool seeSome = false;
	int n = (int)w.players.size();
	for (int b = 0; b < n; b++) {
		SimPlayer& pl = w.players[b];
		e.seePlayer[b] = 0;
		int goOn = 0;
		if (!pl.dead) {
			int plyAngle = (int)GetAngleF(e.loc.x, e.loc.y, pl.location.x, pl.location.y);
			if (e.angle < 270 && e.angle > 90) {
				if (plyAngle > min && plyAngle < maximum) goOn = 1;
			} else if (plyAngle > min || plyAngle < maximum) goOn = 1;
		}
		if (goOn) {
			if (GetDistF(e.loc.x + 14, e.loc.y + 14, pl.location.x + 14, pl.location.y + 14) < (float)t.sightDistance)
				if (w.level.VisibilityCheck({ e.loc.x + 14, e.loc.y + 14 }, { pl.location.x + 14, pl.location.y + 14 }, NULL)) {
					e.seePlayer[b] = 1;
					if (t.hostile) { seeSome = true; e.state = ES_ASSAULT; }
					else { e.state = ES_WANDER; return; }
				}
		}
	}
	if (seeSome) {
		int closest = -1;
		for (int b = 0; b < n && closest < 0; b++)
			if (!w.players[b].dead) if (e.seePlayer[b]) closest = b;
		for (int b = 0; b < n; b++) {
			SimPlayer& pl = w.players[b];
			if (pl.dead || !e.seePlayer[b]) continue;
			SimPlayer& cur = w.players[closest];
			if (GetDistF(pl.location.x, pl.location.y, e.loc.x, e.loc.y) < GetDistF(cur.location.x, cur.location.y, e.loc.x, e.loc.y))
				closest = b;
		}
		SimPlayer& cl = w.players[closest];
		e.targetAngle = (int)GetAngleF(e.loc.x, e.loc.y, cl.location.x, cl.location.y);
	} else {
		if (e.state != ES_STILL) e.state = ES_WANDER;
	}
}
static void SimEnemyShoot(SimWorld& w, SimEnemy& e) {
	const WeaponType& wp = gWeapons[e.curWeapon];
	e.fire = 1; e.loadCounter = 0;
	int ia = (int)e.angle;
	for (int a = 0; a < wp.bulletAmount; a++) {
		int r = (wp.angleAdd / 2) - w.rng.Rand() % wp.angleAdd;
		CoordF sp = AddMovF({ e.loc.x + 14, e.loc.y + 14 }, ia, 10.0f);
		SimNewBullet(w, wp.bulletType, sp, ia + r, 0, 1.0f / wp.bulletAmount, SimEnemyOwnerId(e));
	}
	if (e.shootCount % gBullets[wp.bulletType].multiplier == 0) {
		SimSoundHeard(w, wp.sound, (int)e.loc.x, (int)e.loc.y);
		if (wp.smoke) {
			CoordF p = AddMovF({ e.loc.x + 14, e.loc.y + 14 }, ia, 8.0f);
			p = AddMovF(p, ia + 90, 5.0f);
			SimNewEffect(w, SE_GUNSMOKE, p.x, p.y, ia, 1.0f);
		}
	}
}
static void SimEnemyCheckForShoot(SimWorld& w, SimEnemy& e) {
	int wannashoot = 0;
	const WeaponType& wp = gWeapons[e.curWeapon];
	for (int a = 0; a < (int)w.players.size(); a++) {
		SimPlayer& pl = w.players[a];
		if (e.seePlayer[a] && abs((int)(e.targetAngle - e.angle)) < 10) {
			e.walkCounter = (int)(20 / gEnemies[e.type].speed);
			int dist = (int)GetDistF(e.loc.x + 14, e.loc.y + 14, pl.location.x + 14, pl.location.y + 14);
			if (dist <= SimApproxDistance(gBullets[wp.bulletType]) + 20) {
				e.shootCount++;
				wannashoot = 1;
				if (e.loadCounter == wp.loadingTime) SimEnemyShoot(w, e);
			}
		}
	}
	if (!wannashoot) e.shootCount = 0;
}
static void SimEnemyCheck(SimWorld& w, SimEnemy& e) {
	SimEnemyCheckPlayerVisibility(w, e);
	if (gEnemies[e.type].hostile) {
		SimEnemyCheckForShoot(w, e);
		if (e.loadCounter < gWeapons[e.curWeapon].loadingTime) e.loadCounter++;
	}
}
static void SimEnemyAnimate(SimEnemy& e) {
	e.anim = 1;
	if (e.walk) {
		if (e.walk - 1 < KWalkAnimationDelay) e.walk++;
		else e.walk = 1;
		e.anim = (e.walk - 1) / (KWalkAnimationDelay / 4);
		if (e.anim >= 3) e.anim = 1;
	}
	if (e.fire) { e.fire++; if (e.fire > 6) e.fire = 0; e.anim = 3; }
	if (e.energy < 10) e.anim += 4;
}
static void SimEnemyDecideAndMove(SimWorld& w, SimEnemy& e) {
	const EnemyType& t = gEnemies[e.type];
	if (t.hostile)
		for (int b = 0; b < (int)w.players.size() && e.state != ES_ASSAULT; b++)
			if (e.seePlayer[b]) e.state = ES_ASSAULT;

	if (e.state == ES_WANDER && !e.walkCounter && w.rng.Rand() % 125 == 1)
		e.walkCounter = (w.rng.Rand() % 40) + 20;

	if (e.walkCounter > 0) { SimEnemyMove(w, e, (int)e.angle, 0); e.walkCounter--; if (e.walk == 0) e.walk = 1; }
	else e.walk = 0;

	if (e.targetAngle == e.angle && !e.walkCounter) {
		if (e.state == ES_WANDER || e.state == ES_STILL)
			if (w.rng.Rand() % 50 == 1) e.targetAngle = w.rng.Rand() % 360;
	}
	SimEnemyTargetAngle(e, KEnemyRotSpeedInt);
}
static void SimEnemyUpdate(SimWorld& w) {
	for (size_t i = 0; i < w.enemies.size(); i++) {
		SimEnemy& e = w.enemies[i];
		SimEnemyDecideAndMove(w, e);
		if (e.pushPower > 0) { SimEnemyMove(w, e, e.pushAngle, e.pushPower); e.pushPower -= 0.075f; }
		SimEnemyCheck(w, e);
		SimEnemyAnimate(e);
	}
}
static bool SimEnemyCheckBurning(SimWorld& w, SimEnemy& e) {
	if (e.burning) {
		e.burning--;
		if ((w.steamAnimationCount % 15) == 0) SimNewEffect(w, SE_STEAM, e.loc.x + 14, e.loc.y + 14, 315, 1);
		int mod = 3;
		if (e.burning > 150) mod = 2;
		if ((w.steamAnimationCount % mod) == 0) {
			float yy = e.loc.y + (float)(10 + w.rng.Rand() % 8);
			float xx = e.loc.x + (float)(10 + w.rng.Rand() % 8);
			SimNewEffect(w, SE_FLAME2, xx, yy, 315, 1);
		}
		return SimEnemyGetDamage(w, e, 0.1f, e.fryingObserver);
	}
	return false;
}
static void SimPlayerCheckBurning(SimWorld& w, SimPlayer& p) {
	if (p.burning) {
		p.burning--;
		if ((w.steamAnimationCount % 15) == 0) SimNewEffect(w, SE_STEAM, p.location.x + 14, p.location.y + 14, 315, 1);
		int mod = 3;
		if (p.burning > 150) mod = 2;
		if ((w.steamAnimationCount % mod) == 0) {
			float yy = p.location.y + (float)(10 + w.rng.Rand() % 8);
			float xx = p.location.x + (float)(10 + w.rng.Rand() % 8);
			SimNewEffect(w, SE_FLAME2, xx, yy, 315, 1);
		}
		SimGetDamage(w, p, 0.1f, p.fryingObserver);
	}
}
static void SimCheckBurn(SimWorld& w) {
	for (size_t i = 0; i < w.players.size(); i++)
		if (!w.players[i].dead) SimPlayerCheckBurning(w, w.players[i]);
	for (size_t i = 0; i < w.enemies.size();) {
		if (SimEnemyCheckBurning(w, w.enemies[i])) SimKillEnemy(w, i);
		else i++;
	}
}

// ===========================================================================
// Effects
// ===========================================================================
static int SimEffectRoll(SimWorld& w, SimFx& e, int amount) {
	const EffectType& t = gEffects[e.type];
	int mul = 1;
	if (amount > KLightOverloadLimit) {
		if (amount > KHeavyOverloadLimit) mul = t.heavyOLMul;
		else mul = t.lightOLMul;
	}
	if (e.counter < t.tCount * t.delay) {
		if (!t.random) e.counter += mul;
		else e.counter += w.rng.Rand() % (mul * 3);
	}
	int die = 0;
	if (e.counter >= t.tCount * t.delay) die = 1;
	if ((e.vec.x != 0 || e.vec.y != 0) && !die) {
		e.loc.x += e.vec.x;
		e.loc.y += e.vec.y;
		if (w.level.Collision((int)(e.loc.x / KBlockSpriteSize), (int)(e.loc.y / KBlockSpriteSize))) die = 1;
	}
	if (die && t.afterDeath != SE_NONE)
		SimNewEffect(w, t.afterDeath, e.loc.x, e.loc.y, 0, 0);
	return die;
}
static void SimRollEffects(SimWorld& w) {
	int amount = (int)w.effects.size();
	for (size_t i = 0; i < w.effects.size();) {
		if (SimEffectRoll(w, w.effects[i], amount)) w.effects.erase(w.effects.begin() + i);
		else i++;
	}
	w.steamAnimationCount++;
}

// ===========================================================================
// Crates
// ===========================================================================
static void SimCrateMoveText(SimWorld& w, SimCrate& c) {
	if (c.textCounter > 0) {
		c.textPos = AddMovF(c.textPos, c.textAngle, c.textCounter2);
		c.textCounter -= c.textCounter2;
		c.textCounter2 += 0.05f;
		if (c.textCounter <= 0) {
			c.inUse = 0;
			if (w.crateRespawn) c.wakeUpCounter = 1;
		}
	}
}
static void SimMoveCrateTexts(SimWorld& w) {
	for (size_t i = 0; i < w.crates.size(); i++)
		if (w.crates[i].inUse && w.crates[i].textCounter > 0) SimCrateMoveText(w, w.crates[i]);
}
static int SimCrateTextLen(SimWorld& w, const SimCrate& c) {
	char buf[64];
	switch (c.kind) {
	case CK_WEAPON: strncpy(buf, gWeapons[c.value + 1].name, 63); buf[63] = 0; break;
	case CK_BULLET: strncpy(buf, gBullets[c.value + 1].name, 63); buf[63] = 0; break;
	case CK_HEALTH: strcpy(buf, "energy"); break;
	case CK_MONEY: snprintf(buf, 64, "money (%d)", c.value); break;
	default: strcpy(buf, "target system"); break;
	}
	return w.font.Length(buf);
}
static void SimCrateTaken(SimWorld& w, SimCrate& c, SimPlayer& p, const RectI& drawRect) {
	int len = SimCrateTextLen(w, c);
	int tx = c.loc.x + 7 - len - p.screenPos.x;
	int ty = c.loc.y + 7 - p.screenPos.y;
	c.textPos.x = (float)tx; c.textPos.y = (float)ty;
	int bx = drawRect.l + 10;
	int by = drawRect.b - 20;
	c.textCounter = GetDistF((float)tx, (float)ty, (float)bx, (float)by) + 1.0f;
	c.textAngle = (int)GetAngleF((float)tx, (float)ty, (float)bx, (float)by);
}
static void SimCrateTryPickup(SimWorld& w, SimCrate& c, SimPlayer& p, const RectI& drawRect) {
	switch (c.kind) {
	case CK_WEAPON: {
		int wi = c.value + 1;
		int maxw = gWeapons[wi].singleHand ? 2 : 1;
		if (p.weapons[wi] < maxw) { p.weapons[wi]++; SimCrateTaken(w, c, p, drawRect); }
		break;
	}
	case CK_BULLET: {
		int bi = c.value + 1;
		int maxb = gBullets[bi].maxForPlayer * gBullets[bi].multiplier;
		if (p.bullets[bi] < maxb) {
			p.bullets[bi] += gBullets[bi].amountInCrate;
			if (p.bullets[bi] > maxb) p.bullets[bi] = maxb;
			SimCrateTaken(w, c, p, drawRect);
		}
		break;
	}
	case CK_HEALTH: {
		int maxe = KPlayerMaxEnergy + p.shield * KShieldEnergyAmount;
		if (p.energy < (float)maxe) {
			p.energy += 40;
			if (p.energy > (float)maxe) p.energy = (float)maxe;
			SimCrateTaken(w, c, p, drawRect);
		}
		break;
	}
	case CK_MONEY:
		SimCrateTaken(w, c, p, drawRect);
		p.cash += c.value;
		break;
	default:
		if (!p.targetSystem) { p.targetSystem = true; SimCrateTaken(w, c, p, drawRect); }
		break;
	}
}
static void SimPickupCrates(SimWorld& w, SimPlayer& p, const RectI& drawRect) {
	if (p.dead != 0) return;
	for (size_t i = 0; i < w.crates.size(); i++) {
		SimCrate& c = w.crates[i];
		if (c.inUse && c.textCounter == 0 &&
			c.loc.x + 7 > p.location.x && c.loc.x + 7 < p.location.x + KCharacterSpriteSize &&
			c.loc.y + 7 > p.location.y && c.loc.y + 7 < p.location.y + KCharacterSpriteSize)
			SimCrateTryPickup(w, c, p, drawRect);
	}
}
static void SimChkWakeUps(SimWorld& w) {
	for (size_t i = 0; i < w.crates.size(); i++) {
		SimCrate& c = w.crates[i];
		if (c.inUse != 0) continue;
		if (c.wakeUpCounter > 0) {
			c.wakeUpCounter++;
			if (c.wakeUpCounter >= KCrateWakeupDelay) {
				SimNewEffect(w, SE_TELEPORT, (float)(c.loc.x + 8), (float)(c.loc.y + 8), 0, 0);
				c.textCounter = 0; c.textCounter2 = 0; c.inUse = 1; c.wakeUpCounter = 0;
			}
		}
	}
}
static int SimCheckCratePlace(SimWorld& w, int x, int y, int size) {
	if ((y + size) / KBlockSpriteSize >= w.level.iHeight) return 1;
	if ((x + size) / KBlockSpriteSize >= w.level.iWidth) return 1;
	if (w.level.LevelData(x / KBlockSpriteSize, y / KBlockSpriteSize).iType != 0) return 1;
	if (w.level.LevelData(x / KBlockSpriteSize, (y + size) / KBlockSpriteSize).iType != 0) return 1;
	if (w.level.LevelData((x + size) / KBlockSpriteSize, y / KBlockSpriteSize).iType != 0) return 1;
	if (w.level.LevelData((x + size) / KBlockSpriteSize, (y + size) / KBlockSpriteSize).iType != 0) return 1;
	for (size_t i = 0; i < w.players.size(); i++)
		if (w.players[i].local && GetDistF((float)x, (float)y, w.players[i].location.x, w.players[i].location.y) < 50) return 1;
	return 0;
}
static void SimPlaceGameCrates(SimWorld& w) {
	for (size_t i = 0; i < w.level.iPlacedCratesNormal.size(); i++) {
		const Level::CrateCoord& c = w.level.iPlacedCratesNormal[i];
		SimNewCrate(w, c.x, c.y, c.type1, c.type2);
	}
	int W = w.level.iWidth * KBlockSpriteSize;
	int H = w.level.iHeight * KBlockSpriteSize;
	for (size_t i = 0; i < w.level.iRandomCratesNormal.size(); i++) {
		const Level::RandomCrate& rc = w.level.iRandomCratesNormal[i];
		for (int b = 0; b < rc.amount; b++) {
			int x = 0, y = 0;
			do {
				x = w.rng.Rand() % W;
				y = w.rng.Rand() % H;
			} while (SimCheckCratePlace(w, x, y, 14));
			SimNewCrate(w, x, y, rc.type1, rc.type2);
		}
	}
}
static bool SimTestEnemyLocation(SimWorld& w, int x, int y, bool strict) {
	int plyDist = strict ? KCharacterSpriteSize * 5 : KCharacterSpriteSize;
	if (!w.level.Reachable((x + 10) / KBlockSpriteSize, (y + 10) / KBlockSpriteSize)) return false;
	for (size_t i = 0; i < w.enemies.size(); i++)
		if (GetDistF((float)x, (float)y, w.enemies[i].loc.x, w.enemies[i].loc.y) < 18) return false;
	if (!strict) {
		for (size_t i = 0; i < w.level.iPlStart.size(); i++)
			if (GetDistF((float)x, (float)y, (float)(w.level.iPlStart[i].x * KBlockSpriteSize), (float)(w.level.iPlStart[i].y * KBlockSpriteSize)) < KBlockSpriteSize)
				return false;
	}
	for (size_t i = 0; i < w.players.size(); i++)
		if (GetDistF((float)x, (float)y, w.players[i].location.x, w.players[i].location.y) < (float)plyDist) return false;
	return true;
}
static bool SimPlaceEnemy(SimWorld& w, int type) {
	int nx = 0, ny = 0, tryno = 0;
	for (;;) {
		tryno++;
		if (tryno >= KTooManyTries) return true;
		nx = (w.rng.Rand() % (w.level.iWidth - 2)) + 1;
		ny = (w.rng.Rand() % (w.level.iHeight - 2)) + 1;
		if (SimTestEnemyLocation(w, nx * KBlockSpriteSize, ny * KBlockSpriteSize, true)) break;
	}
	SimNewEnemy(w, type, false, nx * KBlockSpriteSize, ny * KBlockSpriteSize, w.rng.Rand() % 360);
	return false;
}
static void SimInitEnemies(SimWorld& w) {
	for (size_t i = 0; i < w.level.iEnemy.size(); i++) {
		const Level::EnemyCoord& en = w.level.iEnemy[i];
		if (SimTestEnemyLocation(w, en.x, en.y, false))
			SimNewEnemy(w, en.type, true, en.x, en.y, w.rng.Rand() % 360);
	}
	bool randFuckUp = false;
	for (int b = 0; b < EN_AMOUNT && !randFuckUp; b++) {
		int count = w.level.iGeneralEnemies[b];
		for (int a = 0; a < count && !randFuckUp; a++) randFuckUp = SimPlaceEnemy(w, b);
	}
}
static void SimSpawnEntities(SimWorld& w) {
	SimInitEnemies(w);
	SimPlaceGameCrates(w);
}
static void SimShowSteam(SimWorld& w, const RectI& drawRect) {
	const int buffer = 100;
	int halfW = (drawRect.r - drawRect.l) / 2;
	int halfH = (drawRect.b - drawRect.t) / 2;
	for (size_t s = 0; s < w.level.iSteams.size(); s++) {
		const Level::SteamCoord& sc = w.level.iSteams[s];
		bool du = false;
		for (size_t a = 0; a < w.players.size(); a++) {
			SimPlayer& p = w.players[a];
			if (!p.local) continue;
			int l = (int)(p.location.x - halfW - buffer);
			int t = (int)(p.location.y - halfH - buffer);
			int r = (int)(p.location.x + halfW + buffer);
			int b = (int)(p.location.y + halfH + buffer);
			if (sc.x >= l && sc.x < r && sc.y >= t && sc.y < b) { du = true; break; }
		}
		if (du) {
			int rate = (sc.speed < 8) ? KSteamRates[sc.speed] : 1;
			if ((w.steamAnimationCount % rate) == 0) {
				int ang = sc.angle - 3 + w.rng.Rand() % 6;
				float sp = (float)(sc.speed / 2) * 0.75f;
				SimNewEffect(w, SE_STEAM, (float)sc.x, (float)sc.y, ang, sp);
			}
		}
	}
}
static void SimPerFrameCalc(SimWorld& w) {
	int amount = (int)w.effects.size() + (int)w.newEffects.size();
	if (amount > KMaxEffectsInGame) {
		int drop = amount - KMaxEffectsInGame;
		if (drop > (int)w.effects.size()) drop = (int)w.effects.size();
		w.effects.erase(w.effects.begin(), w.effects.begin() + drop);
	}
	for (size_t i = 0; i < w.newEffects.size(); i++) w.effects.push_back(w.newEffects[i]);
	w.newEffects.clear();

	std::stable_sort(w.enemies.begin(), w.enemies.end(),
		[](const SimEnemy& a, const SimEnemy& b) { return a.loc.x < b.loc.x; });
	std::stable_sort(w.bodyparts.begin(), w.bodyparts.end(),
		[](const SimBodyPart& a, const SimBodyPart& b) { return a.loc.x < b.loc.x; });

	for (size_t i = 0; i < w.bullets.size();) {
		// SimMoveBullet can append bullets (SimExplo), which may reallocate the
		// vector; work on a copy and write it back so no reference dangles.
		SimBullet b = w.bullets[i];
		if (SimMoveBullet(w, b)) w.bullets.erase(w.bullets.begin() + i);
		else { w.bullets[i] = b; i++; }
	}
	for (size_t i = 0; i < w.bodyparts.size(); i++) SimBodyPartMove(w, w.bodyparts[i]);
	SimMoveCrateTexts(w);
}

// ---- per-tick world update (mirrors CGameSubStateOngoing::RunFrame inner loop) ----
static void SimTick(SimWorld& w, const SimInput& in, const RectI& drawRect) {
	// CheckUserInput: player keys, then the mouse owner
	for (size_t i = 0; i < w.players.size(); i++)
		if (w.players[i].local && !w.players[i].dead)
			SimPlayerCheckKeys(w, (int)i, w.players[i], in, drawRect);

	if (w.mouseOwner >= 0 && !w.players[w.mouseOwner].dead) {
		float temp = (float)in.mouseXRel * w.mouseSensitivity;
		if (temp < -15) temp = -15;
		if (temp > 15) temp = 15;
		SimRotate(w.players[w.mouseOwner], temp);
		if (in.mouseButtons & SM_WHEEL_DOWN) SimChangeWeapon(w.players[w.mouseOwner], false);
		if (in.mouseButtons & SM_WHEEL_UP) SimChangeWeapon(w.players[w.mouseOwner], true);
	}

	// LevelRuntimeData::PerFrameCalc
	SimPerFrameCalc(w);

	// PushPlayers (local players only)
	for (size_t i = 0; i < w.players.size(); i++) {
		SimPlayer& p = w.players[i];
		if (!p.local) continue;
		if (p.pushPower > 0) {
			SimPlayerMove(w, p, p.pushAngle, p.pushPower, drawRect);
			p.pushPower -= 0.075f;
		}
	}

	// CheckBurn
	SimCheckBurn(w);

	// ChkWakeUps
	if (w.crateRespawn) SimChkWakeUps(w);

	// MoveScr + LoadWeapons (local players)
	for (size_t i = 0; i < w.players.size(); i++)
		if (w.players[i].local) {
			SimMoveScr(w.players[i], drawRect);
			SimLoadWeapons(w.players[i]);
		}

	// AnimatePlayers (local players)
	for (size_t i = 0; i < w.players.size(); i++)
		if (w.players[i].local) SimPlayerAnimate(w.players[i]);

	// EnemyUpdate
	SimEnemyUpdate(w);

	// DecHits (local players)
	for (size_t i = 0; i < w.players.size(); i++)
		if (w.players[i].local) SimDecHits(w.players[i]);

	// ShowSteam
	SimShowSteam(w, drawRect);

	// RollEffects
	SimRollEffects(w);
}

#endif
