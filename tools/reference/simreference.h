// Shared simulation reference for the Tapan Kaikki 4 -> TypeScript port (M3).
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
	bool local = true;
};

struct SimWorld {
	Level level;
	GlibcRandom rng;
	std::vector<SimPlayer> players;
	std::vector<SimBullet> bullets;
	int mouseOwner = -1;
	float mouseSensitivity = 0.5f;
	bool mouseRightPressed = false;
	bool coopFrags = false;
	bool networkNone = true;
	int steamAnimationCount = 0;
	long effectSpawns = 0;
};

// forward decls
static void SimNewEffect(SimWorld&, int type, float x, float y, int angle, float speed);
static void SimNewBullet(SimWorld&, int type, CoordF pos, int angle, int timeAdd, float share, int owner);
static void SimGetDamage(SimWorld&, SimPlayer&, float damage, int observer);
static void SimExplo(SimWorld&, CoordI pos, int size, float share, int owner);
static int SimMoveBullet(SimWorld&, SimBullet&);
static bool SimCollision(SimWorld&, CoordI p);
static bool SimVisibility(SimWorld&, CoordF src, CoordF dst, CoordF* out);
static bool SimCharCollision(SimWorld&, int l, int t, int r, int b, const SimPlayer* self);

static void SimNewEffect(SimWorld& w, int type, float x, float y, int angle, float speed) {
	if (type == SE_NONE) return;
	float w2 = (float)(w.level.iWidth * KBlockSpriteSize);
	float h2 = (float)(w.level.iHeight * KBlockSpriteSize);
	if (x >= 0 && x < w2 && y >= 0 && y < h2) w.effectSpawns++;
	(void)angle; (void)speed;
}

static bool SimCollision(SimWorld& w, CoordI p) { return w.level.Collision(p.x, p.y); }
static bool SimVisibility(SimWorld& w, CoordF src, CoordF dst, CoordF* out) {
	return w.level.VisibilityCheck(src, dst, out);
}

static bool SimCharCollision(SimWorld& w, int l, int t, int r, int b, const SimPlayer* self) {
	for (size_t i = 0; i < w.players.size(); i++) {
		SimPlayer& pl = w.players[i];
		if (&pl == self) continue;
		if (pl.dead) continue;
		CoordI p = ToInt2(pl.location);
		if (p.x >= l && p.x < r && p.y >= t && p.y < b) return true;
	}
	return false;
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
	// body parts: none in M3.
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
					newPos = AddMovF(b.location, b.angle, b.speed / loopTimes);
				}
			}
			b.location = newPos;
			rpos = ToInt2(b.location);
		}

		if (b.counter > t.sleepTime && !hitwall) {
			for (size_t bi = 0; bi < w.players.size(); bi++) {
				SimPlayer& pl = w.players[bi];
				CoordI loc = ToInt2(pl.location);
				int l = loc.x + 5, tt = loc.y + 5, r = loc.x + 22, bb = loc.y + 22;
				bool inside = rpos.x >= l && rpos.x < r && rpos.y >= tt && rpos.y < bb;
				bool selfOk = (b.ownerId != (int)bi) || (t.type != BK_INCENDIARY && t.type != BK_FIST);
				if (!pl.dead && inside && selfOk) {
					hit = true;
					vpos = ToInt2(AddMovF({ (float)(loc.x + 14), (float)(loc.y + 14) }, b.angle, 4));
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
	}

	if ((t.type == BK_NORMAL || t.type == BK_FIST) && (b.time == 0 || hitwall) && !hit && t.speed > 10)
		SimNewEffect(w, SE_SMOKE, (float)rpos.x, (float)rpos.y, 0, 0);

	if ((t.collisionTrigger && (hit || hitwall)) || b.time == 0) {
		if (t.type == BK_EXPLOSIVE) {
			CoordI ep = ToInt2(AddMovF(b.location, b.angle, -1.0f));
			SimExplo(w, ep, t.explosion, b.share, b.ownerId);
		}
		return 1;
	}

	// Effect / Effect2 (arguments evaluated even when the effect is NoEffect).
	{
		// DoEffect default == true.
		int ea = (t.effectKind == EK_ROCKET) ? (b.angle + 90 + w.rng.Rand() % 180) : (t.effectKind == EK_RAY ? b.angle + 180 : b.angle);
		float es = (t.effectKind == EK_ROCKET) ? 0.1f : (t.effectKind == EK_RAY ? (float)(w.rng.Rand() % 2) : 0.0f);
		bool doE = (t.effectKind != EK_ROCKET) || (b.counter % 2 == 0);
		if (doE) SimNewEffect(w, t.effect, (float)rpos.x, (float)rpos.y, ea, es);
	}
	{
		int ea2 = b.angle; // default Effect2Angle
		float es2 = 0.0f;
		// DoEffect2 default == true
		SimNewEffect(w, t.effect2, (float)rpos.x, (float)rpos.y, ea2, es2);
	}

	if (b.speed > 0) b.speed += t.slow;
	if (b.speed < 0) b.speed = 0;

	b.spriteAngle += b.spriteAngleAdd;
	ANGLEFIX(b.spriteAngle);
	if (b.spriteAngleAdd > 0) b.spriteAngleAdd -= 0.4f;
	if (b.spriteAngleAdd < 0) b.spriteAngleAdd += 0.4f;
	if (b.spriteAngleAdd >= -0.4f && b.spriteAngleAdd <= 0.4f) b.spriteAngleAdd = 0;

	return 0;
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

static void SimFootprint(SimWorld& w, SimPlayer& p, int side) {
	CoordI fp = ToInt2(AddMovF({ p.location.x + 15, p.location.y + 15 }, (int)p.angle + 90 + side * 180, 4.0f));
	if (w.level.LevelData(fp.x / KBlockSpriteSize, fp.y / KBlockSpriteSize).iType == 0)
		if (w.level.DustBlock(fp.x / KBlockSpriteSize, fp.y / KBlockSpriteSize))
			SimNewEffect(w, SE_FOOTPRINT, (float)fp.x, (float)fp.y, 0, 0);
}

// CCharacter::Move
static void SimCharMove(SimWorld& w, SimPlayer& p, int aAngle, float aSpeed) {
	const int reuna = 6, reuna2 = 4;
	if (p.walk == (int)(KWalkAnimationDelay * 0.25) || p.walk == (int)(KWalkAnimationDelay * 0.75)) SimFootprint(w, p, 0);
	if (p.walk == (int)(KWalkAnimationDelay * 0.5) || p.walk == KWalkAnimationDelay - 1) SimFootprint(w, p, 1);

	CoordF newpos = AddMovF(p.location, aAngle, aSpeed);
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

	if (newpos.y < p.location.y &&
		w.level.LevelData(bp[0].x, bp[0].y).iType == 0 && w.level.LevelData(bp[1].x, bp[1].y).iType == 0) {
		if (!SimCharCollision(w, testpos.x - 15, testpos.y + 2 * reuna - KCharacterSpriteSize, testpos.x + 15, testpos.y, &p)) {
			if (newpos.y < 0) p.location.y = 0; else p.location.y = newpos.y;
		}
	}
	if (newpos.y > p.location.y &&
		w.level.LevelData(bp[2].x, bp[2].y).iType == 0 && w.level.LevelData(bp[3].x, bp[3].y).iType == 0) {
		if (!SimCharCollision(w, testpos.x - 15, testpos.y, testpos.x + 15, testpos.y + KCharacterSpriteSize - 2 * reuna, &p)) {
			if (newpos.y > w.level.iHeight * KBlockSpriteSize - KCharacterSpriteSize) p.location.y = (float)(w.level.iHeight * KBlockSpriteSize - KCharacterSpriteSize);
			else p.location.y = newpos.y;
		}
	}
	if (newpos.x < p.location.x &&
		w.level.LevelData(bp[4].x, bp[4].y).iType == 0 && w.level.LevelData(bp[5].x, bp[5].y).iType == 0) {
		if (!SimCharCollision(w, testpos.x + 2 * reuna - KCharacterSpriteSize, testpos.y - 15, testpos.x, testpos.y + 15, &p)) {
			if (newpos.x < 0) p.location.x = 0; else p.location.x = newpos.x;
		}
	}
	if (newpos.x > p.location.x &&
		w.level.LevelData(bp[6].x, bp[6].y).iType == 0 && w.level.LevelData(bp[7].x, bp[7].y).iType == 0) {
		if (!SimCharCollision(w, testpos.x, testpos.y - 15, testpos.x + KCharacterSpriteSize - 2 * reuna, testpos.y + 15, &p)) {
			if (newpos.x > w.level.iWidth * KBlockSpriteSize - KCharacterSpriteSize) p.location.x = (float)(w.level.iWidth * KBlockSpriteSize - KCharacterSpriteSize);
			else p.location.x = newpos.x;
		}
	}
}

static void SimPlayerMove(SimWorld& w, SimPlayer& p, int aAngle, float aSpeed) {
	// CPlayer::Move blood effect while hurt.
	if (p.energy < 20 && p.walk % 4 == 0 && w.rng.Rand() % 3 == 0)
		SimNewEffect(w, SE_BLOODG, p.location.x + 15, p.location.y + 15, 0, 0);
	SimCharMove(w, p, aAngle, aSpeed);
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

	if (in.keys & SK_UP) { forward = SD_UP; walk_chk = 1; if (w.rng.Rand() % 40 == 0) { /* KickBodyParts: none */ } }
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
	if (speedi != 0) SimPlayerMove(w, p, FAngle, speedi);

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
			if (p.loadCounter >= gWeapons[p.curWeapon].loadingTime) SimShoot(w, p, 1, index);
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

// ---- per-tick world update (mirrors CGameSubStateOngoing::RunFrame inner loop) ----
static void SimTick(SimWorld& w, const SimInput& in, const RectI& drawRect) {
	// CheckUserInput: player keys
	for (size_t i = 0; i < w.players.size(); i++)
		if (w.players[i].local && !w.players[i].dead)
			SimPlayerCheckKeys(w, (int)i, w.players[i], in, drawRect);

	// CheckUserInput: mouse rotation for the mouse owner
	if (w.mouseOwner >= 0 && !w.players[w.mouseOwner].dead) {
		float temp = (float)in.mouseXRel * w.mouseSensitivity;
		if (temp < -15) temp = -15;
		if (temp > 15) temp = 15;
		SimRotate(w.players[w.mouseOwner], temp);
		if (in.mouseButtons & SM_WHEEL_DOWN) SimChangeWeapon(w.players[w.mouseOwner], false);
		if (in.mouseButtons & SM_WHEEL_UP) SimChangeWeapon(w.players[w.mouseOwner], true);
	}

	// CLevelRuntimeData::PerFrameCalc — sort (none), move bullets
	for (size_t i = 0; i < w.bullets.size();) {
		if (SimMoveBullet(w, w.bullets[i])) w.bullets.erase(w.bullets.begin() + i);
		else i++;
	}

	// PushPlayers (local players only)
	for (size_t i = 0; i < w.players.size(); i++) {
		SimPlayer& p = w.players[i];
		if (!p.local) continue;
		if (p.pushPower > 0) {
			SimPlayerMove(w, p, p.pushAngle, p.pushPower);
			p.pushPower -= 0.075f;
		}
	}

	// CheckBurn (burning only, no-op when not burning)
	for (size_t i = 0; i < w.players.size(); i++) {
		SimPlayer& p = w.players[i];
		if (p.dead) continue;
		if (p.burning) {
			p.burning--;
			if ((w.steamAnimationCount % 15) == 0) SimNewEffect(w, SE_STEAM, p.location.x + 14, p.location.y + 14, 315, 1);
			int mod = 3;
			if (p.burning > 150) mod = 2;
			if ((w.steamAnimationCount % mod) == 0) {
				// Location().Add(10+rand()%8, 10+rand()%8): right-to-left → y then x.
				float yy = p.location.y + (float)(10 + w.rng.Rand() % 8);
				float xx = p.location.x + (float)(10 + w.rng.Rand() % 8);
				SimNewEffect(w, SE_FLAME2, xx, yy, 315, 1);
			}
			SimGetDamage(w, p, 0.1f, p.fryingObserver);
		}
	}

	// MoveScr + LoadWeapons (local players)
	for (size_t i = 0; i < w.players.size(); i++)
		if (w.players[i].local) {
			SimMoveScr(w.players[i], drawRect);
			SimLoadWeapons(w.players[i]);
		}

	// AnimatePlayers (local players)
	for (size_t i = 0; i < w.players.size(); i++)
		if (w.players[i].local) SimPlayerAnimate(w.players[i]);

	// EnemyUpdate: none (M4)

	// DecHits (local players)
	for (size_t i = 0; i < w.players.size(); i++)
		if (w.players[i].local) SimDecHits(w.players[i]);

	// ShowSteam: no steam spots in M3.

	// RollEffects (M4): only the animation counter is maintained here.
	w.steamAnimationCount++;
}

#endif
