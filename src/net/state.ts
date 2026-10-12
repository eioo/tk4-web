/**
 * Conversion between the wire's persistent per-seat state (`NetPlayerState`) and
 * the live `SimPlayer`. Only the fields that survive across levels are packed;
 * transient per-level state (energy, position, animation) is rebuilt by
 * `GameSession` on level start.
 */

import { makeStartPlayer, type SimPlayer } from "../sim/world";
import type { NetPlayerState } from "./protocol";

/** Build a seat's live player from `levelStart.states[seat]` (null = fresh). */
export function playerFromNetState(state: NetPlayerState | null, name: string): SimPlayer {
  const player = makeStartPlayer();
  if (!state) {
    player.name = name;
    return player;
  }
  player.name = state.name.length > 0 ? state.name : name;
  player.cash = state.cash;
  player.shield = state.shield;
  player.curWeapon = state.curWeapon as SimPlayer["curWeapon"];
  player.secWeapon = state.secWeapon;
  for (let i = 0; i < player.weapons.length; i++) player.weapons[i] = state.weapons[i] ?? 0;
  for (let i = 0; i < player.bullets.length; i++) player.bullets[i] = state.bullets[i] ?? 0;
  return player;
}

/** Snapshot a seat's persistent state for `ready` / `levelStart`. */
export function packNetPlayerState(player: SimPlayer, frags: number): NetPlayerState {
  return {
    name: player.name,
    cash: player.cash,
    weapons: [...player.weapons],
    bullets: [...player.bullets],
    shield: player.shield,
    curWeapon: player.curWeapon,
    secWeapon: player.secWeapon,
    frags,
  };
}
