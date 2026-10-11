// Reference oracle for the asset-generation routines in CGraphicsGenerator.
//
// This deliberately copies the original algorithms (and their C++ float/char
// semantics) verbatim so the TypeScript port can be verified byte-for-byte.
// It only needs libm; no SDL.
//
// Build:  g++ -O2 -o rotate_gen rotate_gen.cpp -lm
// Usage:
//   rotate_gen rotate <in.efp> <angles>            -> writes "<in>.<angles>.raw"
//   rotate_gen floors <in.efp> <palette.efp>       -> writes "<in>.floors.raw"
//   rotate_gen zoom   <in.efp> <level 1..5>        -> writes "<in>.zoom<N>.raw"
//
// The .raw files are: uint32 width (LE), uint32 height (LE), then width*height bytes.

#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

// ---- definition from CMath.h exactly ----
#define pi 3.14159265358979f
#define KBlockSpriteSize 20

struct RGBA { unsigned char r, g, b; };

struct Palette {
	RGBA c[256];
	void ReadPalette(unsigned char* buf) { for (int a=0;a<256;a++){ c[a].r=buf[a*3]; c[a].g=buf[a*3+1]; c[a].b=buf[a*3+2]; } }
	void FourMultiply() { for (int a=0;a<256;a++){ c[a].r<<=2; c[a].g<<=2; c[a].b<<=2; } }

	static void rgb2hsl(float r,float g,float b,float &H,float &S,float &L) {
		float delta,cmax,cmin;
		r/=255; g/=255; b/=255;
		cmax=(r>g)?((r>b)?r:b):((g>b)?g:b);
		cmin=(r<g)?((r<b)?r:b):((g<b)?g:b);
		L=(cmax+cmin)/2.0F;
		if (cmax==cmin) { S=0; H=0; }
		else {
			if (L<0.5F) S=(cmax-cmin)/(cmax+cmin);
			else S=(cmax-cmin)/(2.0F-cmax-cmin);
			delta=cmax-cmin;
			if (r==cmax) H=(g-b)/delta;
			else if (g==cmax) H=2.0F+(b-r)/delta;
			else H=4.0F+(r-g)/delta;
			H/=6.0F;
			if (H<0.0F) H+=1;
		}
	}
	static float hue2rgb(float m1,float m2,float h) {
		if (h<0) h+=1.0F;
		if (h>1) h-=1.0F;
		if (6.0F*h<1) return (m1+(m2-m1)*h*6.0F);
		if (2.0F*h<1.0F) return m2;
		if (3.0F*h<2.0F) return (m1+(m2-m1)*((2.0F/3.0F)-h)*6.0F);
		return m1;
	}
	static void hsl2rgb(float H,float S,float L,float &R,float &G,float &B) {
		float m1,m2;
		if (S==0) { R=G=B=L; }
		else {
			if (L<=0.5F) m2=L*(1.0F+S); else m2=L+S-L*S;
			m1=2.0F*L-m2;
			R=hue2rgb(m1,m2,H+1.0F/3.0F);
			G=hue2rgb(m1,m2,H);
			B=hue2rgb(m1,m2,H-1.0F/3.0F);
		}
		R*=255; G*=255; B*=255;
	}
};

static unsigned char ClosestInPalette(int aRed,int aGreen,int aBlue,Palette& aPalette) {
	int a,v,minv=1000; unsigned char closest=0;
	for (a=0;a<256;a++) {
		v=abs(aPalette.c[a].r-aRed)+abs(aPalette.c[a].g-aGreen)+abs(aPalette.c[a].b-aBlue);
		if (v<minv) { minv=v; closest=(char)a; }
	}
	return closest;
}

// ---- GraphicsBuffer with the original Resize semantics ----
struct GfxBuffer {
	int iWidth=0, iHeight=0;
	unsigned char* iBuf=nullptr;
	int Width() const { return iWidth; }
	int Height() const { return iHeight; }
	unsigned char& operator[](int i){ return iBuf[i]; }

	void Resize(int aWidth,int aHeight) {
		if (aWidth==iWidth && aHeight==iHeight) return;
		unsigned char* newbuf=(unsigned char*)malloc(aWidth*aHeight);
		for (int y=0;y<aHeight&&y<iHeight;y++)
			for (int x=0;x<aWidth&&x<iWidth;x++)
				newbuf[y*aWidth+x]=iBuf[y*iWidth+x];
		iWidth=aWidth; iHeight=aHeight; free(iBuf); iBuf=newbuf;
	}
};

// ---- CGraphicsGenerator, verbatim ----
static void ZoomBlock(GfxBuffer& aSrc,GfxBuffer& aDst,int aX,int aY,int aAdd) {
	int a,b,c,d,size;
	size=KBlockSpriteSize+aAdd;
	for (a=0,c=0;a<size;a++) {
		for (b=0,d=0;b<size;b++) {
			aDst[(a+(aY*size))*(aDst.Width())+b+aX*size]=aSrc[(c+(aY*KBlockSpriteSize))*aSrc.Width()+d+aX*KBlockSpriteSize];
			if ((b+1)%(size/(aAdd+1)+1)!=0) d++;
			if (d>=KBlockSpriteSize) d=(KBlockSpriteSize-1);
		}
		if ((a+1)%(size/(aAdd+1)+1)!=0) c++;
		if (c>=KBlockSpriteSize) c=(KBlockSpriteSize-1);
	}
}
static void ZoomWall(GfxBuffer& aSrc,GfxBuffer& aDst,int aLevel) {
	const int cBlocksW=aSrc.Width()/KBlockSpriteSize;
	const int cBlocksH=aSrc.Height()/KBlockSpriteSize;
	int a,b,xsize=cBlocksW*(20+aLevel+1),ysize=cBlocksH*(20+aLevel+1);
	aDst.Resize(xsize,ysize);
	for (a=0;a<cBlocksH;a++)
		for (b=0;b<cBlocksW;b++)
			ZoomBlock(aSrc,aDst,b,a,aLevel+1);
}
static void MakeFloors(Palette& aPal,GfxBuffer& aSrc,GfxBuffer& aDst) {
	int a; float re,gr,bl,h,s,lum; char col;
	aDst.Resize(aSrc.Width(),aSrc.Height());
	for (a=0;a<aSrc.Width()*aSrc.Height();a++) {
		re=aPal.c[aSrc[a]].r; gr=aPal.c[aSrc[a]].g; bl=aPal.c[aSrc[a]].b;
		Palette::rgb2hsl(re,gr,bl,h,s,lum);
		lum/=3; s/=3;
		Palette::hsl2rgb(h,s,lum,re,gr,bl);
		col=ClosestInPalette((int)re,(int)gr,(int)bl,aPal);
		aDst[a]=col;
	}
}
static void RotateSprites(GfxBuffer& aBuffer,int aSpriteWidth,int aSpriteHeight,int aAngles,Palette& pal) {
	float xx,yy,xx2,yy2; int b,c,a,ax,ay; char col;
	const int xSprs=aAngles;
	const int ySprs=(aBuffer.Height()/aSpriteHeight);
	float* sini=(float*)malloc(aAngles*sizeof(float));
	float* cosi=(float*)malloc(aAngles*sizeof(float));
	for (a=0;a<aAngles;a++) {
		sini[a]=sin((float)(a)/aAngles*pi*2);
		cosi[a]=cos((float)(a)/aAngles*pi*2);
	}
	sini[0]=0; cosi[0]=1;
	sini[aAngles/4]=1; cosi[aAngles/4]=0;
	sini[aAngles/2]=0; cosi[aAngles/2]=-1;
	sini[aAngles/4*3]=-1; cosi[aAngles/4*3]=0;
	aBuffer.Resize(xSprs*(aSpriteWidth+1),ySprs*(aSpriteHeight+1));
	for (int column=1;column<xSprs;column++) {
		for (int row=0;row<ySprs;row++) {
			xx2=-(aSpriteWidth/2+1)*cosi[(column+aAngles/4)%aAngles];
			yy2=-(aSpriteHeight/2+1)*sini[(column+aAngles/4)%aAngles];
			for (a=0,c=0;a<aSpriteHeight+1;a++) {
				xx=-(aSpriteWidth/2+1)*cosi[column];
				yy=-(aSpriteHeight/2+1)*sini[column];
				xx2+=cosi[(column+aAngles/4)%aAngles];
				yy2+=sini[(column+aAngles/4)%aAngles];
				for (b=0;b<aSpriteWidth+1;b++,c++) {
					col=0;
					xx+=cosi[column];
					yy+=sini[column];
					ax=int(xx+xx2+(aSpriteWidth/2+1));
					ay=int((row*(aSpriteHeight+1))+yy+yy2+(aSpriteHeight/2+1));
					if (ay>(row*aSpriteHeight) && ax>0 &&
						ay<(row*aSpriteHeight)+aSpriteHeight &&
						ax<aSpriteWidth)
						col=aBuffer[ay*aBuffer.Width()+ax];
					aBuffer[(a+row*(aSpriteHeight+1))*aBuffer.Width()+b+column*(aSpriteWidth+1)]=col;
				}
			}
		}
	}
	free(sini); free(cosi);
}

// ---- EFP loading (LoadEFP) ----
static bool LoadEFP(const char* fn, GfxBuffer& out, Palette* pal) {
	FILE* f=fopen(fn,"rb");
	if (!f) { fprintf(stderr,"cannot open %s\n",fn); return false; }
	fseek(f,0,SEEK_END); long len=ftell(f); fseek(f,0,SEEK_SET);
	unsigned char* fb=(unsigned char*)malloc(len);
	size_t rd=fread(fb,1,len,f); fclose(f); (void)rd;
	if (memcmp(fb,"EF pic",6)!=0) { fprintf(stderr,"not efp %s\n",fn); return false; }
	int cnt=6;
	unsigned short w=*(short*)(fb+cnt); cnt+=2;
	unsigned short h=*(short*)(fb+cnt); cnt+=2;
	out.Resize(w,h);
	for (unsigned int p=0;p<(unsigned)w*h;) {
		int tavu=fb[cnt++];
		if (tavu>192) { int t2=fb[cnt++]; memset(out.iBuf+p,t2,tavu-192); p+=tavu-192; }
		else out.iBuf[p++]=(char)tavu;
	}
	if (pal) { pal->ReadPalette(fb+cnt); pal->FourMultiply(); }
	free(fb);
	return true;
}

static void WriteRaw(const std::string& prefix, const std::string& suffix, GfxBuffer& b) {
	std::string fn=prefix+suffix;
	FILE* f=fopen(fn.c_str(),"wb");
	unsigned int w=b.Width(), h=b.Height();
	fwrite(&w,4,1,f); fwrite(&h,4,1,f);
	fwrite(b.iBuf,1,(size_t)w*h,f);
	fclose(f);
	printf("%s %ux%u\n",fn.c_str(),w,h);
}

int main(int argc,char** argv) {
	if (argc<3) { fprintf(stderr,"usage: rotate_gen rotate|floors|zoom <in.efp> [arg]\n"); return 2; }
	std::string cmd=argv[1];
	std::string in=argv[2];
	GfxBuffer src;
	if (cmd=="rotate") {
		if (argc<4) return 2;
		int angles=atoi(argv[3]);
		Palette pal;
		if (!LoadEFP(in.c_str(),src,nullptr)) return 1;
		RotateSprites(src,28,28,angles,pal);
		WriteRaw(in,"."+std::to_string(angles)+".raw",src);
	} else if (cmd=="floors") {
		if (argc<4) return 2;
		Palette pal;
		GfxBuffer palbuf;
		if (!LoadEFP(argv[3],palbuf,&pal)) return 1;
		if (!LoadEFP(in.c_str(),src,nullptr)) return 1;
		GfxBuffer dst;
		MakeFloors(pal,src,dst);
		WriteRaw(in,".floors.raw",dst);
	} else if (cmd=="zoom") {
		if (argc<4) return 2;
		int level=atoi(argv[3]);
		if (!LoadEFP(in.c_str(),src,nullptr)) return 1;
		GfxBuffer dst;
		ZoomWall(src,dst,level-1);
		WriteRaw(in,".zoom"+std::to_string(level)+".raw",dst);
	} else { fprintf(stderr,"unknown cmd\n"); return 2; }
	return 0;
}
