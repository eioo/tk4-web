/**
 * `CGameStatisticsData` — the per-level kill/accuracy accounting the statistics
 * and shop screens read from.
 *
 * Only the pieces the screens need are modelled: each player owns a lazily
 * grown list of `PlayerLevelStats` (one entry per level index) plus the level
 * they died on. The world records events into the player/level that is
 * currently being played (`recording`); the statistics screen reads the level
 * that was just completed (`latest`).
 */

import { EEnemyAmount } from "./types";

/** `CGameStatisticsData::TPlayerLevelStats`. */
export interface PlayerLevelStats {
  enemyKills: number[];
  /**
   * `iPlayerKills` — deathmatch frags keyed by the victim's player index.
   * `TotalPlayerKills` treats an entry for the killer itself (a suicide) as
   * negative.
   */
  playerKills: Map<number, number>;
  /** Rounds fired. */
  roundsShot: number;
  /** Rounds that connected; may be fractional for shared explosions. */
  roundsHit: number;
}

export function makeLevelStats(): PlayerLevelStats {
  return {
    enemyKills: Array.from({ length: EEnemyAmount }, () => 0),
    playerKills: new Map(),
    roundsShot: 0,
    roundsHit: 0,
  };
}

/** `TPlayerLevelStats::TotalKills`. */
export function totalKills(stats: PlayerLevelStats): number {
  let total = 0;
  for (const kills of stats.enemyKills) total += kills;
  return total;
}

/** `TPlayerLevelStats::Accuracy` — percent, 0 when nothing was fired. */
export function accuracy(stats: PlayerLevelStats): number {
  return stats.roundsShot === 0 ? 0 : (100 * stats.roundsHit) / stats.roundsShot;
}

export interface PlayerStats {
  readonly name: string;
  /** `iLevelOfDeath` — level index the player died on, or -1. */
  levelOfDeath: number;
  readonly levels: PlayerLevelStats[];
}

export class GameStatistics {
  readonly players: PlayerStats[] = [];
  /** `iLatest` — the level whose statistics are being displayed. */
  latest = 0;
  /** Level index new events are recorded against. */
  recording = 0;

  /** `CGameStatisticsData::AddPlayer`. */
  addPlayer(name: string): void {
    this.players.push({ name, levelOfDeath: -1, levels: [] });
  }

  player(index: number): PlayerStats {
    return this.players[index];
  }

  /** `TPlayerStats::LevelStats` — lazily grows the level list. */
  levelStats(player: number, level: number): PlayerLevelStats {
    const levels = this.players[player].levels;
    while (level >= levels.length) levels.push(makeLevelStats());
    return levels[level];
  }

  latestLevelStats(player: number): PlayerLevelStats {
    return this.levelStats(player, this.latest);
  }

  addShot(player: number): void {
    if (player < 0 || player >= this.players.length) return;
    this.levelStats(player, this.recording).roundsShot++;
  }

  addHit(player: number, share: number): void {
    if (player < 0 || player >= this.players.length) return;
    this.levelStats(player, this.recording).roundsHit += share;
  }

  addEnemyKill(player: number, type: number): void {
    if (player < 0 || player >= this.players.length) return;
    this.levelStats(player, this.recording).enemyKills[type]++;
  }

  /** `TPlayerLevelStats::AddPlayerKill( aPlayer )` — `victim` is the killed index. */
  addPlayerKill(player: number, victim: number): void {
    if (player < 0 || player >= this.players.length) return;
    const s = this.levelStats(player, this.recording);
    s.playerKills.set(victim, (s.playerKills.get(victim) ?? 0) + 1);
  }

  playerDied(player: number): void {
    if (player < 0 || player >= this.players.length) return;
    this.players[player].levelOfDeath = this.recording;
  }

  /**
   * `TPlayerLevelStats::TotalPlayerKills( aSelf )` — sum of frags on others
   * minus this player's own suicides.
   */
  totalPlayerKills(player: number): number {
    let total = 0;
    for (const [victim, amount] of this.latestLevelStats(player).playerKills)
      total += victim === player ? -amount : amount;
    return total;
  }
}
