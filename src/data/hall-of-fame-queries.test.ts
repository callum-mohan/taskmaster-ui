import { describe, expect, it } from "vitest";
import { buildHallOfFame, type ClosedSeason } from "./hall-of-fame-queries";
import type {
  Award,
  LeaderboardRow,
  PlayerStreaks,
  Score,
  TeamStanding,
} from "../types";
import { player, season, task, team } from "../test/fixtures";

const row = (
  id: string,
  points: number,
  wins = 0,
  tasksCompleted = 1,
): LeaderboardRow => ({
  rank: 0,
  player: player(id),
  points,
  bonusPoints: 0,
  tasksCompleted,
  wins,
  averagePosition: 1,
  form: [],
});

const score = (taskId: string, playerId: string, points: number): Score => ({
  taskId,
  playerId,
  points,
  position: 1,
});

function closed(
  id: string,
  {
    leaderboard = [],
    squads = [],
    awards = [],
    scores = [],
    streaks = [],
    tasks = [task({ id: `${id}-w1`, seasonId: id })],
  }: {
    leaderboard?: LeaderboardRow[];
    squads?: TeamStanding[];
    awards?: Award[];
    scores?: Score[];
    streaks?: PlayerStreaks[];
    tasks?: ReturnType<typeof task>[];
  },
): ClosedSeason {
  return {
    season: season({ id, name: id, isCurrent: false, status: "closed" }),
    players: leaderboard.map((r) => r.player),
    tasks,
    scores,
    getLeaderboard: () => leaderboard,
    getTeamLeaderboard: () => squads,
    getAwards: () => awards,
    getAllPlayerStreaks: () => streaks,
  };
}

const award = (id: string): Award => ({
  id,
  title: id,
  command: id,
  value: "1",
  accent: "acid",
});

describe("buildHallOfFame", () => {
  it("is empty before any season closes", () => {
    expect(buildHallOfFame([])).toEqual({ seasons: [], records: [] });
  });

  it("lists closed seasons newest first with podium, squad and awards", () => {
    const squad: TeamStanding = {
      rank: 1,
      team: team("reds", ["ann"]),
      members: [player("ann")],
      points: 20,
      tasksCompleted: 1,
      wins: 1,
      averagePosition: 1,
      form: [1],
    };
    const fame = buildHallOfFame([
      closed("s1", {
        leaderboard: [
          row("ann", 30),
          row("bob", 20),
          row("cat", 10),
          row("dan", 5),
          row("eve", 0, 0, 0),
        ],
        squads: [squad],
        awards: [award("champion"), award("most-wins")],
      }),
      closed("s2", { leaderboard: [row("fay", 12)] }),
    ]);
    expect(fame.seasons.map((s) => s.season.id)).toEqual(["s2", "s1"]);
    const [, first] = fame.seasons;
    expect(first.podium.map((r) => r.player.id)).toEqual(["ann", "bob", "cat"]);
    expect(first.winningSquad?.team.id).toBe("reds");
    expect(first.awards.map((a) => a.id)).toEqual(["most-wins"]);
    expect(fame.seasons[0].winningSquad).toBeUndefined();
  });

  it("keeps all-time records with whoever set them first", () => {
    const s1Tasks = [
      task({ id: "s1-w1", seasonId: "s1", weekNumber: 1, title: "Eggs" }),
      task({ id: "s1-w2", seasonId: "s1", weekNumber: 2, format: "team" }),
    ];
    const fame = buildHallOfFame([
      closed("s1", {
        leaderboard: [row("ann", 40, 3), row("bob", 10, 1)],
        tasks: s1Tasks,
        scores: [
          score("s1-w1", "ann", 9),
          // Team-task points don't count as an individual best week.
          score("s1-w2", "bob", 50),
        ],
      }),
      closed("s2", {
        leaderboard: [row("fay", 40, 3), row("gus", 35, 0)],
        scores: [score("s2-w1", "fay", 9)],
      }),
    ]);
    const records = Object.fromEntries(
      fame.records.map((r) => [r.id, [r.player.id, r.season.id, r.value]]),
    );
    expect(records).toEqual({
      "season-points": ["ann", "s1", "40 pts"],
      "title-margin": ["ann", "s1", "+30 pts"],
      "season-wins": ["ann", "s1", "3 wins"],
      "week-score": ["ann", "s1", "9 pts"],
    });
    expect(fame.records.find((r) => r.id === "week-score")?.detail).toBe(
      "Week 1: Eggs",
    );
  });

  it("skips a tie-break margin and a pointless squad", () => {
    const fame = buildHallOfFame([
      closed("s1", {
        leaderboard: [row("ann", 10), row("bob", 10)],
        squads: [
          {
            rank: 1,
            team: team("reds", ["ann"]),
            members: [player("ann")],
            points: 0,
            tasksCompleted: 1,
            wins: 0,
            averagePosition: 1,
            form: [1],
          },
        ],
      }),
    ]);
    expect(fame.records.map((r) => r.id)).not.toContain("title-margin");
    expect(fame.seasons[0].winningSquad).toBeUndefined();
  });

  it("keeps streak, climb and comeback records with whoever set them first", () => {
    const streaks = (
      id: string,
      wins: number,
      climb: number,
      comeback: number,
    ): PlayerStreaks => ({
      player: player(id),
      longest: {
        win: {
          kind: "win",
          length: wins,
          fromWeek: 2,
          toWeek: 1 + wins,
          active: false,
        },
      },
      biggestClimb: {
        task: task({ weekNumber: 4 }),
        fromRank: 1 + climb,
        toRank: 1,
        places: climb,
      },
      comeback: {
        lowRank: 1 + comeback,
        lowWeek: 3,
        rank: 1,
        places: comeback,
      },
      weeksAtTop: 0,
    });
    const fame = buildHallOfFame([
      closed("s1", { streaks: [streaks("ann", 3, 5, 2)] }),
      closed("s2", { streaks: [streaks("bob", 3, 6, 9)] }),
    ]);
    const records = Object.fromEntries(
      fame.records.map((r) => [
        r.id,
        [r.player.id, r.season.id, r.value, r.detail],
      ]),
    );
    expect(records).toEqual({
      "win-streak": ["ann", "s1", "3 in a row", "Weeks 02–04"],
      "week-climb": ["bob", "s2", "+6 places", "#7 → #1 · Week 04"],
      comeback: ["bob", "s2", "+9 places", "#10 after week 03 → #1 final"],
    });
  });

  it("skips a one-week streak", () => {
    const fame = buildHallOfFame([
      closed("s1", {
        streaks: [
          {
            player: player("ann"),
            longest: {
              podium: {
                kind: "podium",
                length: 1,
                fromWeek: 1,
                toWeek: 1,
                active: false,
              },
            },
            weeksAtTop: 0,
          },
        ],
      }),
    ]);
    expect(fame.records).toEqual([]);
  });
});
