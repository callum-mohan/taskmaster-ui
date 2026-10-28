import { describe, expect, it } from "vitest";
import {
  bracketSize,
  buildBracket,
  canRecordResult,
  drawBracket,
  matchPath,
  nextPoolReveal,
  roundLabel,
} from "./pool-bracket";

const teams = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

// Deterministic "random": always picks the last remaining position, so the
// shuffle leaves the order as given.
const keepOrder = () => 0.999999;

describe("bracketSize", () => {
  it.each([
    [2, 2],
    [3, 4],
    [8, 8],
    [9, 16],
    [12, 16],
  ])("fits %i teams in %i slots", (count, size) => {
    expect(bracketSize(count)).toBe(size);
  });
});

describe("drawBracket", () => {
  it("draws every team exactly once", () => {
    const entries = drawBracket(teams(8));
    expect(entries).toHaveLength(8);
    expect(new Set(entries.map((e) => e.teamId))).toEqual(new Set(teams(8)));
    expect(entries.map((e) => e.slot).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("pairs 8 teams in order when the shuffle keeps them", () => {
    expect(drawBracket(teams(8), keepOrder).map((e) => e.teamId)).toEqual(
      teams(8),
    );
  });

  it("spreads byes so two byes never meet in round two", () => {
    const view = buildBracket(drawBracket(teams(12)), []);
    expect(view.size).toBe(16);
    const byes = view.rounds[0].filter((m) => m.bye);
    expect(byes).toHaveLength(4);
    for (const match of view.rounds[1]) {
      const fedByByes = [2 * match.index, 2 * match.index + 1].filter(
        (i) => view.rounds[0][i].bye,
      );
      expect(fedByByes.length).toBeLessThanOrEqual(1);
    }
  });

  it.each([1, 13])("refuses %i teams", (count) => {
    expect(() => drawBracket(teams(count))).toThrow(RangeError);
  });
});

describe("buildBracket", () => {
  const entries = drawBracket(teams(8), keepOrder);

  it("has three rounds for eight teams, with nothing decided yet", () => {
    const view = buildBracket(entries, []);
    expect(view.rounds.map((r) => r.length)).toEqual([4, 2, 1]);
    expect(view.rounds[0][0].teams).toEqual(["t1", "t2"]);
    expect(view.rounds[1][0].teams).toEqual([undefined, undefined]);
    expect(view.championId).toBeUndefined();
  });

  it("advances winners and names the champion and runner-up", () => {
    const view = buildBracket(entries, [
      { round: 0, matchIndex: 0, winnerTeamId: "t1" },
      { round: 0, matchIndex: 1, winnerTeamId: "t4" },
      { round: 0, matchIndex: 2, winnerTeamId: "t5" },
      { round: 0, matchIndex: 3, winnerTeamId: "t8" },
      { round: 1, matchIndex: 0, winnerTeamId: "t4" },
      { round: 1, matchIndex: 1, winnerTeamId: "t5" },
      { round: 2, matchIndex: 0, winnerTeamId: "t5" },
    ]);
    expect(view.rounds[1][0].teams).toEqual(["t1", "t4"]);
    expect(view.rounds[2][0].teams).toEqual(["t4", "t5"]);
    expect(view.championId).toBe("t5");
    expect(view.runnerUpId).toBe("t4");
  });

  it("ignores a result for a team that isn't in that match", () => {
    const view = buildBracket(entries, [
      { round: 0, matchIndex: 0, winnerTeamId: "t3" },
      { round: 1, matchIndex: 0, winnerTeamId: "t1" },
    ]);
    expect(view.rounds[0][0].winnerId).toBeUndefined();
    expect(view.rounds[1][0].winnerId).toBeUndefined();
  });

  it("sends a bye straight through", () => {
    const view = buildBracket(drawBracket(teams(3), keepOrder), []);
    const bye = view.rounds[0].find((m) => m.bye);
    expect(bye?.winnerId).toBeDefined();
    expect(view.rounds[1][0].teams).toContain(bye?.winnerId);
  });
});

describe("canRecordResult", () => {
  const view = buildBracket(drawBracket(teams(8), keepOrder), [
    { round: 0, matchIndex: 0, winnerTeamId: "t1" },
  ]);

  it("allows a winner from an undecided match with both teams", () => {
    expect(canRecordResult(view, 0, 1, "t3")).toBe(true);
  });

  it.each([
    ["decided", 0, 0, "t1"],
    ["waiting on a team", 1, 0, "t1"],
    ["not in the match", 0, 1, "t1"],
    ["no such match", 5, 0, "t1"],
  ])("refuses a match %s", (_, round, index, winner) => {
    expect(canRecordResult(view, round, index, winner)).toBe(false);
  });
});

describe("matchPath", () => {
  it("follows a match through to the final", () => {
    const view = buildBracket(drawBracket(teams(8)), []);
    expect(matchPath(view, 0, 3)).toEqual([
      { round: 0, matchIndex: 3 },
      { round: 1, matchIndex: 1 },
      { round: 2, matchIndex: 0 },
    ]);
  });
});

describe("nextPoolReveal", () => {
  it.each([
    // Thursday 22 Oct 2026 (BST) → Monday 26 Oct.
    ["2026-10-22T12:00:00Z", "2026-10-26 09:00:00"],
    // Monday 08:59 UK (07:59Z in BST) → same morning.
    ["2026-10-19T07:59:00Z", "2026-10-19 09:00:00"],
    // Monday 09:00 UK → the following Monday.
    ["2026-10-19T08:00:00Z", "2026-10-26 09:00:00"],
    // Sunday night in GMT → the next day.
    ["2026-11-01T23:30:00Z", "2026-11-02 09:00:00"],
  ])("a draw at %s is revealed %s", (now, reveal) => {
    expect(nextPoolReveal(new Date(now))).toBe(reveal);
  });
});

describe("roundLabel", () => {
  it("names the last rounds", () => {
    expect([0, 1, 2, 3].map((r) => roundLabel(r, 4))).toEqual([
      "Round 1",
      "Quarter-finals",
      "Semi-finals",
      "Final",
    ]);
  });
});
