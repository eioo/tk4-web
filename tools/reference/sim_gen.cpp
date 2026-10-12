// SPDX-License-Identifier: GPL-2.0-only
// Derived from Tapan Kaikki 4 (GPLv2); see LICENSE.

// Reference oracle for the simulation (player movement, shooting, bullets).
// The algorithms live in simreference.h (near-verbatim copies of the original);
// this file is the CLI.
//
// Build:  g++ -O2 -o sim_gen sim_gen.cpp -lm
// Modes:
//   sim_gen math   <out.raw>
//     dumps 360 sine then 360 cosine floats (little-endian f32) for CMath checks.
//   sim_gen replay <leveldump.bin> <script.bin> <out.trace>
//     runs the scripted tick replay and writes a per-tick state trace.
//
// The level dump format matches tools/reference/render_gen.cpp.

#include "simreference.h"

static unsigned char* ReadAll(const char* path, long* len) {
	FILE* f = fopen(path, "rb");
	if (!f) { fprintf(stderr, "cannot open %s\n", path); return NULL; }
	fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
	unsigned char* buf = (unsigned char*)malloc(n);
	size_t rd = fread(buf, 1, n, f); (void)rd; fclose(f);
	*len = n; return buf;
}

struct Script {
	int seed = 0;
	int ticks = 0;
	std::string levelName;
	float sensitivity = 0.5f;
	int mouseOwner = 0;
	std::vector<SimPlayer> players;
	std::vector<SimInput> inputs;
};

static bool ReadScript(const char* path, Script& s) {
	long len = 0;
	unsigned char* buf = ReadAll(path, &len);
	if (!buf) return false;
	unsigned char* p = buf;
	auto readI32 = [&]() { int v; memcpy(&v, p, 4); p += 4; return v; };
	auto readU32 = [&]() { unsigned int v; memcpy(&v, p, 4); p += 4; return v; };
	auto readF32 = [&]() { float v; memcpy(&v, p, 4); p += 4; return v; };

	unsigned int version = readU32(); (void)version;
	s.seed = readI32();
	s.ticks = (int)readU32();
	unsigned int nameLen = readU32();
	s.levelName.assign((char*)p, nameLen); p += nameLen;
	s.sensitivity = readF32();
	s.mouseOwner = readI32();
	unsigned int playerCount = readU32();
	for (unsigned int i = 0; i < playerCount; i++) {
		SimPlayer pl;
		pl.location.x = readF32(); pl.location.y = readF32();
		pl.angle = readF32(); pl.energy = readF32();
		pl.local = readI32() != 0;
		for (int a = 0; a < W_AMOUNT; a++) pl.weapons[a] = readI32();
		for (int a = 0; a < B_AMOUNT; a++) pl.bullets[a] = readI32();
		s.players.push_back(pl);
	}
	for (int t = 0; t < s.ticks; t++) {
		SimInput in;
		in.keys = readU32();
		in.mouseXRel = readI32();
		in.mouseButtons = readU32();
		s.inputs.push_back(in);
	}
	free(buf);
	return true;
}

static bool ReadLevelDump(Level& lv, const char* path) {
	long len = 0;
	unsigned char* buf = ReadAll(path, &len);
	if (!buf) return false;
	unsigned char* p = buf;
	auto readI32 = [&]() { int v; memcpy(&v, p, 4); p += 4; return v; };
	auto readU32 = [&]() { unsigned int v; memcpy(&v, p, 4); p += 4; return v; };

	unsigned int version = readU32();
	unsigned int w = readU32(), h = readU32();
	lv.iWidth = (int)w; lv.iHeight = (int)h;
	lv.blocks.resize((size_t)w * h);
	for (size_t i = 0; i < lv.blocks.size(); i++) {
		int t = readI32(), n = readI32(), hh = readI32();
		lv.blocks[i].iType = t; lv.blocks[i].iNumber = n;
		if (version < 6 && t != 0) lv.blocks[i].iHeight = KBlockHeights[n];
		else lv.blocks[i].iHeight = hh;
	}
	lv.iOutBlock.iType = readI32();
	lv.iOutBlock.iNumber = readI32();
	int outH = readI32();
	lv.iOutBlock.iHeight = version < 6 ? KBlockHeights[lv.iOutBlock.iNumber] : outH;
	unsigned int startCount = readU32();
	for (unsigned int i = 0; i < startCount; i++) {
		CoordI c; c.x = readI32(); c.y = readI32(); lv.iPlStart.push_back(c);
	}

	// ---- entity section ----
	readI32(); // timeLimit (unused by the sim)
	for (int a = 0; a < 10; a++) lv.iGeneralEnemies[a] = readI32();
	unsigned int enemyCount = readU32();
	for (unsigned int i = 0; i < enemyCount; i++) {
		Level::EnemyCoord e; e.type = readI32(); e.x = readI32(); e.y = readI32();
		lv.iEnemy.push_back(e);
	}
	unsigned int placedCount = readU32();
	for (unsigned int i = 0; i < placedCount; i++) {
		Level::CrateCoord c; c.type1 = readI32(); c.type2 = readI32(); c.x = readI32(); c.y = readI32();
		lv.iPlacedCratesNormal.push_back(c);
	}
	unsigned int randCount = readU32();
	for (unsigned int i = 0; i < randCount; i++) {
		Level::RandomCrate c; c.type1 = readI32(); c.type2 = readI32(); c.amount = readI32();
		lv.iRandomCratesNormal.push_back(c);
	}
	unsigned int steamCount = readU32();
	for (unsigned int i = 0; i < steamCount; i++) {
		Level::SteamCoord s; s.x = readI32(); s.y = readI32(); s.angle = readI32(); s.speed = readI32();
		lv.iSteams.push_back(s);
	}
	free(buf);
	ModifyBorderBlocks(lv);
	DarknessCast(lv);
	GenerateShadows(lv);
	lv.GenerateReachableMap();
	return true;
}

static void WriteMath(const char* out) {
	FILE* f = fopen(out, "wb");
	for (int a = 0; a < 360; a++) fwrite(&gMath.iSine[a], 4, 1, f);
	for (int a = 0; a < 360; a++) fwrite(&gMath.iCosine[a], 4, 1, f);
	fclose(f);
}

static void RunReplay(const char* levelDump, const char* scriptPath, const char* outPath, const char* dataDir) {
	Script s;
	if (!ReadScript(scriptPath, s)) return;
	SimWorld w;
	if (!ReadLevelDump(w.level, levelDump)) return;
	if (dataDir && dataDir[0]) {
		std::string fontPath = std::string(dataDir) + "/fnts/menu15x18dark.fnt";
		if (!w.font.Load(fontPath.c_str()))
			fprintf(stderr, "warning: could not load font %s\n", fontPath.c_str());
	}
	w.rng.Seed((unsigned int)s.seed);
	w.mouseSensitivity = s.sensitivity;
	w.mouseOwner = s.mouseOwner;
	w.players = s.players;
	for (size_t i = 0; i < w.players.size(); i++)
		if (w.players[i].local) SimInitScr(w.players[i], RectI(0, 0, 640, 480));

	SimSpawnEntities(w);

	FILE* f = fopen(outPath, "wb");
	auto wI32 = [&](int v) { fwrite(&v, 4, 1, f); };
	auto wF32 = [&](float v) { fwrite(&v, 4, 1, f); };

	RectI drawRect(0, 0, 640, 480);
	for (int t = 0; t < s.ticks; t++) {
		SimTick(w, s.inputs[t], drawRect);

		wI32(t);
		wI32((int)w.players.size());
		for (size_t i = 0; i < w.players.size(); i++) {
			SimPlayer& p = w.players[i];
			wF32(p.location.x); wF32(p.location.y); wF32(p.angle); wF32(p.energy); wF32(p.pushPower);
			wI32(p.screenPos.x); wI32(p.screenPos.y); wI32(p.curWeapon); wI32(p.secWeapon);
			wI32(p.anim); wI32(p.dead); wI32(p.hit); wI32(p.walk); wI32(p.shootCount);
			wI32(p.loadCounter); wI32(p.loadCounter2); wI32(p.secondaryCounter);
			wI32(p.targetAngle); wI32(p.kick); wI32(p.burning); wI32(p.cash);
			wI32(p.targetSystem ? 1 : 0);
			for (int a = 0; a < W_AMOUNT; a++) wI32(p.weapons[a]);
			for (int a = 0; a < B_AMOUNT; a++) wI32(p.bullets[a]);
		}
		wI32((int)w.bullets.size());
		for (size_t i = 0; i < w.bullets.size(); i++) {
			SimBullet& b = w.bullets[i];
			wF32(b.location.x); wF32(b.location.y); wF32(b.spriteAngle); wF32(b.speed); wF32(b.share);
			wI32(b.angle); wI32(b.counter); wI32(b.typeId); wI32(b.ownerId);
		}
		wI32((int)w.enemies.size());
		for (size_t i = 0; i < w.enemies.size(); i++) {
			SimEnemy& e = w.enemies[i];
			wF32(e.loc.x); wF32(e.loc.y); wF32(e.angle); wF32(e.energy); wF32(e.pushPower);
			wI32(e.targetAngle); wI32(e.pushAngle); wI32(e.walk); wI32(e.fire); wI32(e.anim);
			wI32(e.loadCounter); wI32(e.shootCount); wI32(e.burning); wI32(e.state);
			wI32(e.walkCounter); wI32(e.curWeapon);
		}
		wI32((int)w.bodyparts.size());
		for (size_t i = 0; i < w.bodyparts.size(); i++) {
			SimBodyPart& bp = w.bodyparts[i];
			wF32(bp.loc.x); wF32(bp.loc.y); wF32(bp.speed);
			wI32(bp.angle); wI32(bp.type);
		}
		wI32((int)w.effects.size());
		for (size_t i = 0; i < w.effects.size(); i++) {
			SimFx& e = w.effects[i];
			wF32(e.loc.x); wF32(e.loc.y);
			wI32(e.counter); wI32(e.type);
		}
		wI32((int)w.crates.size());
		for (size_t i = 0; i < w.crates.size(); i++) {
			SimCrate& c = w.crates[i];
			wF32(c.textCounter); wF32(c.textCounter2);
			wI32(c.loc.x); wI32(c.loc.y); wI32(c.inUse); wI32(c.textAngle); wI32(c.wakeUpCounter);
			wI32(c.kind); wI32(c.value);
		}
		wI32((int)w.deadEnemies.size());
		for (size_t i = 0; i < w.deadEnemies.size(); i++) {
			wI32(w.deadEnemies[i].x); wI32(w.deadEnemies[i].y);
		}
		wI32(w.steamAnimationCount);
	}
	fclose(f);
	printf("replay %d ticks -> %s (enemies=%zu bodyparts=%zu effects=%zu crates=%zu)\n",
		s.ticks, outPath, w.enemies.size(), w.bodyparts.size(), w.effects.size(), w.crates.size());
}

int main(int argc, char** argv) {
	InitBulletTypes();
	InitWeaponTypes();
	InitEffectTypes();
	InitBodyPartTypes();
	InitEnemyTypes();
	if (argc >= 3 && std::string(argv[1]) == "math") {
		WriteMath(argv[2]);
		return 0;
	}
	if (argc >= 6 && std::string(argv[1]) == "replay") {
		RunReplay(argv[2], argv[3], argv[4], argc > 5 ? argv[5] : "");
		return 0;
	}
	fprintf(stderr, "usage: sim_gen math <out.raw> | replay <leveldump> <script> <out.trace> [datadir]\n");
	return 2;
}
