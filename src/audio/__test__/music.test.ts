import { describe, expect, test } from "bun:test";

import { KMusicExtensions, MusicPlayer, songCandidates } from "../music";

describe("music filename resolution", () => {
  test("uses the theme directory when no soundtrack is forced", () => {
    expect(songCandidates("", "Default", 2)).toEqual(
      KMusicExtensions.map((e) => `music/Default/2${e}`),
    );
  });

  test("uses the forced soundtrack directory when present", () => {
    expect(songCandidates("music/Heavy", "Default", 2)).toEqual(
      KMusicExtensions.map((e) => `music/Heavy/2${e}`),
    );
  });

  test("treats -1 as song 0", () => {
    expect(songCandidates("", "Default", -1)[0]).toBe("music/Default/0.s3m");
  });

  test("prefers .ogg for the shipped assets", () => {
    expect(songCandidates("", "Default", 1)[2]).toBe("music/Default/1.ogg");
  });
});

describe("MusicPlayer song counter", () => {
  test("increments when the level forces no song and honours an explicit one", () => {
    const player = new MusicPlayer();
    expect(player.nextSong(-1)).toBe(0);
    expect(player.nextSong(-1)).toBe(1);
    expect(player.nextSong(3)).toBe(3);
    expect(player.nextSong(-1)).toBe(2);
  });
});
