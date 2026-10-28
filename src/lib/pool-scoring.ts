import type { PoolBracketView, PoolMatch } from "./pool-bracket";

// Pool points and agreement. A week's points only count once its final has
// an agreed (or admin-recorded) winner, so nothing is handed out mid-week.

export const POOL_POINTS = {
  champion: 5,
  runnerUp: 3,
  semiFinalist: 2,
  knockedOut: 1,
} as const;

export type PoolFinish = keyof typeof POOL_POINTS;

export const POOL_FINISH_LABELS: Record<PoolFinish, string> = {
  champion: "winner",
  runnerUp: "runner-up",
  semiFinalist: "semi-final",
  knockedOut: "knocked out",
};

/** Where each team finished, or `undefined` until the final is decided. */
export function bracketFinishes(
  view: PoolBracketView,
): Map<string, PoolFinish> | undefined {
  if (view.championId === undefined) return undefined;
  const last = view.rounds.length - 1;
  const finishes = new Map<string, PoolFinish>();
  for (const match of view.rounds.flat()) {
    if (match.bye || match.winnerId === undefined) continue;
    const loser = match.teams.find((t) => t !== match.winnerId);
    if (loser === undefined) continue;
    const fromEnd = last - match.round;
    finishes.set(
      loser,
      fromEnd === 0
        ? "runnerUp"
        : fromEnd === 1
          ? "semiFinalist"
          : "knockedOut",
    );
  }
  finishes.set(view.championId, "champion");
  return finishes;
}

export interface PoolStanding {
  teamId: string;
  /** Shared by teams level on points, titles, runner-ups and match wins. */
  rank: number;
  points: number;
  titles: number;
  runnerUps: number;
  matchWins: number;
  weeks: number;
}

/**
 * The season table over every finished week. `teamIds` sets the order of
 * teams that are level on everything.
 */
export function poolStandings(
  teamIds: readonly string[],
  views: readonly PoolBracketView[],
): PoolStanding[] {
  const rows = new Map(
    teamIds.map((teamId) => [
      teamId,
      {
        teamId,
        rank: 0,
        points: 0,
        titles: 0,
        runnerUps: 0,
        matchWins: 0,
        weeks: 0,
      },
    ]),
  );
  for (const view of views) {
    const finishes = bracketFinishes(view);
    if (!finishes) continue;
    for (const [teamId, finish] of finishes) {
      const row = rows.get(teamId);
      if (!row) continue;
      row.weeks += 1;
      row.points += POOL_POINTS[finish];
      if (finish === "champion") row.titles += 1;
      if (finish === "runnerUp") row.runnerUps += 1;
    }
    for (const match of view.rounds.flat()) {
      const row = !match.bye && match.winnerId && rows.get(match.winnerId);
      if (row) row.matchWins += 1;
    }
  }
  const key = (r: PoolStanding) => [
    r.points,
    r.titles,
    r.runnerUps,
    r.matchWins,
  ];
  const sorted = [...rows.values()].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    for (let i = 0; i < ka.length; i++)
      if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  });
  sorted.forEach((row, i) => {
    const prev = sorted[i - 1];
    row.rank =
      prev && key(prev).every((v, k) => v === key(row)[k]) ? prev.rank : i + 1;
  });
  return sorted;
}

export interface PoolReport {
  round: number;
  matchIndex: number;
  /** The team that made the claim. */
  teamId: string;
  winnerTeamId: string;
}

export type PoolAgreement =
  | { state: "none" }
  | { state: "waiting"; teamId: string; winnerTeamId: string }
  | { state: "agreed"; winnerTeamId: string }
  | { state: "disputed" };

/** How the two competing teams' claims about a match stand. */
export function matchAgreement(
  match: PoolMatch,
  reports: readonly PoolReport[],
): PoolAgreement {
  const claims = reports.filter(
    (r) =>
      r.round === match.round &&
      r.matchIndex === match.index &&
      match.teams.includes(r.teamId) &&
      match.teams.includes(r.winnerTeamId),
  );
  const [first, second] = claims;
  if (!first) return { state: "none" };
  if (!second) {
    return {
      state: "waiting",
      teamId: first.teamId,
      winnerTeamId: first.winnerTeamId,
    };
  }
  return first.winnerTeamId === second.winnerTeamId
    ? { state: "agreed", winnerTeamId: first.winnerTeamId }
    : { state: "disputed" };
}

/** The undecided match `teamId` is playing in, if any. */
export function currentMatchFor(
  view: PoolBracketView,
  teamId: string,
): PoolMatch | undefined {
  return view.rounds
    .flat()
    .find(
      (m) =>
        !m.bye &&
        m.winnerId === undefined &&
        m.teams.includes(teamId) &&
        m.teams.every((t) => t !== undefined),
    );
}
