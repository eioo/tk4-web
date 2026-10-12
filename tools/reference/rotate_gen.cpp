// SPDX-License-Identifier: GPL-2.0-only
// Derived from Tapan Kaikki 4 (GPLv2); see LICENSE.

// Reference oracle for the asset-generation routines in CGraphicsGenerator.
// The implementations live in tkreference.h (near-verbatim copies of the
// original C++); this file is just a CLI.
//
// Build:  g++ -O2 -o rotate_gen rotate_gen.cpp -lm
// Usage:
//   rotate_gen rotate <in.efp> <angles>      -> writes "<in>.<angles>.raw"
//   rotate_gen floors <in.efp> <palette.efp> -> writes "<in>.floors.raw"
//   rotate_gen zoom   <in.efp> <level 1..5>  -> writes "<in>.zoom<N>.raw"
//
// The .raw files are: uint32 width (LE), uint32 height (LE), then w*h bytes.

#include "tkreference.h"

static void WriteRaw(const std::string& prefix, const std::string& suffix, GfxBuffer& b) {
	std::string fn = prefix + suffix;
	FILE* f = fopen(fn.c_str(), "wb");
	unsigned int w = b.Width(), h = b.Height();
	fwrite(&w, 4, 1, f); fwrite(&h, 4, 1, f);
	fwrite(b.iBuf, 1, (size_t)w * h, f);
	fclose(f);
	printf("%s %ux%u\n", fn.c_str(), w, h);
}

int main(int argc, char** argv) {
	if (argc < 3) { fprintf(stderr, "usage: rotate_gen rotate|floors|zoom <in.efp> [arg]\n"); return 2; }
	std::string cmd = argv[1];
	std::string in = argv[2];
	GfxBuffer src;
	if (cmd == "rotate") {
		if (argc < 4) return 2;
		int angles = atoi(argv[3]);
		Palette pal;
		if (!LoadEFP(in.c_str(), src, nullptr)) return 1;
		RotateSprites(src, 28, 28, angles, pal);
		WriteRaw(in, "." + std::to_string(angles) + ".raw", src);
	} else if (cmd == "floors") {
		if (argc < 4) return 2;
		Palette pal;
		GfxBuffer palbuf;
		if (!LoadEFP(argv[3], palbuf, &pal)) return 1;
		if (!LoadEFP(in.c_str(), src, nullptr)) return 1;
		GfxBuffer dst;
		MakeFloors(pal, src, dst);
		WriteRaw(in, ".floors.raw", dst);
	} else if (cmd == "zoom") {
		if (argc < 4) return 2;
		int level = atoi(argv[3]);
		if (!LoadEFP(in.c_str(), src, nullptr)) return 1;
		GfxBuffer dst;
		ZoomWall(src, dst, level - 1);
		WriteRaw(in, ".zoom" + std::to_string(level) + ".raw", dst);
	} else {
		fprintf(stderr, "unknown cmd\n");
		return 2;
	}
	return 0;
}
