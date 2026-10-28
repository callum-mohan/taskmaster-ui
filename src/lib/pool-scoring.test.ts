import { describe, expect, it } from "vitest";
import { buildBracket, drawBracket, type PoolResult } from "./pool-bracket";
import {
  bracketFinishes,
  currentMatchFor,
  matchAgreement,
  poolStandings,
} from "./pool-scoring";

const teams = Array.from({ length: 8 }, (_, i) => `t${i + 1}`);
const entries = drawBracket(teams, () => 0.999999);

// t1 beats t2, t3 beats t4, ... then the lower-numbered side keeps winning.
const played: PoolResult[] = [
  { round: 0, matchIndex: 0, winnerTeamId: "t1" },
  { round: 0, matchIndex: 1, winnerTeamId: "t3" },
  { round: 0, matchIndex: 2, winnerTeamId: "t5" },
  { round: 0, matchIndex: 3, winnerTeamId: "t7" },
  { round: 1, matchIndex: 0, winnerTeamId: "t1" },
  { round: 1, matchIndex: 1, winnerTeamId: "t5" },
];
const unfinished = buildBracket(entries, played);
const finished = buildBracket(entries, [
  ...played,
  { round: 2, matchIndex: 0, winnerTeamId: "t1" },
]);

describe("bracketFinishes", () => {
  it("gives nothing out until the final is decided", () => {
    expect(bracketFinishes(unfinished)).toBeUndefined();
  });

  it("ranks finalists above earlier knockouts", () => {
    const finishes = bracketFinishes(finished)!;
    expect(finishes.get("t1")).toBe("champion");
    expect(finishes.get("t5")).toBe("runnerUp");
    expect(finishes.get("t3")).toBe("semiFinalist");
    expect(finishes.get("t7")).toBe("semiFinalist");
    expect(finishes.get("t2")).toBe("knockedOut");
    expect(finishes.size).toBe(8);
  });
});

describe("poolStandings", () => {
  it("adds up finished weeks only, ranking ties together", () => {
    const table = poolStandings(teams, [finished, finished, unfinished]);
    expect(table[0]).toMatchObject({
      teamId: "t1",
      rank: 1,
      points: 10,
      titles: 2,
      matchWins: 6,
      weeks: 2,
    });
    expect(table[1]).toMatchObject({ teamId: "t5", points: 6, runnerUps: 2 });
    const semis = table.filter((r) => r.points === 4);
    expect(semis.map((r) => r.rank)).toEqual([3, 3]);
    expect(table.at(-1)).toMatchObject({ points: 2, rank: 5 });
  });
});

describe("matchAgreement", () => {
  const final = unfinished.rounds[2][0];
  const claim = (teamId: string, winnerTeamId: string) => ({
    round: 2,
    matchIndex: 0,
    teamId,
    winnerTeamId,
  });

  it("waits for the other team, then agrees or flags a dispute", () => {
    expect(matchAgreement(final, [])).toEqual({ state: "none" });
    expect(matchAgreement(final, [claim("t1", "t1")])).toMatchObject({
      state: "waiting",
      teamId: "t1",
    });
    expect(
      matchAgreement(final, [claim("t1", "t1"), claim("t5", "t1")]),
    ).toEqual({ state: "agreed", winnerTeamId: "t1" });
    expect(
      matchAgreement(final, [claim("t1", "t1"), claim("t5", "t5")]),
    ).toEqual({ state: "disputed" });
  });

  it("ignores claims from teams not in the match", () => {
    expect(matchAgreement(final, [claim("t2", "t1")])).toEqual({
      state: "none",
    });
  });
});

describe("currentMatchFor", () => {
  it("finds a team's undecided match and nothing once they're out", () => {
    expect(currentMatchFor(unfinished, "t1")).toMatchObject({ round: 2 });
    expect(currentMatchFor(unfinished, "t2")).toBeUndefined();
  });
});
