import type {
  BonusPoint,
  Player,
  Score,
  Task,
  Team,
  TeamScore,
} from "../types";
import type {
  bonusPoints as bonusPointsTable,
  taskScores as taskScoresTable,
  teamScores as teamScoresTable,
} from "../db/schema";
import { timestamptzToIso } from "../lib/time";
import { goldenWeekPoints } from "./coin-rules";

export interface ScoreRows {
  taskScores: (typeof taskScoresTable.$inferSelect)[];
  teamScores: (typeof teamScoresTable.$inferSelect)[];
  /** In recorded order (stored rows, then derived poll-vote bonuses). */
  bonusPoints: (Pick<
    typeof bonusPointsTable.$inferSelect,
    "taskId" | "playerId" | "points" | "reason"
  > &
    // Only stored rows have these; poll-vote bonuses are derived.
    Partial<Pick<typeof bonusPointsTable.$inferSelect, "id" | "createdAt">>)[];
}

export interface ScoreRecords {
  /** All individual scores (team-task points expanded to members included). */
  scores: Score[];
  /** All team results for scored team tasks, ranked. */
  teamScores: TeamScore[];
  /** All bonus points and deductions. */
  bonusPoints: BonusPoint[];
  /** When each scored task's results were first recorded (ISO 8601). */
  resultsPostedAt: Record<string, string>;
}

/**
 * Raw weekly results, grouped by task id (`week-NN`). Only points are stored:
 * finishing positions and leaderboard totals are derived below and in
 * `queries.ts`, so recording a week's results is just inserting its rows.
 *
 * - `task_scores`  → one row per player per individual task.
 * - `team_scores`  → one row per squad per team task. A squad's points are
 *   awarded to the team (team leaderboard) *and* to every member (so the
 *   individual standings stay complete).
 * - `bonus_points` → one-off bonuses (positive) and deductions (negative).
 *   They count toward the overall total but never change that week's
 *   finishing positions or winner, and a player can receive several per week.
 *
 * A week with no rows has simply not been scored yet. (A task's `status` is
 * derived from its dates in `tasks.ts`, so nothing needs flipping manually.)
 */
export function buildScoreRecords(
  rows: ScoreRows,
  {
    players,
    teams,
    tasks,
    publishedAt = {},
    goldenWeekKeys = new Set(),
  }: {
    players: Player[];
    teams: Team[];
    tasks: Task[];
    /** When held results were published (timestamptz), keyed by task id. */
    publishedAt?: Record<string, string>;
    /**
     * `${taskId}:${playerId}` of every Golden Week used. The player's task
     * points are boosted before positions are decided (on team tasks only
     * their own credit is, so the squad's result is unchanged).
     */
    goldenWeekKeys?: ReadonlySet<string>;
  },
): ScoreRecords {
  /** Groups rows into `{ [taskId]: T[] }`, preserving row order. */
  function groupByTask<Row extends { taskId: string }, T>(
    items: Row[],
    map: (row: Row) => T,
  ): Record<string, T[]> {
    const grouped: Record<string, T[]> = {};
    for (const row of items) (grouped[row.taskId] ??= []).push(map(row));
    return grouped;
  }

  /** Individual points per task: `{ [taskId]: { [playerId]: points } }`. */
  const weeklyTaskScores: Record<
    string,
    Record<string, number>
  > = Object.fromEntries(
    Object.entries(
      groupByTask(
        rows.taskScores,
        (row) => [row.playerId, row.points] as const,
      ),
    ).map(([taskId, entries]) => [taskId, Object.fromEntries(entries)]),
  );

  /** Squad points per team task: `{ [taskId]: { [teamId]: points } }`. */
  const weeklyTeamScores: Record<
    string,
    Record<string, number>
  > = Object.fromEntries(
    Object.entries(
      groupByTask(rows.teamScores, (row) => [row.teamId, row.points] as const),
    ).map(([taskId, entries]) => [taskId, Object.fromEntries(entries)]),
  );

  /** Bonus points and deductions per task, in the order they were recorded. */
  const weeklyBonusPoints: Record<string, Omit<BonusPoint, "taskId">[]> =
    groupByTask(
      rows.bonusPoints,
      ({ playerId, points, reason, id, createdAt }) => ({
        playerId,
        points,
        reason,
        ...(id !== undefined && { id }),
        ...(createdAt !== undefined && {
          awardedAt: timestamptzToIso(createdAt),
        }),
      }),
    );

  // Optional notes explaining how a player's or squad's task points were made up.
  const scoreComments = new Map(
    rows.taskScores
      .filter((row) => row.comment !== null)
      .map((row) => [`${row.taskId}:${row.playerId}`, row.comment as string]),
  );

  const teamScoreComments = new Map(
    rows.teamScores
      .filter((row) => row.comment !== null)
      .map((row) => [`${row.taskId}:${row.teamId}`, row.comment as string]),
  );

  // Roster order, used only as a deterministic tie-breaker when two players
  // earn the same points on a task so finishing positions stay stable.
  const rosterIndex = new Map(players.map((p, index) => [p.id, index]));

  // Team order, the equivalent deterministic tie-breaker for team standings.
  const teamOrderIndex = new Map(teams.map((t, index) => [t.id, index]));

  /**
   * Ranks `{ id, points }` entries highest-first and assigns standard
   * competition finishing positions (ties share a position, the next position
   * skips accordingly: …3, 3, 5). Ties are broken by `tieIndex` so the output
   * is deterministic. Shared by both the individual and team scoring passes.
   */
  function rankByPoints(
    entries: { id: string; points: number }[],
    tieIndex: Map<string, number>,
  ): { id: string; points: number; position: number }[] {
    const ranked = [...entries].sort(
      (a, b) =>
        b.points - a.points ||
        (tieIndex.get(a.id) ?? 0) - (tieIndex.get(b.id) ?? 0),
    );

    let previousPoints: number | null = null;
    let sharedPosition = 0;
    return ranked.map((entry, index) => {
      const position =
        entry.points === previousPoints ? sharedPosition : index + 1;
      previousPoints = entry.points;
      sharedPosition = position;
      return { ...entry, position };
    });
  }

  /**
   * Team results per team task, ranked. Weeks with no recorded team points are
   * skipped. This is the raw record the team leaderboard is derived from.
   */
  function buildTeamScores(): TeamScore[] {
    const result: TeamScore[] = [];

    for (const task of tasks) {
      if (task.format !== "team") continue;
      const weekScores = weeklyTeamScores[task.id];
      if (!weekScores) continue;

      const ranked = rankByPoints(
        Object.entries(weekScores).map(([teamId, points]) => ({
          id: teamId,
          points,
        })),
        teamOrderIndex,
      );

      for (const entry of ranked) {
        const comment = teamScoreComments.get(`${task.id}:${entry.id}`);
        result.push({
          taskId: task.id,
          teamId: entry.id,
          points: entry.points,
          position: entry.position,
          ...(comment !== undefined && { comment }),
        });
      }
    }

    return result;
  }

  // Team membership lookup for expanding team points down to each member.
  const membersByTeamId = new Map(teams.map((t) => [t.id, t.memberIds]));

  /**
   * Expands the static weekly points into flat `Score` records. For individual
   * tasks, players are ranked by points. For team tasks, each squad is ranked by
   * its points and every member inherits the squad's points and finishing
   * position — so the individual leaderboard reflects team results too. Ties
   * share a position (…3, 3, 5). Weeks with no recorded points are skipped.
   */
  function buildScores(): Score[] {
    const result: Score[] = [];

    for (const task of tasks) {
      if (task.format === "team") {
        for (const teamScore of teamScores.filter(
          (t) => t.taskId === task.id,
        )) {
          const memberIds = membersByTeamId.get(teamScore.teamId) ?? [];
          for (const playerId of memberIds) {
            const golden = goldenWeekKeys.has(`${task.id}:${playerId}`);
            result.push({
              taskId: task.id,
              playerId,
              position: teamScore.position,
              points: golden
                ? goldenWeekPoints(teamScore.points)
                : teamScore.points,
              ...(golden && { goldenWeek: true }),
            });
          }
        }
        continue;
      }

      const weekScores = weeklyTaskScores[task.id];
      if (!weekScores) continue;

      const ranked = rankByPoints(
        Object.entries(weekScores).map(([playerId, points]) => ({
          id: playerId,
          points: goldenWeekKeys.has(`${task.id}:${playerId}`)
            ? goldenWeekPoints(points)
            : points,
        })),
        rosterIndex,
      );

      for (const entry of ranked) {
        const comment = scoreComments.get(`${task.id}:${entry.id}`);
        const golden = goldenWeekKeys.has(`${task.id}:${entry.id}`);
        result.push({
          taskId: task.id,
          playerId: entry.id,
          position: entry.position,
          points: entry.points,
          ...(comment !== undefined && { comment }),
          ...(golden && { goldenWeek: true }),
        });
      }
    }

    return result;
  }

  /**
   * Flattens the weekly bonus entries into `BonusPoint` records, in week order.
   * Entries for unknown tasks or players are skipped so a typo can't create a
   * phantom player or week.
   */
  function buildBonusPoints(): BonusPoint[] {
    const result: BonusPoint[] = [];
    const sortedTasks = [...tasks].sort((a, b) => a.weekNumber - b.weekNumber);

    for (const task of sortedTasks) {
      for (const entry of weeklyBonusPoints[task.id] ?? []) {
        if (!rosterIndex.has(entry.playerId) || entry.points === 0) continue;
        result.push({ taskId: task.id, ...entry });
      }
    }

    return result;
  }

  /**
   * A task's results are "in" from the first score recorded for its format;
   * later additions and edits keep that time. Results held for a live reveal
   * are in from when they were published, if that was later.
   */
  function buildResultsPostedAt(): Record<string, string> {
    const earliest = new Map<string, number>();
    const formatOf = new Map(tasks.map((t) => [t.id, t.format]));
    const consider = (taskId: string, format: Task["format"], at: string) => {
      if (formatOf.get(taskId) !== format) return;
      const time = new Date(timestamptzToIso(at)).getTime();
      const current = earliest.get(taskId);
      if (current === undefined || time < current) earliest.set(taskId, time);
    };
    for (const row of rows.taskScores)
      consider(row.taskId, "individual", row.createdAt);
    for (const row of rows.teamScores)
      consider(row.taskId, "team", row.createdAt);
    for (const [taskId, at] of Object.entries(publishedAt)) {
      const first = earliest.get(taskId);
      const published = new Date(timestamptzToIso(at)).getTime();
      if (first !== undefined && published > first) {
        earliest.set(taskId, published);
      }
    }
    return Object.fromEntries(
      [...earliest].map(([taskId, time]) => [
        taskId,
        new Date(time).toISOString(),
      ]),
    );
  }

  const teamScores = buildTeamScores();
  return {
    teamScores,
    scores: buildScores(),
    bonusPoints: buildBonusPoints(),
    resultsPostedAt: buildResultsPostedAt(),
  };
}
