/**
 * SDL 1.2 key codes and the `KeyboardEvent.code` → `SDLKey` mapping used by the
 * menu/key-binding system (`CEventHandler`, `CKeys`, `CGameMenuItemChangeKey`).
 *
 * Only the keys the original actually binds or displays are listed; the numeric
 * values are the SDL 1.2 constants so saved bindings and `KeyToStr` text match.
 */

export const SDLK = {
  UNKNOWN: 0,
  BACKSPACE: 8,
  TAB: 9,
  RETURN: 13,
  ESCAPE: 27,
  SPACE: 32,
  DELETE: 127,
  UP: 273,
  DOWN: 274,
  RIGHT: 275,
  LEFT: 276,
  INSERT: 277,
  HOME: 278,
  END: 279,
  PAGEUP: 280,
  PAGEDOWN: 281,
  F1: 282,
  F2: 283,
  F3: 284,
  F4: 285,
  F5: 286,
  F6: 287,
  F7: 288,
  F8: 289,
  F9: 290,
  F10: 291,
  F11: 292,
  F12: 293,
  LSHIFT: 304,
  RSHIFT: 303,
  LCTRL: 306,
  RCTRL: 305,
  LALT: 308,
  RALT: 307,
} as const;

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";

/** Maps a `KeyboardEvent.code` to an `SDLKey`, or `UNKNOWN`. */
export function codeToSdlKey(code: string): number {
  if (code.startsWith("Key") && code.length === 4) {
    const c = code.charCodeAt(3);
    if (c >= 65 && c <= 90) return c + 32; // 'A'..'Z' -> 'a'..'z'
  }
  if (code.startsWith("Digit") && code.length === 6) {
    const c = code.charCodeAt(5);
    if (c >= 48 && c <= 57) return c;
  }
  if (code.startsWith("Arrow")) {
    switch (code) {
      case "ArrowUp":
        return SDLK.UP;
      case "ArrowDown":
        return SDLK.DOWN;
      case "ArrowLeft":
        return SDLK.LEFT;
      case "ArrowRight":
        return SDLK.RIGHT;
    }
  }
  if (code.startsWith("F") && code.length <= 3) {
    const n = Number(code.slice(1));
    if (n >= 1 && n <= 12) return SDLK.F1 + (n - 1);
  }
  switch (code) {
    case "Space":
      return SDLK.SPACE;
    case "Enter":
    case "NumpadEnter":
      return SDLK.RETURN;
    case "Escape":
      return SDLK.ESCAPE;
    case "Backspace":
      return SDLK.BACKSPACE;
    case "Tab":
      return SDLK.TAB;
    case "Delete":
      return SDLK.DELETE;
    case "Insert":
      return SDLK.INSERT;
    case "Home":
      return SDLK.HOME;
    case "End":
      return SDLK.END;
    case "PageUp":
      return SDLK.PAGEUP;
    case "PageDown":
      return SDLK.PAGEDOWN;
    case "ShiftLeft":
      return SDLK.LSHIFT;
    case "ShiftRight":
      return SDLK.RSHIFT;
    case "ControlLeft":
      return SDLK.LCTRL;
    case "ControlRight":
      return SDLK.RCTRL;
    case "AltLeft":
      return SDLK.LALT;
    case "AltRight":
      return SDLK.RALT;
  }
  return SDLK.UNKNOWN;
}

/** `SDL_GetKeyName` text for the keys the game can bind or show. */
export function keyToStr(key: number): string {
  if (key >= 97 && key <= 122) return LETTERS[key - 97];
  if (key >= 48 && key <= 57) return DIGITS[key - 48];
  if (key >= SDLK.F1 && key <= SDLK.F12) return `f${key - SDLK.F1 + 1}`;
  const names: Record<number, string> = {
    [SDLK.UNKNOWN]: "unknown",
    [SDLK.BACKSPACE]: "backspace",
    [SDLK.TAB]: "tab",
    [SDLK.RETURN]: "return",
    [SDLK.ESCAPE]: "escape",
    [SDLK.SPACE]: "space",
    [SDLK.DELETE]: "delete",
    [SDLK.UP]: "up",
    [SDLK.DOWN]: "down",
    [SDLK.RIGHT]: "right",
    [SDLK.LEFT]: "left",
    [SDLK.INSERT]: "insert",
    [SDLK.HOME]: "home",
    [SDLK.END]: "end",
    [SDLK.PAGEUP]: "page up",
    [SDLK.PAGEDOWN]: "page down",
    [SDLK.LSHIFT]: "left shift",
    [SDLK.RSHIFT]: "right shift",
    [SDLK.LCTRL]: "left ctrl",
    [SDLK.RCTRL]: "right ctrl",
    [SDLK.LALT]: "left alt",
    [SDLK.RALT]: "right alt",
  };
  return names[key] ?? "unknown";
}
