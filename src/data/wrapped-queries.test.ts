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

// Final totals: dan 48 · ann 35 · cat 23 · bob 16 (incl. a +2 bonus) · eve 0.
// Ann leads after weeks 1–3, Dan after weeks 4–5.
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

const queries = () =>
  createQueries(
    competitionData({
      season: season({ status: "closed" }),
      players: ["ann", "bob", "cat", "dan", "eve"].map((id) => player(id)),
      tasks: weeks,
      scores,
      bonusPoints: [
        { taskId: "w5", playerId: "bob", points: 2, reason: "Poll vote" },
      ],
    }),
  );

describe("getSeasonWrapped", () => {
  it("wraps up the podium, the title race and the totals", () => {
    const wrapped = queries().getSeasonWrapped();
    expect(wrapped.podium.map((r) => r.player.id)).toEqual([
      "dan",
      "ann",
      "cat",
    ]);
    expect(wrapped.margin).toBe(13);
    expect(wrapped.weeksScored).toBe(5);
    expect(wrapped.bonusPoints).toBe(2);
    expect(wrapped.leadChanges).toBe(1);
    expect(
      wrapped.leaders.map(({ player, weeks }) => [player.id, weeks]),
    ).toEqual([
      ["ann", 3],
      ["dan", 2],
    ]);
    expect(wrapped.wireToWire).toBe(false);
    expect(wrapped.standings).toHaveLength(5);
  });

  it("keeps the streaks but leaves out the champion and last-week awards", () => {
    const wrapped = queries().getSeasonWrapped();
    expect(wrapped.streaks.map((a) => a.id)).toEqual([
      "win-streak",
      "podium-streak",
      "week-climb",
      "comeback",
    ]);
    const ids = wrapped.awards.map((a) => a.id);
    expect(ids).not.toContain("champion");
    expect(ids).not.toContain("climber");
    expect(ids).toContain("most-wins");
  });

  it("spots a wire-to-wire champion", () => {
    const { getSeasonWrapped } = createQueries(
      competitionData({
        players: [player("ann"), player("bob")],
        tasks: weeks.slice(0, 2),
        scores: [
          { taskId: "w1", playerId: "ann", points: 5, position: 1 },
          { taskId: "w1", playerId: "bob", points: 3, position: 2 },
          { taskId: "w2", playerId: "ann", points: 5, position: 1 },
          { taskId: "w2", playerId: "bob", points: 4, position: 2 },
        ],
      }),
    );
    expect(getSeasonWrapped()).toMatchObject({
      wireToWire: true,
      leadChanges: 0,
    });
  });

  it("is an empty review before any results", () => {
    const wrapped = createQueries(
      competitionData({ players: [player("ann")], tasks: weeks }),
    ).getSeasonWrapped();
    expect(wrapped).toMatchObject({
      podium: [],
      weeksScored: 0,
      leaders: [],
      wireToWire: false,
      streaks: [],
    });
    expect(wrapped.margin).toBeUndefined();
  });
});

describe("getPlayerWrapped", () => {
  it("reviews a player's season", () => {
    const ann = queries().getPlayerWrapped("ann");
    expect(ann).toMatchObject({
      persona: {
        title: "The Contender",
        blurb: "Finished #2, just 13 points off the title.",
      },
      playerCount: 5,
      weeksScored: 5,
      beaten: 3,
      podiums: 5,
      chasing: { rank: 1, gap: 13 },
      holdingOff: { rank: 3, gap: 12 },
    });
    expect(ann?.bestWeek?.task.id).toBe("w1");
    expect(ann?.toughestWeek?.task.id).toBe("w5");
    expect(ann?.awardsWon.map((a) => a.id)).toContain("podium-streak");
    expect(ann?.awardsWon.every((a) => a.player === undefined)).toBe(true);
    expect(ann?.highlights.map((h) => h.id)).toContain("weeks-at-top");
  });

  it("gives everyone a persona", () => {
    const { getPlayerWrapped } = queries();
    const personas = ["dan", "cat", "bob", "eve"].map(
      (id) => getPlayerWrapped(id)?.persona.title,
    );
    expect(personas).toEqual([
      "The Champion",
      "The Contender",
      "The Ever-Present",
      "The Mystery Guest",
    ]);
  });

  it("crowns only the tie-break winner when the top two are level", () => {
    const { getPlayerWrapped } = createQueries(
      competitionData({
        players: [player("ann"), player("bob")],
        tasks: weeks.slice(0, 2),
        scores: [
          { taskId: "w1", playerId: "ann", points: 5, position: 1 },
          { taskId: "w1", playerId: "bob", points: 3, position: 2 },
          { taskId: "w2", playerId: "ann", points: 3, position: 2 },
          { taskId: "w2", playerId: "bob", points: 5, position: 1 },
        ],
      }),
    );
    // Level on points, wins and average finish: both share rank 1, with Ann
    // first on roster order.
    expect(getPlayerWrapped("ann")?.persona.title).toBe("The Champion");
    expect(getPlayerWrapped("bob")?.persona).toEqual({
      title: "The Contender",
      blurb: "Level on points with the champion, edged out on the tie-break.",
    });
  });

  it("doesn't award the champion title twice", () => {
    const dan = queries().getPlayerWrapped("dan");
    expect(dan?.awardsWon.map((a) => a.id)).not.toContain("champion");
    expect(dan?.chasing).toBeUndefined();
  });

  it("only compares a player with neighbours who played", () => {
    const bob = queries().getPlayerWrapped("bob");
    expect(bob?.chasing).toMatchObject({ rank: 3, gap: 7 });
    expect(bob?.holdingOff).toBeUndefined();
    expect(queries().getPlayerWrapped("eve")?.chasing).toBeUndefined();
  });

  it("is undefined for someone not on the roster", () => {
    expect(queries().getPlayerWrapped("nobody")).toBeUndefined();
  });
});
