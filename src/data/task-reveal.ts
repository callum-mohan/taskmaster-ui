import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { tasks } from "../db/schema";

/**
 * A task's reveal password, read only when a visitor submits a guess. It is
 * deliberately kept out of the competition snapshot so it can never reach a
 * page, component or client script.
 */
export async function getRevealPassword(
  taskId: string,
): Promise<string | null> {
  const [row] = await getDb()
    .select({ revealPassword: tasks.revealPassword })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  return row?.revealPassword ?? null;
}
