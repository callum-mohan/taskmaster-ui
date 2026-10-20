import type { Poll, PollStatus, Task } from "../types";
import type {
  pollOptions as pollOptionsTable,
  polls as pollsTable,
  pollVotes as pollVotesTable,
} from "../db/schema";
import { wallClockToIso } from "../lib/time";

type PollRow = typeof pollsTable.$inferSelect;
type OptionRow = typeof pollOptionsTable.$inferSelect;
type VoteRow = typeof pollVotesTable.$inferSelect;

/**
 * Derives a poll's status from its dates, so it flips from scheduled → open
 * → closed on time without anything being written.
 */
export function derivePollStatus(
  poll: { opensAt: string; closesAt: string },
  now: number = Date.now(),
): PollStatus {
  const opens = new Date(poll.opensAt).getTime();
  const closes = new Date(poll.closesAt).getTime();
  if (Number.isNaN(opens) || Number.isNaN(closes) || now < opens) {
    return "scheduled";
  }
  return now < closes ? "open" : "closed";
}

/**
 * The week a poll's voting bonus counts in when no admin picked one: the
 * task live when the poll opens, else the latest one released by then, else
 * the first on the schedule. Tasks are in week order.
 */
export function resolveBonusTask(
  opensAt: string,
  tasks: Pick<Task, "id" | "releaseDate" | "deadline">[],
): string | undefined {
  const opens = new Date(opensAt).getTime();
  const released = tasks.filter(
    (t) => new Date(t.releaseDate).getTime() <= opens,
  );
  const live = released.find((t) => opens < new Date(t.deadline).getTime());
  return (live ?? released.at(-1) ?? tasks[0])?.id;
}

/** Rows → `Poll` records, with options in display order and status derived. */
export function mapPolls(
  pollRows: PollRow[],
  optionRows: OptionRow[],
  voteRows: VoteRow[],
  tasks: Task[],
  now: number = Date.now(),
): Poll[] {
  const taskIds = new Set(tasks.map((t) => t.id));
  return pollRows.map((row) => {
    const options = optionRows
      .filter((o) => o.pollId === row.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .map((o) => ({ id: o.id, label: o.label }));
    const single = row.kind === "single";
    const minChoices = single ? 1 : row.minChoices;
    const maxChoices = single
      ? 1
      : Math.max(
          minChoices,
          Math.min(row.maxChoices ?? options.length, options.length),
        );
    const opensAt = wallClockToIso(row.opensAt);
    const closesAt = wallClockToIso(row.closesAt);
    const pinned = row.bonusTaskId !== null && taskIds.has(row.bonusTaskId);
    const bonusTaskId = pinned
      ? row.bonusTaskId!
      : resolveBonusTask(opensAt, tasks);
    return {
      id: row.id,
      question: row.question,
      ...(row.description !== null && { description: row.description }),
      kind: row.kind,
      minChoices,
      maxChoices,
      opensAt,
      closesAt,
      resultsVisibility: row.resultsVisibility,
      allowVoteChange: row.allowVoteChange,
      anonymous: row.anonymous,
      showOnHomeDays: row.showOnHomeDays,
      published: row.published,
      voteBonusPoints: row.voteBonusPoints,
      ...(bonusTaskId && { bonusTaskId }),
      bonusTaskPinned: pinned,
      status: derivePollStatus({ opensAt, closesAt }, now),
      options,
      votes: voteRows
        .filter((v) => v.pollId === row.id)
        .map((v) => ({ optionId: v.optionId, playerId: v.playerId })),
    };
  });
}

/** A bonus row in the shape `buildScoreRecords` reads. */
export interface DerivedBonusRow {
  taskId: string;
  playerId: string;
  points: number;
  reason: string;
}

/**
 * The voting bonuses, derived from the votes rather than stored: each
 * player who voted in a poll earns its `voteBonusPoints` once (however many
 * options they picked) in the poll's bonus week. Withdrawn votes, reset
 * polls and deleted polls therefore never leave stray points behind.
 */
export function derivePollBonusRows(polls: Poll[]): DerivedBonusRow[] {
  // Oldest poll first, so the ledger reads in the order polls ran.
  return [...polls]
    .sort((a, b) => a.opensAt.localeCompare(b.opensAt))
    .flatMap((poll) => {
      const { bonusTaskId: taskId, voteBonusPoints: points } = poll;
      if (!taskId || points <= 0) return [];
      const voters = [...new Set(poll.votes.map((v) => v.playerId))];
      const reason = `Voted in the poll "${poll.question}"`;
      return voters.map((playerId) => ({ taskId, playerId, points, reason }));
    });
}
