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

/** Snapshot of the mutable accounting, for rollback netplay. */
export interface StatisticsState {
  latest: number;
  recording: number;
  players: Array<{
    levelOfDeath: number;
    levels: Array<{
      enemyKills: number[];
      playerKills: Array<[number, number]>;
      roundsShot: number;
      roundsHit: number;
    }>;
  }>;
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

  /** Snapshot the mutable accounting (rollback netplay). */
  saveState(): StatisticsState {
    return {
      latest: this.latest,
      recording: this.recording,
      players: this.players.map((p) => ({
        levelOfDeath: p.levelOfDeath,
        levels: p.levels.map((l) => ({
          enemyKills: l.enemyKills.slice(),
          playerKills: [...l.playerKills],
          roundsShot: l.roundsShot,
          roundsHit: l.roundsHit,
        })),
      })),
    };
  }

  /** Restore a {@link saveState} snapshot, keeping array/object identity. */
  loadState(s: StatisticsState): void {
    this.latest = s.latest;
    this.recording = s.recording;
    for (let i = 0; i < this.players.length && i < s.players.length; i++) {
      const player = this.players[i];
      const src = s.players[i];
      player.levelOfDeath = src.levelOfDeath;
      player.levels.length = src.levels.length;
      for (let l = 0; l < src.levels.length; l++) {
        let level = player.levels[l];
        if (!level) {
          level = makeLevelStats();
          player.levels[l] = level;
        }
        const levelSrc = src.levels[l];
        level.enemyKills.length = levelSrc.enemyKills.length;
        for (let k = 0; k < levelSrc.enemyKills.length; k++) {
          level.enemyKills[k] = levelSrc.enemyKills[k];
        }
        level.playerKills.clear();
        for (const [victim, amount] of levelSrc.playerKills) {
          level.playerKills.set(victim, amount);
        }
        level.roundsShot = levelSrc.roundsShot;
        level.roundsHit = levelSrc.roundsHit;
      }
    }
  }

  /**
   * Frags for the level currently being recorded (used for the online frag
   * limit while a deathmatch is still running, before `latest` is set).
   */
  currentPlayerKills(player: number): number {
    if (player < 0 || player >= this.players.length) return 0;
    let total = 0;
    for (const [victim, amount] of this.levelStats(player, this.recording).playerKills)
      total += victim === player ? -amount : amount;
    return total;
  }
}
