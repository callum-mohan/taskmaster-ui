import { describe, expect, it, vi } from "vitest";
import { createQueries } from "./queries";
import { ACHIEVEMENTS } from "./achievement-queries";
import type { Score } from "../types";
import { coinData, competitionData, player, task } from "../test/fixtures";

// The selectors are pure; this only stops the db client's `astro:env`
// import loading (some query modules sit beside their writes).
vi.mock("../db", () => ({ getDb: () => undefined }));

const weeks = [1, 2, 3].map((n) =>
  task({ id: `w${n}`, weekNumber: n, status: "completed" }),
);
// ann wins weeks 1–2 and comes 2nd in week 3; bob misses week 2.
const scores: Score[] = [
  { taskId: "w1", playerId: "ann", points: 10, position: 1 },
  { taskId: "w1", playerId: "bob", points: 4, position: 2 },
  { taskId: "w2", playerId: "ann", points: 12, position: 1 },
  { taskId: "w3", playerId: "bob", points: 9, position: 1 },
  { taskId: "w3", playerId: "ann", points: 5, position: 2 },
];

const board = (playerId: string) =>
  createQueries(
    competitionData({
      players: [player("ann"), player("bob"), player("cat")],
      tasks: weeks,
      scores,
      resultsPostedAt: Object.fromEntries(weeks.map((w) => [w.id, w.deadline])),
      predictions: [
        { taskId: "w1", playerId: "bob", pick: { type: "player", id: "ann" } },
        { taskId: "w3", playerId: "bob", pick: { type: "player", id: "ann" } },
      ],
      coins: coinData({
        miniTasks: [
          {
            id: 1,
            title: "Plant",
            reward: 2,
            startsOn: "2026-10-26",
            endsOn: "2026-10-26",
            status: "ended",
          },
        ],
        miniTaskCompletions: [
          {
            miniTaskId: 1,
            playerId: "bob",
            actorName: "TM",
            at: "2026-10-26T10:00:00.000Z",
          },
        ],
      }),
    }),
  ).getAchievementBoard(playerId);

const find = (playerId: string, id: string) =>
  board(playerId)
    .groups.flatMap((g) => g.items)
    .find((i) => i.achievement.id === id)!;

describe("getAchievementBoard", () => {
  it("lists every achievement once, grouped by category", () => {
    const result = board("ann");
    expect(result.total).toBe(ACHIEVEMENTS.length);
    expect(result.groups.map((g) => g.category)).toEqual([
      "results",
      "streaks",
      "taking-part",
      "coin",
    ]);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(
      ACHIEVEMENTS.length,
    );
  });

  it("unlocks what a player has done and shows progress on the rest", () => {
    expect(find("ann", "task-winner")).toMatchObject({
      unlocked: true,
      current: 1,
      target: 1,
      percent: 100,
    });
    expect(find("ann", "serial-winner")).toMatchObject({
      unlocked: false,
      current: 2,
      target: 3,
      percent: 67,
    });
    expect(find("ann", "on-fire").unlocked).toBe(true);
    expect(find("ann", "ever-present")).toMatchObject({
      unlocked: true,
      current: 3,
      target: 3,
    });
    expect(find("bob", "ever-present")).toMatchObject({
      unlocked: false,
      current: 2,
      target: 3,
    });
    expect(find("ann", "top-of-the-table").unlocked).toBe(true);
    expect(find("ann", "high-scorer").unlocked).toBe(true);
  });

  it("counts calls, correct calls and mini-tasks", () => {
    expect(find("bob", "pundit")).toMatchObject({ current: 2, target: 5 });
    expect(find("bob", "oracle")).toMatchObject({ current: 1, target: 3 });
    expect(find("bob", "side-quester")).toMatchObject({ current: 1 });
  });

  it("caps progress at the target and starts a newcomer at zero", () => {
    expect(find("ann", "off-the-mark").current).toBe(1);
    const fresh = board("cat");
    expect(fresh.unlockedCount).toBe(0);
    expect(
      fresh.groups.flatMap((g) => g.items).every((i) => i.percent === 0),
    ).toBe(true);
  });
});
