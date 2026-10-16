import type { Task, TaskRevealContext, TaskStatus } from "../types";
import type { tasks as tasksTable } from "../db/schema";
import { wallClockToIso } from "../lib/time";

type TaskRow = typeof tasksTable.$inferSelect;

/**
 * Derives a task's status purely from its release/deadline dates, so the
 * status is always consistent with the clock and self-corrects as time
 * passes (e.g. a live task flips to "completed" once its deadline passes)
 * instead of relying on a hardcoded value that can go stale.
 *
 *   now < releaseDate            → "upcoming" (brief still encrypted)
 *   releaseDate <= now < deadline → "live"     (task is open)
 *   now >= deadline              → "completed" (task closed)
 */
export function deriveTaskStatus(
  task: Pick<Task, "releaseDate" | "deadline">,
  now: number = Date.now(),
): TaskStatus {
  const release = new Date(task.releaseDate).getTime();
  const deadline = new Date(task.deadline).getTime();
  if (Number.isNaN(release) || Number.isNaN(deadline) || now < release) {
    return "upcoming";
  }
  return now < deadline ? "live" : "completed";
}

/**
 * Whether a password-protected task still withholds its content from this
 * visitor. Completed tasks always open up, as do tasks an admin revealed to
 * everyone; otherwise only a visitor who entered the password sees it.
 */
export function isTaskLocked(
  task: Pick<Task, "id" | "status" | "passwordProtected" | "revealedToAll">,
  reveal: TaskRevealContext,
): boolean {
  if (reveal.mode === "admin") return false;
  if (!task.passwordProtected || task.revealedToAll) return false;
  if (task.status === "completed") return false;
  return !reveal.unlockedTaskIds.has(task.id);
}

/**
 * The weekly schedule. Status is not stored: it is derived from the dates so
 * it is always clock-correct for the moment the page is rendered. Locked
 * tasks are redacted here, in the data layer, so no page, component or
 * feed (palette, banner, .ics) can leak their title or brief.
 */
export function mapTasks(
  rows: TaskRow[],
  reveal: TaskRevealContext,
  now: number = Date.now(),
): Task[] {
  return rows.map((row) => {
    const dates = {
      releaseDate: wallClockToIso(row.releaseDate),
      deadline: wallClockToIso(row.deadline),
    };
    const base = {
      id: row.id,
      weekNumber: row.weekNumber,
      ...dates,
      format: row.format,
      status: deriveTaskStatus(dates, now),
      passwordProtected: row.revealPassword !== null,
      revealedToAll: row.revealedAt !== null,
    };
    if (isTaskLocked(base, reveal)) {
      return { ...base, title: "???", description: "", locked: true };
    }
    return {
      ...base,
      title: row.title,
      description: row.description,
      ...(row.brief !== null && { brief: row.brief }),
      locked: false,
    };
  });
}
