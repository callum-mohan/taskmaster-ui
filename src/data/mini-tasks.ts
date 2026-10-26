import type { MiniTask, MiniTaskCompletion, MiniTaskStatus } from "../types";
import type {
  miniTaskCompletions as miniTaskCompletionsTable,
  miniTasks as miniTasksTable,
} from "../db/schema";
import { timestamptzToIso, toWallClock } from "../lib/time";

type MiniTaskRow = typeof miniTasksTable.$inferSelect;
type CompletionRow = typeof miniTaskCompletionsTable.$inferSelect;

/** The most Clim Coin a single mini-task can pay (also a database check). */
export const MINI_TASK_MAX_REWARD = 5;

/** Today's date in the UK, as YYYY-MM-DD. */
export const ukToday = (now: number = Date.now()): string =>
  toWallClock(new Date(now)).slice(0, 10);

/**
 * Where a mini-task's window sits relative to `today` (YYYY-MM-DD, UK).
 * The dates are inclusive, so it's active all day on both.
 */
export function deriveMiniTaskStatus(
  { startsOn, endsOn }: Pick<MiniTask, "startsOn" | "endsOn">,
  today: string,
): MiniTaskStatus {
  if (today < startsOn) return "upcoming";
  if (today > endsOn) return "ended";
  return "active";
}

/** Rows → mini-tasks, newest start first, with their status for today. */
export function mapMiniTasks(
  rows: readonly MiniTaskRow[],
  now: number = Date.now(),
): MiniTask[] {
  const today = ukToday(now);
  return [...rows]
    .sort(
      (a, b) =>
        b.startsOn.localeCompare(a.startsOn) ||
        b.endsOn.localeCompare(a.endsOn) ||
        b.id - a.id,
    )
    .map((row) => ({
      id: row.id,
      title: row.title,
      ...(row.description && { description: row.description }),
      reward: row.reward,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      status: deriveMiniTaskStatus(row, today),
    }));
}

/** Rows → completions, oldest first. */
export function mapMiniTaskCompletions(
  rows: readonly CompletionRow[],
): MiniTaskCompletion[] {
  return rows
    .map((row) => ({
      miniTaskId: row.miniTaskId,
      playerId: row.playerId,
      actorName: row.actorName,
      at: timestamptzToIso(row.createdAt),
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
}
