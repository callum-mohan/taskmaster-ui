import { and, eq } from "drizzle-orm";
import type { ReactionKind, SubmissionReaction } from "../types";
import { getDb } from "../db";
import { submissionReactions, taskSubmissions } from "../db/schema";

// Emoji reactions on gallery entries. Like the entries themselves they're
// loaded per task (only task pages show them), outside the competition
// snapshot. Who may react is decided in `gallery-queries.ts`.

/** Every reaction to a task's entries, oldest first. */
export async function loadTaskReactions(
  taskId: string,
): Promise<SubmissionReaction[]> {
  const rows = await getDb()
    .select({
      submissionId: submissionReactions.submissionId,
      playerId: submissionReactions.playerId,
      kind: submissionReactions.kind,
    })
    .from(submissionReactions)
    .innerJoin(
      taskSubmissions,
      eq(taskSubmissions.id, submissionReactions.submissionId),
    )
    .where(eq(taskSubmissions.taskId, taskId))
    .orderBy(submissionReactions.createdAt);
  return rows;
}

/**
 * Adds the reaction, or takes it away if the player already left it.
 * Returns whether the reaction is now on.
 */
export async function toggleReaction(
  submissionId: number,
  playerId: string,
  kind: ReactionKind,
): Promise<boolean> {
  const db = getDb();
  const removed = await db
    .delete(submissionReactions)
    .where(
      and(
        eq(submissionReactions.submissionId, submissionId),
        eq(submissionReactions.playerId, playerId),
        eq(submissionReactions.kind, kind),
      ),
    )
    .returning({ kind: submissionReactions.kind });
  if (removed.length > 0) return false;
  await db
    .insert(submissionReactions)
    .values({ submissionId, playerId, kind })
    .onConflictDoNothing();
  return true;
}
