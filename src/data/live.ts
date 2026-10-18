import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { taskScores, teamScores } from "../db/schema";
import type { ScoreRows } from "./scores";

// Results night. A held week's scores are left out of the public snapshot,
// so `/live` loads them on their own and `live-queries.ts` decides how many
// of them have been revealed. Admin writes (hold, reveal, publish) live in
// `admin.ts`.

/** The stored scores for one task, held or not. */
export async function loadTaskResultRows(
  taskId: string,
): Promise<Pick<ScoreRows, "taskScores" | "teamScores">> {
  const db = getDb();
  const [individual, team] = await db.batch([
    db.select().from(taskScores).where(eq(taskScores.taskId, taskId)),
    db.select().from(teamScores).where(eq(teamScores.taskId, taskId)),
  ]);
  return { taskScores: individual, teamScores: team };
}
