import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type {
  SubmissionKind,
  SubmissionOwnerRef,
  TaskSubmission,
} from "../types";
import { getDb } from "../db";
import { taskSubmissions } from "../db/schema";

// Task submissions. Entries are loaded per task (only task pages and the
// admin gallery need them), so they stay out of the competition snapshot.
// Who may submit, delete or see what is decided by the pure selectors in
// `submission-queries.ts`; these writes only enforce what the database must
// (the entry limit, the owner).

type SubmissionRow = typeof taskSubmissions.$inferSelect;

export function mapSubmission(row: SubmissionRow): TaskSubmission {
  return {
    id: row.id,
    taskId: row.taskId,
    playerId: row.playerId,
    ...(row.teamId !== null && { teamId: row.teamId }),
    kind: row.kind,
    ...(row.text !== null && { text: row.text }),
    ...(row.objectKey !== null && { objectKey: row.objectKey }),
    ...(row.contentType !== null && { contentType: row.contentType }),
    ...(row.sizeBytes !== null && { sizeBytes: row.sizeBytes }),
    hidden: row.hiddenAt !== null,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/** Every entry for a task, oldest first. */
export async function loadTaskSubmissions(
  taskId: string,
): Promise<TaskSubmission[]> {
  const rows = await getDb()
    .select()
    .from(taskSubmissions)
    .where(eq(taskSubmissions.taskId, taskId))
    .orderBy(asc(taskSubmissions.createdAt), asc(taskSubmissions.id));
  return rows.map(mapSubmission);
}

export async function getSubmission(
  id: number,
): Promise<TaskSubmission | undefined> {
  const [row] = await getDb()
    .select()
    .from(taskSubmissions)
    .where(eq(taskSubmissions.id, id));
  return row && mapSubmission(row);
}

/** Rows owned by a player (individual task) or squad (team task). */
const ownedBy = (owner: SubmissionOwnerRef) =>
  owner.type === "team"
    ? eq(taskSubmissions.teamId, owner.id)
    : and(
        eq(taskSubmissions.playerId, owner.id),
        isNull(taskSubmissions.teamId),
      );

export interface NewSubmission {
  taskId: string;
  playerId: string;
  owner: SubmissionOwnerRef;
  kind: SubmissionKind;
  text: string | null;
  objectKey?: string;
  contentType?: string;
  sizeBytes?: number;
}

/**
 * Records an entry if the owner still has a free slot. The count and the
 * insert are one statement, so a double-submit can't overshoot the limit.
 * Returns whether a row was written.
 */
export async function createSubmission(
  entry: NewSubmission,
  max: number,
): Promise<boolean> {
  const db = getDb();
  const used = db
    .select({ n: count() })
    .from(taskSubmissions)
    .where(and(eq(taskSubmissions.taskId, entry.taskId), ownedBy(entry.owner)));
  const teamId = entry.owner.type === "team" ? entry.owner.id : null;
  // Raw SQL: Drizzle's insert-select can't leave out the identity column.
  const inserted = await db.execute(sql`
    insert into ${taskSubmissions} (task_id, player_id, team_id, kind, text,
      object_key, content_type, size_bytes)
    select ${entry.taskId}, ${entry.playerId}, ${teamId}::text,
      ${entry.kind}::submission_kind, ${entry.text}::text,
      ${entry.objectKey ?? null}::text, ${entry.contentType ?? null}::text,
      ${entry.sizeBytes ?? null}::integer
    where (${used}) < ${max}
    returning id`);
  return inserted.rows.length > 0;
}

/**
 * Withdraws one of the owner's entries. Returns the deleted entry (so its
 * photo can be removed from storage), or undefined if it wasn't theirs.
 */
export async function deleteOwnSubmission(
  id: number,
  taskId: string,
  owner: SubmissionOwnerRef,
): Promise<TaskSubmission | undefined> {
  const [row] = await getDb()
    .delete(taskSubmissions)
    .where(
      and(
        eq(taskSubmissions.id, id),
        eq(taskSubmissions.taskId, taskId),
        ownedBy(owner),
      ),
    )
    .returning();
  return row && mapSubmission(row);
}
