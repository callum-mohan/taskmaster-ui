import { describe, expect, it } from "vitest";
import { buildScoreRecords, type ScoreRows } from "./scores";
import {
  player,
  task,
  taskScoreRow,
  team,
  teamScoreRow,
} from "../test/fixtures";

const players = ["alice", "bob", "cara", "dev", "eve"].map((id) => player(id));
const week1 = task({ id: "week-01", weekNumber: 1 });
const week2 = task({ id: "week-02", weekNumber: 2, format: "team" });
const week3 = task({ id: "week-03", weekNumber: 3 });
const tasks = [week1, week2, week3];
const teams = [
  team("red", ["alice", "bob"]),
  team("blue", ["cara", "dev"]),
  team("green", ["eve"]),
];

function build(rows: Partial<ScoreRows>, publishedAt?: Record<string, string>) {
  return buildScoreRecords(
    { taskScores: [], teamScores: [], bonusPoints: [], ...rows },
    { players, teams, tasks, publishedAt },
  );
}

/** `playerId → position` for one task's individual scores. */
const positions = (
  scores: { taskId: string; playerId: string; position: number }[],
  taskId = "week-01",
) =>
  Object.fromEntries(
    scores
      .filter((s) => s.taskId === taskId)
      .map((s) => [s.playerId, s.position]),
  );

describe("buildScoreRecords", () => {
  describe("individual finishing positions", () => {
    it("ranks players highest points first", () => {
      const { scores } = build({
        taskScores: [
          taskScoreRow("week-01", "alice", 3),
          taskScoreRow("week-01", "bob", 5),
          taskScoreRow("week-01", "cara", 1),
        ],
      });
      expect(scores).toEqual([
        { taskId: "week-01", playerId: "bob", points: 5, position: 1 },
        { taskId: "week-01", playerId: "alice", points: 3, position: 2 },
        { taskId: "week-01", playerId: "cara", points: 1, position: 3 },
      ]);
    });

    it("shares a position on a tie and skips the next (1, 2, 2, 4)", () => {
      const { scores } = build({
        taskScores: [
          taskScoreRow("week-01", "alice", 10),
          taskScoreRow("week-01", "bob", 8),
          taskScoreRow("week-01", "cara", 8),
          taskScoreRow("week-01", "dev", 5),
        ],
      });
      expect(positions(scores)).toEqual({ alice: 1, bob: 2, cara: 2, dev: 4 });
    });

    it("shares first place between joint winners (1, 1, 1, 4)", () => {
      const { scores } = build({
        taskScores: [
          taskScoreRow("week-01", "alice", 5),
          taskScoreRow("week-01", "bob", 5),
          taskScoreRow("week-01", "cara", 5),
          taskScoreRow("week-01", "dev", 2),
        ],
      });
      expect(positions(scores)).toEqual({ alice: 1, bob: 1, cara: 1, dev: 4 });
    });

    it("handles back-to-back ties (1, 1, 3, 3, 5)", () => {
      const { scores } = build({
        taskScores: [
          taskScoreRow("week-01", "alice", 5),
          taskScoreRow("week-01", "bob", 5),
          taskScoreRow("week-01", "cara", 3),
          taskScoreRow("week-01", "dev", 3),
          taskScoreRow("week-01", "eve", 1),
        ],
      });
      expect(positions(scores)).toEqual({
        alice: 1,
        bob: 1,
        cara: 3,
        dev: 3,
        eve: 5,
      });
    });

    it("ranks zero and negative points below positive ones", () => {
      const { scores } = build({
        taskScores: [
          taskScoreRow("week-01", "alice", -2),
          taskScoreRow("week-01", "bob", 0),
          taskScoreRow("week-01", "cara", 1),
        ],
      });
      expect(positions(scores)).toEqual({ cara: 1, bob: 2, alice: 3 });
    });

    it("orders tied players by roster, whatever order the rows came in", () => {
      const rows = [
        taskScoreRow("week-01", "dev", 4),
        taskScoreRow("week-01", "bob", 4),
        taskScoreRow("week-01", "cara", 4),
      ];
      const forward = build({ taskScores: rows }).scores;
      const reversed = build({ taskScores: [...rows].reverse() }).scores;
      expect(forward.map((s) => s.playerId)).toEqual(["bob", "cara", "dev"]);
      expect(reversed).toEqual(forward);
    });

    it("ranks each task independently", () => {
      const { scores } = build({
        taskScores: [
          taskScoreRow("week-01", "alice", 5),
          taskScoreRow("week-01", "bob", 1),
          taskScoreRow("week-03", "alice", 1),
          taskScoreRow("week-03", "bob", 5),
        ],
      });
      expect(positions(scores, "week-01")).toEqual({ alice: 1, bob: 2 });
      expect(positions(scores, "week-03")).toEqual({ bob: 1, alice: 2 });
    });

    it("carries score comments and omits null ones", () => {
      const { scores } = build({
        taskScores: [
          taskScoreRow("week-01", "alice", 5, { comment: "Flew 12m" }),
          taskScoreRow("week-01", "bob", 3),
        ],
      });
      expect(scores[0].comment).toBe("Flew 12m");
      expect(scores[1]).not.toHaveProperty("comment");
    });

    it("skips weeks with no scores", () => {
      const { scores, teamScores } = build({});
      expect(scores).toEqual([]);
      expect(teamScores).toEqual([]);
    });
  });

  describe("team tasks", () => {
    const teamRows = [
      teamScoreRow("week-02", "blue", 6),
      teamScoreRow("week-02", "red", 9),
      teamScoreRow("week-02", "green", 6),
    ];

    it("ranks squads with shared positions on a tie", () => {
      const { teamScores } = build({ teamScores: teamRows });
      expect(teamScores).toEqual([
        { taskId: "week-02", teamId: "red", points: 9, position: 1 },
        { taskId: "week-02", teamId: "blue", points: 6, position: 2 },
        { taskId: "week-02", teamId: "green", points: 6, position: 2 },
      ]);
    });

    it("breaks squad ties by team order", () => {
      const { teamScores } = build({ teamScores: [...teamRows].reverse() });
      expect(teamScores.map((t) => t.teamId)).toEqual(["red", "blue", "green"]);
    });

    it("credits every member with the squad's points and position", () => {
      const { scores } = build({ teamScores: teamRows });
      expect(scores).toEqual([
        { taskId: "week-02", playerId: "alice", points: 9, position: 1 },
        { taskId: "week-02", playerId: "bob", points: 9, position: 1 },
        { taskId: "week-02", playerId: "cara", points: 6, position: 2 },
        { taskId: "week-02", playerId: "dev", points: 6, position: 2 },
        { taskId: "week-02", playerId: "eve", points: 6, position: 2 },
      ]);
    });

    it("carries squad comments onto the team result only", () => {
      const { teamScores, scores } = build({
        teamScores: [teamScoreRow("week-02", "red", 9, { comment: "Nailed" })],
      });
      expect(teamScores[0].comment).toBe("Nailed");
      expect(scores.every((s) => !("comment" in s))).toBe(true);
    });

    it("ignores scores recorded against the other format", () => {
      const { scores, teamScores } = build({
        taskScores: [taskScoreRow("week-02", "alice", 50)],
        teamScores: [teamScoreRow("week-01", "red", 50)],
      });
      expect(scores).toEqual([]);
      expect(teamScores).toEqual([]);
    });
  });

  describe("bonus points", () => {
    const bonus = (
      taskId: string,
      playerId: string,
      points: number,
      reason = "Bonus",
    ) => ({ taskId, playerId, points, reason });

    it("keeps bonuses and deductions without touching positions", () => {
      const { bonusPoints, scores } = build({
        taskScores: [
          taskScoreRow("week-01", "alice", 5),
          taskScoreRow("week-01", "bob", 3),
        ],
        bonusPoints: [
          bonus("week-01", "bob", 10),
          bonus("week-01", "alice", -2),
        ],
      });
      expect(positions(scores)).toEqual({ alice: 1, bob: 2 });
      expect(bonusPoints).toEqual([
        { taskId: "week-01", playerId: "bob", points: 10, reason: "Bonus" },
        { taskId: "week-01", playerId: "alice", points: -2, reason: "Bonus" },
      ]);
    });

    it("lists bonuses in week order, then recorded order", () => {
      const { bonusPoints } = buildScoreRecords(
        {
          taskScores: [],
          teamScores: [],
          bonusPoints: [
            bonus("week-03", "alice", 1, "c"),
            bonus("week-01", "alice", 1, "a"),
            bonus("week-01", "bob", 1, "b"),
          ],
        },
        // Tasks given out of week order.
        { players, teams, tasks: [week3, week1, week2] },
      );
      expect(bonusPoints.map((b) => b.reason)).toEqual(["a", "b", "c"]);
    });

    it("allows several adjustments for a player in one week", () => {
      const { bonusPoints } = build({
        bonusPoints: [
          bonus("week-01", "alice", 2),
          bonus("week-01", "alice", 3),
        ],
      });
      expect(bonusPoints.map((b) => b.points)).toEqual([2, 3]);
    });

    it("drops zero-point entries and unknown players or tasks", () => {
      const { bonusPoints } = build({
        bonusPoints: [
          bonus("week-01", "alice", 0),
          bonus("week-01", "ghost", 5),
          bonus("week-99", "alice", 5),
        ],
      });
      expect(bonusPoints).toEqual([]);
    });

    it("adds the row id and award time for stored bonuses only", () => {
      const { bonusPoints } = build({
        bonusPoints: [
          {
            ...bonus("week-01", "alice", 2),
            id: 12,
            createdAt: "2026-01-12 13:55:43.12+00",
          },
          bonus("week-01", "bob", 1),
        ],
      });
      expect(bonusPoints[0]).toMatchObject({
        id: 12,
        awardedAt: "2026-01-12T13:55:43.120Z",
      });
      expect(bonusPoints[1]).not.toHaveProperty("id");
      expect(bonusPoints[1]).not.toHaveProperty("awardedAt");
    });
  });

  describe("resultsPostedAt", () => {
    it("is the first score recorded for each task", () => {
      const { resultsPostedAt } = build({
        taskScores: [
          taskScoreRow("week-01", "alice", 5, {
            createdAt: "2026-01-12 11:00:00+00",
          }),
          taskScoreRow("week-01", "bob", 3, {
            createdAt: "2026-01-12 10:30:00+00",
          }),
        ],
        teamScores: [
          teamScoreRow("week-02", "red", 9, {
            createdAt: "2026-01-19 10:00:00+01",
          }),
        ],
      });
      expect(resultsPostedAt).toEqual({
        "week-01": "2026-01-12T10:30:00.000Z",
        "week-02": "2026-01-19T09:00:00.000Z",
      });
    });

    it("ignores scores recorded against the other format", () => {
      const { resultsPostedAt } = build({
        taskScores: [taskScoreRow("week-02", "alice", 5)],
        teamScores: [teamScoreRow("week-01", "red", 9)],
      });
      expect(resultsPostedAt).toEqual({});
    });

    it("dates held results from when they were published", () => {
      const { resultsPostedAt } = build(
        {
          taskScores: [
            taskScoreRow("week-01", "alice", 5, {
              createdAt: "2026-01-12 10:00:00+00",
            }),
          ],
        },
        { "week-01": "2026-01-12 20:00:00+00" },
      );
      expect(resultsPostedAt["week-01"]).toBe("2026-01-12T20:00:00.000Z");
    });

    it("keeps the first score time if publishing came earlier", () => {
      const { resultsPostedAt } = build(
        {
          taskScores: [
            taskScoreRow("week-01", "alice", 5, {
              createdAt: "2026-01-12 10:00:00+00",
            }),
          ],
        },
        { "week-01": "2026-01-12 09:00:00+00" },
      );
      expect(resultsPostedAt["week-01"]).toBe("2026-01-12T10:00:00.000Z");
    });

    it("ignores a publish time for a task with no scores", () => {
      const { resultsPostedAt } = build(
        {},
        { "week-01": "2026-01-12 20:00:00+00" },
      );
      expect(resultsPostedAt).toEqual({});
    });
  });
});
