import { describe, expect, test } from "bun:test";

import { sha256, readRef } from "../../data/__test__/helpers";
import { decodeFnt } from "../../data/font";
import { Framebuffer } from "../fb";
import { MessageBoard } from "../message-board";

// SHA-256 of the overlay produced by the C++ oracle
// (`/tmp/render_gen messageboard <datadir> <out.raw>`), which replays the
// `CMessageBoard::AddMessage` ring/truncation rules and the `Draw` blit onto a
// 320x96 textured buffer at draw offset 16.
const HASH = "4dfdbf18c43a4b36efb7de8953c4af04d934b096002f7b1a9f8fe80d8a9fe078";

const INPUT = [
  "Sound system initialization FAILED!",
  "Mouse sensitivity 0.55",
  "Mouse mode: relative",
  "Effect volume: 65%",
  "Music volume: 30%",
  "Screen capture disabled in DEBUG version. Sorry!",
  "This one is pushed out of the ring by the next line",
  "A very long message that is certainly longer than eighty characters and must be truncated by the board okay",
];

describe("message board matches the C++ oracle byte-for-byte", () => {
  test("ring cap, truncation and draw offset", async () => {
    const font = decodeFnt(await readRef("fnts/8x8b.fnt"));
    const width = 320;
    const height = 96;
    const fb = new Framebuffer(width, height);
    for (let i = 0; i < width * height; i++) fb.pixels[i] = (i * 5 + 3) & 0x3f;

    const board = new MessageBoard();
    for (const msg of INPUT) board.addMessage(msg, 0);
    board.setDrawOffset(16);
    expect(board.run(0)).toBe(true);
    board.draw(font, fb);

    expect(sha256(fb.pixels)).toBe(HASH);
  });

  test("caps at six and truncates over-long lines", () => {
    const board = new MessageBoard();
    for (const msg of INPUT) board.addMessage(msg, 0);
    expect(board.messages).toHaveLength(6);
    expect(board.messages[0]).not.toBe(INPUT[0]); // first two pushed out
    expect(board.messages[5].endsWith("...")).toBe(true);
    expect(board.messages[5]).toHaveLength(80);
  });

  test("clears after its time has elapsed", () => {
    const board = new MessageBoard();
    board.addMessage("hello", 10);
    board.run(10);
    expect(board.messages).toHaveLength(1);
    board.run(511);
    expect(board.messages).toHaveLength(0);
  });
});
