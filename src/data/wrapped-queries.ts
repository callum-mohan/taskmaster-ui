import type {
  Award,
  CompetitionData,
  CompetitionStats,
  LeaderboardRow,
  PlayerBonusSummary,
  PlayerStreaks,
  PlayerTaskResult,
  PlayerWrapped,
  PointsChartData,
  SeasonWrapped,
  Team,
  TeamStanding,
  TitleRaceLeader,
  WrappedNeighbour,
  WrappedPersona,
} from "../types";

// The end-of-season "wrapped": the season's story (podium, title race,
// streaks, superlatives) and each player's own season in review. Pages only
// show it to the public once the season is closed (see `isWrappedLive`).

interface WrappedDeps {
  getLeaderboard(): LeaderboardRow[];
  getTeamLeaderboard(): TeamStanding[];
  getTeamForPlayer(playerId: string): Team | undefined;
  getAwards(): Award[];
  getCompetitionStats(): CompetitionStats;
  getPlayerResults(playerId: string): PlayerTaskResult[];
  getPlayerBonusSummary(playerId: string): PlayerBonusSummary;
  getPlayerProgressionChart(playerId: string): PointsChartData | undefined;
  getStreakAwards(): Award[];
  getPlayerStreaks(playerId: string): PlayerStreaks | undefined;
  getPlayerStreakStats(playerId: string): Award[];
  getLeadersByWeek(): string[][];
}

const PODIUM_SIZE = 3;

// "Biggest climber" is about the latest week only, and the champion is
// crowned on the page itself, so neither belongs in a season review.
const NOT_FOR_WRAPPED = new Set(["champion", "climber"]);

const pad = (n: number) => String(n).padStart(2, "0");

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

export function createWrappedQueries(
  {
    season,
    players,
    bonusPoints,
  }: Pick<CompetitionData, "season" | "players" | "bonusPoints">,
  deps: WrappedDeps,
) {
  const playerById = new Map(players.map((p) => [p.id, p]));

  function topSquad(): TeamStanding | undefined {
    const top = deps.getTeamLeaderboard()[0];
    return top && top.tasksCompleted > 0 && top.points > 0 ? top : undefined;
  }

  function seasonAwards(): Award[] {
    return deps.getAwards().filter((award) => !NOT_FOR_WRAPPED.has(award.id));
  }

  /** The whole season in review: podium, title race, streaks and awards. */
  function getSeasonWrapped(): SeasonWrapped {
    const standings = deps.getLeaderboard();
    const played = standings.filter((row) => row.tasksCompleted > 0);
    const podium = played.slice(0, PODIUM_SIZE);
    const [champion, runnerUp] = podium;
    const leadersByWeek = deps.getLeadersByWeek();

    // A lead changes hands when a different player goes clear at the top;
    // being caught (a tie) doesn't count until someone else edges ahead.
    const weeksLed = new Map<string, number>();
    let holder: string | undefined;
    let leadChanges = 0;
    for (const leaders of leadersByWeek) {
      for (const id of leaders) weeksLed.set(id, (weeksLed.get(id) ?? 0) + 1);
      if (leaders.length !== 1) continue;
      if (holder !== undefined && leaders[0] !== holder) leadChanges += 1;
      holder = leaders[0];
    }
    const leaders: TitleRaceLeader[] = [...weeksLed]
      .flatMap(([id, weeks]) => {
        const player = playerById.get(id);
        return player ? [{ player, weeks }] : [];
      })
      .sort((a, b) => b.weeks - a.weeks);

    const squad = topSquad();
    return {
      season,
      standings,
      podium,
      ...(champion &&
        runnerUp && { margin: champion.points - runnerUp.points }),
      ...(squad && { winningSquad: squad }),
      stats: deps.getCompetitionStats(),
      weeksScored: leadersByWeek.length,
      bonusPoints: bonusPoints.reduce((sum, b) => sum + b.points, 0),
      leadChanges,
      leaders,
      wireToWire:
        champion !== undefined &&
        leadersByWeek.length >= 2 &&
        leadersByWeek.every((ids) => ids.includes(champion.player.id)),
      streaks: deps.getStreakAwards(),
      awards: seasonAwards(),
    };
  }

  function personaFor(
    row: LeaderboardRow,
    {
      champion,
      playerCount,
      weeksScored,
      streaks,
    }: {
      champion?: LeaderboardRow;
      playerCount: number;
      weeksScored: number;
      streaks?: PlayerStreaks;
    },
  ): WrappedPersona {
    const { rank, wins, tasksCompleted, averagePosition } = row;
    const comeback = streaks?.comeback;
    const climb = streaks?.biggestClimb;
    const podiumRun = streaks?.longest.podium?.length ?? 0;

    if (tasksCompleted === 0) {
      return {
        title: "The Mystery Guest",
        blurb: "Never troubled the scorers, which only adds to the legend.",
      };
    }
    // Level on points shares rank 1, but the tie-break crowns one champion.
    if (champion && row.player.id === champion.player.id) {
      return {
        title: "The Champion",
        blurb: `Top of ${plural(playerCount, "player")} when the music stopped.`,
      };
    }
    if (rank <= PODIUM_SIZE) {
      const gap = champion ? champion.points - row.points : 0;
      return {
        title: "The Contender",
        blurb:
          gap > 0
            ? `Finished #${rank}, just ${plural(gap, "point")} off the title.`
            : "Level on points with the champion, edged out on the tie-break.",
      };
    }
    if (comeback && comeback.places >= 5) {
      return {
        title: "The Comeback Kid",
        blurb: `Down at #${comeback.lowRank} after week ${pad(comeback.lowWeek)}, finished #${rank}. Never counted out.`,
      };
    }
    if (wins >= 2) {
      return {
        title: "The Serial Winner",
        blurb: `${wins} weekly wins. The Taskmaster noticed.`,
      };
    }
    if (podiumRun >= 3) {
      return {
        title: "The Podium Regular",
        blurb: `${podiumRun} top-three finishes in a row.`,
      };
    }
    if (weeksScored >= 2 && tasksCompleted >= weeksScored) {
      return {
        title: "The Ever-Present",
        blurb: "Turned up every single week. Reliability is a superpower.",
      };
    }
    if (climb && climb.places >= 3) {
      return {
        title: "The Rocket",
        blurb: `Shot up ${climb.places} places in week ${pad(climb.task.weekNumber)}.`,
      };
    }
    if (averagePosition <= playerCount / 3) {
      return {
        title: "The Steady Hand",
        blurb: `Averaged a ${averagePosition.toFixed(1)} finish. Quietly, relentlessly good.`,
      };
    }
    return {
      title: "The Wildcard",
      blurb: "Unpredictable, unmissable, and always good value.",
    };
  }

  /**
   * One player's season in review. Undefined for a player who isn't on this
   * season's roster.
   */
  function getPlayerWrapped(playerId: string): PlayerWrapped | undefined {
    const standings = deps.getLeaderboard();
    const index = standings.findIndex((row) => row.player.id === playerId);
    if (index === -1) return undefined;
    const standing = standings[index];
    const played = standings.filter((row) => row.tasksCompleted > 0);
    const weeksScored = deps.getLeadersByWeek().length;
    const streaks = deps.getPlayerStreaks(playerId);

    const results = deps.getPlayerResults(playerId);
    const bestWeek = [...results].sort(
      (a, b) =>
        b.points - a.points ||
        a.position - b.position ||
        a.task.weekNumber - b.task.weekNumber,
    )[0];
    const toughest = [...results].sort(
      (a, b) =>
        b.position - a.position ||
        a.points - b.points ||
        a.task.weekNumber - b.task.weekNumber,
    )[0];

    const neighbour = (
      row: LeaderboardRow | undefined,
      gap: (row: LeaderboardRow) => number,
    ): WrappedNeighbour | undefined =>
      row && row.tasksCompleted > 0 && standing.tasksCompleted > 0
        ? { player: row.player, rank: row.rank, gap: gap(row) }
        : undefined;
    const chasing = neighbour(
      standings[index - 1],
      (row) => row.points - standing.points,
    );
    const holdingOff = neighbour(
      standings[index + 1],
      (row) => standing.points - row.points,
    );

    const team = deps.getTeamForPlayer(playerId);
    const squad = team
      ? deps
          .getTeamLeaderboard()
          .find(
            (row) =>
              row.team.id === team.id &&
              row.tasksCompleted > 0 &&
              row.points > 0,
          )
      : undefined;

    // They're all this player's, so the cards needn't name them.
    const awardsWon = [...seasonAwards(), ...deps.getStreakAwards()]
      .filter((award) => award.player?.id === playerId)
      .map((award) => {
        const own = { ...award };
        delete own.player;
        return own;
      });
    const chart = deps.getPlayerProgressionChart(playerId);

    return {
      season,
      standing,
      persona: personaFor(standing, {
        champion: played[0],
        playerCount: standings.length,
        weeksScored,
        streaks,
      }),
      playerCount: standings.length,
      weeksScored,
      beaten: standings.filter((row) => row.rank > standing.rank).length,
      podiums: results.filter((r) => r.position <= PODIUM_SIZE).length,
      ...(bestWeek && { bestWeek }),
      ...(toughest &&
        toughest !== bestWeek &&
        toughest.position > (bestWeek?.position ?? 0) && {
          toughestWeek: toughest,
        }),
      highlights: deps.getPlayerStreakStats(playerId),
      awardsWon,
      bonus: deps.getPlayerBonusSummary(playerId),
      ...(squad && { squad }),
      ...(chasing && { chasing }),
      ...(holdingOff && { holdingOff }),
      ...(chart && { chart }),
    };
  }

  return { getSeasonWrapped, getPlayerWrapped };
}
