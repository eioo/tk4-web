// Reference oracle for the static level rendering path (floor, block shadows,
// camera-cone black parts, pseudo-3D walls). The draw code lives in
// tkreference.h as a near-verbatim copy of the original C++.
//
// Build:  g++ -O2 -o render_gen render_gen.cpp -lm
// Usage:  render_gen <leveldump.bin> <datadir> <out.raw> <locX> <locY> [W] [H]
//
// The level dump holds *raw* (pre-derived-map) block data so the oracle also
// recomputes ModifyBorderBlocks / DarknessCast / GenerateShadows itself:
//   u32 version, u32 width, u32 height,
//   width*height * (i32 type, i32 number, i32 height),
//   i32 outType, i32 outNumber, i32 outHeight,
//   u32 startCount, startCount * (i32 x, i32 y)
//
// Output: uint32 width (LE), uint32 height (LE), then w*h index bytes.

#include "tkreference.h"

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

int main(int argc, char** argv) {
	if (argc >= 3 && std::string(argv[1]) == "lightmap") {
		WriteLightMaps(argv[2]);
		return 0;
	}
	if (argc >= 4 && std::string(argv[1]) == "lightrender") {
		RenderLights(argv[2], argv[3]);
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

	FILE* f = fopen(dumpPath, "rb");
	if (!f) { fprintf(stderr, "cannot open %s\n", dumpPath); return 1; }
	Level lv;
	unsigned int version = 0, w = 0, h = 0, startCount = 0;
	if (fread(&version, 4, 1, f) != 1 || fread(&w, 4, 1, f) != 1 || fread(&h, 4, 1, f) != 1) { fprintf(stderr, "short dump\n"); return 1; }
	lv.iWidth = (int)w; lv.iHeight = (int)h;
	lv.blocks.resize((size_t)w * h);
	for (size_t i = 0; i < lv.blocks.size(); i++) {
		int t, n, hh;
		if (fread(&t, 4, 1, f) != 1 || fread(&n, 4, 1, f) != 1 || fread(&hh, 4, 1, f) != 1) { fprintf(stderr, "short dump (blocks)\n"); return 1; }
		lv.blocks[i].iType = t; lv.blocks[i].iNumber = n;
		// Old-format levels store no per-block height; derive it from the
		// block number here so the oracle independently validates KBlockHeights.
		if (version < 6 && t != 0) lv.blocks[i].iHeight = KBlockHeights[n];
		else lv.blocks[i].iHeight = hh;
	}
	int ot, on, oh;
	if (fread(&ot, 4, 1, f) != 1 || fread(&on, 4, 1, f) != 1 || fread(&oh, 4, 1, f) != 1) { fprintf(stderr, "short dump (outblock)\n"); return 1; }
	lv.iOutBlock.iType = ot; lv.iOutBlock.iNumber = on;
	lv.iOutBlock.iHeight = version < 6 ? KBlockHeights[on] : oh;
	if (fread(&startCount, 4, 1, f) != 1) { fprintf(stderr, "short dump (starts)\n"); return 1; }
	for (unsigned int i = 0; i < startCount; i++) {
		int sx, sy;
		if (fread(&sx, 4, 1, f) != 1 || fread(&sy, 4, 1, f) != 1) { fprintf(stderr, "short dump (start)\n"); return 1; }
		CoordI c; c.x = sx; c.y = sy; lv.iPlStart.push_back(c);
	}
	fclose(f);

	// Derived maps, in the original order.
	ModifyBorderBlocks(lv);
	DarknessCast(lv);
	GenerateShadows(lv);

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
