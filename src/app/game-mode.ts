/**
 * `IGameMode` — cooperative (attack) or deathmatch rules. Ported from
 * `CGameModeCooperative` / `CGameModeDeathmatch` (docs/01, docs/12 M12).
 *
 * The mode decides the objective, whether frags/kill messages are shown, the
 * player setup at game/level start, DM crates and whether players respawn.
 * Kept in its own module so both `App` and `GameSession` can import it.
 */

import { KPlayerMaxEnergy, KShieldEnergyAmount, type SimPlayer } from "../sim/world";

/** DM `iShield` set up at game start (`CGameModeDeathmatch::SetupPlayerEpisode`). */
export const KDeathmatchShield = 30;

export class GameMode {
  constructor(readonly dm: boolean) {}

  name(): string {
    return this.dm ? "deathmatch" : "cooperative";
  }
  startFromAnyLevel(): boolean {
    return this.dm;
  }
  frags(): boolean {
    return this.dm;
  }
  dmEpisodes(): boolean {
    return this.dm;
  }
  crateRespawn(): boolean {
    return this.dm;
  }
  actionTimeMatters(): boolean {
    return !this.dm;
  }
  disableEnemiesPossible(): boolean {
    return this.dm;
  }
  shopEnabled(level: number): boolean {
    return !this.dm && level >= 1;
  }
  hidePlayersFromMap(): boolean {
    return this.dm;
  }
  randomPlacePlayers(): boolean {
    return this.dm;
  }
  dmCrates(): boolean {
    return this.dm;
  }

  /** `IGameMode::ObjectiveFulfilled` — cooperative ends when the enemies are dead. */
  objectiveFulfilled(enemiesEmpty: boolean): boolean {
    return !this.dm && enemiesEmpty;
  }

  /** `IGameMode::GameOver` — cooperative is over when every local player is dead. */
  gameOver(allPlayersDead: boolean): boolean {
    return !this.dm && allPlayersDead;
  }

  /** `SetupPlayerEpisode` — DM gives every player a 30-point shield for the game. */
  setupPlayerEpisode(player: SimPlayer): void {
    player.shield = this.dm ? KDeathmatchShield : 0;
  }

  /** `SetupPlayerLevel` — DM derives energy from the shield and applies the DM options. */
  setupPlayerLevel(player: SimPlayer, dmSpeed: number, dmTargetSystem: boolean): void {
    if (!this.dm) return;
    player.energy = Math.trunc((KPlayerMaxEnergy + player.shield * KShieldEnergyAmount) / 3);
    if (dmTargetSystem) player.targetSystem = true;
    player.speed = dmSpeed;
  }
}
