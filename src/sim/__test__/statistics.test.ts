import { describe, expect, test } from "bun:test";

import { givePlayerPrize } from "../../app/statistics";
import { accuracy, GameStatistics, makeLevelStats, totalKills } from "../statistics";
import { EnemyTypes } from "../types";
import { SimPlayer } from "../world";

describe("CGameStatisticsData accounting", () => {
  test("accuracy is percent of shots hit, zero when nothing fired", () => {
    const s = makeLevelStats();
    expect(accuracy(s)).toBe(0);
    s.roundsShot = 4;
    s.roundsHit = 3;
    expect(accuracy(s)).toBe(75);
  });

  test("enemy kills accumulate per level and per type", () => {
    const stats = new GameStatistics();
    stats.addPlayer("John");
    stats.recording = 0;
    stats.addEnemyKill(0, 0);
    stats.addEnemyKill(0, 0);
    stats.addEnemyKill(0, 4);
    expect(totalKills(stats.latestLevelStats(0))).toBe(3);
    expect(stats.levelStats(0, 0).enemyKills[0]).toBe(2);
    expect(stats.levelStats(0, 0).enemyKills[4]).toBe(1);
  });

  test("events for a later level do not touch earlier levels", () => {
    const stats = new GameStatistics();
    stats.addPlayer("John");
    stats.recording = 0;
    stats.addEnemyKill(0, 0);
    stats.recording = 1;
    stats.addEnemyKill(0, 1);
    expect(totalKills(stats.levelStats(0, 0))).toBe(1);
    expect(totalKills(stats.levelStats(0, 1))).toBe(1);
  });

  test("deathmatch frags count others and subtract suicides", () => {
    const stats = new GameStatistics();
    stats.addPlayer("John");
    stats.addPlayer("Paul");
    stats.addPlayer("George");
    stats.recording = 0;
    stats.latest = 0;
    stats.addPlayerKill(0, 1); // John kills Paul
    stats.addPlayerKill(0, 1); // John kills Paul again
    stats.addPlayerKill(0, 0); // John suicides
    stats.addPlayerKill(1, 0); // Paul kills John
    expect(stats.totalPlayerKills(0)).toBe(1); // 2 - 1 suicide
    expect(stats.totalPlayerKills(1)).toBe(1);
    expect(stats.totalPlayerKills(2)).toBe(0);
  });
});

describe("CGameSubStateStatistics::GivePlayerPrize", () => {
  test("rewards each kill by its enemy type and adds the time bonus", () => {
    const player = new SimPlayer();
    player.cash = 0;
    const stats = new GameStatistics();
    stats.addPlayer("John");
    stats.recording = 0;
    stats.addEnemyKill(0, 0); // pistol boy
    stats.addEnemyKill(0, 4); // bazooka boy
    stats.latest = 0;

    const bonus = givePlayerPrize(player, 0, stats, 100, 90, false, false);
    expect(bonus).toBe((100 - 90) * 5);
    expect(player.cash).toBe(EnemyTypes[0].reward + EnemyTypes[4].reward + 50);
  });

  test("the time bonus is zeroed on game over or user quit", () => {
    const player = new SimPlayer();
    player.cash = 0;
    const stats = new GameStatistics();
    stats.addPlayer("John");
    stats.latest = 0;
    expect(givePlayerPrize(player, 0, stats, 100, 200, true, false)).toBe(0);
    expect(givePlayerPrize(player, 0, stats, 100, 200, false, true)).toBe(0);
  });

  test("the penalty is capped at -500 and cash never goes negative", () => {
    const player = new SimPlayer();
    player.cash = 0;
    const stats = new GameStatistics();
    stats.addPlayer("John");
    stats.latest = 0;
    const bonus = givePlayerPrize(player, 0, stats, 100, 100000, false, false);
    expect(bonus).toBe(-500);
    expect(player.cash).toBe(0);
  });
});
