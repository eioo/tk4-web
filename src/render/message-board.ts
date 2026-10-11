/**
 * `CMessageBoard` — the small top-left overlay of transient status messages
 * ("Mouse sensitivity 0.50", volume changes, level errors, network chat).
 *
 * It is drawn over *everything* (menus included) by `CGameApp::RunFrame`, so it
 * is not part of the game HUD and lives beside the other render helpers. The
 * behaviour ported here is deliberately small: cap the ring at 6 lines, truncate
 * over-long messages, and clear the whole board `KMessageTimeOnScreen` ticks
 * after the last message arrived.
 */

import { fontWrite, VAlign, HAlign, type Font, type FontTarget } from "../data/font";

/** `KMaxMessagesOnBoard`. */
export const MAX_MESSAGES_ON_BOARD = 6;
/** `KMaxMessagesLengthOnBoard`. */
export const MAX_MESSAGES_LENGTH_ON_BOARD = 80;
/** `KMessageTimeOnScreen` (ticks at the 100 Hz sim rate => 5 seconds). */
export const MESSAGE_TIME_ON_SCREEN = 500;

export class MessageBoard {
  readonly messages: string[] = [];
  /** `iClearTime` — sim-tick at which the board clears. */
  private clearTime = 0;
  /** `iOffset` — vertical offset in pixels (16 for deathmatch, else 0). */
  private offset = 0;
  /** `iNeedUpdate` — true when the previously drawn area needs erasing. */
  private needUpdate = false;

  /** `CMessageBoard::AddMessage`. `timerCounter` is the current sim tick. */
  addMessage(message: string, timerCounter: number): void {
    let str = message;
    if (str.length > MAX_MESSAGES_LENGTH_ON_BOARD) {
      str = str.slice(0, MAX_MESSAGES_LENGTH_ON_BOARD - 3) + "...";
    }
    this.messages.push(str);
    while (this.messages.length > MAX_MESSAGES_ON_BOARD) this.messages.shift();
    this.clearTime = timerCounter + MESSAGE_TIME_ON_SCREEN;
    this.needUpdate = true;
  }

  /**
   * `CMessageBoard::Run` — clears the board when its time has elapsed and
   * reports whether the previously drawn region must be redrawn. Call once per
   * frame *before* drawing.
   */
  run(timerCounter: number): boolean {
    if (this.clearTime < timerCounter && this.messages.length > 0) this.clear();
    const update = this.needUpdate;
    this.needUpdate = false;
    return update;
  }

  /** `CMessageBoard::Clear`. */
  clear(): void {
    this.messages.length = 0;
    this.needUpdate = true;
  }

  /** `CMessageBoard::SetDrawOffset`. */
  setDrawOffset(offset: number): void {
    this.offset = offset;
  }

  /** `CMessageBoard::Draw` — blits the messages onto `target` with `font`. */
  draw(font: Font, target: FontTarget, oneIsZero = true): void {
    const yoffs = 5 + this.offset;
    const lineHeight = font.height + 1;
    for (let a = 0; a < this.messages.length; a++) {
      fontWrite(
        font,
        target,
        5,
        yoffs + a * lineHeight,
        this.messages[a],
        VAlign.Below,
        HAlign.ToRight,
        oneIsZero,
      );
    }
  }
}
