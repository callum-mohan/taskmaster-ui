import type { Score, TeamScore } from "../types";
import { tasks } from "./tasks";
import { players } from "./players";
import { teams } from "./teams";

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
    finnbar: 8,
    eve: 8,
    luke: 6,
    rose: 5,
    emma: 6,
    jack: 3,
    caolan_d: 3,
    erin: 3,
    john: 3,
    connor: 3,
    sophia: 3,
    orlagh: 3,
    amelia: 4,
    daire: 3,
    jake: 3,
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

/**
 * Static weekly *team* task scores — the companion to `weeklyTaskScores` for
 * team-format tasks (see `tasks.ts`). Each key is a team task's id mapping to
 * that week's points: one `teamId: points` entry per squad.
 *
 * A team's points are awarded to the team (driving the separate team
 * leaderboard) *and* to every one of its members (so the individual standings
 * stay complete). Finishing positions among teams are derived automatically
 * (see `buildTeamScores`), exactly like the individual table — so to publish a
 * team week you only fill in that week's object here.
 *
 * Empty objects are placeholders for team tasks that have not been scored yet.
 * This becomes a Supabase table/query later; keep the exported shapes stable.
 */
export const weeklyTeamScores: Record<string, Record<string, number>> = {
  // week-04 is the first team task. Fill in each squad's points once scored.
  "week-04": {},
};

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
  entries: { id: string; points: number; }[],
  tieIndex: Map<string, number>,
): { id: string; points: number; position: number; }[] {
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
      result.push({
        taskId: task.id,
        teamId: entry.id,
        points: entry.points,
        position: entry.position,
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
      for (const teamScore of teamScores.filter((t) => t.taskId === task.id)) {
        const memberIds = membersByTeamId.get(teamScore.teamId) ?? [];
        for (const playerId of memberIds) {
          result.push({
            taskId: task.id,
            playerId,
            position: teamScore.position,
            points: teamScore.points,
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
        points,
      })),
      rosterIndex,
    );

    for (const entry of ranked) {
      result.push({
        taskId: task.id,
        playerId: entry.id,
        position: entry.position,
        points: entry.points,
      });
    }
  }

  return result;
}

// All team results for scored team tasks. Later this becomes a Supabase query.
export const teamScores: TeamScore[] = buildTeamScores();

// All individual scores (team-task points expanded to members included).
// Later this becomes a Supabase query.
export const scores: Score[] = buildScores();

export function getScoresForTask(taskId: string): Score[] {
  return scores.filter((s) => s.taskId === taskId);
}

export function getScoresForPlayer(playerId: string): Score[] {
  return scores.filter((s) => s.playerId === playerId);
}

export function getTeamScoresForTask(taskId: string): TeamScore[] {
  return teamScores.filter((s) => s.taskId === taskId);
}
