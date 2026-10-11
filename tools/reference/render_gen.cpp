// Reference oracle for the rendering path: static level (floor, block shadows,
// camera-cone black parts, pseudo-3D walls), lights, and the HUD/fonts. The
// draw code lives in tkreference.h / simreference.h as near-verbatim copies of
// the original C++.
//
// Build:  g++ -O2 -o render_gen render_gen.cpp -lm
// Usage:
//   render_gen <leveldump.bin> <datadir> <out.raw> <locX> <locY> [W] [H]
//     static level frame.
//   render_gen lightmap <out.raw>
//     dumps the ten light maps (CLightMap::Make).
//   render_gen lightrender <palette.tab> <out.raw>
//     applies eight synthetic lights to a patterned buffer.
//   render_gen fontwrite <datadir> <out.raw>
//     renders a fixed set of strings through CFonts::Write.
//   render_gen hud <leveldump.bin> <datadir> <out.raw>
//     composes the deterministic HUD/font primitives for a synthetic player.
//
// The level dump holds *raw* (pre-derived-map) block data so the oracle also
// recomputes ModifyBorderBlocks / DarknessCast / GenerateShadows itself:
//   u32 version, u32 width, u32 height,
//   width*height * (i32 type, i32 number, i32 height),
//   i32 outType, i32 outNumber, i32 outHeight,
//   u32 startCount, startCount * (i32 x, i32 y)
//
// Static-frame output: uint32 width (LE), uint32 height (LE), then w*h bytes.

#include "simreference.h"

// ---- level dump loading (shared) ----
static bool LoadLevelDump(const char* dumpPath, Level& lv) {
	FILE* f = fopen(dumpPath, "rb");
	if (!f) { fprintf(stderr, "cannot open %s\n", dumpPath); return false; }
	unsigned int version = 0, w = 0, h = 0, startCount = 0;
	if (fread(&version, 4, 1, f) != 1 || fread(&w, 4, 1, f) != 1 || fread(&h, 4, 1, f) != 1) { fprintf(stderr, "short dump\n"); return false; }
	lv.iWidth = (int)w; lv.iHeight = (int)h;
	lv.blocks.resize((size_t)w * h);
	for (size_t i = 0; i < lv.blocks.size(); i++) {
		int t, n, hh;
		if (fread(&t, 4, 1, f) != 1 || fread(&n, 4, 1, f) != 1 || fread(&hh, 4, 1, f) != 1) { fprintf(stderr, "short dump (blocks)\n"); return false; }
		lv.blocks[i].iType = t; lv.blocks[i].iNumber = n;
		// Old-format levels store no per-block height; derive it from the
		// block number here so the oracle independently validates KBlockHeights.
		if (version < 6 && t != 0) lv.blocks[i].iHeight = KBlockHeights[n];
		else lv.blocks[i].iHeight = hh;
	}
	int ot, on, oh;
	if (fread(&ot, 4, 1, f) != 1 || fread(&on, 4, 1, f) != 1 || fread(&oh, 4, 1, f) != 1) { fprintf(stderr, "short dump (outblock)\n"); return false; }
	lv.iOutBlock.iType = ot; lv.iOutBlock.iNumber = on;
	lv.iOutBlock.iHeight = version < 6 ? KBlockHeights[on] : oh;
	if (fread(&startCount, 4, 1, f) != 1) { fprintf(stderr, "short dump (starts)\n"); return false; }
	for (unsigned int i = 0; i < startCount; i++) {
		int sx, sy;
		if (fread(&sx, 4, 1, f) != 1 || fread(&sy, 4, 1, f) != 1) { fprintf(stderr, "short dump (start)\n"); return false; }
		CoordI c; c.x = sx; c.y = sy; lv.iPlStart.push_back(c);
	}
	fclose(f);
	ModifyBorderBlocks(lv);
	DarknessCast(lv);
	GenerateShadows(lv);
	return true;
}

// ---- extra oracle modes (lights) ----
static void WriteLightMaps(const char* outPath) {
	FILE* out = fopen(outPath, "wb");
	unsigned char buf[60 * 60];
	for (int a = 0; a < KLightAmount; a++) {
		int size = 15 + a * 5;
		SimMakeLightMap(size, buf);
		fwrite(buf, 1, (size_t)size * size, out);
	}
	fclose(out);
	printf("wrote %s\n", outPath);
}

static void RenderLights(const char* paletteTab, const char* outPath) {
	unsigned char* tab = (unsigned char*)malloc(86016);
	FILE* tf = fopen(paletteTab, "rb");
	if (!tf) { fprintf(stderr, "cannot open %s\n", paletteTab); free(tab); return; }
	size_t rd = fread(tab, 1, 86016, tf); (void)rd; fclose(tf);
	// layout: transparency[65536], shadow[4096], then 4 light tables [4096 each].
	const unsigned char* lights = tab + 65536 + 4096;
	const unsigned char* normal = lights;
	const unsigned char* red = lights + 4096;
	const unsigned char* yellow = lights + 8192;
	const unsigned char* explosion = lights + 12288;

	static unsigned char maps[KLightAmount][60 * 60];
	for (int a = 0; a < KLightAmount; a++) SimMakeLightMap(15 + a * 5, maps[a]);

	const int W = 200, H = 150;
	GfxBuffer draw; draw.Resize(W, H);
	for (int i = 0; i < W * H; i++) draw.iBuf[i] = (unsigned char)((i * 7) & 0xff);
	RectI drawRect(0, 0, W, H);

	SimDrawLight(normal, maps[2], 25, 30, 40, -10, &draw, drawRect);
	SimDrawLight(normal, maps[2], 25, 30, 40, 0, &draw, drawRect);
	SimDrawLight(explosion, maps[7], 50, 100, 75, 3, &draw, drawRect);
	SimDrawLight(yellow, maps[3], 30, 100, 75, -1, &draw, drawRect);
	SimDrawLight(red, maps[4], 35, 5, 5, 2, &draw, drawRect);
	SimDrawLight(normal, maps[0], 15, 199, 149, 15, &draw, drawRect);
	SimDrawLight(explosion, maps[9], 60, 150, 120, -5, &draw, drawRect);
	SimDrawLight(normal, maps[1], 20, 0, 0, 4, &draw, drawRect);

	FILE* out = fopen(outPath, "wb");
	fwrite(draw.iBuf, 1, (size_t)W * H, out);
	fclose(out);
	free(tab);
	printf("wrote %s\n", outPath);
}

// ---- font-only oracle (CFonts::Write) ----
static void RenderFontWrite(const char* dataDirIn, const char* outPath) {
	std::string dir(dataDirIn);
	SimFont f;
	if (!f.Load((dir + "/fnts/8x8b.fnt").c_str(), true)) return;
	SimFont menu;
	if (!menu.Load((dir + "/fnts/menu15x18dark.fnt").c_str(), false)) return;

	const int W = 320, H = 200;
	GfxBuffer draw; draw.Resize(W, H);
	for (int i = 0; i < W * H; i++) draw.iBuf[i] = (unsigned char)((i * 5 + 3) & 0x3f);
	RectI dr(0, 0, W, H);

	// 8x8b (oneIsZero): all three horizontal and vertical alignments.
	SimFontWrite(f, 4, 4, (const unsigned char*)"Hello, World! 0123", 0, 0, &draw);
	SimFontWrite(f, 160, 30, (const unsigned char*)"centered", 1, 1, &draw);
	SimFontWrite(f, 310, 60, (const unsigned char*)"right", 0, 2, &draw);
	SimFontWrite(f, 40, 90, (const unsigned char*)"above me", 2, 0, &draw);
	SimFontWrite(f, 10, 150, (const unsigned char*)"tab\ttest", 0, 0, &draw);
	SimFontWrite(f, 10, 170, (const unsigned char*)"jY{}[]<>=+-*/", 0, 0, &draw);
	// menu font (not oneIsZero): explicit setScale path.
	menu.iScaleX = 2;
	menu.iScaleY = 2;
	SimFontWrite(menu, 8, 120, (const unsigned char*)"BIG", 1, 0, &draw);

	FILE* out = fopen(outPath, "wb");
	fwrite(draw.iBuf, 1, (size_t)W * H, out);
	fclose(out);
	printf("wrote %s\n", outPath);
}

// ---- fader oracle (CGraphicsFader::DrawPhase / DrawZoom) ----
static void RenderFader(const char* outPath) {
	const int W = 320, H = 200;
	GfxBuffer src; src.Resize(W, H);
	for (int i = 0; i < W * H; i++) src.iBuf[i] = (unsigned char)((i * 7) & 0x3f);
	GfxBuffer dest; dest.Resize(W, H);

	int iSine[256];
	for (int a = 0; a < 256; a++) iSine[a] = (int)(255 * (sin((float)a / 256 * pi * 2)));

	// DrawPhase(phase = 77)
	{
		const int phase = 77;
		dest.Fill(0);
		int l = (phase * 30) >> 8;
		const unsigned char* srcptr = src.iBuf;
		unsigned char* dstptr = dest.iBuf;
		for (int y = 0; y < H; y++) {
			int yfix = (l * iSine[(y + phase) & 0xff]) >> 8;
			if (yfix + y < 0 || yfix + y >= H) memset(dstptr, 0, W);
			else {
				int yf = yfix * W;
				for (int x = 0; x < W; x++) {
					int xfix = x + ((l * iSine[(x + phase) & 0xff]) >> 8);
					if (xfix > 0 && xfix < W) dstptr[x] = srcptr[xfix + yf];
					else dstptr[x] = 0;
				}
			}
			srcptr += W; dstptr += W;
		}
	}

	// DrawZoom(mul = 0.6f)
	GfxBuffer zoom; zoom.Resize(W, H);
	{
		float mul = 0.6f;
		int dstw = W, dsth = H, srcw = W;
		unsigned char* dstbuf = zoom.iBuf;
		const unsigned char* srcbuf = src.iBuf;
		float yoffs = (dsth * (1.0f - mul)) / 2.0f;
		for (int y = 0; y < dsth; y++) {
			float xoffs = (dstw * (1.0f - mul)) / 2.0f;
			int iyo = (int)yoffs;
			for (int x = 0; x < dstw; x++) {
				int ixo = (int)xoffs;
				(*dstbuf) = srcbuf[iyo * srcw + ixo];
				xoffs += mul;
				dstbuf++;
			}
			yoffs += mul;
		}
	}

	FILE* out = fopen(outPath, "wb");
	fwrite(dest.iBuf, 1, (size_t)W * H, out);
	fwrite(zoom.iBuf, 1, (size_t)W * H, out);
	fclose(out);
	printf("wrote %s\n", outPath);
}

// ---- PCX oracle (CGraphicsBuffer::LoadPCX) ----
static void RenderPcx(const char* fileIn, const char* outPath) {
	GfxBuffer img; Palette pal;
	if (!LoadPCX(fileIn, img, &pal)) return;
	FILE* out = fopen(outPath, "wb");
	unsigned int w = (unsigned int)img.Width(), h = (unsigned int)img.Height();
	fwrite(&w, 4, 1, out); fwrite(&h, 4, 1, out);
	fwrite(img.iBuf, 1, (size_t)w * h, out);
	unsigned char palb[768];
	pal.AppendPalette(palb);
	fwrite(palb, 1, 768, out);
	fclose(out);
	printf("wrote %s\n", outPath);
}

// ---- message board oracle (CMessageBoard) ----
static void RenderMessageBoard(const char* dataDirIn, const char* outPath) {
	std::string dir(dataDirIn);
	SimFont f;
	if (!f.Load((dir + "/fnts/8x8b.fnt").c_str(), true)) return;

	const int W = 320, H = 96;
	GfxBuffer draw; draw.Resize(W, H);
	for (int i = 0; i < W * H; i++) draw.iBuf[i] = (unsigned char)((i * 5 + 3) & 0x3f);

	// Same ring-buffer/truncation rules as CMessageBoard::AddMessage.
	const int KMaxMessagesOnBoard = 6;
	const int KMaxMessagesLengthOnBoard = 80;
	std::vector<std::string> msgs;
	const char* input[] = {
		"Sound system initialization FAILED!",
		"Mouse sensitivity 0.55",
		"Mouse mode: relative",
		"Effect volume: 65%",
		"Music volume: 30%",
		"Screen capture disabled in DEBUG version. Sorry!",
		"This one is pushed out of the ring by the next line",
		"A very long message that is certainly longer than eighty characters and must be truncated by the board okay",
	};
	for (size_t i = 0; i < sizeof(input) / sizeof(input[0]); i++) {
		std::string str = input[i];
		if (str.length() > (size_t)KMaxMessagesLengthOnBoard)
			str = str.substr(0, KMaxMessagesLengthOnBoard - 3) + "...";
		msgs.push_back(str);
		while ((int)msgs.size() > KMaxMessagesOnBoard) msgs.erase(msgs.begin());
	}

	const int yoffs = 5 + 16; // deathmatch offset
	const int lineHeight = f.Height() + 1;
	for (int a = 0; a < (int)msgs.size(); a++)
		SimFontWrite(f, 5, yoffs + a * lineHeight, (const unsigned char*)msgs[a].c_str(), 0, 0, &draw);

	FILE* out = fopen(outPath, "wb");
	fwrite(draw.iBuf, 1, (size_t)W * H, out);
	fclose(out);
	printf("wrote %s\n", outPath);
}

// ---- HUD oracle (CGameDrawManager HUD primitives) ----
static void RenderHud(const char* dumpPath, const char* dataDirIn, const char* outPath) {
	Level lv;
	if (!LoadLevelDump(dumpPath, lv)) return;
	lv.GenerateReachableMap();
	Assets as; Palette pal;
	if (!LoadAssets(dataDirIn, as, pal)) return;
	std::string dir(dataDirIn);
	InitBulletTypes();
	InitWeaponTypes();

	const int W = 640, H = 480;
	GfxBuffer draw; draw.Resize(W, H);
	for (int i = 0; i < W * H; i++) draw.iBuf[i] = (unsigned char)((i * 13) & 0xff);
	RectI dr(0, 0, W, H);

	SimFont small;
	if (!small.Load((dir + "/fnts/8x8b.fnt").c_str(), true)) return;

	// Synthetic player at the level start (full-screen draw rect => centred).
	CoordF pl;
	if (!lv.iPlStart.empty()) {
		pl.x = (float)(lv.iPlStart[0].x * KBlockSpriteSize);
		pl.y = (float)(lv.iPlStart[0].y * KBlockSpriteSize);
	} else { pl.x = 200.0f; pl.y = 200.0f; }
	int angle = 0;
	int screenX = (int)(pl.x - (float)(RectW(dr) / 2));
	int screenY = (int)(pl.y - (float)(RectH(dr) / 2));

	// --- DrawHits(hit = 7) ---
	SimRectangle(&draw, dr.l, dr.t, dr.r - 1, dr.b - 1, (unsigned char)(((4 * 16) - 1) - 7));

	// --- DrawTargets (targetSystem, gun; Gas: multiplier 10, approx distance 74) ---
	{
		int dist = SimApproxDistance(gBullets[8]);
		CoordF pos = AddMovF(pl, angle, 10);
		pos.x += 14; pos.y += 14;
		CoordF endpos;
		CoordF dst = AddMovF(pos, angle, (float)dist);
		lv.VisibilityCheck(pos, dst, &endpos);
		dist = (int)GetDistF(pos.x, pos.y, endpos.x, endpos.y);
		int a = 0;
		int plot_count = 1;
		for (; a < dist &&
			   pos.x - screenX >= 0 && pos.x - screenX < RectW(dr) &&
			   pos.y - screenY >= 0 && pos.y - screenY < RectH(dr); a++) {
			if ((a - (int)(plot_count / 4)) % 6 == 0)
				draw.iBuf[(int)(dr.t + pos.y - screenY) * W + (int)(dr.l + pos.x - screenX)] = 9 * 16;
			pos = AddMovF(pos, angle, 1);
		}
		if (a == dist || lv.LevelData((int)(pos.x / 20), (int)(pos.y / 20)).iType == 1) {
			int tx = (int)(dr.l + pos.x - 3 - screenX);
			int ty = (int)(dr.t + pos.y - 3 - screenY);
			DrawTransSprite(tx, ty, 7, 7, &as.target, 0, &draw, as.transparency, dr);
		}
	}

	// --- DrawEnergies(energy 73.5, shield 2) ---
	{
		int a, b, target, offset, yadd;
		float energy = 73.5f;
		int shield = 2;
		float div = 100 + shield * 10;
		target = RectH(dr) / 80;
		offset = ((RectH(dr) - 3 - target + dr.t) * W) + 3 + dr.l;
		for (a = 0; a < energy / 5; a++)
			for (b = 0, yadd = 0; b < target; b++, yadd += W)
				draw.iBuf[offset + a + yadd] = (unsigned char)(239 - (int)(5 * a * 15 / div));
	}

	// --- DrawInfos("Flame Thrower", double, ammo 4567, multiplier 10, bulletType 8) ---
	{
		const int fontHeight = small.Height();
		int z = H / 80;
		char text[256];
		strcpy(text, "Flame Thrower");
		strcat(text, " (double)");
		SimFontWrite(small, 3 + dr.l, RectH(dr) - 5 - z + dr.t - fontHeight, (const unsigned char*)text, 0, 0, &draw);
		char ammo[32];
		sprintf(ammo, "%d", 4567 / 10);
		SimFontWrite(small, 3 + dr.l, RectH(dr) - 5 - z + dr.t - fontHeight * 2, (const unsigned char*)ammo, 0, 0, &draw);
	}

	// --- DrawKills (frags; three players) ---
	{
		const char* names[3] = { "Pekka", "Jussi", "Matti" };
		int kills[3] = { 5, 12, 3 };
		for (int b = 0; b < 3; b++) {
			char text[50];
			sprintf(text, "%s %d", names[b], kills[b]);
			SimFontWrite(small, 3 + (b % 4) * 80, 3 + (b / 4) * 10, (const unsigned char*)text, 0, 0, &draw);
		}
	}

	// --- DrawCrateTexts (two crates with text) ---
	{
		SimFontWrite(small, 100, 200, (const unsigned char*)"energy", 0, 0, &draw);
		SimFontWrite(small, 300, 250, (const unsigned char*)"money (123)", 0, 0, &draw);
	}

	// --- DrawMap (reachable, enemies, dead enemies, one player) ---
	{
		int a, b, offset, cx, cy, type, size;
		size = W >= 640 ? 2 : 1;
		cx = W - (lv.iWidth) * size;
		cy = 0;
		offset = cy * W + cx;
		for (a = 0; a < lv.iHeight; a++, offset += (W - lv.iWidth) * size)
			for (b = 0; b < lv.iWidth; b++, offset += size) {
				type = lv.LevelData(b, a).iType;
				SimDrawMapPixel(&draw, as.shadowTable, offset, size, type == 1 ? 16 : -1);
				if (lv.Reachable(b, a))
					SimDrawMapPixel(&draw, as.shadowTable, offset, size, 3);
			}
		struct { int x, y; } dead[1] = { { 400, 80 } };
		for (int i = 0; i < 1; i++)
			SimDrawMapPixel(&draw, as.shadowTable, ((int)((dead[i].y + 15) / 20) * size + cy) * W + (int)((dead[i].x + 15) / 20) * size + cx, size, 9);
		struct { int x, y; } enemies[2] = { { 100, 100 }, { 305, 245 } };
		for (int i = 0; i < 2; i++)
			SimDrawMapPixel(&draw, as.shadowTable, ((int)((enemies[i].y + 15) / 20) * size + cy) * W + (int)((enemies[i].x + 15) / 20) * size + cx, size, 3);
		SimDrawMapPixel(&draw, as.shadowTable, ((int)((pl.y + 15) / 20) * size + cy) * W + (int)((pl.x + 15) / 20) * size + cx, size, 16 * 3);
	}

	// --- DrawFPS ---
	{
		char text[20];
		const int timeYPos = 10;
		const int fpsYPos = timeYPos + small.Height() + 2;
		sprintf(text, "%d / %d fps", 57, 100);
		SimFontWrite(small, W / 2, fpsYPos, (const unsigned char*)text, 0, 1, &draw);
	}

	// --- DrawTime (completeTime 123 => "2:03") ---
	{
		char text[10];
		int aika = 123;
		sprintf(text, "%d:%02d", aika / 60, aika % 60);
		SimFontWrite(small, W / 2, 10, (const unsigned char*)text, 0, 1, &draw);
	}

	// --- DrawComplete (nextLevel 37) ---
	{
		int nextLevel = 37;
		int a = nextLevel * 2;
		float tmp = (float)nextLevel / (float)940;
		int xpos = (int)(W / 2 * (1 + ((1 - tmp) * gMath.Cose(a))));
		int ypos = (int)((H / 2) * (1 + ((1 - tmp) * gMath.Sine(a))));
		SimFontWrite(small, xpos, ypos, (const unsigned char*)"MISSION COMPLETED", 1, 1, &draw);
	}

	FILE* out = fopen(outPath, "wb");
	fwrite(draw.iBuf, 1, (size_t)W * H, out);
	fclose(out);
	printf("wrote %s\n", outPath);
}

int main(int argc, char** argv) {
	if (argc >= 3 && std::string(argv[1]) == "lightmap") {
		WriteLightMaps(argv[2]);
		return 0;
	}
	if (argc >= 4 && std::string(argv[1]) == "lightrender") {
		RenderLights(argv[2], argv[3]);
		return 0;
	}
	if (argc >= 4 && std::string(argv[1]) == "fontwrite") {
		RenderFontWrite(argv[2], argv[3]);
		return 0;
	}
	if (argc >= 4 && std::string(argv[1]) == "messageboard") {
		RenderMessageBoard(argv[2], argv[3]);
		return 0;
	}
	if (argc >= 4 && std::string(argv[1]) == "pcx") {
		RenderPcx(argv[2], argv[3]);
		return 0;
	}
	if (argc >= 3 && std::string(argv[1]) == "fader") {
		RenderFader(argv[2]);
		return 0;
	}
	if (argc >= 5 && std::string(argv[1]) == "hud") {
		RenderHud(argv[2], argv[3], argv[4]);
		return 0;
	}
	if (argc < 6) {
		fprintf(stderr, "usage: render_gen <leveldump> <datadir> <out.raw> <locX> <locY> [W] [H]\n");
		return 2;
	}
	const char* dumpPath = argv[1];
	std::string dataDir = argv[2];
	const char* outPath = argv[3];
	int locX = atoi(argv[4]);
	int locY = atoi(argv[5]);
	int W = argc > 6 ? atoi(argv[6]) : 640;
	int H = argc > 7 ? atoi(argv[7]) : 480;

	Level lv;
	if (!LoadLevelDump(dumpPath, lv)) return 1;

	Assets assets;
	Palette pal;
	if (!LoadAssets(dataDir, assets, pal)) return 1;

	GfxBuffer draw; draw.Resize(W, H); draw.Fill(0);
	GfxBuffer dark; dark.Resize(W, H); dark.Fill(0);
	RectI drawRect(0, 0, W, H);
	CoordI scr; scr.x = locX - W / 2; scr.y = locY - H / 2;

	DrawStaticFrame(lv, assets, &draw, &dark, drawRect, scr, (float)locX, (float)locY);

	FILE* out = fopen(outPath, "wb");
	unsigned int ow = (unsigned int)W, oh2 = (unsigned int)H;
	fwrite(&ow, 4, 1, out); fwrite(&oh2, 4, 1, out);
	fwrite(draw.iBuf, 1, (size_t)W * H, out);
	fclose(out);
	printf("rendered %s %dx%d\n", outPath, W, H);
	return 0;
}
