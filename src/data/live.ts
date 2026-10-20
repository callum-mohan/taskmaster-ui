import { eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "../db";
import { taskScores, teamScores, tasks } from "../db/schema";
import type { LiveHold } from "../types";
import type { ScoreRows } from "./scores";

// Results night. A held week's scores are left out of the public snapshot,
// so `/live` loads them on their own and `live-queries.ts` decides how many
// of them have been revealed. Admin writes (hold, reveal, publish) live in
// `admin.ts`.

type ResultRows = Pick<ScoreRows, "taskScores" | "teamScores">;

/** The stored scores for one task, held or not. */
export async function loadTaskResultRows(taskId: string): Promise<ResultRows> {
  const db = getDb();
  const [individual, team] = await db.batch([
    db.select().from(taskScores).where(eq(taskScores.taskId, taskId)),
    db.select().from(teamScores).where(eq(teamScores.taskId, taskId)),
  ]);
  return { taskScores: individual, teamScores: team };
}

/**
 * The show's live state for `/live`, read fresh on every poll: which weeks
 * are held, how far each reveal has got, and those weeks' scores. It's a
 * few small rows, so the page can poll often while the rest of the snapshot
 * comes from the cache.
 */
export async function loadLiveRows(): Promise<
  ResultRows & { holds: LiveHold[] }
> {
  const db = getDb();
  const heldTaskIds = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(isNotNull(tasks.resultsHeldAt));
  const [holds, individual, team] = await db.batch([
    db
      .select({ taskId: tasks.id, revealCount: tasks.resultsRevealCount })
      .from(tasks)
      .where(isNotNull(tasks.resultsHeldAt)),
    db.select().from(taskScores).where(inArray(taskScores.taskId, heldTaskIds)),
    db.select().from(teamScores).where(inArray(teamScores.taskId, heldTaskIds)),
  ]);
  return { holds, taskScores: individual, teamScores: team };
}
