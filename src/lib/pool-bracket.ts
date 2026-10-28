// The weekly pool bracket: a single-elimination draw of pool teams (pairs of
// players). Only facts are stored — which team was drawn into which slot,
// and who won each match an admin recorded. Byes, who meets whom in later
// rounds, and the week's winner and runner-up are all derived here.

import { toWallClock } from "./time";

export const MIN_POOL_TEAMS = 2;
export const MAX_POOL_TEAMS = 12;
export const POOL_TEAM_SIZE = 2;

/**
 * When a draw made at `now` is revealed: the next Monday 09:00 UK time (today,
 * if it's Monday before 9). A zone-less UK wall-clock timestamp, like tasks'.
 */
export function nextPoolReveal(now: Date): string {
  const [date, time] = toWallClock(now).split(" ");
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  let ahead = (8 - day.getUTCDay()) % 7;
  if (ahead === 0 && time >= "09:00:00") ahead = 7;
  day.setUTCDate(day.getUTCDate() + ahead);
  return `${day.toISOString().slice(0, 10)} 09:00:00`;
}

/** A team drawn into a first-round slot (slots `2m` and `2m + 1` meet in match `m`). */
export interface PoolEntry {
  slot: number;
  teamId: string;
}

export interface PoolResult {
  round: number;
  matchIndex: number;
  winnerTeamId: string;
}

export interface PoolMatch {
  round: number;
  index: number;
  /** Unset while a side is still to be decided (or is a first-round bye). */
  teams: [string | undefined, string | undefined];
  winnerId?: string;
  /** A first-round match with one team, who goes through without playing. */
  bye: boolean;
}

export interface PoolBracketView {
  size: number;
  rounds: PoolMatch[][];
  championId?: string;
  runnerUpId?: string;
}

/** The smallest power of two that fits `teamCount` teams (at least 2). */
export function bracketSize(teamCount: number): number {
  let size = 2;
  while (size < teamCount) size *= 2;
  return size;
}

// Reverses the low `bits` bits of `n`, so byes spread evenly across the draw.
function bitReverse(n: number, bits: number): number {
  let out = 0;
  for (let i = 0; i < bits; i++) out = (out << 1) | ((n >> i) & 1);
  return out;
}

/**
 * A random first-round draw. When the teams don't fill a power of two, the
 * spare slots are byes, spread so no two byes meet in the next round.
 */
export function drawBracket(
  teamIds: readonly string[],
  random: () => number = Math.random,
): PoolEntry[] {
  const count = teamIds.length;
  if (count < MIN_POOL_TEAMS || count > MAX_POOL_TEAMS) {
    throw new RangeError(
      `A bracket needs ${MIN_POOL_TEAMS}–${MAX_POOL_TEAMS} teams, not ${count}.`,
    );
  }
  const shuffled = [...teamIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const size = bracketSize(count);
  const matches = size / 2;
  const byes = size - count;
  const bits = Math.log2(matches);
  const entries: PoolEntry[] = [];
  let next = 0;
  for (let m = 0; m < matches; m++) {
    entries.push({ slot: 2 * m, teamId: shuffled[next++] });
    if (bitReverse(m, bits) >= byes) {
      entries.push({ slot: 2 * m + 1, teamId: shuffled[next++] });
    }
  }
  return entries;
}

/** Builds every round from the draw, applying only results that still fit. */
export function buildBracket(
  entries: readonly PoolEntry[],
  results: readonly PoolResult[],
): PoolBracketView {
  const size = bracketSize(entries.length);
  const bySlot = new Map(entries.map((e) => [e.slot, e.teamId]));
  const recorded = new Map(
    results.map((r) => [`${r.round}:${r.matchIndex}`, r.winnerTeamId]),
  );
  const rounds: PoolMatch[][] = [];
  let previous: PoolMatch[] | undefined;
  for (let round = 0, count = size / 2; count >= 1; round++, count /= 2) {
    const matches: PoolMatch[] = [];
    for (let index = 0; index < count; index++) {
      const teams: PoolMatch["teams"] = previous
        ? [previous[2 * index].winnerId, previous[2 * index + 1].winnerId]
        : [bySlot.get(2 * index), bySlot.get(2 * index + 1)];
      const [a, b] = teams;
      const bye = !previous && (a === undefined) !== (b === undefined);
      const pick = recorded.get(`${round}:${index}`);
      const winnerId = bye
        ? (a ?? b)
        : a !== undefined && b !== undefined && (pick === a || pick === b)
          ? pick
          : undefined;
      matches.push({
        round,
        index,
        teams,
        bye,
        ...(winnerId !== undefined && { winnerId }),
      });
    }
    rounds.push(matches);
    previous = matches;
  }
  const final = rounds[rounds.length - 1][0];
  const championId = final.winnerId;
  const runnerUpId =
    championId === undefined
      ? undefined
      : final.teams.find((t) => t !== championId);
  return {
    size,
    rounds,
    ...(championId !== undefined && { championId }),
    ...(runnerUpId !== undefined && { runnerUpId }),
  };
}

/** Whether `winnerId` can be recorded as the winner of this match now. */
export function canRecordResult(
  view: PoolBracketView,
  round: number,
  index: number,
  winnerId: string,
): boolean {
  const match = view.rounds[round]?.[index];
  return (
    !!match &&
    !match.bye &&
    match.winnerId === undefined &&
    match.teams.every((t) => t !== undefined) &&
    match.teams.includes(winnerId)
  );
}

/** A match and every later match its winner feeds into, up to the final. */
export function matchPath(
  view: PoolBracketView,
  round: number,
  index: number,
): { round: number; matchIndex: number }[] {
  const path: { round: number; matchIndex: number }[] = [];
  for (let r = round, i = index; r < view.rounds.length; r++, i >>= 1) {
    path.push({ round: r, matchIndex: i });
  }
  return path;
}

/** "Final", "Semi-finals", "Quarter-finals", else "Round N". */
export function roundLabel(round: number, roundCount: number): string {
  const fromEnd = roundCount - 1 - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semi-finals";
  if (fromEnd === 2) return "Quarter-finals";
  return `Round ${round + 1}`;
}
