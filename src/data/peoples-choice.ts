import { and, eq, sql } from "drizzle-orm";
import type {
  PeoplesChoiceStatus,
  PeoplesChoiceVote,
  Task,
  Team,
} from "../types";
import { getDb } from "../db";
import { peoplesChoiceVotes } from "../db/schema";
import type { DerivedBonusRow } from "./polls";

// People's Choice: once a task's deadline passes and its gallery goes up,
// every player gets one vote for their favourite entry (never their own or
// their squad's). Voting closes a fixed time later; the most-voted entry's
// owner earns a bonus, derived from the votes rather than stored, so a
// withdrawn vote or a hidden entry can never leave stray points behind.

/** How long voting stays open after the deadline. */
export const PEOPLES_CHOICE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** Points each People's Choice winner earns (ties all earn it). */
export const PEOPLES_CHOICE_BONUS_POINTS = 1;

/** When voting on a task's entries closes (ISO 8601). */
export function peoplesChoiceClosesAt(task: Pick<Task, "deadline">): string {
  return new Date(
    new Date(task.deadline).getTime() + PEOPLES_CHOICE_WINDOW_MS,
  ).toISOString();
}

export function derivePeoplesChoiceStatus(
  task: Pick<Task, "deadline" | "status">,
  now: number = Date.now(),
): PeoplesChoiceStatus {
  if (task.status !== "completed") return "not-open";
  return now < new Date(peoplesChoiceClosesAt(task)).getTime()
    ? "open"
    : "closed";
}

export interface PeoplesChoiceVoteRow {
  taskId: string;
  playerId: string;
  submissionId: number;
  submitterId: string;
  teamId: string | null;
  hiddenAt: string | null;
}

export function mapPeoplesChoiceVotes(
  rows: PeoplesChoiceVoteRow[],
): PeoplesChoiceVote[] {
  return rows.map((row) => ({
    taskId: row.taskId,
    playerId: row.playerId,
    submissionId: row.submissionId,
    submitterId: row.submitterId,
    ...(row.teamId !== null && { teamId: row.teamId }),
    entryHidden: row.hiddenAt !== null,
  }));
}

/**
 * The entries that won a task's vote: the most votes among visible entries
 * (ties all win), or none if nobody voted.
 */
export function peoplesChoiceWinners(votes: PeoplesChoiceVote[]): number[] {
  const tally = new Map<number, number>();
  for (const vote of votes) {
    if (vote.entryHidden) continue;
    tally.set(vote.submissionId, (tally.get(vote.submissionId) ?? 0) + 1);
  }
  const top = Math.max(0, ...tally.values());
  if (top === 0) return [];
  return [...tally].filter(([, n]) => n === top).map(([id]) => id);
}

/**
 * The winners' bonuses for every closed vote, in week order. A squad's
 * winning entry earns every member the bonus, like squad points; a player
 * with several winning entries still earns it once.
 */
export function derivePeoplesChoiceBonusRows(
  votes: PeoplesChoiceVote[],
  tasks: Task[],
  teams: Team[],
  now: number = Date.now(),
): DerivedBonusRow[] {
  const membersOf = new Map(teams.map((t) => [t.id, t.memberIds]));
  return tasks.flatMap((task) => {
    if (derivePeoplesChoiceStatus(task, now) !== "closed") return [];
    const taskVotes = votes.filter((v) => v.taskId === task.id);
    const winners = new Set(peoplesChoiceWinners(taskVotes));
    const playerIds = new Set<string>();
    for (const vote of taskVotes) {
      if (!winners.has(vote.submissionId)) continue;
      const owners = vote.teamId
        ? (membersOf.get(vote.teamId) ?? [])
        : [vote.submitterId];
      owners.forEach((id) => playerIds.add(id));
    }
    return [...playerIds].map((playerId) => ({
      taskId: task.id,
      playerId,
      points: PEOPLES_CHOICE_BONUS_POINTS,
      reason: "Won People's Choice",
    }));
  });
}

/**
 * Records (or moves) a player's vote on a task. The caller checks the window
 * and that the entry isn't theirs; the composite key makes sure the entry
 * belongs to the task.
 */
export async function castPeoplesChoiceVote(
  taskId: string,
  playerId: string,
  submissionId: number,
): Promise<void> {
  await getDb()
    .insert(peoplesChoiceVotes)
    .values({ taskId, playerId, submissionId })
    .onConflictDoUpdate({
      target: [peoplesChoiceVotes.taskId, peoplesChoiceVotes.playerId],
      set: { submissionId, createdAt: sql`now()` },
    });
}

export async function withdrawPeoplesChoiceVote(
  taskId: string,
  playerId: string,
): Promise<void> {
  await getDb()
    .delete(peoplesChoiceVotes)
    .where(
      and(
        eq(peoplesChoiceVotes.taskId, taskId),
        eq(peoplesChoiceVotes.playerId, playerId),
      ),
    );
}
