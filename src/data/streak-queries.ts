import type {
  Award,
  Comeback,
  CompetitionData,
  LeaderboardRow,
  PlayerStreaks,
  RankClimb,
  Score,
  StreakKind,
  StreakRun,
} from "../types";

// Streaks, climbs and comebacks, derived from each scored week's results
// and the overall standings straight after it. A week a player wasn't
// scored on breaks their streaks, the same as a week they missed the mark.

interface StreakDeps {
  getLeaderboard(): LeaderboardRow[];
  /** Standings from every score and bonus up to and including a week. */
  standingsUpToWeek(weekNumber: number): LeaderboardRow[];
}

const STREAK_KINDS: StreakKind[] = ["win", "podium", "scoring"];

const counts: Record<StreakKind, (score: Score | undefined) => boolean> = {
  win: (score) => score !== undefined && score.position === 1,
  podium: (score) => score !== undefined && score.position <= 3,
  scoring: (score) => score !== undefined && score.points > 0,
};

/** Streaks shorter than this aren't worth a mention. */
export const MIN_STREAK = 2;

const pad = (n: number) => String(n).padStart(2, "0");

/** "Week 03", or "Weeks 03–05" for a run over several weeks. */
export function weekSpan({
  fromWeek,
  toWeek,
}: Pick<StreakRun, "fromWeek" | "toWeek">): string {
  return fromWeek === toWeek
    ? `Week ${pad(fromWeek)}`
    : `Weeks ${pad(fromWeek)}–${pad(toWeek)}`;
}

export const climbDetail = (climb: RankClimb): string =>
  `#${climb.fromRank} → #${climb.toRank} · Week ${pad(climb.task.weekNumber)}`;

export const comebackDetail = (comeback: Comeback, final: boolean): string =>
  `#${comeback.lowRank} after week ${pad(comeback.lowWeek)} → #${comeback.rank} ${final ? "final" : "now"}`;

/**
 * Keeps the best candidate seen so far, so on a tie the first one in the
 * list (e.g. the higher-ranked player) keeps it.
 */
export function best<T>(
  candidates: T[],
  score: (candidate: T) => number,
): T | undefined {
  let top: T | undefined;
  for (const candidate of candidates) {
    if (top === undefined || score(candidate) > score(top)) top = candidate;
  }
  return top;
}

export function createStreakQueries(
  {
    season,
    players,
    tasks,
    scores,
  }: Pick<CompetitionData, "season" | "players" | "tasks" | "scores">,
  { getLeaderboard, standingsUpToWeek }: StreakDeps,
) {
  const scoredIds = new Set(scores.map((s) => s.taskId));
  const weeks = tasks
    .filter((t) => scoredIds.has(t.id))
    .sort((a, b) => a.weekNumber - b.weekNumber);
  const scoreByKey = new Map(
    scores.map((s) => [`${s.taskId}:${s.playerId}`, s] as const),
  );
  const isFinal = season.status === "closed";

  // Built at most once per snapshot (i.e. per request and season).
  let timeline: Map<string, number>[] | undefined;
  let standingsNow: LeaderboardRow[] | undefined;
  const rankTimeline = () =>
    (timeline ??= weeks.map(
      (task) =>
        new Map(
          standingsUpToWeek(task.weekNumber).map((row) => [
            row.player.id,
            row.rank,
          ]),
        ),
    ));
  const leaderboard = () => (standingsNow ??= getLeaderboard());

  function longestRun(playerId: string, kind: StreakKind) {
    let start = -1;
    let longest: StreakRun | undefined;
    weeks.forEach((task, index) => {
      if (!counts[kind](scoreByKey.get(`${task.id}:${playerId}`))) {
        start = -1;
        return;
      }
      if (start === -1) start = index;
      const length = index - start + 1;
      if (!longest || length > longest.length) {
        longest = {
          kind,
          length,
          fromWeek: weeks[start].weekNumber,
          toWeek: task.weekNumber,
          active: !isFinal && index === weeks.length - 1,
        };
      }
    });
    return longest;
  }

  /**
   * A player's longest streaks, biggest one-week climb, best comeback and
   * peak rank. Undefined for an unknown player; a player who hasn't been
   * scored yet has no streaks or ranks to speak of.
   */
  function getPlayerStreaks(playerId: string): PlayerStreaks | undefined {
    const player = players.find((p) => p.id === playerId);
    if (!player) return undefined;
    const streaks: PlayerStreaks = { player, longest: {}, weeksAtTop: 0 };
    if (!scores.some((s) => s.playerId === playerId)) return streaks;

    for (const kind of STREAK_KINDS) {
      const run = longestRun(playerId, kind);
      if (run) streaks.longest[kind] = run;
    }

    const ranks = rankTimeline().flatMap((ranksAfter, index) => {
      const rank = ranksAfter.get(playerId);
      return rank === undefined ? [] : [{ task: weeks[index], rank }];
    });

    for (const [index, { task, rank }] of ranks.entries()) {
      if (rank === 1) streaks.weeksAtTop += 1;
      if (!streaks.peak || rank < streaks.peak.rank) {
        streaks.peak = { rank, weekNumber: task.weekNumber };
      }
      const before = ranks[index - 1];
      const places = before ? before.rank - rank : 0;
      if (
        before &&
        places > 0 &&
        places > (streaks.biggestClimb?.places ?? 0)
      ) {
        streaks.biggestClimb = {
          task,
          fromRank: before.rank,
          toRank: rank,
          places,
        };
      }
    }

    // The low point is the latest week at their worst rank: where the
    // climb back began.
    let low: { rank: number; weekNumber: number } | undefined;
    for (const { task, rank } of ranks) {
      if (!low || rank >= low.rank) low = { rank, weekNumber: task.weekNumber };
    }
    const rankNow = leaderboard().find(
      (row) => row.player.id === playerId,
    )?.rank;
    if (low && rankNow !== undefined && low.rank > rankNow) {
      streaks.comeback = {
        lowRank: low.rank,
        lowWeek: low.weekNumber,
        rank: rankNow,
        places: low.rank - rankNow,
      };
    }

    return streaks;
  }

  /** Every player's streaks, in standings order. */
  function getAllPlayerStreaks(): PlayerStreaks[] {
    return leaderboard().flatMap((row) => {
      const streaks = getPlayerStreaks(row.player.id);
      return streaks ? [streaks] : [];
    });
  }

  /**
   * The season's streak and comeback leaders, as award cards. A tie goes to
   * whoever is higher on the standings. Empty until anyone has a streak.
   */
  function getStreakAwards(): Award[] {
    const all = getAllPlayerStreaks();
    const awards: Award[] = [];

    const streakAward = (
      kind: StreakKind,
      fields: Pick<Award, "id" | "title" | "command" | "accent">,
    ) => {
      const top = best(all, (s) => s.longest[kind]?.length ?? 0);
      const run = top?.longest[kind];
      if (!top || !run || run.length < MIN_STREAK) return;
      awards.push({
        ...fields,
        player: top.player,
        value: `${run.length} in a row`,
        detail: weekSpan(run),
        ...(run.active && { active: true }),
      });
    };

    streakAward("win", {
      id: "win-streak",
      title: "Win Streak",
      command: "max streak --wins",
      accent: "magenta",
    });
    streakAward("podium", {
      id: "podium-streak",
      title: "Podium Machine",
      command: "max streak --podium",
      accent: "cyan",
    });

    const climber = best(all, (s) => s.biggestClimb?.places ?? 0);
    if (climber?.biggestClimb) {
      awards.push({
        id: "week-climb",
        title: "Rocket Week",
        command: "max climb --week",
        player: climber.player,
        value: `+${climber.biggestClimb.places}`,
        detail: climbDetail(climber.biggestClimb),
        accent: "amber",
      });
    }

    const comeback = best(all, (s) => s.comeback?.places ?? 0);
    if (comeback?.comeback) {
      awards.push({
        id: "comeback",
        title: "Comeback Kid",
        command: "max comeback",
        player: comeback.player,
        value: `+${comeback.comeback.places}`,
        detail: comebackDetail(comeback.comeback, isFinal),
        accent: "acid",
      });
    }

    return awards;
  }

  /**
   * A player's peak rank, streaks, biggest climb and comeback as cards for
   * their profile. Empty until they've been scored.
   */
  function getPlayerStreakStats(playerId: string): Award[] {
    const streaks = getPlayerStreaks(playerId);
    if (!streaks?.peak) return [];
    const { longest, peak, weeksAtTop, biggestClimb, comeback } = streaks;
    const stats: Award[] = [
      {
        id: "peak",
        title: "Peak Position",
        command: "min rank",
        value: `#${peak.rank}`,
        detail: `After week ${pad(peak.weekNumber)}`,
        accent: "cyan",
      },
    ];

    if (weeksAtTop > 0) {
      stats.push({
        id: "weeks-at-top",
        title: "Weeks at #1",
        command: "count rank==1",
        value: String(weeksAtTop),
        detail: `Of ${weeks.length} scored ${weeks.length === 1 ? "week" : "weeks"}`,
        accent: "amber",
      });
    }

    const runStat = (
      kind: StreakKind,
      fields: Pick<Award, "id" | "title" | "command" | "accent">,
      unit: string,
    ) => {
      const run = longest[kind];
      if (!run || run.length < MIN_STREAK) return;
      stats.push({
        ...fields,
        value: `${run.length} ${unit}`,
        detail: weekSpan(run),
        ...(run.active && { active: true }),
      });
    };
    runStat(
      "win",
      {
        id: "win-streak",
        title: "Win Streak",
        command: "max streak --wins",
        accent: "magenta",
      },
      "in a row",
    );
    runStat(
      "podium",
      {
        id: "podium-streak",
        title: "Podium Run",
        command: "max streak --podium",
        accent: "cyan",
      },
      "in a row",
    );
    runStat(
      "scoring",
      {
        id: "scoring-streak",
        title: "Scoring Run",
        command: "max streak --scoring",
        accent: "acid",
      },
      "weeks",
    );

    if (biggestClimb) {
      stats.push({
        id: "week-climb",
        title: "Biggest Climb",
        command: "max climb --week",
        value: `+${biggestClimb.places}`,
        detail: climbDetail(biggestClimb),
        accent: "amber",
      });
    }

    if (comeback) {
      stats.push({
        id: "comeback",
        title: "Comeback",
        command: "max comeback",
        value: `+${comeback.places}`,
        detail: comebackDetail(comeback, isFinal),
        accent: "acid",
      });
    }

    return stats;
  }

  /**
   * Who topped the table after each scored week (several on a tie), oldest
   * week first. Feeds the wrapped title race.
   */
  function getLeadersByWeek(): string[][] {
    return rankTimeline().map((ranksAfter) =>
      [...ranksAfter].filter(([, rank]) => rank === 1).map(([id]) => id),
    );
  }

  return {
    getPlayerStreaks,
    getAllPlayerStreaks,
    getStreakAwards,
    getPlayerStreakStats,
    getLeadersByWeek,
  };
}
