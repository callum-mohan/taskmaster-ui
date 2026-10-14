import type { Task, TaskStatus } from "../types";
import type { tasks as tasksTable } from "../db/schema";

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

// Timestamps are zone-less wall-clock times, returned as
// "YYYY-MM-DD HH:MM:SS" and normalised to the ISO form the site expects
// ("YYYY-MM-DDTHH:MM:SS", parsed as local time).
const toLocalIso = (timestamp: string) => timestamp.replace(" ", "T");

/**
 * The weekly schedule. Status is not stored: it is derived from the dates so
 * it is always clock-correct for the moment the page is rendered.
 */
export function mapTasks(rows: TaskRow[], now: number = Date.now()): Task[] {
  return rows.map((row) => {
    const task = {
      id: row.id,
      weekNumber: row.weekNumber,
      title: row.title,
      description: row.description,
      ...(row.brief !== null && { brief: row.brief }),
      releaseDate: toLocalIso(row.releaseDate),
      deadline: toLocalIso(row.deadline),
      format: row.format,
    };
    return { ...task, status: deriveTaskStatus(task, now) };
  });
}
