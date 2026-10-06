import type { Score } from "../types";
import { tasks } from "./tasks";
import { players } from "./players";

/**
 * Static weekly task scores — the single place results are recorded.
 *
 * Each key is a task id (`week-NN`) mapping to that week's points: one
 * `playerId: points` entry per player who scored. To publish a new week's
 * results, fill in that week's object with the points you awarded — nothing
 * else needs to change. Finishing positions and the overall leaderboard
 * totals are derived automatically in the data layer (see `buildScores` and
 * `queries.ts`), so this file is the only thing you edit each week.
 *
 * Empty objects are placeholders for tasks that have not been scored yet.
 * (A task's `status` is derived automatically from its dates in `tasks.ts`,
 * so there is nothing to flip manually once a week's deadline passes.)
 *
 * This becomes a Supabase table/query later; keep the exported shapes stable.
 */
export const weeklyTaskScores: Record<string, Record<string, number>> = {
  "week-01": {
    eva: 5,
    rebekah: 0,
    karen: 8,
    finnbar: 0,
    eve: 3,
    luke: 1,
    rose: 10,
    emma: 3,
    jack: 4,
    caolan_d: 5,
    erin: 0,
    john: 3,
    connor: 1,
    sophia: 0,
    orlagh: 0,
    amelia: 0,
    daire: 3,
    jake: 0,
    ryan: 0,
    caolan_t: 0,
    criostoir: 1,
    eimhear: 0,
    grace: 5,
    adam: 0,
    andrew: 0,
  },
  "week-02": {
    eva: 13,
    rebekah: 6,
    karen: 5,
    finnbar: 9,
    eve: 9,
    luke: 6,
    rose: 5,
    emma: 6,
    jack: 3,
    caolan_d: 3,
    erin: 3,
    john: 3,
    connor: 3,
    sophia: 3,
    orlagh: 4,
    amelia: 4,
    daire: 3,
    jake: 4,
    ryan: 3,
    caolan_t: 3,
    criostoir: 1,
    eimhear: 3,
    grace: 1,
    adam: 1,
    andrew: 1,
  },
  // --- Placeholders: fill in each week's points as tasks are scored. ---
  "week-03": {},
  "week-04": {},
  "week-05": {},
  "week-06": {},
  "week-07": {},
  "week-08": {},
  "week-09": {},
  "week-10": {},
  "week-11": {},
  "week-12": {},
  "week-13": {},
  "week-14": {},
  "week-15": {},
  "week-16": {},
};

// Roster order, used only as a deterministic tie-breaker when two players
// earn the same points on a task so finishing positions stay stable.
const rosterIndex = new Map(players.map((p, index) => [p.id, index]));

/**
 * Expands the static weekly points into flat `Score` records. Finishing
 * positions are derived by ranking each task's players by points (highest
 * first), breaking ties by roster order so the output is deterministic.
 * Weeks with no recorded points are skipped.
 */
function buildScores(): Score[] {
  const result: Score[] = [];

  for (const task of tasks) {
    const weekScores = weeklyTaskScores[task.id];
    if (!weekScores) continue;

    const ranked = Object.entries(weekScores)
      .map(([playerId, points]) => ({ playerId, points }))
      .sort(
        (a, b) =>
          b.points - a.points ||
          (rosterIndex.get(a.playerId) ?? 0) -
            (rosterIndex.get(b.playerId) ?? 0),
      );

    // Standard competition ranking within the task: players level on points
    // share a finishing position (e.g. two on the same points are joint 3rd),
    // and the next position skips accordingly (…3, 3, 5).
    let previousPoints: number | null = null;
    let sharedPosition = 0;
    ranked.forEach((entry, index) => {
      const position =
        entry.points === previousPoints ? sharedPosition : index + 1;
      previousPoints = entry.points;
      sharedPosition = position;
      result.push({
        taskId: task.id,
        playerId: entry.playerId,
        position,
        points: entry.points,
      });
    });
  }

  return result;
}

// All scores for scored tasks. Later this becomes a Supabase query.
export const scores: Score[] = buildScores();

export function getScoresForTask(taskId: string): Score[] {
  return scores.filter((s) => s.taskId === taskId);
}

export function getScoresForPlayer(playerId: string): Score[] {
  return scores.filter((s) => s.playerId === playerId);
}
