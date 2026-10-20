import type { AllTimeRecord, HallOfFame, HallOfFameSeason } from "../types";
import type { Queries } from "./queries";
import {
  climbDetail,
  comebackDetail,
  MIN_STREAK,
  weekSpan,
} from "./streak-queries";

/** The selectors bound to one closed season's snapshot. */
export type ClosedSeason = Pick<
  Queries,
  | "season"
  | "players"
  | "tasks"
  | "scores"
  | "getLeaderboard"
  | "getTeamLeaderboard"
  | "getAwards"
  | "getAllPlayerStreaks"
>;

const PODIUM_SIZE = 3;

function seasonHonours(queries: ClosedSeason): HallOfFameSeason {
  const played = queries
    .getLeaderboard()
    .filter((row) => row.tasksCompleted > 0);
  const topSquad = queries.getTeamLeaderboard()[0];
  return {
    season: queries.season,
    podium: played.slice(0, PODIUM_SIZE),
    ...(topSquad &&
      topSquad.tasksCompleted > 0 &&
      topSquad.points > 0 && { winningSquad: topSquad }),
    // The podium already crowns the champion.
    awards: queries.getAwards().filter((award) => award.id !== "champion"),
    playerCount: queries.players.length,
    weekCount: queries.tasks.length,
  };
}

/**
 * Keeps the best candidate seen so far. Candidates arrive oldest season
 * first, so on a tie the record stays with whoever set it first.
 */
function best<T>(
  candidates: T[],
  score: (candidate: T) => number,
): T | undefined {
  let top: T | undefined;
  for (const candidate of candidates) {
    if (top === undefined || score(candidate) > score(top)) top = candidate;
  }
  return top;
}

function allTimeRecords(closed: ClosedSeason[]): AllTimeRecord[] {
  const records: AllTimeRecord[] = [];
  const honours = closed.map((queries) => ({
    season: queries.season,
    played: queries.getLeaderboard().filter((row) => row.tasksCompleted > 0),
  }));

  const champions = honours.flatMap(({ season, played }) =>
    played[0] ? [{ season, row: played[0], runnerUp: played[1] }] : [],
  );

  const topTotal = best(champions, (c) => c.row.points);
  if (topTotal) {
    records.push({
      id: "season-points",
      title: "Highest season total",
      command: "max season.points",
      player: topTotal.row.player,
      season: topTotal.season,
      value: `${topTotal.row.points} pts`,
      detail: "Season champion",
      accent: "amber",
    });
  }

  const margins = champions.filter((c) => c.runnerUp !== undefined);
  const widest = best(margins, (c) => c.row.points - c.runnerUp!.points);
  const margin = widest ? widest.row.points - widest.runnerUp!.points : 0;
  // A title won on a tie-break isn't a margin worth recording.
  if (widest && margin > 0) {
    records.push({
      id: "title-margin",
      title: "Biggest winning margin",
      command: "max champion.lead",
      player: widest.row.player,
      season: widest.season,
      value: `+${margin} pts`,
      detail: `Ahead of ${widest.runnerUp!.player.name}`,
      accent: "acid",
    });
  }

  const winners = honours.flatMap(({ season, played }) =>
    played.map((row) => ({ season, row })),
  );
  const mostWins = best(winners, (w) => w.row.wins);
  if (mostWins && mostWins.row.wins > 0) {
    records.push({
      id: "season-wins",
      title: "Most weekly wins",
      command: "max season.wins",
      player: mostWins.row.player,
      season: mostWins.season,
      value: `${mostWins.row.wins} ${mostWins.row.wins === 1 ? "win" : "wins"}`,
      detail: "In a single season",
      accent: "magenta",
    });
  }

  const weekScores = closed.flatMap((data) => {
    const players = new Map(data.players.map((p) => [p.id, p]));
    const tasks = new Map(data.tasks.map((t) => [t.id, t]));
    return data.scores.flatMap((score) => {
      const player = players.get(score.playerId);
      const task = tasks.get(score.taskId);
      // Team-task points are credited to every member; the record is for
      // an individual effort.
      return player && task && task.format === "individual"
        ? [{ season: data.season, score, player, task }]
        : [];
    });
  });
  const topWeek = best(weekScores, (w) => w.score.points);
  if (topWeek && topWeek.score.points > 0) {
    records.push({
      id: "week-score",
      title: "Best single week",
      command: "max week.points",
      player: topWeek.player,
      season: topWeek.season,
      value: `${topWeek.score.points} pts`,
      detail: `Week ${topWeek.task.weekNumber}: ${topWeek.task.title}`,
      accent: "cyan",
    });
  }

  const streaks = closed.flatMap((data) =>
    data
      .getAllPlayerStreaks()
      .map((streak) => ({ season: data.season, streak })),
  );

  for (const [kind, id, title, command, accent] of [
    ["win", "win-streak", "Longest win streak", "max streak.wins", "magenta"],
    [
      "podium",
      "podium-streak",
      "Longest podium run",
      "max streak.podium",
      "cyan",
    ],
  ] as const) {
    const top = best(streaks, (s) => s.streak.longest[kind]?.length ?? 0);
    const run = top?.streak.longest[kind];
    if (top && run && run.length >= MIN_STREAK) {
      records.push({
        id,
        title,
        command,
        player: top.streak.player,
        season: top.season,
        value: `${run.length} in a row`,
        detail: weekSpan(run),
        accent,
      });
    }
  }

  const climb = best(streaks, (s) => s.streak.biggestClimb?.places ?? 0);
  if (climb?.streak.biggestClimb) {
    records.push({
      id: "week-climb",
      title: "Biggest one-week climb",
      command: "max climb.week",
      player: climb.streak.player,
      season: climb.season,
      value: `+${climb.streak.biggestClimb.places} places`,
      detail: climbDetail(climb.streak.biggestClimb),
      accent: "amber",
    });
  }

  const comeback = best(streaks, (s) => s.streak.comeback?.places ?? 0);
  if (comeback?.streak.comeback) {
    records.push({
      id: "comeback",
      title: "Greatest comeback",
      command: "max comeback",
      player: comeback.streak.player,
      season: comeback.season,
      value: `+${comeback.streak.comeback.places} places`,
      detail: comebackDetail(comeback.streak.comeback, true),
      accent: "acid",
    });
  }

  return records;
}

/**
 * The Hall of Fame: every closed season's honours (most recent first) and
 * the all-time records across them. `closed` is oldest season first.
 */
export function buildHallOfFame(closed: ClosedSeason[]): HallOfFame {
  return {
    seasons: closed.map(seasonHonours).reverse(),
    records: allTimeRecords(closed),
  };
}
