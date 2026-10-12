// SPDX-License-Identifier: GPL-2.0-only
// Derived from Tapan Kaikki 4 (GPLv2); see LICENSE.

// Shared reference implementations for the Tapan Kaikki 4 -> TypeScript port.
//
// Everything here is a near-verbatim copy of the original C++ (with only the
// SDL/graphics-buffer plumbing replaced by plain byte buffers) so the
// TypeScript port can be verified byte-for-byte. No SDL is required.
//
// Used by rotate_gen.cpp (asset generation) and render_gen.cpp (static level
// rendering). See docs/parity-testing-and-risks.md.

#ifndef TKREFERENCE_H
#define TKREFERENCE_H

#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>

// ---- from CMath.h ----
#define pi 3.14159265358979f
#define KBlockSpriteSize 20
#define KCharacterSpriteSize 28
#define KFixedPointBits 10

// ---- palette (CPalette / CLightTable::ClosestInPalette) ----
struct RGBA { unsigned char r, g, b; };

struct Palette {
	RGBA c[256];
	void ReadPalette(unsigned char* buf) { for (int a = 0; a < 256; a++) { c[a].r = buf[a * 3]; c[a].g = buf[a * 3 + 1]; c[a].b = buf[a * 3 + 2]; } }
	void FourMultiply() { for (int a = 0; a < 256; a++) { c[a].r <<= 2; c[a].g <<= 2; c[a].b <<= 2; } }
	void AppendPaletteDiv4(unsigned char* out) const { for (int a = 0; a < 256; a++) { out[a*3]=c[a].r/4; out[a*3+1]=c[a].g/4; out[a*3+2]=c[a].b/4; } }
	void AppendPalette(unsigned char* out) const { for (int a = 0; a < 256; a++) { out[a*3]=c[a].r; out[a*3+1]=c[a].g; out[a*3+2]=c[a].b; } }

	static void rgb2hsl(float r, float g, float b, float& H, float& S, float& L) {
		float delta, cmax, cmin;
		r /= 255; g /= 255; b /= 255;
		cmax = (r > g) ? ((r > b) ? r : b) : ((g > b) ? g : b);
		cmin = (r < g) ? ((r < b) ? r : b) : ((g < b) ? g : b);
		L = (cmax + cmin) / 2.0F;
		if (cmax == cmin) { S = 0; H = 0; }
		else {
			if (L < 0.5F) S = (cmax - cmin) / (cmax + cmin);
			else S = (cmax - cmin) / (2.0F - cmax - cmin);
			delta = cmax - cmin;
			if (r == cmax) H = (g - b) / delta;
			else if (g == cmax) H = 2.0F + (b - r) / delta;
			else H = 4.0F + (r - g) / delta;
			H /= 6.0F;
			if (H < 0.0F) H += 1;
		}
	}
	static float hue2rgb(float m1, float m2, float h) {
		if (h < 0) h += 1.0F;
		if (h > 1) h -= 1.0F;
		if (6.0F * h < 1) return (m1 + (m2 - m1) * h * 6.0F);
		if (2.0F * h < 1.0F) return m2;
		if (3.0F * h < 2.0F) return (m1 + (m2 - m1) * ((2.0F / 3.0F) - h) * 6.0F);
		return m1;
	}
	static void hsl2rgb(float H, float S, float L, float& R, float& G, float& B) {
		float m1, m2;
		if (S == 0) { R = G = B = L; }
		else {
			if (L <= 0.5F) m2 = L * (1.0F + S); else m2 = L + S - L * S;
			m1 = 2.0F * L - m2;
			R = hue2rgb(m1, m2, H + 1.0F / 3.0F);
			G = hue2rgb(m1, m2, H);
			B = hue2rgb(m1, m2, H - 1.0F / 3.0F);
		}
		R *= 255; G *= 255; B *= 255;
	}
};

static unsigned char ClosestInPalette(int aRed, int aGreen, int aBlue, Palette& aPalette) {
	int a, v, minv = 1000; unsigned char closest = 0;
	for (a = 0; a < 256; a++) {
		v = abs(aPalette.c[a].r - aRed) + abs(aPalette.c[a].g - aGreen) + abs(aPalette.c[a].b - aBlue);
		if (v < minv) { minv = v; closest = (char)a; }
	}
	return closest;
}

// ---- CGraphicsBuffer (index buffer + Resize semantics) ----
struct GfxBuffer {
	int iWidth = 0, iHeight = 0;
	unsigned char* iBuf = nullptr;
	int Width() const { return iWidth; }
	int Height() const { return iHeight; }
	unsigned char& operator[](int i) { return iBuf[i]; }
	void Resize(int aWidth, int aHeight) {
		if (aWidth == iWidth && aHeight == iHeight) return;
		unsigned char* newbuf = (unsigned char*)malloc(aWidth * aHeight);
		for (int y = 0; y < aHeight && y < iHeight; y++)
			for (int x = 0; x < aWidth && x < iWidth; x++)
				newbuf[y * aWidth + x] = iBuf[y * iWidth + x];
		iWidth = aWidth; iHeight = aHeight; free(iBuf); iBuf = newbuf;
	}
	void Fill(unsigned char c) { memset(iBuf, c, (size_t)iWidth * iHeight); }
};

// ---- EFP loading (CGraphicsBuffer::LoadEFP) ----
static bool LoadEFP(const char* fn, GfxBuffer& out, Palette* pal) {
	FILE* f = fopen(fn, "rb");
	if (!f) { fprintf(stderr, "cannot open %s\n", fn); return false; }
	fseek(f, 0, SEEK_END); long len = ftell(f); fseek(f, 0, SEEK_SET);
	unsigned char* fb = (unsigned char*)malloc(len);
	size_t rd = fread(fb, 1, len, f); (void)rd; fclose(f);
	if (memcmp(fb, "EF pic", 6) != 0) { fprintf(stderr, "not efp %s\n", fn); free(fb); return false; }
	int cnt = 6;
	unsigned short w = *(short*)(fb + cnt); cnt += 2;
	unsigned short h = *(short*)(fb + cnt); cnt += 2;
	out.Resize(w, h);
	for (unsigned int p = 0; p < (unsigned)w * h;) {
		int tavu = fb[cnt++];
		if (tavu > 192) { int t2 = fb[cnt++]; memset(out.iBuf + p, t2, tavu - 192); p += tavu - 192; }
		else out.iBuf[p++] = (char)tavu;
	}
	if (pal) { pal->ReadPalette(fb + cnt); pal->FourMultiply(); }
	free(fb);
	return true;
}

// ---- PCX loading (CGraphicsBuffer::LoadPCX) ----
static bool LoadPCX(const char* fn, GfxBuffer& out, Palette* pal) {
	FILE* f = fopen(fn, "rb");
	if (!f) { fprintf(stderr, "cannot open %s\n", fn); return false; }
	fseek(f, 8, SEEK_SET);
	int w = fgetc(f); w += fgetc(f) << 8; w += 1;
	int h = fgetc(f); h += fgetc(f) << 8; h += 1;
	out.Resize(w, h);
	fseek(f, 128, SEEK_SET);
	for (unsigned int p = 0; p < (unsigned)w * h;) {
		int tavu = fgetc(f);
		if (tavu > 192) { int t2 = fgetc(f); for (; tavu > 192; tavu--) out.iBuf[p++] = (char)t2; }
		else out.iBuf[p++] = (char)tavu;
	}
	if (pal) {
		fseek(f, -256 * 3, SEEK_END);
		for (int a = 0; a < 256; a++) {
			int r = fgetc(f), g = fgetc(f), b = fgetc(f);
			pal->c[a].r = (unsigned char)r; pal->c[a].g = (unsigned char)g; pal->c[a].b = (unsigned char)b;
		}
	}
	fclose(f);
	return true;
}

// ---- CGraphicsGenerator ----
static void ZoomBlock(GfxBuffer& aSrc, GfxBuffer& aDst, int aX, int aY, int aAdd) {
	int a, b, c, d, size;
	size = KBlockSpriteSize + aAdd;
	for (a = 0, c = 0; a < size; a++) {
		for (b = 0, d = 0; b < size; b++) {
			aDst[(a + (aY * size)) * (aDst.Width()) + b + aX * size] = aSrc[(c + (aY * KBlockSpriteSize)) * aSrc.Width() + d + aX * KBlockSpriteSize];
			if ((b + 1) % (size / (aAdd + 1) + 1) != 0) d++;
			if (d >= KBlockSpriteSize) d = (KBlockSpriteSize - 1);
		}
		if ((a + 1) % (size / (aAdd + 1) + 1) != 0) c++;
		if (c >= KBlockSpriteSize) c = (KBlockSpriteSize - 1);
	}
}
static void ZoomWall(GfxBuffer& aSrc, GfxBuffer& aDst, int aLevel) {
	const int cBlocksW = aSrc.Width() / KBlockSpriteSize;
	const int cBlocksH = aSrc.Height() / KBlockSpriteSize;
	int a, b, xsize = cBlocksW * (20 + aLevel + 1), ysize = cBlocksH * (20 + aLevel + 1);
	aDst.Resize(xsize, ysize);
	for (a = 0; a < cBlocksH; a++)
		for (b = 0; b < cBlocksW; b++)
			ZoomBlock(aSrc, aDst, b, a, aLevel + 1);
}
static void MakeFloors(Palette& aPal, GfxBuffer& aSrc, GfxBuffer& aDst) {
	int a; float re, gr, bl, h, s, lum; char col;
	aDst.Resize(aSrc.Width(), aSrc.Height());
	for (a = 0; a < aSrc.Width() * aSrc.Height(); a++) {
		re = aPal.c[aSrc[a]].r; gr = aPal.c[aSrc[a]].g; bl = aPal.c[aSrc[a]].b;
		Palette::rgb2hsl(re, gr, bl, h, s, lum);
		lum /= 3; s /= 3;
		Palette::hsl2rgb(h, s, lum, re, gr, bl);
		col = ClosestInPalette((int)re, (int)gr, (int)bl, aPal);
		aDst[a] = col;
	}
}
static void RotateSprites(GfxBuffer& aBuffer, int aSpriteWidth, int aSpriteHeight, int aAngles, Palette& pal) {
	float xx, yy, xx2, yy2; int b, c, a, ax, ay; char col;
	const int xSprs = aAngles;
	const int ySprs = (aBuffer.Height() / aSpriteHeight);
	float* sini = (float*)malloc(aAngles * sizeof(float));
	float* cosi = (float*)malloc(aAngles * sizeof(float));
	for (a = 0; a < aAngles; a++) {
		sini[a] = sin((float)(a) / aAngles * pi * 2);
		cosi[a] = cos((float)(a) / aAngles * pi * 2);
	}
	sini[0] = 0; cosi[0] = 1;
	sini[aAngles / 4] = 1; cosi[aAngles / 4] = 0;
	sini[aAngles / 2] = 0; cosi[aAngles / 2] = -1;
	sini[aAngles / 4 * 3] = -1; cosi[aAngles / 4 * 3] = 0;
	aBuffer.Resize(xSprs * (aSpriteWidth + 1), ySprs * (aSpriteHeight + 1));
	for (int column = 1; column < xSprs; column++) {
		for (int row = 0; row < ySprs; row++) {
			xx2 = -(aSpriteWidth / 2 + 1) * cosi[(column + aAngles / 4) % aAngles];
			yy2 = -(aSpriteHeight / 2 + 1) * sini[(column + aAngles / 4) % aAngles];
			for (a = 0, c = 0; a < aSpriteHeight + 1; a++) {
				xx = -(aSpriteWidth / 2 + 1) * cosi[column];
				yy = -(aSpriteHeight / 2 + 1) * sini[column];
				xx2 += cosi[(column + aAngles / 4) % aAngles];
				yy2 += sini[(column + aAngles / 4) % aAngles];
				for (b = 0; b < aSpriteWidth + 1; b++, c++) {
					col = 0;
					xx += cosi[column];
					yy += sini[column];
					ax = int(xx + xx2 + (aSpriteWidth / 2 + 1));
					ay = int((row * (aSpriteHeight + 1)) + yy + yy2 + (aSpriteHeight / 2 + 1));
					if (ay > (row * aSpriteHeight) && ax > 0 &&
						ay < (row * aSpriteHeight) + aSpriteHeight &&
						ax < aSpriteWidth)
						col = aBuffer[ay * aBuffer.Width() + ax];
					aBuffer[(a + row * (aSpriteHeight + 1)) * aBuffer.Width() + b + column * (aSpriteWidth + 1)] = col;
				}
			}
		}
	}
	free(sini); free(cosi);
}

// ---- CLevel (block heights + the level struct + derived maps) ----
static const char KBlockHeights[16 * 30] = {
	3,3,3,3,3,2,1,0,0,1,1,1,1,1,1,1,
	3,3,3,5,1,2,1,0,0,1,1,1,1,1,1,1,
	3,3,3,3,1,1,1,2,2,1,1,1,1,3,3,3,
	3,3,3,3,3,1,1,3,2,1,1,1,1,3,3,3,
	2,2,2,2,2,2,2,2,3,1,1,1,1,3,3,3,
	2,2,2,2,1,2,2,1,1,1,1,1,1,3,3,3,
	2,2,2,2,1,3,2,2,3,3,3,3,3,3,3,3,
	2,2,2,2,1,1,4,4,5,3,3,3,3,3,3,3,
	1,1,1,1,1,1,0,0,0,3,3,3,3,3,3,3,
	1,1,1,1,1,1,0,0,0,3,3,3,3,3,3,0,
	3,3,3,3,3,3,3,1,1,0,0,1,1,3,3,3,
	3,3,3,4,1,2,1,1,1,0,0,1,1,3,3,3,
	3,3,3,3,1,1,1,1,1,3,3,3,3,3,3,3,
	3,3,3,3,3,1,1,1,1,3,3,3,3,3,3,3,
	2,2,2,2,2,2,2,1,1,3,3,3,3,3,3,3,
	2,2,2,2,2,2,2,1,1,3,3,3,4,3,3,3,
	2,2,2,2,1,3,2,2,3,3,3,3,3,3,3,3,
	2,2,2,2,1,2,4,4,5,3,3,3,3,3,3,3,
	2,2,2,2,2,2,1,1,1,3,3,3,3,3,3,3,
	2,2,2,2,2,2,1,1,1,3,3,3,4,3,3,3,
	2,2,2,2,1,1,0,0,0,0,0,0,0,0,0,0,
	2,2,2,2,1,1,0,0,0,0,0,0,0,0,0,0,
	1,0,1,1,1,1,1,0,0,0,0,0,0,0,0,0,
	1,0,1,1,1,1,1,0,0,0,0,0,0,0,0,0,
	0,0,1,1,1,1,1,0,0,0,0,0,0,0,0,0,
	0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
	0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
	0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
	0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
	0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
};

struct TBlock { int iType = 0, iNumber = 0, iShadow = 0, iHeight = 0, iCastDarkness = 0; };

struct CoordI { int x = 0, y = 0; };
struct CoordF { float x = 0, y = 0; };

static const int KDustBlockAmount = 18;
static const int KDustBlocks[KDustBlockAmount] = {
	0, 16 * 4, 16 * 5, 16 * 5 + 2, 16 * 6 + 1, 16 * 6 + 1, 16 * 6 + 2, 16 * 7 + 1, 16 * 7 + 2,
	16 * 7 + 3, 21, 22, 23, 24, 21 + 16, 22 + 16, 23 + 16, 24 + 16,
};

struct Level {
	int iWidth = 0, iHeight = 0;
	std::vector<TBlock> blocks;
	TBlock iOutBlock;
	std::vector<CoordI> iPlStart;
	std::vector<unsigned char> reachable;

	// Entity data (read from the extended level dump).
	struct EnemyCoord { int type = 0, x = 0, y = 0; };
	struct CrateCoord { int type1 = 0, type2 = 0, x = 0, y = 0; };
	struct RandomCrate { int type1 = 0, type2 = 0, amount = 0; };
	struct SteamCoord { int x = 0, y = 0, angle = 0, speed = 0; };
	std::vector<EnemyCoord> iEnemy;
	int iGeneralEnemies[10] = {0};
	std::vector<CrateCoord> iPlacedCratesNormal;
	std::vector<RandomCrate> iRandomCratesNormal;
	std::vector<SteamCoord> iSteams;

	static bool FloorLevel(const TBlock& b) { return b.iType == 0 || b.iHeight == 0; }
	TBlock& LevelData(int x, int y) {
		if (x < 0 || y < 0 || x >= iWidth || y >= iHeight) return iOutBlock;
		return blocks[y * iWidth + x];
	}
	bool InLevel(int x, int y) const { return x >= 0 && y >= 0 && x < iWidth && y < iHeight; }
	// CLevel::Collision (free of the inline CRect). Coordinates in blocks.
	bool Collision(int x, int y) const {
		if (InLevel(x, y) && blocks[y * iWidth + x].iType == 0) return false;
		return true;
	}
	// CLevel::VisibilityCheck. Coordinates in pixels; 1px accuracy.
	bool VisibilityCheck(const CoordF& aSrc, const CoordF& aDst, CoordF* aCollisionPoint) const {
		int iterations = (int)std::max(1.0f, std::max(std::fabs(aDst.x - aSrc.x), std::fabs(aDst.y - aSrc.y)));
		float dx = aDst.x - aSrc.x;
		float dy = aDst.y - aSrc.y;
		int x_sign = dx < 0 ? -1 : (dx > 0 ? 1 : 0);
		int y_sign = dy < 0 ? -1 : (dy > 0 ? 1 : 0);
		float xDelta = dx / iterations;
		float yDelta = dy / iterations;
		CoordF oldPos = aSrc;
		CoordF newPos;
		for (int a = 0; a <= iterations; a++) {
			newPos.x = aSrc.x + (xDelta * a);
			newPos.y = aSrc.y + (yDelta * a);
			if (Collision((int)(newPos.x / KBlockSpriteSize), (int)(newPos.y / KBlockSpriteSize))) {
				if (aCollisionPoint) *aCollisionPoint = oldPos;
				return false;
			}
			if (x_sign != 0 && y_sign != 0 && a > 0) {
				if (Collision((int)((newPos.x - x_sign) / KBlockSpriteSize), (int)(newPos.y / KBlockSpriteSize)) &&
					Collision((int)(newPos.x / KBlockSpriteSize), (int)((newPos.y - y_sign) / KBlockSpriteSize))) {
					if (aCollisionPoint) *aCollisionPoint = oldPos;
					return false;
				}
			}
			oldPos = newPos;
		}
		if (aCollisionPoint) *aCollisionPoint = aDst;
		return true;
	}
	bool Reachable(int x, int y) const {
		if (!InLevel(x, y)) return false;
		return reachable[y * iWidth + x] != 0;
	}
	bool DustBlock(int x, int y) const {
		if (!InLevel(x, y)) return false;
		int num = blocks[y * iWidth + x].iNumber;
		for (int a = 0; a < KDustBlockAmount; a++)
			if (num == KDustBlocks[a]) return true;
		return false;
	}
	void GenerateReachableMap() {
		reachable.assign((size_t)iWidth * iHeight, 0);
		if (!iPlStart.empty()) RecurseReachable(iPlStart[0], true);
	}
	void RecurseReachable(CoordI aPos, bool aHoriz) {
		if (!InLevel(aPos.x, aPos.y)) return;
		if (Collision(aPos.x, aPos.y)) return;
		if (Reachable(aPos.x, aPos.y)) return;
		if (aHoriz) {
			int xmin = aPos.x, xmax = aPos.x, y = aPos.y, a;
			do { xmin--; } while (!Collision(xmin, y) && !Reachable(xmin, y) && InLevel(xmin, y));
			do { xmax++; } while (!Collision(xmax, y) && !Reachable(xmax, y) && InLevel(xmax, y));
			for (a = xmin + 1; a < xmax; a++) reachable[y * iWidth + a] = 1;
			if (y - 1 >= 0) for (a = xmin + 1; a < xmax; a++) { CoordI p; p.x = a; p.y = y - 1; RecurseReachable(p, !aHoriz); }
			if (y + 1 < iHeight) for (a = xmin + 1; a < xmax; a++) { CoordI p; p.x = a; p.y = y + 1; RecurseReachable(p, !aHoriz); }
		} else {
			int ymin = aPos.y, ymax = aPos.y, x = aPos.x, a;
			do { ymin--; } while (!Collision(x, ymin) && !Reachable(x, ymin) && InLevel(x, ymin));
			do { ymax++; } while (!Collision(x, ymax) && !Reachable(x, ymax) && InLevel(x, ymax));
			for (a = ymin + 1; a < ymax; a++) reachable[a * iWidth + x] = 1;
			if (x - 1 >= 0) for (a = ymin + 1; a < ymax; a++) { CoordI p; p.x = x - 1; p.y = a; RecurseReachable(p, !aHoriz); }
			if (x + 1 < iWidth) for (a = ymin + 1; a < ymax; a++) { CoordI p; p.x = x + 1; p.y = a; RecurseReachable(p, !aHoriz); }
		}
	}
};

// CLevel::ModifyBorderBlocks
static void ModifyBorderBlocks(Level& l) {
	int x, y, height = KBlockHeights[l.iOutBlock.iNumber];
	for (y = 0; y < l.iHeight; y++) {
		x = 0;
		if (l.blocks[y * l.iWidth + x].iType == 0) l.blocks[y * l.iWidth + x].iType = 1;
		if (l.blocks[y * l.iWidth + x].iHeight < height) l.blocks[y * l.iWidth + x].iHeight = height;
		x = l.iWidth - 1;
		if (l.blocks[y * l.iWidth + x].iType == 0) l.blocks[y * l.iWidth + x].iType = 1;
		if (l.blocks[y * l.iWidth + x].iHeight < height) l.blocks[y * l.iWidth + x].iHeight = height;
	}
	for (x = 0; x < l.iWidth; x++) {
		y = 0;
		if (l.blocks[y * l.iWidth + x].iType == 0) l.blocks[y * l.iWidth + x].iType = 1;
		if (l.blocks[y * l.iWidth + x].iHeight < height) l.blocks[y * l.iWidth + x].iHeight = height;
		y = l.iHeight - 1;
		if (l.blocks[y * l.iWidth + x].iType == 0) l.blocks[y * l.iWidth + x].iType = 1;
		if (l.blocks[y * l.iWidth + x].iHeight < height) l.blocks[y * l.iWidth + x].iHeight = height;
	}
}

// CLevel::DarknessCast
static void DarknessCast(Level& l) {
	int a, b;
	for (a = 1; a < l.iHeight - 1; a++)
		for (b = 1; b < l.iWidth - 1; b++) {
			if (l.blocks[a * l.iWidth + b].iHeight == 0) l.blocks[a * l.iWidth + b].iCastDarkness = 0;
			else l.blocks[a * l.iWidth + b].iCastDarkness = 1;
		}
}

// CLevel::GenerateShadows
static void GenerateShadows(Level& l) {
	int a, b, c, length;
	for (a = 0; a < l.iWidth * l.iHeight; a++) l.blocks[a].iShadow = 0;
	for (a = 0; a < l.iHeight; a++)
		for (b = 0; b < l.iWidth; b++) {
			if (l.blocks[a * l.iWidth + b].iHeight <= 0) continue;
			c = 1;
			if (l.blocks[a * l.iWidth + b].iHeight > 2) c = 2;
			if (l.blocks[a * l.iWidth + b].iHeight > 4) c = 3;
			for (length = 1; length < c + 1; length++) {
				if (b - length >= 0 && a + length < l.iHeight) {
					if (l.blocks[(a + length) * l.iWidth + b - length].iHeight <= l.blocks[a * l.iWidth + b].iHeight - length)
						l.blocks[(a + length) * l.iWidth + b - length].iShadow = 1;
				}
				if (b - length >= 0 && a + length - 1 < l.iHeight) {
					if (l.blocks[(a + length - 1) * l.iWidth + b - length].iHeight <= l.blocks[a * l.iWidth + b].iHeight - length) {
						switch (l.blocks[(a + length - 1) * l.iWidth + b - length].iShadow) {
							case 0: l.blocks[(a + length - 1) * l.iWidth + b - length].iShadow = 2; break;
							case 1: l.blocks[(a + length - 1) * l.iWidth + b - length].iShadow = 1; break;
							case 2: l.blocks[(a + length - 1) * l.iWidth + b - length].iShadow = 2; break;
							case 3: l.blocks[(a + length - 1) * l.iWidth + b - length].iShadow = 1; break;
						}
					}
				}
				if (b - (length - 1) >= 0 && a + length < l.iHeight) {
					if (l.blocks[(a + length) * l.iWidth + b - length + 1].iHeight <= l.blocks[a * l.iWidth + b].iHeight - length) {
						switch (l.blocks[(a + length) * l.iWidth + b - length + 1].iShadow) {
							case 0: l.blocks[(a + length) * l.iWidth + b - length + 1].iShadow = 3; break;
							case 1: l.blocks[(a + length) * l.iWidth + b - length + 1].iShadow = 1; break;
							case 2: l.blocks[(a + length) * l.iWidth + b - length + 1].iShadow = 1; break;
							case 3: l.blocks[(a + length) * l.iWidth + b - length + 1].iShadow = 3; break;
						}
					}
				}
			}
		}
}

// ---- RectI + CGameDrawer primitives ----
struct RectI { int l = 0, t = 0, r = 0, b = 0; };

struct Assets {
	GfxBuffer floor, floor2, wall2, wallClr;
	GfxBuffer walls[6];
	GfxBuffer crate, target;                    // HUD sprites (efps/crates.efp, efps/target.efp)
	const unsigned char* shadowTable = nullptr; // 256*16
	const unsigned char* transparency = nullptr; // 256*256
};

static RectI ClipRect(int aX, int aY, int aBlockXSize, int aBlockYSize, const RectI& aDrawRect) {
	RectI clip(0, 0, aBlockXSize, aBlockYSize);
	if (aX + aBlockXSize > aDrawRect.r) clip.r = aBlockXSize - (aX + aBlockXSize - aDrawRect.r);
	if (aX < aDrawRect.l) clip.l = aDrawRect.l - aX;
	if (aY + aBlockYSize > aDrawRect.b) clip.b = aBlockYSize - (aY + aBlockYSize - aDrawRect.b);
	if (aY < aDrawRect.t) clip.t = aDrawRect.t - aY;
	return clip;
}
static bool RectValid(const RectI& r) { return r.r > r.l && r.b > r.t; }
static int RectW(const RectI& r) { return r.r - r.l; }
static int RectH(const RectI& r) { return r.b - r.t; }

static void DrawBlock(int aX, int aY, int aType, int aNumber, int aBlockHeight, Assets& a, GfxBuffer* aDrawBuffer, const RectI& aDrawRect) {
	int a2, offset, xSize = aBlockHeight * 16 + 320;
	const unsigned char* texture = NULL;
	unsigned char* gofs;
	int blockSpriteSize = KBlockSpriteSize + aBlockHeight;
	RectI clipRect = ClipRect(aX, aY, blockSpriteSize, blockSpriteSize, aDrawRect);
	if (!RectValid(clipRect)) return;
	offset = ((aNumber & 15) * blockSpriteSize) + (aNumber / 16 * xSize * blockSpriteSize) + clipRect.t * xSize + clipRect.l;
	if (aType == 0) texture = a.floor.iBuf;
	else texture = a.walls[aBlockHeight].iBuf;
	texture += offset;
	gofs = aDrawBuffer->iBuf + (aY + clipRect.t) * aDrawBuffer->Width() + aX + clipRect.l;
	for (a2 = clipRect.t; a2 < clipRect.b; a2++) {
		memcpy(gofs, texture, RectW(clipRect));
		texture += xSize;
		gofs += aDrawBuffer->Width();
	}
}

static void DrawDarkBlock(int aX, int aY, int aType, int aNumber, unsigned char* aTarget, Assets& a, GfxBuffer* aDrawBuffer, const RectI& aDrawRect) {
	int a2, offset;
	unsigned char* gofs;
	const unsigned char* spr;
	RectI clipRect = ClipRect(aX, aY, KBlockSpriteSize, KBlockSpriteSize, aDrawRect);
	if (!RectValid(clipRect)) return;
	offset = ((aNumber & 15) * KBlockSpriteSize) + (aNumber / 16 * 320 * KBlockSpriteSize) + clipRect.t * 320 + clipRect.l;
	gofs = aTarget + (clipRect.t + aY) * aDrawBuffer->Width() + aX + clipRect.l;
	if (aType == 0) spr = a.floor2.iBuf; else spr = a.wall2.iBuf;
	for (a2 = clipRect.t; a2 < clipRect.b; a2++) {
		memcpy(gofs, spr + offset, RectW(clipRect));
		offset += 320;
		gofs += aDrawBuffer->Width();
	}
}

static void DrawWallShadow(int aX, int aY, int aNumber, int aSize, Assets& a, GfxBuffer* aDrawBuffer, const RectI& aDrawRect) {
	int a2, b;
	int lum = 6;
	unsigned char* vb;
	RectI clipRect = ClipRect(aX, aY, aSize, aSize, aDrawRect);
	if (!RectValid(clipRect)) return;
	vb = aDrawBuffer->iBuf + ((aY + clipRect.t) * aDrawBuffer->Width() + aX);
	const unsigned char* st = a.shadowTable;
	switch (aNumber) {
		case 1:
			for (a2 = clipRect.t; a2 < clipRect.b; a2++, vb += aDrawBuffer->Width())
				for (b = clipRect.l; b < clipRect.r; b++) vb[b] = st[vb[b] * 16 + lum];
			break;
		case 2:
			for (a2 = clipRect.t; a2 < clipRect.b; a2++, vb += aDrawBuffer->Width())
				for (b = std::max(clipRect.l, aSize - a2); b < clipRect.r; b++) vb[b] = st[vb[b] * 16 + lum];
			break;
		case 3:
			for (a2 = clipRect.t; a2 < clipRect.b; a2++, vb += aDrawBuffer->Width())
				for (b = clipRect.l; b < aSize - a2 && clipRect.l < aSize - a2 && b < clipRect.r; b++) vb[b] = st[vb[b] * 16 + lum];
			break;
		case 4:
			for (a2 = clipRect.t; a2 < clipRect.b; a2++, vb += aDrawBuffer->Width())
				for (b = clipRect.l + a2; b < clipRect.r && clipRect.l + a2 < clipRect.r; b++) vb[b] = st[vb[b] * 16 + lum];
			break;
		case 5:
			for (a2 = clipRect.t; a2 < clipRect.b; a2++, vb += aDrawBuffer->Width())
				for (b = clipRect.l; b < clipRect.r + a2; b++) vb[b] = st[vb[b] * 16 + lum];
			break;
	}
}

struct PointI { int x, y; };
static int CalcX(const PointI& p1, const PointI& p2, int y) { return p1.x + (y - p1.y) * (p2.x - p1.x) / (p2.y - p1.y); }
static int CalcY(const PointI& p1, const PointI& p2, int x) { return p1.y + (x - p1.x) * (p2.y - p1.y) / (p2.x - p1.x); }
#define swap(a, b, c) { c = a; a = b; b = c; }

static void DrawPolyTri(int k1, int k2, int x, int y, int aHeight, int col, GfxBuffer* aDarkBuffer, GfxBuffer* aDrawBuffer) {
	int adder = aDrawBuffer->Width(), row, dx, dx2;
	unsigned char* yg;
	int ofs = adder * y;
	if (aHeight < 0) { adder = -adder; aHeight = -aHeight; }
	yg = aDrawBuffer->iBuf + ofs;
	if (k1 > k2) { int t = k1; k1 = k2; k2 = t; }
	dx2 = dx = x << KFixedPointBits;
	if (col < 0) {
		unsigned char* yg2 = aDarkBuffer->iBuf + ofs;
		for (row = 0; row <= aHeight; row++) {
			int left = dx >> KFixedPointBits;
			int len = (dx2 >> KFixedPointBits) - left + 1;
			if (len > 0) memcpy(yg + left, yg2 + left, len);
			yg += adder; yg2 += adder; dx += k1; dx2 += k2;
		}
	} else {
		for (row = 0; row <= aHeight; row++) {
			int left = dx >> KFixedPointBits;
			int len = (dx2 >> KFixedPointBits) - left + 1;
			if (len > 0) memset(yg + left, col, len);
			yg += adder; dx += k1; dx2 += k2;
		}
	}
}

static void DrawPolygonAB(PointI& aP1, PointI& aP2, PointI& aP3, int col, GfxBuffer* aDarkBuffer, GfxBuffer* aDrawBuffer, const RectI& aDrawRect) {
	PointI* p1 = &aP1, * p2 = &aP2, * p3 = &aP3, * tmp = NULL;
	PointI p4, p5;
	if (p1->x > p2->x) swap(p1, p2, tmp);
	if (p1->x > p3->x) swap(p1, p3, tmp);
	if (p2->x > p3->x) swap(p2, p3, tmp);
	if (p1->x != p3->x) {
		if (p2->x < aDrawRect.l) {
			if (p3->x <= aDrawRect.l) return;
			p2->y = CalcY(*p3, *p2, aDrawRect.l); p2->x = aDrawRect.l;
			p1->y = CalcY(*p3, *p1, aDrawRect.l); p1->x = aDrawRect.l;
		} else if (p1->x < aDrawRect.l) {
			if (p3->x <= aDrawRect.l) return;
			p4.y = CalcY(*p3, *p1, aDrawRect.l); p4.x = aDrawRect.l;
			p5.y = CalcY(*p1, *p2, aDrawRect.l); p5.x = aDrawRect.l;
			if (p1->x == p4.x && p1->y == p4.y) return;
			if (p1->x == p5.x && p1->y == p5.y) return;
			DrawPolygonAB(*p3, p4, *p2, col, aDarkBuffer, aDrawBuffer, aDrawRect);
			DrawPolygonAB(p4, p5, *p2, col, aDarkBuffer, aDrawBuffer, aDrawRect);
			return;
		}
		if (p2->x >= aDrawRect.r) {
			if (p1->x >= aDrawRect.r - 1) return;
			p2->y = CalcY(*p1, *p2, aDrawRect.r - 1); p2->x = aDrawRect.r - 1;
			p3->y = CalcY(*p3, *p1, aDrawRect.r - 1); p3->x = aDrawRect.r - 1;
		} else if (p3->x >= aDrawRect.r) {
			if (p1->x >= aDrawRect.r - 1) return;
			p4.y = CalcY(*p3, *p1, aDrawRect.r - 1); p4.x = aDrawRect.r - 1;
			p5.y = CalcY(*p3, *p2, aDrawRect.r - 1); p5.x = aDrawRect.r - 1;
			if (p3->x == p4.x && p3->y == p4.y) return;
			if (p3->x == p5.x && p3->y == p5.y) return;
			DrawPolygonAB(*p1, p4, *p2, col, aDarkBuffer, aDrawBuffer, aDrawRect);
			DrawPolygonAB(p4, p5, *p2, col, aDarkBuffer, aDrawBuffer, aDrawRect);
			return;
		}
	} else return;
	if (p1->y > p2->y) swap(p1, p2, tmp);
	if (p1->y > p3->y) swap(p1, p3, tmp);
	if (p2->y > p3->y) swap(p2, p3, tmp);
	if (p1->y != p3->y) {
		if (p2->y < aDrawRect.t) {
			if (p3->y <= aDrawRect.t) return;
			p1->x = CalcX(*p1, *p3, aDrawRect.t); p1->y = aDrawRect.t;
			p2->x = CalcX(*p2, *p3, aDrawRect.t); p2->y = aDrawRect.t;
		} else if (p1->y < aDrawRect.t) {
			if (p3->y <= aDrawRect.t) return;
			p4.x = CalcX(*p1, *p3, aDrawRect.t); p4.y = aDrawRect.t;
			p5.x = CalcX(*p1, *p2, aDrawRect.t); p5.y = aDrawRect.t;
			if (p1->x == p4.x && p1->y == p4.y) return;
			if (p1->x == p5.x && p1->y == p5.y) return;
			DrawPolygonAB(*p3, p4, *p2, col, aDarkBuffer, aDrawBuffer, aDrawRect);
			DrawPolygonAB(p4, p5, *p2, col, aDarkBuffer, aDrawBuffer, aDrawRect);
			return;
		}
		if (p2->y >= aDrawRect.b) {
			if (p1->y >= aDrawRect.b - 1) return;
			p2->x = CalcX(*p2, *p1, aDrawRect.b - 1); p2->y = aDrawRect.b - 1;
			p3->x = CalcX(*p3, *p1, aDrawRect.b - 1); p3->y = aDrawRect.b - 1;
		} else if (p3->y >= aDrawRect.b) {
			if (p1->y >= aDrawRect.b - 1) return;
			p4.x = CalcX(*p3, *p1, aDrawRect.b - 1); p4.y = aDrawRect.b - 1;
			p5.x = CalcX(*p3, *p2, aDrawRect.b - 1); p5.y = aDrawRect.b - 1;
			if (p3->x == p4.x && p3->y == p4.y) return;
			if (p3->x == p5.x && p3->y == p5.y) return;
			DrawPolygonAB(*p1, p4, *p2, col, aDarkBuffer, aDrawBuffer, aDrawRect);
			DrawPolygonAB(p4, p5, *p2, col, aDarkBuffer, aDrawBuffer, aDrawRect);
			return;
		}
	} else return;

#define FS(p) do { if ((p).x+1==aDrawRect.l) (p).x=aDrawRect.l; if ((p).x==aDrawRect.r) (p).x=aDrawRect.r-1; if ((p).y+1==aDrawRect.t) (p).y=aDrawRect.t; if ((p).y==aDrawRect.b) (p).y=aDrawRect.b-1; } while(0)
	FS(*p1); FS(*p2); FS(*p3);

	int h1, h2, k1, k2;
	h1 = p2->y - p1->y;
	h2 = p3->y - p1->y;
	k2 = ((p3->x - p1->x) << KFixedPointBits) / h2;
	if (h1) {
		k1 = ((p2->x - p1->x) << KFixedPointBits) / h1;
		DrawPolyTri(k1, k2, p1->x, p1->y, h1, col, aDarkBuffer, aDrawBuffer);
	}
	h2 -= h1;
	if (h2) {
		k1 = ((p2->x - p3->x) << KFixedPointBits) / h2;
		DrawPolyTri(k1, -k2, p3->x, p3->y, -h2, col, aDarkBuffer, aDrawBuffer);
	}
}

static void DrawPolygonRel(int p1x, int p1y, int p2x, int p2y, int p3x, int p3y, int col, GfxBuffer* aDarkBuffer, GfxBuffer* aDrawBuffer, const RectI& aDrawRect) {
	PointI p1 = { p1x + aDrawRect.l, p1y + aDrawRect.t };
	PointI p2 = { p2x + aDrawRect.l, p2y + aDrawRect.t };
	PointI p3 = { p3x + aDrawRect.l, p3y + aDrawRect.t };
	if (col == -1 && aDarkBuffer == NULL) return;
	DrawPolygonAB(p1, p2, p3, col, aDarkBuffer, aDrawBuffer, aDrawRect);
}

// ---- CGameDrawManager static draw functions ----
static void DrawFloor(Level& aLevel, Assets& as, GfxBuffer* aDrawBuffer, GfxBuffer* aDarkBuffer, const RectI& aDrawRect, const CoordI& aPlayerScreenPos) {
	int a, b, ovx1, ovy1;
	int x_endi, x_ofs, y_ofs;
	x_endi = (int)ceilf(aDrawRect.r / (float)KBlockSpriteSize) + 1;
	if (aPlayerScreenPos.x >= 0) { ovx1 = aPlayerScreenPos.x % KBlockSpriteSize; x_ofs = aPlayerScreenPos.x / KBlockSpriteSize; }
	else { x_ofs = (aPlayerScreenPos.x + 1) / KBlockSpriteSize - 1; ovx1 = (aPlayerScreenPos.x + 10000) % KBlockSpriteSize; }
	if (aPlayerScreenPos.y >= 0) { ovy1 = aPlayerScreenPos.y % KBlockSpriteSize; y_ofs = aPlayerScreenPos.y / KBlockSpriteSize; }
	else { ovy1 = (10000 + aPlayerScreenPos.y) % KBlockSpriteSize; y_ofs = (aPlayerScreenPos.y + 1) / KBlockSpriteSize - 1; }
	for (a = 0; a < (int)ceilf(aDrawRect.b / (float)KBlockSpriteSize) + 1; a++)
		for (b = 0; b < x_endi; b++)
			if (x_ofs + b >= 0 && x_ofs + b < aLevel.iWidth && y_ofs + a >= 0 && y_ofs + a < aLevel.iHeight) {
				TBlock& block = aLevel.LevelData(x_ofs + b, y_ofs + a);
				if (Level::FloorLevel(block)) {
					DrawBlock(aDrawRect.l + (b * KBlockSpriteSize) - ovx1, aDrawRect.t + (a * KBlockSpriteSize) - ovy1, block.iType, block.iNumber, 0, as, aDrawBuffer, aDrawRect);
					DrawDarkBlock(aDrawRect.l + (b * KBlockSpriteSize) - ovx1, aDrawRect.t + (a * KBlockSpriteSize) - ovy1, block.iType, block.iNumber, aDarkBuffer->iBuf, as, aDrawBuffer, aDrawRect);
				}
			}
}

static void DrawShadows(Level* aLevel, Assets& as, GfxBuffer* aDrawBuffer, const RectI& aDrawRect, const CoordI& aPlayerScreenPos) {
	int a, b, ovx1, ovy1;
	int x_endi, xOffset, yOffset;
	if (aPlayerScreenPos.x >= 0) { ovx1 = aPlayerScreenPos.x % 20; xOffset = aPlayerScreenPos.x / 20; }
	else { ovx1 = (aPlayerScreenPos.x + 10000) % 20; xOffset = (aPlayerScreenPos.x + 1) / 20 - 1; }
	if (aPlayerScreenPos.y >= 0) { ovy1 = aPlayerScreenPos.y % 20; yOffset = aPlayerScreenPos.y / 20; }
	else { ovy1 = (aPlayerScreenPos.y + 10000) % 20; yOffset = (aPlayerScreenPos.y + 1) / 20 - 1; }
	int y_endi = (int)ceilf(aDrawRect.b / 20.0f) + 1;
	x_endi = (int)ceilf(aDrawRect.r / 20.0f) + 1;
	for (a = std::min(0, yOffset); a < y_endi; a++)
		for (b = std::min(0, -xOffset); b < x_endi; b++)
			if (xOffset + b >= 0 && xOffset + b < aLevel->iWidth && yOffset + a > 0 && yOffset + a < aLevel->iHeight) {
				TBlock& blk = aLevel->LevelData(xOffset + b, yOffset + a);
				if (blk.iShadow > 0)
					if (blk.iType == 0 || (blk.iType == 1 && blk.iHeight == 0))
						DrawWallShadow(aDrawRect.l + (b * 20) - ovx1, aDrawRect.t + (a * 20) - ovy1, blk.iShadow, 20, as, aDrawBuffer, aDrawRect);
			}
}

static int CheckCasting(int aXOfs, int aYOfs, int aMode, Level* aLevel) {
	switch (aMode) {
		case 1: if (aLevel->LevelData(aXOfs-1,aYOfs).iCastDarkness && aLevel->LevelData(aXOfs-1,aYOfs-1).iCastDarkness && aLevel->LevelData(aXOfs,aYOfs-1).iCastDarkness) return 0; break;
		case 2: if (aLevel->LevelData(aXOfs,aYOfs+1).iCastDarkness) return 0; break;
		case 3: if (aLevel->LevelData(aXOfs+1,aYOfs).iCastDarkness && aLevel->LevelData(aXOfs+1,aYOfs-1).iCastDarkness && aLevel->LevelData(aXOfs,aYOfs-1).iCastDarkness) return 0; break;
		case 4: if (aLevel->LevelData(aXOfs+1,aYOfs).iCastDarkness) return 0; break;
		case 5: if (aLevel->LevelData(aXOfs-1,aYOfs).iCastDarkness) return 0; break;
		case 6: if (aLevel->LevelData(aXOfs-1,aYOfs).iCastDarkness && aLevel->LevelData(aXOfs-1,aYOfs+1).iCastDarkness && aLevel->LevelData(aXOfs,aYOfs+1).iCastDarkness) return 0; break;
		case 7: if (aLevel->LevelData(aXOfs,aYOfs-1).iCastDarkness) return 0; break;
		case 8: if (aLevel->LevelData(aXOfs+1,aYOfs).iCastDarkness && aLevel->LevelData(aXOfs+1,aYOfs+1).iCastDarkness && aLevel->LevelData(aXOfs,aYOfs+1).iCastDarkness) return 0; break;
	}
	return 1;
}

static void DrawBlackPartsOfLevel(Level* aLevel, Assets& as, GfxBuffer* aDrawBuffer, GfxBuffer* aDarkBuffer, const RectI& aDrawRect, const CoordI& aPlayerScreenPos, float aPlayerLocX, float aPlayerLocY) {
	int a, b, xOffset, yOffset, blockx, blocky, px[5], py[5];
	int eye_x, eye_y, scr_x_size = aDrawRect.r;
	int draw_polys = 0;
	int drawH = aDrawRect.b;
	eye_x = int(aPlayerLocX + 14 - aPlayerScreenPos.x);
	eye_y = int(aPlayerLocY + 14 - aPlayerScreenPos.y);
	if (aPlayerScreenPos.x >= 0) xOffset = (aPlayerScreenPos.x / KBlockSpriteSize);
	else xOffset = (aPlayerScreenPos.x + 1) / KBlockSpriteSize - 1;
	if (aPlayerScreenPos.y >= 0) yOffset = (aPlayerScreenPos.y / KBlockSpriteSize);
	else yOffset = (aPlayerScreenPos.y + 1) / KBlockSpriteSize - 1;

	for (a = 0; a < aDrawRect.b / KBlockSpriteSize; a++)
		for (b = 0; b < (scr_x_size / KBlockSpriteSize) + 1; b++)
			if (xOffset + b > 0 && xOffset + b < aLevel->iWidth - 1 && yOffset + a > 0 && yOffset + a < aLevel->iHeight - 1)
				if (aLevel->LevelData(xOffset + b, yOffset + a).iCastDarkness) {
					draw_polys = 0;
					blockx = (xOffset + b) * KBlockSpriteSize - aPlayerScreenPos.x;
					blocky = (yOffset + a) * KBlockSpriteSize - aPlayerScreenPos.y;

					// Situation 1
					if (blockx + KBlockSpriteSize <= eye_x && blocky + KBlockSpriteSize < eye_y)
						if (CheckCasting(xOffset + b, yOffset + a, 1, aLevel)) {
							px[0] = blockx; py[0] = blocky + KBlockSpriteSize;
							px[1] = blockx + KBlockSpriteSize; py[1] = blocky;
							py[2] = py[0] - int((float)(eye_y - py[0]) / (eye_x - px[0]) * px[0]);
							if (py[2] < 0) { px[2] = px[0] - int(py[0] / ((float)(eye_y - py[0]) / (eye_x - px[0]))); py[2] = 0; } else px[2] = 0;
							if (px[2] > px[0]) px[2] = px[0];
							if (py[2] > py[0]) py[2] = py[0];
							py[3] = py[1] - int((float)(eye_y - py[1]) / (eye_x - px[1]) * px[1]);
							if (py[3] <= 0) { px[3] = px[1] - int(py[1] / ((float)(eye_y - py[1]) / (eye_x - px[1]))); py[3] = 0; } else px[3] = 0;
							if (px[3] > px[1]) px[3] = px[1];
							if (py[3] > py[1]) py[3] = py[1];
							if (px[2] != px[3]) DrawPolygonRel(px[2], py[2], px[3], py[3], 0, 0, -1, aDarkBuffer, aDrawBuffer, aDrawRect);
							draw_polys = 1;
						}
					// Situation 2
					if (blockx + KBlockSpriteSize >= eye_x && blockx <= eye_x && blocky + KBlockSpriteSize < eye_y)
						if (CheckCasting(xOffset + b, yOffset + a, 2, aLevel)) {
							px[0] = blockx - 1; py[0] = blocky + KBlockSpriteSize;
							px[1] = blockx + KBlockSpriteSize; py[1] = blocky + KBlockSpriteSize;
							if (eye_x != px[0]) px[2] = px[0] - int(py[0] / ((float)(eye_y - py[0]) / (eye_x - px[0]))); else px[2] = px[0];
							if (px[2] < 0) { py[2] = py[0] - int((float)(eye_y - py[0]) / (eye_x - px[0]) * px[0]); px[2] = 0; } else py[2] = 0;
							if (eye_x != px[1]) px[3] = px[1] - int(py[1] / ((float)(eye_y - py[1]) / (eye_x - px[1]))); else px[3] = px[1];
							if (px[3] > scr_x_size - 1) { py[3] = py[1] + int((float)(eye_y - py[1]) / (eye_x - px[1]) * (scr_x_size - 1 - px[1])); px[3] = scr_x_size - 1; } else py[3] = 0;
							if (py[2] > 0 && py[3] == 0) DrawPolygonRel(px[2], py[2], px[3], py[3], 0, 0, -1, aDarkBuffer, aDrawBuffer, aDrawRect);
							if (py[2] == 0 && py[3] > 0) DrawPolygonRel(px[2], py[2], px[3], py[3], scr_x_size - 1, 0, -1, aDarkBuffer, aDrawBuffer, aDrawRect);
							if (py[2] > 0 && py[3] > 0) { DrawPolygonRel(0, 0, px[3], py[3], scr_x_size - 1, 0, -1, aDarkBuffer, aDrawBuffer, aDrawRect); DrawPolygonRel(px[2], py[2], px[3], py[3], 0, 0, -1, aDarkBuffer, aDrawBuffer, aDrawRect); }
							draw_polys = 1;
						}
					// Situation 3
					if (blockx > eye_x && blocky + KBlockSpriteSize < eye_y)
						if (CheckCasting(xOffset + b, yOffset + a, 3, aLevel)) {
							px[0] = blockx; py[0] = blocky;
							px[1] = blockx + KBlockSpriteSize; py[1] = blocky + KBlockSpriteSize;
							py[2] = py[0] + int((float)(eye_y - py[0]) / (eye_x - px[0]) * (scr_x_size - 1 - px[0]));
							if (py[2] < 0) { px[2] = px[0] - int(py[0] / ((float)(eye_y - py[0]) / (eye_x - px[0]))); py[2] = 0; } else px[2] = scr_x_size - 1;
							if (px[2] < px[0]) px[2] = px[0];
							if (py[2] > py[0]) py[2] = py[0];
							py[3] = py[1] + int((float)(eye_y - py[1]) / (eye_x - px[1]) * (scr_x_size - 1 - px[1]));
							if (py[3] < 0) { px[3] = px[1] - int(py[1] / ((float)(eye_y - py[1]) / (eye_x - px[1]))); py[3] = 0; } else px[3] = scr_x_size - 1;
							if (px[3] < px[1]) { px[1] = scr_x_size - 1; px[3] = px[1]; }
							if (py[3] > py[1]) py[3] = py[1];
							if (px[2] != px[3]) DrawPolygonRel(px[2], py[2], px[3], py[3], scr_x_size - 1, 0, -1, aDarkBuffer, aDrawBuffer, aDrawRect);
							draw_polys = 1;
						}
					// Situation 4
					if (blockx < eye_x && blocky <= eye_y && blocky + KBlockSpriteSize >= eye_y)
						if (CheckCasting(xOffset + b, yOffset + a, 4, aLevel)) {
							px[0] = blockx + KBlockSpriteSize; py[0] = blocky + KBlockSpriteSize;
							px[1] = blockx + KBlockSpriteSize; py[1] = blocky - 1;
							py[2] = py[0] - int((float)(eye_y - py[0]) / (eye_x - px[0]) * px[0]);
							if (py[2] > drawH - 1) { px[2] = px[0] + int((drawH - 1 - py[0]) / ((float)(eye_y - py[0]) / (eye_x - px[0]))); py[2] = drawH - 1; } else px[2] = 0;
							py[3] = py[1] - int((float)(eye_y - py[1]) / (eye_x - px[1]) * px[1]);
							if (py[3] < 0) { px[3] = px[1] - int(py[1] / ((float)(eye_y - py[1]) / (eye_x - px[1]))); py[3] = 0; } else px[3] = 0;
							if (px[2] > 0 && px[3] == 0) DrawPolygonRel(px[2], py[2], px[3], py[3], 0, drawH - 1, -1, aDarkBuffer, aDrawBuffer, aDrawRect);
							if (px[2] == 0 && px[3] > 0) DrawPolygonRel(px[2], py[2], px[3], py[3], 0, 0, -1, aDarkBuffer, aDrawBuffer, aDrawRect);
							if (px[2] > 0 && px[3] > 0) { DrawPolygonRel(0, 0, px[2], py[2], 0, drawH - 1, -1, aDarkBuffer, aDrawBuffer, aDrawRect); DrawPolygonRel(px[2], py[2], px[3], py[3], 0, 0, -1, aDarkBuffer, aDrawBuffer, aDrawRect); }
							draw_polys = 1;
						}
					// Situation 5
					if (blockx > eye_x && blocky <= eye_y && blocky + KBlockSpriteSize >= eye_y)
						if (CheckCasting(xOffset + b, yOffset + a, 5, aLevel)) {
							px[0] = blockx; py[0] = blocky + KBlockSpriteSize;
							px[1] = blockx; py[1] = blocky - 1;
							py[2] = py[0] + int((float)(eye_y - py[0]) / (eye_x - px[0]) * (scr_x_size - 1 - px[0]));
							if (py[2] > drawH - 1) { px[2] = px[0] + int((drawH - py[0]) / ((float)(eye_y - py[0]) / (eye_x - px[0]))); py[2] = drawH - 1; } else px[2] = scr_x_size - 1;
							py[3] = py[1] + int((float)(eye_y - py[1]) / (eye_x - px[1]) * (scr_x_size - 1 - px[1]));
							if (py[3] < 0) { px[3] = px[1] - int(py[1] / ((float)(eye_y - py[1]) / (eye_x - px[1]))); py[3] = 0; } else px[3] = scr_x_size - 1;
							if (px[2] < scr_x_size - 1 && px[3] == scr_x_size - 1) DrawPolygonRel(px[2], py[2], px[3], py[3], scr_x_size - 1, drawH - 1, -1, aDarkBuffer, aDrawBuffer, aDrawRect);
							if (px[2] == scr_x_size - 1 && px[3] < scr_x_size - 1) DrawPolygonRel(px[2], py[2], px[3], py[3], scr_x_size - 1, 0, -1, aDarkBuffer, aDrawBuffer, aDrawRect);
							if (px[2] < scr_x_size - 1 && px[3] < scr_x_size - 1) { DrawPolygonRel(scr_x_size - 1, 0, px[2], py[2], scr_x_size - 1, drawH - 1, -1, aDarkBuffer, aDrawBuffer, aDrawRect); DrawPolygonRel(px[2], py[2], px[3], py[3], scr_x_size - 1, 0, -1, aDarkBuffer, aDrawBuffer, aDrawRect); }
							draw_polys = 1;
						}
					// Situation 6
					if (blockx + KBlockSpriteSize < eye_x && blocky > eye_y)
						if (CheckCasting(xOffset + b, yOffset + a, 6, aLevel)) {
							px[0] = blockx + KBlockSpriteSize; py[0] = blocky + KBlockSpriteSize;
							px[1] = blockx; py[1] = blocky;
							py[2] = py[0] - int((float)(eye_y - py[0]) / (eye_x - px[0]) * px[0]);
							if (py[2] > drawH - 1) { px[2] = px[0] + int((drawH - 1 - py[0]) / ((float)(eye_y - py[0]) / (eye_x - px[0]))); py[2] = drawH - 1; } else px[2] = 0;
							if (px[2] > px[0]) px[2] = px[0];
							if (py[2] < py[0]) py[2] = py[0];
							py[3] = py[1] - int((float)(eye_y - py[1]) / (eye_x - px[1]) * px[1]);
							if (py[3] > drawH - 1) { px[3] = px[1] + int((drawH - 1 - py[1]) / ((float)(eye_y - py[1]) / (eye_x - px[1]))); py[3] = drawH - 1; } else px[3] = 0;
							if (px[3] > px[1]) px[3] = px[1];
							if (py[3] < py[1]) py[3] = py[1];
							if (px[2] != px[3]) DrawPolygonRel(px[2], py[2], px[3], py[3], 0, drawH - 1, -1, aDarkBuffer, aDrawBuffer, aDrawRect);
							draw_polys = 1;
						}
					// Situation 7
					if (blockx + KBlockSpriteSize >= eye_x && blockx <= eye_x && blocky > eye_y)
						if (CheckCasting(xOffset + b, yOffset + a, 7, aLevel)) {
							px[0] = blockx - 1; py[0] = blocky;
							px[1] = blockx + KBlockSpriteSize; py[1] = blocky;
							if (eye_x != px[0]) px[2] = px[0] + int((drawH - 1 - py[0]) / ((float)(eye_y - py[0]) / (eye_x - px[0]))); else px[2] = px[0];
							if (px[2] < 0) { py[2] = py[0] - int(((float)(eye_y - py[0]) / (eye_x - px[0]) * px[0])); px[2] = 0; } else py[2] = drawH - 1;
							if (eye_x != px[1]) px[3] = px[1] + int((drawH - 1 - py[1]) / ((float)(eye_y - py[1]) / (eye_x - px[1]))); else px[3] = px[1];
							if (px[3] > scr_x_size - 1) { py[3] = py[1] + int((float)(eye_y - py[1]) / (eye_x - px[1]) * (scr_x_size - 1 - px[1])); px[3] = scr_x_size - 1; } else py[3] = drawH - 1;
							if (py[2] < drawH - 1 && py[3] == drawH - 1) DrawPolygonRel(px[2], py[2], px[3], py[3], 0, drawH - 1, -1, aDarkBuffer, aDrawBuffer, aDrawRect);
							if (py[2] == drawH - 1 && py[3] < drawH - 1) DrawPolygonRel(px[2], py[2], px[3], py[3], scr_x_size - 1, drawH - 1, -1, aDarkBuffer, aDrawBuffer, aDrawRect);
							if (py[2] < drawH - 1 && py[3] < drawH - 1) { DrawPolygonRel(0, drawH - 1, px[3], py[3], scr_x_size - 1, drawH - 1, -1, aDarkBuffer, aDrawBuffer, aDrawRect); DrawPolygonRel(px[2], py[2], px[3], py[3], 0, drawH - 1, -1, aDarkBuffer, aDrawBuffer, aDrawRect); }
							draw_polys = 1;
						}
					// Situation 8
					if (blockx > eye_x && blocky > eye_y)
						if (CheckCasting(xOffset + b, yOffset + a, 8, aLevel)) {
							px[0] = blockx; py[0] = blocky + KBlockSpriteSize;
							px[1] = blockx + KBlockSpriteSize; py[1] = blocky;
							py[2] = py[0] + int((float)(eye_y - py[0]) / (eye_x - px[0]) * (scr_x_size - 1 - px[0]));
							if (py[2] > drawH - 1) { px[2] = px[0] + int((drawH - 1 - py[0]) / ((float)(eye_y - py[0]) / (eye_x - px[0]))); py[2] = drawH - 1; } else px[2] = scr_x_size - 1;
							if (px[2] < px[0]) px[2] = px[0];
							if (py[2] < py[0]) py[2] = py[0];
							py[3] = py[1] + int((float)(eye_y - py[1]) / (eye_x - px[1]) * (scr_x_size - 1 - px[1]));
							if (py[3] > drawH - 1) { px[3] = px[1] + int((drawH - 1 - py[1]) / ((float)(eye_y - py[1]) / (eye_x - px[1]))); py[3] = drawH - 1; } else px[3] = scr_x_size - 1;
							if (px[3] < px[1]) { px[1] = scr_x_size - 1; px[3] = px[1]; }
							if (py[3] < py[1]) py[3] = py[1];
							if (px[2] != px[3]) DrawPolygonRel(px[2], py[2], px[3], py[3], scr_x_size - 1, drawH - 1, -1, aDarkBuffer, aDrawBuffer, aDrawRect);
							draw_polys = 1;
						}

					if (draw_polys) {
						DrawPolygonRel(px[0], py[0], px[1], py[1], px[2], py[2], -1, aDarkBuffer, aDrawBuffer, aDrawRect);
						DrawPolygonRel(px[2], py[2], px[3], py[3], px[1], py[1], -1, aDarkBuffer, aDrawBuffer, aDrawRect);
					}
				}
}

static void DrawWalls(Level* aLevel, Assets& a, GfxBuffer* aDrawBuffer, const RectI& aDrawRect, const CoordI& aPlayerScreenPos) {
	int xStart, xEnd, yStart, yEnd;
	int a2, b, offsetInsideBlockX, offsetInsideBlockY, xofs1, yofs1, xofs2, yofs2, size;
	int levelOffsetX, levelOffsetY;
	int perspectFixOffsetX[6];
	int perspectFixOffsetY[6];
	unsigned char col1, col2;
	const unsigned char* sprWallClr = a.wallClr.iBuf;
	if (aPlayerScreenPos.x >= 0) { offsetInsideBlockX = aPlayerScreenPos.x % KBlockSpriteSize; levelOffsetX = aPlayerScreenPos.x / KBlockSpriteSize; }
	else { offsetInsideBlockX = (KBlockSpriteSize - 1) + ((aPlayerScreenPos.x + 1) % KBlockSpriteSize); levelOffsetX = (aPlayerScreenPos.x + 1) / KBlockSpriteSize - 1; }
	if (aPlayerScreenPos.y >= 0) { offsetInsideBlockY = aPlayerScreenPos.y % KBlockSpriteSize; levelOffsetY = aPlayerScreenPos.y / KBlockSpriteSize; }
	else { offsetInsideBlockY = (KBlockSpriteSize - 1) + ((aPlayerScreenPos.y + 1) % KBlockSpriteSize); levelOffsetY = (aPlayerScreenPos.y + 1) / KBlockSpriteSize - 1; }
	int ScrBlockHalfWidth = int(ceilf(aDrawRect.r / (KBlockSpriteSize * 2.0f)));
	int ScrBlockHalfHeight = int(ceilf(aDrawRect.b / (KBlockSpriteSize * 2.0f)));
	for (b = 0; b < 6; b++) {
		perspectFixOffsetX[b] = (int)((-offsetInsideBlockX) + ((-offsetInsideBlockX) / (float)KBlockSpriteSize - ScrBlockHalfWidth) * b);
		perspectFixOffsetY[b] = (int)((-offsetInsideBlockY) + ((-offsetInsideBlockY) / (float)KBlockSpriteSize - ScrBlockHalfHeight) * b);
	}
	yStart = 0; yEnd = (int)ceilf(aDrawRect.b / 40.0f);
	for (a2 = yStart; a2 < yEnd; a2++) {
		xStart = 0; xEnd = (int)ceilf(aDrawRect.r / 40.0f);
		yofs1 = (a2 * KBlockSpriteSize) - offsetInsideBlockY;
		for (b = xStart; b < xEnd; b++) {
			TBlock& block = aLevel->LevelData(levelOffsetX + b, levelOffsetY + a2);
			xofs1 = (b * KBlockSpriteSize) - offsetInsideBlockX;
			if (levelOffsetX + b >= 0 && levelOffsetX + b < aLevel->iWidth && levelOffsetY + a2 >= 0 && levelOffsetY + a2 < aLevel->iHeight) {
				if (!Level::FloorLevel(block)) {
					xofs2 = perspectFixOffsetX[block.iHeight] + b * (block.iHeight + KBlockSpriteSize);
					yofs2 = perspectFixOffsetY[block.iHeight] + a2 * (block.iHeight + KBlockSpriteSize);
					size = KBlockSpriteSize + block.iHeight;
					col1 = sprWallClr[block.iNumber + 16 * (block.iNumber / 16)];
					col2 = sprWallClr[block.iNumber + 16 * (block.iNumber / 16) + 16];
					if (!(aLevel->LevelData(levelOffsetX + b, levelOffsetY + a2 + 1).iType == 1 && aLevel->LevelData(levelOffsetX + b, levelOffsetY + a2 + 1).iHeight >= block.iHeight)) {
						DrawPolygonRel(xofs2 - 1, yofs2 + size, xofs1 - 1, yofs1 + KBlockSpriteSize, xofs1 + KBlockSpriteSize, yofs1 + KBlockSpriteSize, col2, NULL, aDrawBuffer, aDrawRect);
						DrawPolygonRel(xofs2 - 1, yofs2 + size, xofs2 + size, yofs2 + size, xofs1 + KBlockSpriteSize, yofs1 + KBlockSpriteSize, col2, NULL, aDrawBuffer, aDrawRect);
					}
					if (!(aLevel->LevelData(levelOffsetX + b + 1, levelOffsetY + a2).iType == 1 && aLevel->LevelData(levelOffsetX + b + 1, levelOffsetY + a2).iHeight >= block.iHeight)) {
						DrawPolygonRel(xofs2 + size, yofs2 + size, xofs1 + KBlockSpriteSize, yofs1 + KBlockSpriteSize, xofs2 + size, yofs2 - 1, col1 + 1, NULL, aDrawBuffer, aDrawRect);
						DrawPolygonRel(xofs1 + KBlockSpriteSize, yofs1 - 1, xofs1 + KBlockSpriteSize, yofs1 + KBlockSpriteSize, xofs2 + size, yofs2 - 1, col1 + 1, NULL, aDrawBuffer, aDrawRect);
					}
					if (xofs2 + block.iHeight + KBlockSpriteSize > 0 && yofs2 + block.iHeight + KBlockSpriteSize > 0) {
						DrawBlock(aDrawRect.l + xofs2, aDrawRect.t + yofs2, block.iType, block.iNumber, block.iHeight, a, aDrawBuffer, aDrawRect);
						DrawWallShadow(aDrawRect.l + xofs2, aDrawRect.t + yofs2, block.iShadow, block.iHeight + KBlockSpriteSize, a, aDrawBuffer, aDrawRect);
					}
				}
			} else {
				xofs2 = int(perspectFixOffsetX[aLevel->iOutBlock.iHeight] + b * (aLevel->iOutBlock.iHeight + (float)KBlockSpriteSize));
				yofs2 = int(perspectFixOffsetY[aLevel->iOutBlock.iHeight] + a2 * (aLevel->iOutBlock.iHeight + (float)KBlockSpriteSize));
				DrawBlock(aDrawRect.l + xofs2, aDrawRect.t + yofs2, aLevel->iOutBlock.iType, aLevel->iOutBlock.iNumber, aLevel->iOutBlock.iHeight, a, aDrawBuffer, aDrawRect);
			}
		}
		// upper right
		xStart = (int)ceilf(aDrawRect.r / (float)KBlockSpriteSize);
		for (b = xStart; b >= xEnd; b--) {
			TBlock& block = aLevel->LevelData(levelOffsetX + b, levelOffsetY + a2);
			xofs1 = (b * KBlockSpriteSize) - offsetInsideBlockX;
			if (levelOffsetX + b >= 0 && levelOffsetX + b < aLevel->iWidth && levelOffsetY + a2 >= 0 && levelOffsetY + a2 < aLevel->iHeight) {
				if (!Level::FloorLevel(block)) {
					size = KBlockSpriteSize + block.iHeight;
					col1 = sprWallClr[block.iNumber + 16 * (block.iNumber / 16)];
					col2 = sprWallClr[block.iNumber + 16 * (block.iNumber / 16) + 16];
					xofs2 = perspectFixOffsetX[block.iHeight] + b * (block.iHeight + KBlockSpriteSize);
					yofs2 = perspectFixOffsetY[block.iHeight] + a2 * (block.iHeight + KBlockSpriteSize);
					if (!(aLevel->LevelData(levelOffsetX + b, levelOffsetY + a2 + 1).iType == 1 && aLevel->LevelData(levelOffsetX + b, levelOffsetY + a2 + 1).iHeight >= block.iHeight)) {
						DrawPolygonRel(xofs2 - 1, yofs2 + size, xofs1 - 1, yofs1 + KBlockSpriteSize, xofs1 + KBlockSpriteSize, yofs1 + KBlockSpriteSize, col2, NULL, aDrawBuffer, aDrawRect);
						DrawPolygonRel(xofs2 - 1, yofs2 + size, xofs2 + size, yofs2 + size, xofs1 + KBlockSpriteSize, yofs1 + KBlockSpriteSize, col2, NULL, aDrawBuffer, aDrawRect);
					}
					if (!(aLevel->LevelData(levelOffsetX + b - 1, levelOffsetY + a2).iType == 1 && aLevel->LevelData(levelOffsetX + b - 1, levelOffsetY + a2).iHeight >= block.iHeight) && xofs2 > xofs1) {
						DrawPolygonRel(xofs2 - 1, yofs2 - 1, xofs1 - 1, yofs1 - 1, xofs2 - 1, yofs2 + size, col2 - 1, NULL, aDrawBuffer, aDrawRect);
						DrawPolygonRel(xofs1 - 1, yofs1 + KBlockSpriteSize, xofs1 - 1, yofs1 - 1, xofs2 - 1, yofs2 + size, col2 - 1, NULL, aDrawBuffer, aDrawRect);
					}
					if (xofs2 < aDrawRect.r && yofs2 + block.iHeight + KBlockSpriteSize > 0) {
						DrawBlock(aDrawRect.l + xofs2, aDrawRect.t + yofs2, block.iType, block.iNumber, block.iHeight, a, aDrawBuffer, aDrawRect);
						DrawWallShadow(aDrawRect.l + xofs2, aDrawRect.t + yofs2, block.iShadow, block.iHeight + KBlockSpriteSize, a, aDrawBuffer, aDrawRect);
					}
				}
			} else {
				xofs2 = int(perspectFixOffsetX[aLevel->iOutBlock.iHeight] + b * (aLevel->iOutBlock.iHeight + (float)KBlockSpriteSize));
				yofs2 = int(perspectFixOffsetY[aLevel->iOutBlock.iHeight] + a2 * (aLevel->iOutBlock.iHeight + (float)KBlockSpriteSize));
				DrawBlock(aDrawRect.l + xofs2, aDrawRect.t + yofs2, aLevel->iOutBlock.iType, aLevel->iOutBlock.iNumber, aLevel->iOutBlock.iHeight, a, aDrawBuffer, aDrawRect);
			}
		}
	}
	// lower left
	yStart = (int)ceilf(aDrawRect.b / (float)KBlockSpriteSize);
	for (a2 = yStart; a2 >= yEnd; a2--) {
		xStart = 0; xEnd = (int)ceilf(aDrawRect.r / 40.0f);
		yofs1 = (a2 * KBlockSpriteSize) - offsetInsideBlockY;
		for (b = xStart; b < xEnd; b++) {
			TBlock& block = aLevel->LevelData(levelOffsetX + b, levelOffsetY + a2);
			xofs1 = (b * KBlockSpriteSize) - offsetInsideBlockX;
			if (levelOffsetX + b >= 0 && levelOffsetX + b < aLevel->iWidth && levelOffsetY + a2 >= 0 && levelOffsetY + a2 < aLevel->iHeight) {
				if (!Level::FloorLevel(block)) {
					size = KBlockSpriteSize + block.iHeight;
					col1 = sprWallClr[block.iNumber + 16 * (block.iNumber / 16)];
					col2 = sprWallClr[block.iNumber + 16 * (block.iNumber / 16) + 16];
					xofs2 = perspectFixOffsetX[block.iHeight] + b * (block.iHeight + KBlockSpriteSize);
					yofs2 = perspectFixOffsetY[block.iHeight] + a2 * (block.iHeight + KBlockSpriteSize);
					if (yofs2 > yofs1 && !(aLevel->LevelData(levelOffsetX + b, levelOffsetY + a2 - 1).iType == 1 && aLevel->LevelData(levelOffsetX + b, levelOffsetY + a2 - 1).iHeight >= block.iHeight)) {
						DrawPolygonRel(xofs2 - 1, yofs2 - 1, xofs1 - 1, yofs1 - 1, xofs1 + KBlockSpriteSize, yofs1 - 1, col1, NULL, aDrawBuffer, aDrawRect);
						DrawPolygonRel(xofs2 - 1, yofs2 - 1, xofs2 + size, yofs2 - 1, xofs1 + KBlockSpriteSize, yofs1 - 1, col1, NULL, aDrawBuffer, aDrawRect);
					}
					if (!(aLevel->LevelData(levelOffsetX + b + 1, levelOffsetY + a2).iType == 1 && aLevel->LevelData(levelOffsetX + b + 1, levelOffsetY + a2).iHeight >= block.iHeight)) {
						DrawPolygonRel(xofs2 + size, yofs2 + size, xofs1 + KBlockSpriteSize, yofs1 + KBlockSpriteSize, xofs2 + size, yofs2 - 1, col1 + 1, NULL, aDrawBuffer, aDrawRect);
						DrawPolygonRel(xofs1 + KBlockSpriteSize, yofs1 - 1, xofs1 + KBlockSpriteSize, yofs1 + KBlockSpriteSize, xofs2 + size, yofs2 - 1, col1 + 1, NULL, aDrawBuffer, aDrawRect);
					}
					if (xofs2 + block.iHeight + KBlockSpriteSize > 0 && yofs2 < aDrawRect.b) {
						DrawBlock(aDrawRect.l + xofs2, aDrawRect.t + yofs2, block.iType, block.iNumber, block.iHeight, a, aDrawBuffer, aDrawRect);
						DrawWallShadow(aDrawRect.l + xofs2, aDrawRect.t + yofs2, block.iShadow, block.iHeight + KBlockSpriteSize, a, aDrawBuffer, aDrawRect);
					}
				}
			} else {
				xofs2 = int(perspectFixOffsetX[aLevel->iOutBlock.iHeight] + b * (aLevel->iOutBlock.iHeight + (float)KBlockSpriteSize));
				yofs2 = int(perspectFixOffsetY[aLevel->iOutBlock.iHeight] + a2 * (aLevel->iOutBlock.iHeight + (float)KBlockSpriteSize));
				DrawBlock(aDrawRect.l + xofs2, aDrawRect.t + yofs2, aLevel->iOutBlock.iType, aLevel->iOutBlock.iNumber, aLevel->iOutBlock.iHeight, a, aDrawBuffer, aDrawRect);
			}
		}
		// lower right
		xStart = (int)ceilf(aDrawRect.r / (float)KBlockSpriteSize);
		for (b = xStart; b >= xEnd; b--) {
			TBlock& block = aLevel->LevelData(levelOffsetX + b, levelOffsetY + a2);
			xofs1 = (b * KBlockSpriteSize) - offsetInsideBlockX;
			if (levelOffsetX + b >= 0 && levelOffsetX + b < aLevel->iWidth && levelOffsetY + a2 >= 0 && levelOffsetY + a2 < aLevel->iHeight) {
				if (!Level::FloorLevel(block)) {
					size = KBlockSpriteSize + block.iHeight;
					col1 = sprWallClr[block.iNumber + 16 * (block.iNumber / 16)];
					col2 = sprWallClr[block.iNumber + 16 * (block.iNumber / 16) + 16];
					xofs2 = perspectFixOffsetX[block.iHeight] + b * (block.iHeight + KBlockSpriteSize);
					yofs2 = perspectFixOffsetY[block.iHeight] + a2 * (block.iHeight + KBlockSpriteSize);
					if (yofs2 > yofs1 && !(aLevel->LevelData(levelOffsetX + b, levelOffsetY + a2 - 1).iType == 1 && aLevel->LevelData(levelOffsetX + b, levelOffsetY + a2 - 1).iHeight >= block.iHeight)) {
						DrawPolygonRel(xofs1 + KBlockSpriteSize, yofs1 - 1, xofs2 - 1, yofs2 - 1, xofs1 - 1, yofs1 - 1, col1, NULL, aDrawBuffer, aDrawRect);
						DrawPolygonRel(xofs2 - 1, yofs2 - 1, xofs2 + size, yofs2 - 1, xofs1 + KBlockSpriteSize, yofs1 - 1, col1, NULL, aDrawBuffer, aDrawRect);
					}
					if (xofs2 > xofs1 && !(aLevel->LevelData(levelOffsetX + b - 1, levelOffsetY + a2).iType == 1 && aLevel->LevelData(levelOffsetX + b - 1, levelOffsetY + a2).iHeight >= block.iHeight)) {
						DrawPolygonRel(xofs2 - 1, yofs2 - 1, xofs1 - 1, yofs1 - 1, xofs2 - 1, yofs2 + size, col2 - 1, NULL, aDrawBuffer, aDrawRect);
						DrawPolygonRel(xofs1 - 1, yofs1 + KBlockSpriteSize, xofs1 - 1, yofs1 - 1, xofs2 - 1, yofs2 + size, col2 - 1, NULL, aDrawBuffer, aDrawRect);
					}
					if (xofs2 < aDrawRect.r && yofs2 < aDrawRect.b) {
						DrawBlock(aDrawRect.l + xofs2, aDrawRect.t + yofs2, block.iType, block.iNumber, block.iHeight, a, aDrawBuffer, aDrawRect);
						DrawWallShadow(aDrawRect.l + xofs2, aDrawRect.t + yofs2, block.iShadow, block.iHeight + KBlockSpriteSize, a, aDrawBuffer, aDrawRect);
					}
				}
			} else {
				xofs2 = int(perspectFixOffsetX[aLevel->iOutBlock.iHeight] + b * (aLevel->iOutBlock.iHeight + (float)KBlockSpriteSize));
				yofs2 = int(perspectFixOffsetY[aLevel->iOutBlock.iHeight] + a2 * (aLevel->iOutBlock.iHeight + (float)KBlockSpriteSize));
				DrawBlock(aDrawRect.l + xofs2, aDrawRect.t + yofs2, aLevel->iOutBlock.iType, aLevel->iOutBlock.iNumber, aLevel->iOutBlock.iHeight, a, aDrawBuffer, aDrawRect);
			}
		}
	}
}

// ---- light maps + DrawLight (CLightMap / CGameDrawer::DrawLight) ----
static const int KLightAmount = 10;

// CLightMap::Make — writes `aSize*aSize` light strengths.
static void SimMakeLightMap(int aSize, unsigned char* out) {
	int a, b;
	int hsize = aSize / 2;
	memset(out, 0, (size_t)aSize * aSize);
	for (a = 0; a < aSize; a++)
		for (b = 0; b < aSize; b++) {
			int dist = (int)sqrt((float)((a - hsize) * (a - hsize) + (b - hsize) * (b - hsize)));
			int iOffset = (a * aSize) + b;
			int pow = 16 - (int)(dist * (float)(16 / (float)(aSize / 2)));
			if (pow > 15) pow = 15;
			if (pow < 0) pow = 0;
			out[iOffset] = (unsigned char)pow;
		}
}

// CGameDrawer::DrawLight — near-verbatim (light tables come from palette.tab).
static void SimDrawLight(const unsigned char* aLightTable, const unsigned char* aLightMap,
	int aLightMapSize, int aPosX, int aPosY, int aAdd,
	GfxBuffer* aDrawBuffer, const RectI& aDrawRect) {
	int xs = aLightMapSize, ys = aLightMapSize;
	int px = aPosX - xs / 2;
	int py = aPosY - ys / 2;
	RectI clip = ClipRect(px, py, xs, ys, aDrawRect);
	if (!RectValid(clip)) return;
	int ycount, xcount;
	int offset = xs * clip.t + clip.l;
	unsigned char* dbuf = aDrawBuffer->iBuf + (py + clip.t) * aDrawBuffer->Width() + px + clip.l;
	int cw = RectW(clip);
	for (ycount = clip.t; ycount < clip.b; ycount++, dbuf += aDrawBuffer->Width() - cw, offset += xs - cw)
		for (xcount = clip.l; xcount < clip.r; xcount++, offset++, dbuf++) {
			int sum = aLightMap[offset];
			if (sum) {
				sum += aAdd;
				if (sum < 0) sum = 0;
				else if (sum > 15) sum = 15;
				*dbuf = aLightTable[*dbuf * 16 + sum];
			}
		}
}

// ---- static frame composition ----
static void DrawStaticFrame(Level& lvl, Assets& a, GfxBuffer* draw, GfxBuffer* dark, const RectI& drawRect, const CoordI& scr, float locX, float locY) {
	DrawFloor(lvl, a, draw, dark, drawRect, scr);
	DrawShadows(&lvl, a, draw, drawRect, scr);
	DrawBlackPartsOfLevel(&lvl, a, draw, dark, drawRect, scr, locX, locY);
	DrawWalls(&lvl, a, draw, drawRect, scr);
}

// ---- asset bundle loading (matches CIngameData) ----
static bool LoadAssets(const std::string& dir, Assets& a, Palette& pal) {
	if (!LoadEFP((dir + "/efps/walls1.efp").c_str(), a.walls[0], &pal)) return false;
	if (!LoadEFP((dir + "/efps/floor1.efp").c_str(), a.floor, NULL)) return false;
	if (!LoadEFP((dir + "/efps/polycolr.efp").c_str(), a.wallClr, NULL)) return false;
	if (!LoadEFP((dir + "/efps/crates.efp").c_str(), a.crate, NULL)) return false;
	if (!LoadEFP((dir + "/efps/target.efp").c_str(), a.target, NULL)) return false;
	MakeFloors(pal, a.floor, a.floor2);
	MakeFloors(pal, a.walls[0], a.wall2);
	ZoomWall(a.walls[0], a.walls[1], 0);
	ZoomWall(a.walls[0], a.walls[2], 1);
	ZoomWall(a.walls[0], a.walls[3], 2);
	ZoomWall(a.walls[0], a.walls[4], 3);
	ZoomWall(a.walls[0], a.walls[5], 4);
	// shadow + transparency tables from palette.tab
	FILE* f = fopen((dir + "/palette.tab").c_str(), "rb");
	if (!f) { fprintf(stderr, "cannot open palette.tab\n"); return false; }
	unsigned char* tab = (unsigned char*)malloc(86016);
	size_t rd = fread(tab, 1, 86016, f); (void)rd; fclose(f);
	a.transparency = tab;
	a.shadowTable = tab + 65536;
	return true;
}

// ---- CGraphicsBuffer::Rectangle / CGameDrawer::DrawMapPixel ----
static void SimRectangle(GfxBuffer* b, int aX1, int aY1, int aX2, int aY2, unsigned char aCol) {
	int a, offs, offs1, offs2, offs3, w = b->Width();
	offs1 = aY1 * w + aX1;
	offs2 = aY1 * w + aX2;
	offs3 = aY2 * w + aX1;
	memset(b->iBuf + offs1, aCol, (aX2 - aX1) + 1);
	memset(b->iBuf + offs3, aCol, (aX2 - aX1) + 1);
	for (a = 0, offs = offs1 + w; a < (aY2 - aY1) - 1; a++, offs += w) b->iBuf[offs] = aCol;
	for (a = 0, offs = offs2 + w; a < (aY2 - aY1) - 1; a++, offs += w) b->iBuf[offs] = aCol;
}

static void SimDrawMapPixel(GfxBuffer* b, const unsigned char* shadowTable, int aOffset, int aSize, int aColor) {
	for (int a = 0; a < aSize; a++)
		for (int bb = 0; bb < aSize; bb++) {
			int i = aOffset + a * b->Width() + bb;
			if (aColor >= 0) b->iBuf[i] = (unsigned char)aColor;
			else b->iBuf[i] = shadowTable[b->iBuf[i] * 16 + 15];
		}
}

// ---- CGameDrawer::DrawTransSprite (transparency table) ----
static void DrawTransSprite(int aX, int aY, int aXS, int aYS, const GfxBuffer* aSprite, int aOffset,
	GfxBuffer* aDrawBuffer, const unsigned char* transparency, const RectI& aDrawRect) {
	RectI clip = ClipRect(aX, aY, aXS, aYS, aDrawRect);
	if (!RectValid(clip)) return;
	int sprOfs = aOffset + clip.l + clip.t * aSprite->Width();
	unsigned char* dbuf = aDrawBuffer->iBuf + (aY + clip.t) * aDrawBuffer->Width() + aX + clip.l;
	for (int a = 0; a < RectH(clip); a++, dbuf += aDrawBuffer->Width(), sprOfs += aSprite->Width())
		for (int b = 0; b < RectW(clip); b++) {
			unsigned char colo = aSprite->iBuf[sprOfs + b];
			if (colo != 0) dbuf[b] = transparency[colo * 256 + dbuf[b]];
		}
}

#endif
