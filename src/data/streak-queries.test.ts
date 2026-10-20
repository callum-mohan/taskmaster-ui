import { describe, expect, it, vi } from "vitest";
import { createQueries } from "./queries";
import type { Score } from "../types";
import { competitionData, player, season, task } from "../test/fixtures";

// The selectors are pure; this only stops the db client's `astro:env`
// import loading (some query modules sit beside their writes).
vi.mock("../db", () => ({ getDb: () => undefined }));

const weeks = [1, 2, 3, 4, 5].map((n) =>
  task({ id: `w${n}`, weekNumber: n, title: `Task ${n}` }),
);

// [player, points, position] per week. Totals after each week:
//   W1 ann 10 · bob 8  · cat 2  · dan 0   → ann, bob, cat, dan
//   W2 ann 20 · bob 13 · cat 5  · dan 1   → ann, bob, cat, dan
//   W3 ann 29 · dan 21 · bob 13 · cat 13  → ann, dan, bob =3, cat =3
//   W4 dan 36 · ann 30 · bob 13 · cat 13  → dan, ann, bob =3, cat =3 (cat missed it)
//   W5 dan 48 · ann 35 · cat 23 · bob 14  → dan, ann, cat, bob
const results: Record<string, [string, number, number][]> = {
  w1: [
    ["ann", 10, 1],
    ["bob", 8, 2],
    ["cat", 2, 3],
    ["dan", 0, 4],
  ],
  w2: [
    ["ann", 10, 1],
    ["bob", 5, 2],
    ["cat", 3, 3],
    ["dan", 1, 4],
  ],
  w3: [
    ["dan", 20, 1],
    ["ann", 9, 2],
    ["cat", 8, 3],
    ["bob", 0, 4],
  ],
  w4: [
    ["dan", 15, 1],
    ["ann", 1, 2],
    ["bob", 0, 3],
  ],
  w5: [
    ["dan", 12, 1],
    ["cat", 10, 2],
    ["ann", 5, 3],
    ["bob", 1, 4],
  ],
};
const scores: Score[] = Object.entries(results).flatMap(([taskId, rows]) =>
  rows.map(([playerId, points, position]) => ({
    taskId,
    playerId,
    points,
    position,
  })),
);

const queries = (status: "running" | "closed" = "running") =>
  createQueries(
    competitionData({
      season: season({ status }),
      players: ["ann", "bob", "cat", "dan", "eve"].map((id) => player(id)),
      tasks: weeks,
      scores,
    }),
  );

describe("getPlayerStreaks", () => {
  it("finds each kind of longest run and whether it's still going", () => {
    const { getPlayerStreaks } = queries();
    expect(getPlayerStreaks("dan")?.longest).toEqual({
      win: { kind: "win", length: 3, fromWeek: 3, toWeek: 5, active: true },
      podium: {
        kind: "podium",
        length: 3,
        fromWeek: 3,
        toWeek: 5,
        active: true,
      },
      scoring: {
        kind: "scoring",
        length: 4,
        fromWeek: 2,
        toWeek: 5,
        active: true,
      },
    });
    expect(getPlayerStreaks("ann")?.longest.win).toEqual({
      kind: "win",
      length: 2,
      fromWeek: 1,
      toWeek: 2,
      active: false,
    });
  });

  it("breaks a streak on a week the player wasn't scored", () => {
    const cat = queries().getPlayerStreaks("cat");
    expect(cat?.longest.podium).toMatchObject({
      length: 3,
      fromWeek: 1,
      toWeek: 3,
      active: false,
    });
    expect(cat?.longest.win).toBeUndefined();
  });

  it("tracks climbs, the comeback, the peak and weeks on top", () => {
    const { getPlayerStreaks } = queries();
    const dan = getPlayerStreaks("dan");
    expect(dan?.biggestClimb).toMatchObject({
      fromRank: 4,
      toRank: 2,
      places: 2,
    });
    expect(dan?.biggestClimb?.task.id).toBe("w3");
    expect(dan?.comeback).toEqual({
      lowRank: 4,
      lowWeek: 2,
      rank: 1,
      places: 3,
    });
    expect(dan?.weeksAtTop).toBe(2);
    expect(getPlayerStreaks("ann")).toMatchObject({
      peak: { rank: 1, weekNumber: 1 },
      weeksAtTop: 3,
    });
    expect(getPlayerStreaks("ann")?.comeback).toBeUndefined();
  });

  it("has nothing for an unscored player, and nobody for an unknown id", () => {
    const { getPlayerStreaks } = queries();
    expect(getPlayerStreaks("eve")).toEqual({
      player: player("eve"),
      longest: {},
      weeksAtTop: 0,
    });
    expect(getPlayerStreaks("nobody")).toBeUndefined();
  });
});

describe("getStreakAwards", () => {
  it("crowns the season's streak, climb and comeback leaders", () => {
    const awards = queries().getStreakAwards();
    expect(
      awards.map((a) => [a.id, a.player?.id, a.value, a.detail, a.active]),
    ).toEqual([
      ["win-streak", "dan", "3 in a row", "Weeks 03–05", true],
      ["podium-streak", "ann", "5 in a row", "Weeks 01–05", true],
      ["week-climb", "dan", "+2", "#4 → #2 · Week 03", undefined],
      ["comeback", "dan", "+3", "#4 after week 02 → #1 now", undefined],
    ]);
  });

  it("calls the comeback final once the season is closed", () => {
    const awards = queries("closed").getStreakAwards();
    const comeback = awards.find((a) => a.id === "comeback");
    expect(comeback?.detail).toBe("#4 after week 02 → #1 final");
    // Nothing is still going once the season is over.
    expect(awards.some((a) => a.active)).toBe(false);
  });

  it("is empty before any results", () => {
    const { getStreakAwards } = createQueries(
      competitionData({ players: [player("ann")], tasks: weeks }),
    );
    expect(getStreakAwards()).toEqual([]);
  });

  it("gives a tied streak to the higher-ranked player", () => {
    const { getStreakAwards } = createQueries(
      competitionData({
        players: [player("ann"), player("bob")],
        tasks: weeks.slice(0, 2),
        scores: [
          { taskId: "w1", playerId: "ann", points: 5, position: 1 },
          { taskId: "w1", playerId: "bob", points: 5, position: 1 },
          { taskId: "w2", playerId: "ann", points: 3, position: 1 },
          { taskId: "w2", playerId: "bob", points: 3, position: 1 },
        ],
      }),
    );
    expect(
      getStreakAwards().find((a) => a.id === "win-streak")?.player?.id,
    ).toBe("ann");
  });
});

describe("getPlayerStreakStats", () => {
  it("lists the highlights a player has earned", () => {
    const { getPlayerStreakStats } = queries();
    expect(
      getPlayerStreakStats("cat").map((s) => [s.id, s.value, s.detail]),
    ).toEqual([
      ["peak", "#3", "After week 01"],
      ["podium-streak", "3 in a row", "Weeks 01–03"],
      ["scoring-streak", "3 weeks", "Weeks 01–03"],
    ]);
    expect(getPlayerStreakStats("dan").map((s) => s.id)).toEqual([
      "peak",
      "weeks-at-top",
      "win-streak",
      "podium-streak",
      "scoring-streak",
      "week-climb",
      "comeback",
    ]);
  });

  it("is empty for a player yet to be scored", () => {
    expect(queries().getPlayerStreakStats("eve")).toEqual([]);
  });
});

describe("getLeadersByWeek", () => {
  it("names who topped the table after each week", () => {
    expect(queries().getLeadersByWeek()).toEqual([
      ["ann"],
      ["ann"],
      ["ann"],
      ["dan"],
      ["dan"],
    ]);
  });
});
