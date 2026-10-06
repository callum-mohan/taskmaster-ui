import type {
  Achievement,
  Award,
  ChartSeries,
  CommandPaletteItem,
  CompareOpponent,
  CompetitionStats,
  FollowStanding,
  LeaderboardRow,
  Player,
  PlayerCompareOptions,
  PlayerComparison,
  PlayerTaskResult,
  PointsChartData,
  RecapMover,
  RecapSummary,
  RecapTitleRace,
  Score,
  TaskResult,
  TaskResultRow,
  TaskSummary,
  Task,
  TaskPager,
  TaskPagerLink,
  Team,
  TeamScore,
  TeamStanding,
  TeamStats,
  TeamTaskResultRow,
  WeekRecap,
  WhatsNewInfo,
} from "../types";
import { players, getPlayerById } from "./players";
import { tasks, getTaskById, getCurrentTask, getTeamTasks } from "./tasks";
import { scores, teamScores } from "./scores";
import { teams, getTeamById, getTeamForPlayer } from "./teams";
import { getRecapContent } from "./recaps";
import { withBase } from "../lib/url";

// This module is the single "data layer" the UI talks to. Pages import these
// derived selectors rather than raw records, so moving to Supabase later only
// means re-implementing these functions.

const completedWeekByTask = new Map(tasks.map((t) => [t.id, t.weekNumber]));

/**
 * Builds and ranks the standings from an arbitrary set of scores. Used both
 * for the current table and for historical snapshots (rank movement).
 */
function computeStandings(scoreSet: Score[]): LeaderboardRow[] {
  const rows = players.map((player) => {
    const playerScores = scoreSet
      .filter((s) => s.playerId === player.id)
      .sort(
        (a, b) =>
          (completedWeekByTask.get(a.taskId) ?? 0) -
          (completedWeekByTask.get(b.taskId) ?? 0),
      );

    const points = playerScores.reduce((sum, s) => sum + s.points, 0);
    const wins = playerScores.filter((s) => s.position === 1).length;
    const tasksCompleted = playerScores.length;
    const averagePosition =
      tasksCompleted > 0
        ? playerScores.reduce((sum, s) => sum + s.position, 0) / tasksCompleted
        : 0;
    const form = playerScores.slice(-4).map((s) => s.position);

    return {
      player,
      points,
      wins,
      tasksCompleted,
      averagePosition,
      form,
    };
  });

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.averagePosition - b.averagePosition;
  });

  // Standard competition ranking: players level on points share a rank
  // (e.g. two on the same points are both 3rd), and the next player's rank
  // skips accordingly (…3, 3, 5). Order within a tie still follows the
  // wins / average-position sort above.
  let previousPoints: number | null = null;
  let sharedRank = 0;
  return rows.map((row, index) => {
    const rank = row.points === previousPoints ? sharedRank : index + 1;
    previousPoints = row.points;
    sharedRank = rank;
    return { rank, ...row };
  });
}

/**
 * Full leaderboard, sorted by points (then wins, then average position).
 * Every player appears even if they have not scored yet.
 */
export function getLeaderboard(): LeaderboardRow[] {
  return computeStandings(scores);
}

/**
 * The leaderboard annotated with each player's movement since the standings
 * before the most recent completed task (positive movement = climbed).
 * Movement is omitted when there is no earlier task to compare against.
 */
export function getLeaderboardWithMovement(): LeaderboardRow[] {
  const current = getLeaderboard();
  const completedWeeks = tasks
    .filter((t) => t.status === "completed")
    .map((t) => t.weekNumber);

  if (completedWeeks.length < 2) return current;

  const latestWeek = Math.max(...completedWeeks);
  const previousScores = scores.filter(
    (s) => (completedWeekByTask.get(s.taskId) ?? Infinity) < latestWeek,
  );
  const previousRankByPlayer = new Map(
    computeStandings(previousScores).map((row) => [row.player.id, row.rank]),
  );

  return current.map((row) => {
    const previousRank = previousRankByPlayer.get(row.player.id);
    return {
      ...row,
      previousRank,
      movement:
        previousRank !== undefined ? previousRank - row.rank : undefined,
    };
  });
}

/** Top N leaderboard rows (defaults to 5 for the homepage). */
export function getTopPlayers(limit = 5): LeaderboardRow[] {
  return getLeaderboard().slice(0, limit);
}

/** A single player's standing row (rank, points, form, …) if they exist. */
export function getPlayerStanding(
  playerId: string,
): LeaderboardRow | undefined {
  return getLeaderboard().find((row) => row.player.id === playerId);
}

/**
 * Every scored task for a player, newest week last, with the task record
 * attached. Empty if the player has not been scored yet.
 */
export function getPlayerResults(playerId: string): PlayerTaskResult[] {
  const results: PlayerTaskResult[] = [];
  for (const s of scores.filter((s) => s.playerId === playerId)) {
    const task = getTaskById(s.taskId);
    if (!task) continue;
    results.push({
      task,
      position: s.position,
      points: s.points,
      comment: s.comment,
    });
  }
  return results.sort((a, b) => a.task.weekNumber - b.task.weekNumber);
}

/** Most recent completed tasks with their winner, newest first. */
export function getRecentResults(limit = 3): TaskResult[] {
  const completed = tasks
    .filter((t) => t.status === "completed")
    .sort((a, b) => b.weekNumber - a.weekNumber);

  const results: TaskResult[] = [];
  for (const task of completed) {
    const winnerScore = scores.find(
      (s) => s.taskId === task.id && s.position === 1,
    );
    const winner = winnerScore
      ? getPlayerById(winnerScore.playerId)
      : undefined;
    if (winnerScore && winner) {
      results.push({
        task,
        winner,
        winningScore: winnerScore.points,
        completionDate: task.deadline,
      });
    }
  }
  return results.slice(0, limit);
}

/** Ordered results for a single task (winner first). Empty if not scored. */
export function getTaskResults(taskId: string): TaskResultRow[] {
  const rows: TaskResultRow[] = [];
  for (const s of scores.filter((s) => s.taskId === taskId)) {
    const player = getPlayerById(s.playerId);
    if (!player) continue;
    rows.push({
      position: s.position,
      player,
      points: s.points,
      comment: s.comment,
    });
  }
  return rows.sort((a, b) => a.position - b.position);
}

/** A single task with its winner/score, for the detail page and cards. */
export function getTaskSummary(taskId: string): TaskSummary | undefined {
  const task = getTaskById(taskId);
  if (!task) return undefined;
  const [top] = getTaskResults(taskId);
  return {
    task,
    winner: top?.player,
    winningScore: top?.points,
    winningTeam:
      task.format === "team" ? getTeamResults(taskId)[0]?.team : undefined,
  };
}

/** Every task as a summary, ordered by week number (ascending). */
export function getTaskSummaries(): TaskSummary[] {
  return [...tasks]
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .map((task) => {
      const [top] = getTaskResults(task.id);
      return {
        task,
        winner: top?.player,
        winningScore: top?.points,
        winningTeam:
          task.format === "team" ? getTeamResults(task.id)[0]?.team : undefined,
      };
    });
}

// ─── Teams ───────────────────────────────────────────────────────────────
// The team leaderboard and team task results, derived from `teamScores` the
// same way the individual standings are derived from `scores`. Team-format
// task points are awarded to each squad here (and to its members in the
// individual table), so both leaderboards stay consistent.

/** Resolve a team's member ids to full Player records (unknown ids dropped). */
function resolveMembers(team: Team): Player[] {
  return team.memberIds
    .map((id) => getPlayerById(id))
    .filter((p): p is Player => p !== undefined);
}

/**
 * Builds and ranks the team standings from an arbitrary set of team scores.
 * Used for the current team table and for historical snapshots (movement).
 */
function computeTeamStandings(teamScoreSet: TeamScore[]): TeamStanding[] {
  const rows = teams.map((team) => {
    const teamResults = teamScoreSet
      .filter((s) => s.teamId === team.id)
      .sort(
        (a, b) =>
          (completedWeekByTask.get(a.taskId) ?? 0) -
          (completedWeekByTask.get(b.taskId) ?? 0),
      );

    const points = teamResults.reduce((sum, s) => sum + s.points, 0);
    const wins = teamResults.filter((s) => s.position === 1).length;
    const tasksCompleted = teamResults.length;
    const averagePosition =
      tasksCompleted > 0
        ? teamResults.reduce((sum, s) => sum + s.position, 0) / tasksCompleted
        : 0;
    const form = teamResults.slice(-4).map((s) => s.position);

    return {
      team,
      members: resolveMembers(team),
      points,
      wins,
      tasksCompleted,
      averagePosition,
      form,
    };
  });

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.averagePosition - b.averagePosition;
  });

  // Standard competition ranking: teams level on points share a rank and the
  // next rank skips accordingly (…3, 3, 5). Order within a tie follows the
  // wins / average-position sort above.
  let previousPoints: number | null = null;
  let sharedRank = 0;
  return rows.map((row, index) => {
    const rank = row.points === previousPoints ? sharedRank : index + 1;
    previousPoints = row.points;
    sharedRank = rank;
    return { rank, ...row };
  });
}

/**
 * Full team leaderboard, sorted by points (then wins, then average position).
 * Every team appears even before any team task has been scored.
 */
export function getTeamLeaderboard(): TeamStanding[] {
  return computeTeamStandings(teamScores);
}

/**
 * The team leaderboard annotated with each squad's movement since the
 * standings before the most recent scored team task (positive = climbed).
 */
export function getTeamLeaderboardWithMovement(): TeamStanding[] {
  const current = getTeamLeaderboard();
  const scoredWeeks = [
    ...new Set(teamScores.map((s) => completedWeekByTask.get(s.taskId) ?? 0)),
  ];

  if (scoredWeeks.length < 2) return current;

  const latestWeek = Math.max(...scoredWeeks);
  const previousScores = teamScores.filter(
    (s) => (completedWeekByTask.get(s.taskId) ?? Infinity) < latestWeek,
  );
  const previousRankByTeam = new Map(
    computeTeamStandings(previousScores).map((row) => [row.team.id, row.rank]),
  );

  return current.map((row) => {
    const previousRank = previousRankByTeam.get(row.team.id);
    return {
      ...row,
      previousRank,
      movement:
        previousRank !== undefined ? previousRank - row.rank : undefined,
    };
  });
}

/** A single team's standing row, if the team exists. */
export function getTeamStanding(teamId: string): TeamStanding | undefined {
  return getTeamLeaderboard().find((row) => row.team.id === teamId);
}

/** Ordered results for a single team task (winning squad first). */
export function getTeamResults(taskId: string): TeamTaskResultRow[] {
  const rows: TeamTaskResultRow[] = [];
  for (const s of teamScores.filter((s) => s.taskId === taskId)) {
    const team = getTeamById(s.teamId);
    if (!team) continue;
    rows.push({
      position: s.position,
      team,
      members: resolveMembers(team),
      points: s.points,
      comment: s.comment,
    });
  }
  return rows.sort((a, b) => a.position - b.position);
}

/** Summary counts for the teams overview page. */
export function getTeamStats(): TeamStats {
  const sizes = teams.map((t) => t.memberIds.length);
  const scoredTaskIds = new Set(teamScores.map((s) => s.taskId));
  return {
    totalTeams: teams.length,
    minTeamSize: Math.min(...sizes),
    maxTeamSize: Math.max(...sizes),
    teamTasks: getTeamTasks().length,
    teamTasksScored: scoredTaskIds.size,
  };
}

/**
 * Compare two players head to head. Returns their full standings, a per-task
 * breakdown (every task either player was scored on), and the record over
 * tasks they both completed. Returns undefined if either player is unknown
 * or the two ids are the same.
 */
export function getPlayerComparison(
  aId: string,
  bId: string,
): PlayerComparison | undefined {
  const a = getPlayerStanding(aId);
  const b = getPlayerStanding(bId);
  if (!a || !b || aId === bId) return undefined;

  const aResults = new Map(
    getPlayerResults(aId).map((r) => [r.task.id, r] as const),
  );
  const bResults = new Map(
    getPlayerResults(bId).map((r) => [r.task.id, r] as const),
  );

  const taskIds = new Set<string>([...aResults.keys(), ...bResults.keys()]);

  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  let shared = 0;

  const rows = [...taskIds].flatMap((taskId) => {
    const task = getTaskById(taskId);
    if (!task) return [];

    const ar = aResults.get(taskId);
    const br = bResults.get(taskId);

    let leader: "a" | "b" | "tie" = "tie";
    if (ar && br) {
      shared += 1;
      if (ar.position < br.position) {
        leader = "a";
        aWins += 1;
      } else if (br.position < ar.position) {
        leader = "b";
        bWins += 1;
      } else {
        ties += 1;
      }
    } else if (ar) {
      leader = "a";
    } else if (br) {
      leader = "b";
    }

    return [
      {
        task,
        a: ar ? { position: ar.position, points: ar.points } : undefined,
        b: br ? { position: br.position, points: br.points } : undefined,
        leader,
      },
    ];
  });

  rows.sort((x, y) => x.task.weekNumber - y.task.weekNumber);

  return { a, b, tasks: rows, headToHead: { aWins, bWins, ties, shared } };
}

/** High-level competition statistics for the homepage stat cards. */
export function getCompetitionStats(): CompetitionStats {
  const completed = tasks.filter((t) => t.status === "completed");
  const winners = new Set(
    scores.filter((s) => s.position === 1).map((s) => s.playerId),
  );
  const pointsAwarded = scores.reduce((sum, s) => sum + s.points, 0);

  return {
    totalPlayers: players.length,
    tasksCompleted: completed.length,
    pointsAwarded,
    differentWinners: winners.size,
  };
}

export function getPlayerInitials(player: Player): string {
  return player.name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// Number of generated avatar SVGs living in `public/avatars/player-NN.svg`.
const PLAYER_ICON_COUNT = 25;

// FNV-1a hash — small, stable, and well-distributed for short id strings.
function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Pseudo-random but deterministic avatar assignment. Seeding from the player
// id keeps each player on the same icon across every page, and probing to the
// next free slot keeps assignments unique while players <= available icons.
const playerIconIndex: Map<string, number> = (() => {
  const assignment = new Map<string, number>();
  const used = new Set<number>();
  // Sort by id so the mapping is independent of the roster array order.
  const ordered = [...players].sort((a, b) => a.id.localeCompare(b.id));
  for (const player of ordered) {
    let index = hashString(player.id) % PLAYER_ICON_COUNT;
    while (used.has(index) && used.size < PLAYER_ICON_COUNT) {
      index = (index + 1) % PLAYER_ICON_COUNT;
    }
    used.add(index);
    assignment.set(player.id, index);
  }
  return assignment;
})();

/** Root-relative path to the avatar SVG assigned to this player. */
export function getPlayerIcon(player: Player): string {
  const index =
    playerIconIndex.get(player.id) ?? hashString(player.id) % PLAYER_ICON_COUNT;
  return `/avatars/player-${String(index + 1).padStart(2, "0")}.svg`;
}

// Tasks that have at least one recorded score, ascending by week number.
// This is the shared x-axis for every points-over-time chart.
function getScoredTasks(): Task[] {
  const scoredIds = new Set(scores.map((s) => s.taskId));
  return [...tasks]
    .filter((t) => scoredIds.has(t.id))
    .sort((a, b) => a.weekNumber - b.weekNumber);
}

const CHART_SERIES_ACCENTS = [
  "acid",
  "magenta",
  "cyan",
  "amber",
  "ink-dim",
] as const;

const weekAxisLabel = (weekNumber: number) =>
  `W${String(weekNumber).padStart(2, "0")}`;

// A player's running points total across every scored week (weeks they
// weren't scored on carry the previous total forward).
function cumulativeFor(playerId: string, scoredTasks: Task[]): number[] {
  const pointsByTask = new Map(
    scores
      .filter((s) => s.playerId === playerId)
      .map((s) => [s.taskId, s.points] as const),
  );
  let running = 0;
  return scoredTasks.map((t) => {
    running += pointsByTask.get(t.id) ?? 0;
    return running;
  });
}

/**
 * A single player's cumulative points trajectory, for the chart on their
 * profile. Undefined when there are fewer than two scored weeks (nothing to
 * plot a line between yet).
 */
export function getPlayerProgressionChart(
  playerId: string,
): PointsChartData | undefined {
  const scoredTasks = getScoredTasks();
  if (scoredTasks.length < 2) return undefined;
  const player = getPlayerById(playerId);
  if (!player) return undefined;

  const values = cumulativeFor(playerId, scoredTasks);
  const total = values[values.length - 1] ?? 0;

  return {
    weeks: scoredTasks.map((t) => ({
      weekNumber: t.weekNumber,
      label: weekAxisLabel(t.weekNumber),
    })),
    series: [
      { id: player.id, label: player.name, accent: "acid", values, total },
    ],
    maxValue: Math.max(1, total),
  };
}

/**
 * The "points race": cumulative points for the top N players across every
 * scored week, for the leaderboard chart. Undefined until two weeks exist.
 */
export function getPointsRaceChart(limit = 5): PointsChartData | undefined {
  const scoredTasks = getScoredTasks();
  if (scoredTasks.length < 2) return undefined;

  const top = getLeaderboard()
    .slice(0, limit)
    .filter((row) => row.tasksCompleted > 0);
  if (top.length === 0) return undefined;

  const series: ChartSeries[] = top.map((row, index) => {
    const values = cumulativeFor(row.player.id, scoredTasks);
    return {
      id: row.player.id,
      label: row.player.name,
      accent: CHART_SERIES_ACCENTS[index % CHART_SERIES_ACCENTS.length],
      values,
      total: values[values.length - 1] ?? 0,
    };
  });

  return {
    weeks: scoredTasks.map((t) => ({
      weekNumber: t.weekNumber,
      label: weekAxisLabel(t.weekNumber),
    })),
    series,
    maxValue: Math.max(1, ...series.map((s) => s.total)),
  };
}

/**
 * Playful per-player badges (streaks, wins, consistency) for the profile
 * page. Derived entirely from the player's results and current standing;
 * empty for a player who has not been scored yet.
 */
export function getPlayerAchievements(playerId: string): Achievement[] {
  const standing = getLeaderboardWithMovement().find(
    (row) => row.player.id === playerId,
  );
  if (!standing || standing.tasksCompleted === 0) return [];

  const positions = getPlayerResults(playerId).map((r) => r.position);
  const longestRun = (pred: (position: number) => boolean) => {
    let best = 0;
    let current = 0;
    for (const position of positions) {
      current = pred(position) ? current + 1 : 0;
      if (current > best) best = current;
    }
    return best;
  };

  const wins = positions.filter((p) => p === 1).length;
  const podiums = positions.filter((p) => p <= 3).length;
  const achievements: Achievement[] = [];

  if (standing.rank === 1) {
    achievements.push({
      id: "leader",
      label: "Top of the Table",
      detail: "Currently #1",
      icon: "👑",
      accent: "amber",
    });
  }

  if (wins >= 2) {
    achievements.push({
      id: "serial-winner",
      label: "Serial Winner",
      detail: `Won ${wins} tasks`,
      icon: "🏆",
      accent: "acid",
    });
  } else if (wins === 1) {
    achievements.push({
      id: "winner",
      label: "Task Winner",
      detail: "Won a task",
      icon: "🥇",
      accent: "acid",
    });
  }

  const winStreak = longestRun((p) => p === 1);
  if (winStreak >= 2) {
    achievements.push({
      id: "win-streak",
      label: "On Fire",
      detail: `${winStreak} wins in a row`,
      icon: "🔥",
      accent: "magenta",
    });
  }

  const podiumStreak = longestRun((p) => p <= 3);
  if (podiumStreak >= 3) {
    achievements.push({
      id: "podium-streak",
      label: "Podium Regular",
      detail: `${podiumStreak} podiums in a row`,
      icon: "🎖️",
      accent: "cyan",
    });
  } else if (podiums >= 1) {
    achievements.push({
      id: "podium",
      label: "Podium Finish",
      detail: `${podiums} top-3 ${podiums === 1 ? "finish" : "finishes"}`,
      icon: "🥉",
      accent: "cyan",
    });
  }

  if (standing.tasksCompleted >= 2 && standing.averagePosition <= 3) {
    achievements.push({
      id: "consistent",
      label: "Ever Reliable",
      detail: `${standing.averagePosition.toFixed(1)} average finish`,
      icon: "🎯",
      accent: "magenta",
    });
  }

  const completedCount = tasks.filter((t) => t.status === "completed").length;
  if (completedCount > 0 && standing.tasksCompleted >= completedCount) {
    achievements.push({
      id: "ever-present",
      label: "Ever Present",
      detail: "Scored in every task",
      icon: "📅",
      accent: "acid",
    });
  }

  if (typeof standing.movement === "number" && standing.movement > 0) {
    achievements.push({
      id: "climber",
      label: "Climbing",
      detail: `+${standing.movement} places last task`,
      icon: "📈",
      accent: "amber",
    });
  }

  const topScore = [...scores].sort((a, b) => b.points - a.points)[0];
  if (topScore && topScore.playerId === playerId) {
    achievements.push({
      id: "high-score",
      label: "High Scorer",
      detail: `${topScore.points} pts in a single task`,
      icon: "⚡",
      accent: "magenta",
    });
  }

  return achievements;
}

/**
 * Per-player "this is me" standings for the homepage follow widget. The
 * visitor's identity is resolved on the client, so every player's row ships
 * up front. Each entry carries the player's current standing plus the rival
 * directly ahead of them (the one to overtake next).
 */
export function getFollowStandings(): FollowStanding[] {
  const leaderboard = getLeaderboard();
  return leaderboard.map((row, index) => {
    const ahead = leaderboard[index - 1];
    return {
      id: row.player.id,
      name: row.player.name,
      icon: withBase(getPlayerIcon(row.player)),
      rank: row.rank,
      points: row.points,
      wins: row.wins,
      tasksCompleted: row.tasksCompleted,
      href: withBase(`/players/${row.player.id}`),
      isLeader: index === 0,
      rival: ahead
        ? {
            id: ahead.player.id,
            name: ahead.player.name,
            rank: ahead.rank,
            href: withBase(`/players/${ahead.player.id}`),
            gap: ahead.points - row.points,
          }
        : undefined,
    };
  });
}

/**
 * Playful Hall of Fame superlatives for the stats page. Each award is derived
 * from the current data; awards with no qualifying data are omitted.
 */
export function getAwards(): Award[] {
  const awards: Award[] = [];
  const leaderboard = getLeaderboardWithMovement();
  const played = leaderboard.filter((row) => row.tasksCompleted > 0);

  // Reigning champion — whoever tops the table.
  const champion = leaderboard[0];
  if (champion && champion.tasksCompleted > 0) {
    awards.push({
      id: "champion",
      title: "Reigning Champion",
      command: "rank --top 1",
      player: champion.player,
      value: `${champion.points} pts`,
      detail: "Leads the academy",
      accent: "amber",
    });
  }

  // Most task wins.
  const mostWins = [...played].sort((a, b) => b.wins - a.wins)[0];
  if (mostWins && mostWins.wins > 0) {
    awards.push({
      id: "most-wins",
      title: "Serial Winner",
      command: "max wins",
      player: mostWins.player,
      value: `${mostWins.wins} ${mostWins.wins === 1 ? "win" : "wins"}`,
      detail: "Most task victories",
      accent: "acid",
    });
  }

  // Highest single-task score.
  const topScore = [...scores].sort((a, b) => b.points - a.points)[0];
  if (topScore) {
    const player = getPlayerById(topScore.playerId);
    const task = getTaskById(topScore.taskId);
    if (player && task) {
      awards.push({
        id: "top-score",
        title: "Highest Score",
        command: "max points",
        player,
        value: `${topScore.points} pts`,
        detail: `Week ${String(task.weekNumber).padStart(2, "0")} · ${task.title}`,
        accent: "magenta",
      });
    }
  }

  // Most consistent — best average finishing position (min 2 tasks).
  const consistent = played
    .filter((row) => row.tasksCompleted >= 2)
    .sort((a, b) => a.averagePosition - b.averagePosition)[0];
  if (consistent) {
    awards.push({
      id: "most-consistent",
      title: "Mr/Ms Reliable",
      command: "min avg-position",
      player: consistent.player,
      value: `${consistent.averagePosition.toFixed(1)} avg`,
      detail: "Best average finish",
      accent: "cyan",
    });
  }

  // Biggest climber since the previous standings.
  const climber = [...leaderboard]
    .filter((row) => typeof row.movement === "number" && row.movement > 0)
    .sort((a, b) => (b.movement ?? 0) - (a.movement ?? 0))[0];
  if (climber && climber.movement) {
    awards.push({
      id: "climber",
      title: "Biggest Climber",
      command: "max rank-gain",
      player: climber.player,
      value: `+${climber.movement}`,
      detail: "Places gained last task",
      accent: "acid",
    });
  }

  // Biggest winning margin across completed tasks.
  const completedTasks = tasks.filter((t) => t.status === "completed");
  let widest: { task: (typeof completedTasks)[number]; margin: number } | null =
    null;
  let closest: {
    task: (typeof completedTasks)[number];
    margin: number;
  } | null = null;
  for (const task of completedTasks) {
    const results = getTaskResults(task.id);
    if (results.length < 2) continue;
    const margin = results[0].points - results[1].points;
    if (!widest || margin > widest.margin) widest = { task, margin };
    if (!closest || margin < closest.margin) closest = { task, margin };
  }

  if (widest) {
    const [winner] = getTaskResults(widest.task.id);
    if (winner) {
      awards.push({
        id: "biggest-margin",
        title: "Runaway Victory",
        command: "max margin",
        player: winner.player,
        value: `+${widest.margin} pts`,
        detail: `Week ${String(widest.task.weekNumber).padStart(2, "0")} · ${widest.task.title}`,
        accent: "amber",
      });
    }
  }

  if (closest) {
    const [winner, runnerUp] = getTaskResults(closest.task.id);
    if (winner && runnerUp) {
      awards.push({
        id: "closest-finish",
        title: "Photo Finish",
        command: "min margin",
        player: winner.player,
        value: closest.margin === 0 ? "dead heat" : `${closest.margin} pt`,
        detail: `Edged out ${runnerUp.player.name} · ${closest.task.title}`,
        accent: "magenta",
      });
    }
  }

  return awards;
}

// Static top-level destinations, listed first so the palette is useful even
// before the user types anything.
const PALETTE_PAGES: CommandPaletteItem[] = [
  {
    id: "page-home",
    label: "Home",
    group: "page",
    href: withBase("/"),
    hint: "current task & overview",
    keywords: "start index dashboard",
  },
  {
    id: "page-tasks",
    label: "Tasks",
    group: "page",
    href: withBase("/tasks"),
    hint: "every weekly brief",
    keywords: "weeks briefs challenges",
  },
  {
    id: "page-leaderboard",
    label: "Leaderboard",
    group: "page",
    href: withBase("/leaderboard"),
    hint: "full standings",
    keywords: "ranks table standings top",
  },
  {
    id: "page-teams",
    label: "Teams",
    group: "page",
    href: withBase("/teams"),
    hint: "teams & team leaderboard",
    keywords: "teams groups team standings four five",
  },
  {
    id: "page-recaps",
    label: "Recaps",
    group: "page",
    href: withBase("/recaps"),
    hint: "weekly episodes",
    keywords: "episodes week review winner climber recap",
  },
  {
    id: "page-compare",
    label: "Compare",
    group: "page",
    href: withBase("/compare"),
    hint: "head-to-head",
    keywords: "versus vs head to head",
  },
  {
    id: "page-stats",
    label: "Stats",
    group: "page",
    href: withBase("/stats"),
    hint: "hall of fame & awards",
    keywords: "summary superlatives records",
  },
  {
    id: "page-players",
    label: "Players",
    group: "page",
    href: withBase("/players"),
    hint: "the roster",
    keywords: "competitors roster people",
  },
  {
    id: "page-about",
    label: "About",
    group: "page",
    href: withBase("/about"),
    hint: "what this is & the taskmaster",
    keywords: "about info taskmaster callum mohan how it works",
  },
];

/**
 * Flat, searchable index of every destination in the app (pages, tasks and
 * players) for the global command palette. Computing it here keeps the data
 * concerns out of the component, which renders the resulting props only.
 */
export function getCommandPaletteItems(): CommandPaletteItem[] {
  const taskItems: CommandPaletteItem[] = [...tasks]
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .map((task) => {
      const weekLabel = `Week ${String(task.weekNumber).padStart(2, "0")}`;
      const named = task.title.length > 0 && task.title !== "???";
      return {
        id: `task-${task.id}`,
        label: named ? task.title : weekLabel,
        group: "task" as const,
        href: withBase(`/tasks/${task.id}`),
        hint: `${weekLabel} · ${task.status}`,
        keywords: `${weekLabel} week ${task.weekNumber} w${task.weekNumber} ${task.status} ${task.description}`,
      };
    });

  const teamStandingById = new Map(
    getTeamLeaderboard().map((row) => [row.team.id, row]),
  );

  const teamItems: CommandPaletteItem[] = teams.map((team) => {
    const row = teamStandingById.get(team.id);
    return {
      id: `team-${team.id}`,
      label: team.name,
      group: "team" as const,
      href: withBase(`/teams/${team.id}`),
      hint: row
        ? `rank #${row.rank} · ${row.points} pts · ${row.members.length} players`
        : "squad",
      keywords: `team squad ${team.memberIds.join(" ")} ${team.tagline ?? ""}`,
    };
  });

  const standingByPlayer = new Map(
    getLeaderboard().map((row) => [row.player.id, row]),
  );

  const playerItems: CommandPaletteItem[] = players.map((player) => {
    const row = standingByPlayer.get(player.id);
    const team = getTeamForPlayer(player.id);
    return {
      id: `player-${player.id}`,
      label: player.name,
      group: "player" as const,
      href: withBase(`/players/${player.id}`),
      hint: row ? `rank #${row.rank} · ${row.points} pts` : "unranked",
      keywords: [player.team, team?.name].filter(Boolean).join(" "),
    };
  });

  return [...PALETTE_PAGES, ...taskItems, ...teamItems, ...playerItems];
}

/**
 * The current task (live, else the next upcoming) distilled into the signal
 * the "what's new" banner compares against the visitor's last-seen task.
 */
export function getWhatsNew(): WhatsNewInfo | undefined {
  const task = getCurrentTask();
  if (!task) return undefined;

  const weekLabel = `Week ${String(task.weekNumber).padStart(2, "0")}`;
  const named = task.title.length > 0 && task.title !== "???";

  return {
    taskId: task.id,
    weekNumber: task.weekNumber,
    title: named ? task.title : weekLabel,
    status: task.status,
    href: withBase(`/tasks/${task.id}`),
  };
}

/**
 * The tasks immediately before and after a given task, by week number, for
 * the previous/next pager on a task detail page.
 */
export function getTaskPager(taskId: string): TaskPager {
  const ordered = [...tasks].sort((a, b) => a.weekNumber - b.weekNumber);
  const index = ordered.findIndex((t) => t.id === taskId);
  if (index === -1) return {};

  const toLink = (task: Task): TaskPagerLink => {
    const named = task.title.length > 0 && task.title !== "???";
    return {
      href: withBase(`/tasks/${task.id}`),
      weekNumber: task.weekNumber,
      title: named
        ? task.title
        : `Week ${String(task.weekNumber).padStart(2, "0")}`,
      status: task.status,
    };
  };

  return {
    prev: index > 0 ? toLink(ordered[index - 1]) : undefined,
    next: index < ordered.length - 1 ? toLink(ordered[index + 1]) : undefined,
  };
}

// ─── Weekly "episode" recaps ─────────────────────────────────────────────
// A recap turns a completed, scored week into an episode page. Everything
// below is derived from the week's scores and the standings before/after it;
// only the editorial colour comes from `recaps.ts`.

const namedTitle = (task: Task) =>
  task.title.length > 0 && task.title !== "???"
    ? task.title
    : `Week ${String(task.weekNumber).padStart(2, "0")}`;

/** Completed tasks that have at least one recorded score, oldest first. */
function getRecapTasks(): Task[] {
  const scoredIds = new Set(scores.map((s) => s.taskId));
  return [...tasks]
    .filter((t) => t.status === "completed" && scoredIds.has(t.id))
    .sort((a, b) => a.weekNumber - b.weekNumber);
}

/** Standings from every score up to and including the given week number. */
function standingsUpToWeek(weekNumber: number): LeaderboardRow[] {
  return computeStandings(
    scores.filter(
      (s) => (completedWeekByTask.get(s.taskId) ?? Infinity) <= weekNumber,
    ),
  );
}

function recapPagerLink(task: Task): TaskPagerLink {
  return {
    href: withBase(`/recaps/${task.id}`),
    weekNumber: task.weekNumber,
    title: namedTitle(task),
    status: task.status,
  };
}

/**
 * The full "episode" recap for a week: winner, podium, biggest climber and
 * faller, how the title race swung, the standings after the week, and the
 * editorial copy (with auto-generated fallbacks). Undefined for unknown or
 * unscored weeks.
 */
export function getWeekRecap(taskId: string): WeekRecap | undefined {
  const task = getTaskById(taskId);
  if (!task) return undefined;

  const thisWeekScores = scores.filter((s) => s.taskId === taskId);
  if (thisWeekScores.length === 0) return undefined;

  const weekNumber = task.weekNumber;
  const weekLabel = `WEEK ${String(weekNumber).padStart(2, "0")}`;

  const results = getTaskResults(taskId);
  const podium = results.slice(0, 3);
  const winnerRow = results[0];
  const runnerRow = results[1];
  const winner = winnerRow
    ? {
        player: winnerRow.player,
        points: winnerRow.points,
        margin: winnerRow.points - (runnerRow?.points ?? 0),
      }
    : undefined;

  const weekPoints = thisWeekScores.reduce((sum, s) => sum + s.points, 0);
  const playersScored = thisWeekScores.length;
  const weekPointsById = new Map(
    thisWeekScores.map((s) => [s.playerId, s.points] as const),
  );

  // Is there any earlier scored week to measure movement against? Without one,
  // "before" standings are meaningless (everyone is level), so we skip movers.
  const hasPrior = scores.some(
    (s) => (completedWeekByTask.get(s.taskId) ?? Infinity) < weekNumber,
  );

  const after = standingsUpToWeek(weekNumber);
  const before = hasPrior ? standingsUpToWeek(weekNumber - 1) : [];
  const beforeRankById = new Map(before.map((r) => [r.player.id, r.rank]));

  // Standings after this week, annotated with movement *during* this week.
  const standings: LeaderboardRow[] = after.map((row) => {
    const previousRank = beforeRankById.get(row.player.id);
    return {
      ...row,
      previousRank,
      movement:
        previousRank !== undefined ? previousRank - row.rank : undefined,
    };
  });

  // Climbers / fallers for the week, biggest move first.
  const movers: RecapMover[] = hasPrior
    ? standings.flatMap((row) => {
        const fromRank = beforeRankById.get(row.player.id);
        if (fromRank === undefined) return [];
        return [
          {
            player: row.player,
            fromRank,
            toRank: row.rank,
            places: fromRank - row.rank,
            weekPoints: weekPointsById.get(row.player.id) ?? 0,
          },
        ];
      })
    : [];

  const biggestClimber = movers
    .filter((m) => m.places > 0)
    .sort((a, b) => b.places - a.places || b.weekPoints - a.weekPoints)[0];
  const biggestFaller = movers
    .filter((m) => m.places < 0)
    .sort((a, b) => a.places - b.places || a.weekPoints - b.weekPoints)[0];

  // Title race at the summit, before vs after.
  const topRow = after[0];
  const secondRow = after[1];
  const prevTop = before[0];
  const lead = topRow ? topRow.points - (secondRow?.points ?? 0) : 0;
  // The *current* leader's margin before this week: their earlier points less
  // the best of the rest. Negative when they were chasing, so a change of
  // leader produces the full swing (e.g. from 5 behind to 3 clear = +8), not a
  // misleading comparison of two different leaders' margins.
  const leaderPointsBefore = topRow
    ? before.find((r) => r.player.id === topRow.player.id)?.points
    : undefined;
  const bestOtherPointsBefore = topRow
    ? before
        .filter((r) => r.player.id !== topRow.player.id)
        .reduce((max, r) => Math.max(max, r.points), 0)
    : 0;
  const previousLead =
    hasPrior && leaderPointsBefore !== undefined
      ? leaderPointsBefore - bestOtherPointsBefore
      : undefined;
  const titleRace: RecapTitleRace | undefined = topRow
    ? {
        leader: topRow.player,
        runnerUp: secondRow?.player,
        lead,
        previousLead,
        swing: previousLead !== undefined ? lead - previousLead : undefined,
        changedHands: Boolean(
          prevTop && prevTop.player.id !== topRow.player.id,
        ),
      }
    : undefined;

  // Editorial copy, with sensible auto-generated fallbacks.
  const content = getRecapContent(taskId) ?? {};
  const headline =
    content.headline ??
    (winner ? `${winner.player.name} wins ${weekLabel}` : `${weekLabel} recap`);

  const summaryParts: string[] = [];
  if (winner) {
    summaryParts.push(
      `${winner.player.name} took ${weekLabel.toLowerCase()} with ${winner.points} ${winner.points === 1 ? "point" : "points"}` +
        (winner.margin > 0
          ? `, ${winner.margin} clear of the chasing pack.`
          : `, edging a tight finish.`),
    );
  }
  if (biggestClimber) {
    summaryParts.push(
      `${biggestClimber.player.name} was the week's biggest climber, up ${biggestClimber.places} to #${biggestClimber.toRank}.`,
    );
  }
  summaryParts.push(
    `${playersScored} ${playersScored === 1 ? "player" : "players"} scored, for ${weekPoints} points in all.`,
  );
  const summary = content.summary ?? summaryParts.join(" ");

  const momentPlayer = content.momentPlayerId
    ? getPlayerById(content.momentPlayerId)
    : undefined;

  const recapTasks = getRecapTasks();
  const index = recapTasks.findIndex((t) => t.id === taskId);

  return {
    task,
    weekLabel,
    episodeNumber: weekNumber,
    winner,
    podium,
    biggestClimber,
    biggestFaller,
    titleRace,
    weekPoints,
    playersScored,
    standings,
    headline,
    summary,
    moment: content.moment,
    momentPlayer,
    quote: content.quote,
    prev: index > 0 ? recapPagerLink(recapTasks[index - 1]) : undefined,
    next:
      index >= 0 && index < recapTasks.length - 1
        ? recapPagerLink(recapTasks[index + 1])
        : undefined,
  };
}

/** Every available recap, condensed for the episode index grid, newest first. */
export function getRecapSummaries(): RecapSummary[] {
  return getRecapTasks()
    .sort((a, b) => b.weekNumber - a.weekNumber)
    .flatMap((task) => {
      const recap = getWeekRecap(task.id);
      if (!recap) return [];
      return [
        {
          task,
          weekLabel: recap.weekLabel,
          episodeNumber: recap.episodeNumber,
          headline: recap.headline,
          winner: recap.winner?.player,
          winningScore: recap.winner?.points,
          biggestClimber: recap.biggestClimber,
        },
      ];
    });
}

/** The ids of every week that currently has a recap page. */
export function getRecapTaskIds(): string[] {
  return getRecapTasks().map((t) => t.id);
}

/**
 * Options for the "compare with…" entry point on a player profile: a
 * suggested nearest rival (the adjacent player on the standings) plus every
 * other player for the dropdown, all ordered by rank.
 */
export function getPlayerCompareOptions(
  playerId: string,
): PlayerCompareOptions {
  const leaderboard = getLeaderboard();
  const index = leaderboard.findIndex((row) => row.player.id === playerId);
  if (index === -1) return { opponents: [] };

  const toOpponent = (row: LeaderboardRow): CompareOpponent => ({
    id: row.player.id,
    name: row.player.name,
    rank: row.rank,
  });

  // Nearest rival: prefer the player directly above, else the one below.
  const rivalRow = leaderboard[index - 1] ?? leaderboard[index + 1];

  return {
    rival: rivalRow ? toOpponent(rivalRow) : undefined,
    opponents: leaderboard
      .filter((row) => row.player.id !== playerId)
      .map(toOpponent),
  };
}
