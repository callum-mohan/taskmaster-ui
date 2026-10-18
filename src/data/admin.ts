import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb } from "../db";
import {
  bonusPoints,
  changelogEntries,
  playerAccounts,
  players,
  pollOptions,
  polls,
  pollVotes,
  peoplesChoiceVotes,
  predictions,
  recaps,
  scoreAuditLog,
  submissionReactions,
  taskScores,
  taskSubmissions,
  tasks,
  teamMembers,
  teamScores,
  teams,
} from "../db/schema";
import type { BatchItem } from "drizzle-orm/batch";
import type { AdminUser, ScoreAuditEntry, SubmissionOwnerRef } from "../types";
import { timestamptzToIso } from "../lib/time";
import { deleteObjects, putObject } from "../lib/storage";
import { submissionObjectKey } from "../lib/submission-forms";
import type {
  AddEntryInput,
  BonusInput,
  ChangelogInput,
  PlayerInput,
  PollInput,
  RecapInput,
  TaskInput,
  TaskScoreInput,
  TeamInput,
  TeamScoreInput,
} from "../lib/admin-forms";

// Admin reads and writes. Only facts are written (points, dates,
// membership); positions, status and totals stay derived in `queries.ts`.
// Multi-statement changes use `db.batch`, which runs as one transaction.

export type PlayerRecord = typeof players.$inferSelect;
export type TeamRecord = typeof teams.$inferSelect & { memberIds: string[] };
export type TaskRecord = typeof tasks.$inferSelect;
export type BonusRecord = typeof bonusPoints.$inferSelect;
export type RecapRecord = typeof recaps.$inferSelect;
export type ChangelogRecord = typeof changelogEntries.$inferSelect;
export type PollRecord = typeof polls.$inferSelect & {
  options: (typeof pollOptions.$inferSelect)[];
};

/** Rows a delete will also remove through `ON DELETE CASCADE`. */
export interface DeleteImpact {
  label: string;
  count: number;
}

/**
 * Deletes a parent row together with the submissions it owns, in one
 * transaction, then removes their photos from storage. The submissions are
 * deleted explicitly (rather than left to the cascade) so their object keys
 * come back.
 */
async function deleteWithSubmissions(
  owned: SQL | undefined,
  parent: BatchItem<"pg">,
): Promise<void> {
  const db = getDb();
  const [removed] = await db.batch([
    db
      .delete(taskSubmissions)
      .where(owned)
      .returning({ objectKey: taskSubmissions.objectKey }),
    parent,
  ]);
  await deleteObjects(removed.flatMap((r) => r.objectKey ?? []));
}

const countSubmissions = (owned: SQL | undefined) =>
  getDb().select({ n: count() }).from(taskSubmissions).where(owned);

const nextSortOrder = (table: typeof players | typeof teams) =>
  sql<number>`(select coalesce(max(${table.sortOrder}), 0) + 1 from ${table})`;

// ── Dashboard ─────────────────────────────────────────────────────────

export async function getAdminCounts() {
  const db = getDb();
  const [[p], [t], [k], [s], [ts], [b], [q]] = await db.batch([
    db.select({ n: count() }).from(players),
    db.select({ n: count() }).from(teams),
    db.select({ n: count() }).from(tasks),
    db.select({ n: count() }).from(taskScores),
    db.select({ n: count() }).from(teamScores),
    db.select({ n: count() }).from(bonusPoints),
    db.select({ n: count() }).from(polls),
  ]);
  return {
    players: p.n,
    teams: t.n,
    tasks: k.n,
    scores: s.n + ts.n,
    bonuses: b.n,
    polls: q.n,
  };
}

// ── Players ───────────────────────────────────────────────────────────

export async function listPlayers(): Promise<PlayerRecord[]> {
  return getDb().select().from(players).orderBy(asc(players.sortOrder));
}

export async function getPlayer(id: string): Promise<PlayerRecord | undefined> {
  const [row] = await getDb().select().from(players).where(eq(players.id, id));
  return row;
}

export async function createPlayer(input: PlayerInput): Promise<void> {
  await getDb()
    .insert(players)
    .values({
      id: input.id,
      name: input.name,
      bio: input.bio,
      avatarUrl: input.avatarUrl,
      sortOrder: input.sortOrder ?? nextSortOrder(players),
    });
}

export async function updatePlayer(
  id: string,
  input: PlayerInput,
): Promise<void> {
  await getDb()
    .update(players)
    .set({
      name: input.name,
      bio: input.bio,
      avatarUrl: input.avatarUrl,
      ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
    })
    .where(eq(players.id, id));
}

export async function getPlayerDeleteImpact(
  id: string,
): Promise<DeleteImpact[]> {
  const db = getDb();
  const [[s], [b], [m], [a], [e], [p], [v], [r]] = await db.batch([
    db
      .select({ n: count() })
      .from(taskScores)
      .where(eq(taskScores.playerId, id)),
    db
      .select({ n: count() })
      .from(bonusPoints)
      .where(eq(bonusPoints.playerId, id)),
    db
      .select({ n: count() })
      .from(teamMembers)
      .where(eq(teamMembers.playerId, id)),
    db
      .select({ n: count() })
      .from(playerAccounts)
      .where(eq(playerAccounts.playerId, id)),
    countSubmissions(eq(taskSubmissions.playerId, id)),
    db
      .select({ n: count() })
      .from(predictions)
      .where(
        or(eq(predictions.playerId, id), eq(predictions.pickedPlayerId, id)),
      ),
    db
      .select({ n: count() })
      .from(peoplesChoiceVotes)
      .where(eq(peoplesChoiceVotes.playerId, id)),
    db
      .select({ n: count() })
      .from(submissionReactions)
      .where(eq(submissionReactions.playerId, id)),
  ]);
  return [
    { label: "individual score", count: s.n },
    { label: "bonus / deduction", count: b.n },
    { label: "team membership", count: m.n },
    { label: "sign-in account link", count: a.n },
    { label: "task submission", count: e.n },
    { label: "winner prediction", count: p.n },
    { label: "People's Choice vote", count: v.n },
    { label: "reaction", count: r.n },
  ];
}

export async function deletePlayer(id: string): Promise<void> {
  await deleteWithSubmissions(
    eq(taskSubmissions.playerId, id),
    getDb().delete(players).where(eq(players.id, id)),
  );
}

// ── Teams ─────────────────────────────────────────────────────────────

export async function listTeams(): Promise<TeamRecord[]> {
  const db = getDb();
  const [teamRows, memberRows] = await db.batch([
    db.select().from(teams).orderBy(asc(teams.sortOrder)),
    db.select().from(teamMembers).orderBy(asc(teamMembers.sortOrder)),
  ]);
  return teamRows.map((team) => ({
    ...team,
    memberIds: memberRows
      .filter((m) => m.teamId === team.id)
      .map((m) => m.playerId),
  }));
}

export async function getTeam(id: string): Promise<TeamRecord | undefined> {
  return (await listTeams()).find((t) => t.id === id);
}

/**
 * Replaces a squad's members. Players already in another squad are moved
 * (a player belongs to at most one squad), all in the same transaction.
 */
function replaceMembers(teamId: string, memberIds: string[]) {
  const db = getDb();
  const removeExisting = db
    .delete(teamMembers)
    .where(
      memberIds.length > 0
        ? or(
            eq(teamMembers.teamId, teamId),
            inArray(teamMembers.playerId, memberIds),
          )
        : eq(teamMembers.teamId, teamId),
    );
  return memberIds.length > 0
    ? ([
        removeExisting,
        db.insert(teamMembers).values(
          memberIds.map((playerId, index) => ({
            teamId,
            playerId,
            sortOrder: index + 1,
          })),
        ),
      ] as const)
    : ([removeExisting] as const);
}

export async function createTeam(input: TeamInput): Promise<void> {
  const db = getDb();
  await db.batch([
    db.insert(teams).values({
      id: input.id,
      name: input.name,
      tagline: input.tagline,
      sortOrder: input.sortOrder ?? nextSortOrder(teams),
    }),
    ...replaceMembers(input.id, input.memberIds),
  ]);
}

export async function updateTeam(id: string, input: TeamInput): Promise<void> {
  const db = getDb();
  await db.batch([
    db
      .update(teams)
      .set({
        name: input.name,
        tagline: input.tagline,
        ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
      })
      .where(eq(teams.id, id)),
    ...replaceMembers(id, input.memberIds),
  ]);
}

export async function getTeamDeleteImpact(id: string): Promise<DeleteImpact[]> {
  const db = getDb();
  const [[s], [m], [e], [p]] = await db.batch([
    db.select({ n: count() }).from(teamScores).where(eq(teamScores.teamId, id)),
    db
      .select({ n: count() })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, id)),
    countSubmissions(eq(taskSubmissions.teamId, id)),
    db
      .select({ n: count() })
      .from(predictions)
      .where(eq(predictions.pickedTeamId, id)),
  ]);
  return [
    { label: "team score", count: s.n },
    { label: "team membership", count: m.n },
    { label: "squad submission", count: e.n },
    { label: "winner prediction", count: p.n },
  ];
}

export async function deleteTeam(id: string): Promise<void> {
  await deleteWithSubmissions(
    eq(taskSubmissions.teamId, id),
    getDb().delete(teams).where(eq(teams.id, id)),
  );
}

// ── Tasks ─────────────────────────────────────────────────────────────

export async function listTasks(): Promise<TaskRecord[]> {
  return getDb().select().from(tasks).orderBy(asc(tasks.weekNumber));
}

export async function getTask(id: string): Promise<TaskRecord | undefined> {
  const [row] = await getDb().select().from(tasks).where(eq(tasks.id, id));
  return row;
}

const taskValues = (input: TaskInput) => ({
  weekNumber: input.weekNumber,
  title: input.title,
  description: input.description,
  brief: input.brief,
  releaseDate: input.releaseDate,
  deadline: input.deadline,
  format: input.format,
  revealPassword: input.revealPassword,
  maxSubmissions: input.maxSubmissions,
  submissionKinds: input.submissionKinds,
});

export async function createTask(input: TaskInput): Promise<void> {
  await getDb()
    .insert(tasks)
    .values({ id: input.id, ...taskValues(input) });
}

export async function updateTask(id: string, input: TaskInput): Promise<void> {
  await getDb().update(tasks).set(taskValues(input)).where(eq(tasks.id, id));
}

/**
 * Reveals a password-protected task to everyone (or re-locks it). Re-locking
 * keeps visitors who already entered the password unlocked; change the
 * password to lock them out too.
 */
export async function setTaskRevealed(
  id: string,
  revealed: boolean,
): Promise<void> {
  await getDb()
    .update(tasks)
    .set({
      // Zone-less like the other task times, so store UK wall-clock time.
      revealedAt: revealed
        ? sql`date_trunc('second', timezone('Europe/London', now()))`
        : null,
    })
    .where(eq(tasks.id, id));
}

export async function getTaskDeleteImpact(id: string): Promise<DeleteImpact[]> {
  const db = getDb();
  const [[s], [t], [b], [e], [p], [v], [r]] = await db.batch([
    db.select({ n: count() }).from(taskScores).where(eq(taskScores.taskId, id)),
    db.select({ n: count() }).from(teamScores).where(eq(teamScores.taskId, id)),
    db
      .select({ n: count() })
      .from(bonusPoints)
      .where(eq(bonusPoints.taskId, id)),
    countSubmissions(eq(taskSubmissions.taskId, id)),
    db
      .select({ n: count() })
      .from(predictions)
      .where(eq(predictions.taskId, id)),
    db
      .select({ n: count() })
      .from(peoplesChoiceVotes)
      .where(eq(peoplesChoiceVotes.taskId, id)),
    db.select({ n: count() }).from(recaps).where(eq(recaps.taskId, id)),
  ]);
  return [
    { label: "individual score", count: s.n },
    { label: "team score", count: t.n },
    { label: "bonus / deduction", count: b.n },
    { label: "submission", count: e.n },
    { label: "winner prediction", count: p.n },
    { label: "People's Choice vote", count: v.n },
    { label: "recap write-up", count: r.n },
  ];
}

export async function deleteTask(id: string): Promise<void> {
  await deleteWithSubmissions(
    eq(taskSubmissions.taskId, id),
    getDb().delete(tasks).where(eq(tasks.id, id)),
  );
}

// ── Submissions ───────────────────────────────────────────────────────

/** Entry counts per task id, for the submissions index. */
export async function getSubmissionCountsByTask(): Promise<
  Map<string, { total: number; hidden: number }>
> {
  const rows = await getDb()
    .select({
      taskId: taskSubmissions.taskId,
      total: count(),
      hidden: count(taskSubmissions.hiddenAt),
    })
    .from(taskSubmissions)
    .groupBy(taskSubmissions.taskId);
  return new Map(
    rows.map(({ taskId, total, hidden }) => [taskId, { total, hidden }]),
  );
}

const submissionOf = (taskId: string, id: number) =>
  and(eq(taskSubmissions.taskId, taskId), eq(taskSubmissions.id, id));

/** Hides an entry from the public gallery (or shows it again). */
export async function setSubmissionHidden(
  taskId: string,
  id: number,
  hidden: boolean,
): Promise<void> {
  await getDb()
    .update(taskSubmissions)
    .set({ hiddenAt: hidden ? sql`now()` : null })
    .where(submissionOf(taskId, id));
}

/**
 * Records an entry on a player's behalf (e.g. one they sent in another way),
 * uploading its photo first. Unlike a player's own submission, the task's
 * entry limit and kinds don't apply. Throws `StorageError` if the upload
 * fails; returns the new entry's id.
 */
export async function addSubmissionForPlayer(
  taskId: string,
  owner: SubmissionOwnerRef,
  entry: AddEntryInput,
): Promise<number> {
  const base = {
    taskId,
    playerId: entry.playerId,
    teamId: owner.type === "team" ? owner.id : null,
  };
  const insert = (values: typeof taskSubmissions.$inferInsert) =>
    getDb()
      .insert(taskSubmissions)
      .values(values)
      .returning({ id: taskSubmissions.id })
      .then(([row]) => row.id);

  if (entry.kind === "text") {
    return insert({ ...base, kind: "text", text: entry.text });
  }
  const { bytes, type, caption } = entry.photo;
  const objectKey = submissionObjectKey(taskId, owner, type);
  await putObject(objectKey, bytes, type.contentType);
  try {
    return await insert({
      ...base,
      kind: "photo",
      text: caption,
      objectKey,
      contentType: type.contentType,
      sizeBytes: bytes.byteLength,
    });
  } catch (error) {
    // Don't leave an orphaned image when the entry wasn't recorded.
    await deleteObjects([objectKey]);
    throw error;
  }
}

/** Deletes an entry and its photo. */
export async function deleteSubmission(
  taskId: string,
  id: number,
): Promise<void> {
  const removed = await getDb()
    .delete(taskSubmissions)
    .where(submissionOf(taskId, id))
    .returning({ objectKey: taskSubmissions.objectKey });
  await deleteObjects(removed.flatMap((r) => r.objectKey ?? []));
}

// ── Scores ────────────────────────────────────────────────────────────

export async function getTaskScoreSheet(taskId: string) {
  const db = getDb();
  const [individual, team, bonuses] = await db.batch([
    db.select().from(taskScores).where(eq(taskScores.taskId, taskId)),
    db.select().from(teamScores).where(eq(teamScores.taskId, taskId)),
    db
      .select()
      .from(bonusPoints)
      .where(eq(bonusPoints.taskId, taskId))
      .orderBy(asc(bonusPoints.id)),
  ]);
  return { individual, team, bonuses };
}

/** Scored-row counts per task id, for the score index. */
export async function getScoreCountsByTask(): Promise<
  Map<string, { scores: number; bonuses: number }>
> {
  const db = getDb();
  const [individual, team, bonus] = await db.batch([
    db
      .select({ taskId: taskScores.taskId, n: count() })
      .from(taskScores)
      .groupBy(taskScores.taskId),
    db
      .select({ taskId: teamScores.taskId, n: count() })
      .from(teamScores)
      .groupBy(teamScores.taskId),
    db
      .select({ taskId: bonusPoints.taskId, n: count() })
      .from(bonusPoints)
      .groupBy(bonusPoints.taskId),
  ]);
  const counts = new Map<string, { scores: number; bonuses: number }>();
  const entry = (taskId: string) => {
    let value = counts.get(taskId);
    if (!value) counts.set(taskId, (value = { scores: 0, bonuses: 0 }));
    return value;
  };
  for (const row of [...individual, ...team]) entry(row.taskId).scores += row.n;
  for (const row of bonus) entry(row.taskId).bonuses += row.n;
  return counts;
}

// Score and bonus writes diff against what's stored rather than replacing it,
// so `createdAt` (when results first arrived, which drives notifications)
// survives edits, and every change is written to `score_audit_log` in the
// same transaction.

type AuditRow = typeof scoreAuditLog.$inferInsert;

const actorFields = (actor: AdminUser) => ({
  actorId: actor.id,
  actorName: actor.name || actor.email,
});

/** Runs the statements as one transaction; does nothing if there are none. */
async function runBatch(statements: BatchItem<"pg">[]): Promise<void> {
  if (statements.length === 0) return;
  await getDb().batch(statements as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
}

/** A score grid row keyed by player or team id. */
interface GridScore {
  id: string;
  points: number;
  comment: string | null;
}

interface ScoreDiff {
  created: GridScore[];
  updated: { before: GridScore; after: GridScore }[];
  deleted: GridScore[];
}

function diffScores(stored: GridScore[], submitted: GridScore[]): ScoreDiff {
  const before = new Map(stored.map((row) => [row.id, row]));
  const after = new Set(submitted.map((row) => row.id));
  const diff: ScoreDiff = { created: [], updated: [], deleted: [] };
  for (const row of submitted) {
    const previous = before.get(row.id);
    if (!previous) diff.created.push(row);
    else if (
      previous.points !== row.points ||
      previous.comment !== row.comment
    ) {
      diff.updated.push({ before: previous, after: row });
    }
  }
  diff.deleted = stored.filter((row) => !after.has(row.id));
  return diff;
}

function scoreAuditRows(
  actor: AdminUser,
  taskId: string,
  entity: "task_score" | "team_score",
  diff: ScoreDiff,
): AuditRow[] {
  const base = { ...actorFields(actor), taskId, entity };
  return [
    ...diff.created.map((row): AuditRow => ({
      ...base,
      action: "created",
      subjectId: row.id,
      pointsAfter: row.points,
      noteAfter: row.comment,
    })),
    ...diff.updated.map(({ before, after }): AuditRow => ({
      ...base,
      action: "updated",
      subjectId: after.id,
      pointsBefore: before.points,
      pointsAfter: after.points,
      noteBefore: before.comment,
      noteAfter: after.comment,
    })),
    ...diff.deleted.map((row): AuditRow => ({
      ...base,
      action: "deleted",
      subjectId: row.id,
      pointsBefore: row.points,
      noteBefore: row.comment,
    })),
  ];
}

/** Saves a week's individual scores: only changed rows are touched. */
export async function saveTaskScores(
  taskId: string,
  entries: TaskScoreInput[],
  actor: AdminUser,
): Promise<void> {
  const db = getDb();
  const stored = await db
    .select({
      id: taskScores.playerId,
      points: taskScores.points,
      comment: taskScores.comment,
    })
    .from(taskScores)
    .where(eq(taskScores.taskId, taskId));
  const diff = diffScores(
    stored,
    entries.map(({ playerId, points, comment }) => ({
      id: playerId,
      points,
      comment,
    })),
  );
  const ofTask = eq(taskScores.taskId, taskId);
  const statements: BatchItem<"pg">[] = [];
  if (diff.created.length > 0) {
    statements.push(
      db.insert(taskScores).values(
        diff.created.map(({ id, points, comment }) => ({
          taskId,
          playerId: id,
          points,
          comment,
        })),
      ),
    );
  }
  for (const { after } of diff.updated) {
    statements.push(
      db
        .update(taskScores)
        .set({ points: after.points, comment: after.comment })
        .where(and(ofTask, eq(taskScores.playerId, after.id))),
    );
  }
  if (diff.deleted.length > 0) {
    statements.push(
      db.delete(taskScores).where(
        and(
          ofTask,
          inArray(
            taskScores.playerId,
            diff.deleted.map((row) => row.id),
          ),
        ),
      ),
    );
  }
  const audit = scoreAuditRows(actor, taskId, "task_score", diff);
  if (audit.length > 0) statements.push(db.insert(scoreAuditLog).values(audit));
  await runBatch(statements);
}

/** Saves a team task's squad scores: only changed rows are touched. */
export async function saveTeamScores(
  taskId: string,
  entries: TeamScoreInput[],
  actor: AdminUser,
): Promise<void> {
  const db = getDb();
  const stored = await db
    .select({
      id: teamScores.teamId,
      points: teamScores.points,
      comment: teamScores.comment,
    })
    .from(teamScores)
    .where(eq(teamScores.taskId, taskId));
  const diff = diffScores(
    stored,
    entries.map(({ teamId, points, comment }) => ({
      id: teamId,
      points,
      comment,
    })),
  );
  const ofTask = eq(teamScores.taskId, taskId);
  const statements: BatchItem<"pg">[] = [];
  if (diff.created.length > 0) {
    statements.push(
      db.insert(teamScores).values(
        diff.created.map(({ id, points, comment }) => ({
          taskId,
          teamId: id,
          points,
          comment,
        })),
      ),
    );
  }
  for (const { after } of diff.updated) {
    statements.push(
      db
        .update(teamScores)
        .set({ points: after.points, comment: after.comment })
        .where(and(ofTask, eq(teamScores.teamId, after.id))),
    );
  }
  if (diff.deleted.length > 0) {
    statements.push(
      db.delete(teamScores).where(
        and(
          ofTask,
          inArray(
            teamScores.teamId,
            diff.deleted.map((row) => row.id),
          ),
        ),
      ),
    );
  }
  const audit = scoreAuditRows(actor, taskId, "team_score", diff);
  if (audit.length > 0) statements.push(db.insert(scoreAuditLog).values(audit));
  await runBatch(statements);
}

export async function addBonus(
  taskId: string,
  input: BonusInput,
  actor: AdminUser,
): Promise<void> {
  const { actorId, actorName } = actorFields(actor);
  // One statement, so the audit row can reference the new bonus's id.
  await getDb().execute(sql`
    with added as (
      insert into ${bonusPoints} (task_id, player_id, points, reason)
      values (${taskId}, ${input.playerId}, ${input.points}, ${input.reason})
      returning id, player_id, points, reason
    )
    insert into ${scoreAuditLog}
      (actor_id, actor_name, task_id, entity, action, subject_id, bonus_id,
       points_after, note_after)
    select ${actorId}, ${actorName}, ${taskId}, 'bonus', 'created',
      player_id, id, points, reason
    from added
  `);
}

async function getBonusRow(
  taskId: string,
  id: number,
): Promise<BonusRecord | undefined> {
  const [row] = await getDb()
    .select()
    .from(bonusPoints)
    .where(and(eq(bonusPoints.id, id), eq(bonusPoints.taskId, taskId)));
  return row;
}

export async function updateBonus(
  taskId: string,
  id: number,
  input: BonusInput,
  actor: AdminUser,
): Promise<void> {
  const before = await getBonusRow(taskId, id);
  if (
    !before ||
    (before.playerId === input.playerId &&
      before.points === input.points &&
      before.reason === input.reason)
  ) {
    return;
  }
  const db = getDb();
  const base = { ...actorFields(actor), taskId, entity: "bonus" as const };
  const moved = before.playerId !== input.playerId;
  // Moving a bonus to someone else is, to both players, a removal and a new
  // award, so it's logged that way and the new recipient gets notified.
  const audit: AuditRow[] = moved
    ? [
        {
          ...base,
          action: "deleted",
          subjectId: before.playerId,
          bonusId: id,
          pointsBefore: before.points,
          noteBefore: before.reason,
        },
        {
          ...base,
          action: "created",
          subjectId: input.playerId,
          bonusId: id,
          pointsAfter: input.points,
          noteAfter: input.reason,
        },
      ]
    : [
        {
          ...base,
          action: "updated",
          subjectId: input.playerId,
          bonusId: id,
          pointsBefore: before.points,
          pointsAfter: input.points,
          noteBefore: before.reason,
          noteAfter: input.reason,
        },
      ];
  await runBatch([
    db
      .update(bonusPoints)
      .set({ ...input, ...(moved && { createdAt: sql`now()` }) })
      .where(and(eq(bonusPoints.id, id), eq(bonusPoints.taskId, taskId))),
    db.insert(scoreAuditLog).values(audit),
  ]);
}

export async function deleteBonus(
  taskId: string,
  id: number,
  actor: AdminUser,
): Promise<void> {
  const before = await getBonusRow(taskId, id);
  if (!before) return;
  const db = getDb();
  await runBatch([
    db
      .delete(bonusPoints)
      .where(and(eq(bonusPoints.id, id), eq(bonusPoints.taskId, taskId))),
    db.insert(scoreAuditLog).values({
      ...actorFields(actor),
      taskId,
      entity: "bonus",
      action: "deleted",
      subjectId: before.playerId,
      bonusId: id,
      pointsBefore: before.points,
      noteBefore: before.reason,
    }),
  ]);
}

/** A week's score and bonus history, newest change first. */
export async function getScoreAuditLog(
  taskId: string,
  limit = 100,
): Promise<ScoreAuditEntry[]> {
  const rows = await getDb()
    .select()
    .from(scoreAuditLog)
    .where(eq(scoreAuditLog.taskId, taskId))
    .orderBy(desc(scoreAuditLog.at), desc(scoreAuditLog.id))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    at: timestamptzToIso(row.at),
    actorName: row.actorName,
    entity: row.entity,
    action: row.action,
    subjectId: row.subjectId,
    ...(row.pointsBefore !== null && { pointsBefore: row.pointsBefore }),
    ...(row.pointsAfter !== null && { pointsAfter: row.pointsAfter }),
    ...(row.noteBefore !== null && { noteBefore: row.noteBefore }),
    ...(row.noteAfter !== null && { noteAfter: row.noteAfter }),
  }));
}

// ── Polls ─────────────────────────────────────────────────────────────

export async function getPoll(id: string): Promise<PollRecord | undefined> {
  const db = getDb();
  const [[poll], options] = await db.batch([
    db.select().from(polls).where(eq(polls.id, id)),
    db
      .select()
      .from(pollOptions)
      .where(eq(pollOptions.pollId, id))
      .orderBy(asc(pollOptions.sortOrder), asc(pollOptions.id)),
  ]);
  return poll && { ...poll, options };
}

const pollValues = (input: PollInput) => ({
  question: input.question,
  description: input.description,
  kind: input.kind,
  minChoices: input.minChoices,
  maxChoices: input.maxChoices,
  opensAt: input.opensAt,
  closesAt: input.closesAt,
  resultsVisibility: input.resultsVisibility,
  allowVoteChange: input.allowVoteChange,
  anonymous: input.anonymous,
  showOnHomeDays: input.showOnHomeDays,
  published: input.published,
  voteBonusPoints: input.voteBonusPoints,
  bonusTaskId: input.bonusTaskId,
});

export async function createPoll(input: PollInput): Promise<void> {
  const db = getDb();
  await db.batch([
    db.insert(polls).values({ id: input.id, ...pollValues(input) }),
    db.insert(pollOptions).values(
      input.options.map((option, index) => ({
        pollId: input.id,
        label: option.label,
        sortOrder: index + 1,
      })),
    ),
  ]);
}

/**
 * Saves a poll and its options in one transaction. Existing options keep
 * their id (and votes) when renamed or reordered; options left out are
 * deleted along with their votes.
 */
export async function updatePoll(id: string, input: PollInput): Promise<void> {
  const db = getDb();
  const keptIds = input.options.flatMap((o) => (o.id ? [o.id] : []));
  const added = input.options
    .map((option, index) => ({ option, sortOrder: index + 1 }))
    .filter(({ option }) => !option.id);
  await db.batch([
    db.update(polls).set(pollValues(input)).where(eq(polls.id, id)),
    db
      .delete(pollOptions)
      .where(
        keptIds.length > 0
          ? and(eq(pollOptions.pollId, id), notInArray(pollOptions.id, keptIds))
          : eq(pollOptions.pollId, id),
      ),
    ...input.options.flatMap((option, index) =>
      option.id
        ? [
            db
              .update(pollOptions)
              .set({ label: option.label, sortOrder: index + 1 })
              .where(
                and(eq(pollOptions.id, option.id), eq(pollOptions.pollId, id)),
              ),
          ]
        : [],
    ),
    ...(added.length > 0
      ? [
          db.insert(pollOptions).values(
            added.map(({ option, sortOrder }) => ({
              pollId: id,
              label: option.label,
              sortOrder,
            })),
          ),
        ]
      : []),
  ]);
}

/** Moves a poll's opening or closing time (the "open/close now" actions). */
export async function setPollWindow(
  id: string,
  window: { opensAt?: string; closesAt?: string },
): Promise<void> {
  await getDb().update(polls).set(window).where(eq(polls.id, id));
}

export async function setPollPublished(
  id: string,
  published: boolean,
): Promise<void> {
  await getDb().update(polls).set({ published }).where(eq(polls.id, id));
}

/** Clears every vote on a poll (e.g. after fixing a mistake in it). */
export async function resetPollVotes(id: string): Promise<void> {
  await getDb().delete(pollVotes).where(eq(pollVotes.pollId, id));
}

export async function getPollVoteImpact(id: string): Promise<DeleteImpact[]> {
  const [{ n }] = await getDb()
    .select({ n: countDistinct(pollVotes.playerId) })
    .from(pollVotes)
    .where(eq(pollVotes.pollId, id));
  return [{ label: "player ballot", count: n }];
}

export async function getPollDeleteImpact(id: string): Promise<DeleteImpact[]> {
  const db = getDb();
  const [[o], [v]] = await db.batch([
    db
      .select({ n: count() })
      .from(pollOptions)
      .where(eq(pollOptions.pollId, id)),
    db
      .select({ n: countDistinct(pollVotes.playerId) })
      .from(pollVotes)
      .where(eq(pollVotes.pollId, id)),
  ]);
  return [
    { label: "option", count: o.n },
    { label: "player ballot", count: v.n },
  ];
}

export async function deletePoll(id: string): Promise<void> {
  await getDb().delete(polls).where(eq(polls.id, id));
}

// ── Results night ─────────────────────────────────────────────────────

/**
 * Holds a week's results back from the public site for a live reveal, or
 * releases the hold without a show (which, like publishing, dates the
 * week's notifications from now). Either way the reveal starts over.
 */
export async function setResultsHeld(
  taskId: string,
  held: boolean,
): Promise<void> {
  await getDb()
    .update(tasks)
    .set(
      held
        ? { resultsHeldAt: sql`now()`, resultsRevealCount: 0 }
        : {
            resultsHeldAt: null,
            resultsRevealCount: 0,
            resultsPublishedAt: sql`case when ${tasks.resultsHeldAt} is not null then now() else ${tasks.resultsPublishedAt} end`,
          },
    )
    .where(eq(tasks.id, taskId));
}

/**
 * Moves the live reveal on (or back) by `step` results, never below zero
 * or past `total`. Only held weeks are touched.
 */
export async function stepResultsReveal(
  taskId: string,
  step: number,
  total: number,
): Promise<void> {
  await getDb()
    .update(tasks)
    .set({
      resultsRevealCount: sql`least(greatest(${tasks.resultsRevealCount} + ${step}, 0), ${total})`,
    })
    .where(and(eq(tasks.id, taskId), sql`${tasks.resultsHeldAt} is not null`));
}

/**
 * Ends the show: the held results go out across the site, dated now so the
 * "results are in" notifications arrive after the reveal, not before.
 */
export async function publishHeldResults(taskId: string): Promise<void> {
  await getDb()
    .update(tasks)
    .set({
      resultsHeldAt: null,
      resultsRevealCount: 0,
      resultsPublishedAt: sql`now()`,
    })
    .where(and(eq(tasks.id, taskId), sql`${tasks.resultsHeldAt} is not null`));
}

// ── Recaps ────────────────────────────────────────────────────────────

export async function listRecaps(): Promise<RecapRecord[]> {
  return getDb().select().from(recaps);
}

export async function getRecap(
  taskId: string,
): Promise<RecapRecord | undefined> {
  const [row] = await getDb()
    .select()
    .from(recaps)
    .where(eq(recaps.taskId, taskId));
  return row;
}

/** Saves a week's write-up; an all-blank form removes it. */
export async function saveRecap(
  taskId: string,
  input: RecapInput,
): Promise<void> {
  const db = getDb();
  if (Object.values(input).every((v) => v === null)) {
    await db.delete(recaps).where(eq(recaps.taskId, taskId));
    return;
  }
  await db
    .insert(recaps)
    .values({ taskId, ...input })
    .onConflictDoUpdate({ target: recaps.taskId, set: input });
}

export async function deleteRecap(taskId: string): Promise<void> {
  await getDb().delete(recaps).where(eq(recaps.taskId, taskId));
}

// ── Changelog ─────────────────────────────────────────────────────────

export async function listChangelog(): Promise<ChangelogRecord[]> {
  return getDb()
    .select()
    .from(changelogEntries)
    .orderBy(desc(changelogEntries.date), desc(changelogEntries.createdAt));
}

export async function getChangelogEntry(
  id: string,
): Promise<ChangelogRecord | undefined> {
  const [row] = await getDb()
    .select()
    .from(changelogEntries)
    .where(eq(changelogEntries.id, id));
  return row;
}

const changelogValues = (input: ChangelogInput) => ({
  date: input.date,
  title: input.title,
  description: input.description,
  category: input.category,
});

export async function createChangelogEntry(
  input: ChangelogInput,
): Promise<void> {
  await getDb()
    .insert(changelogEntries)
    .values({ id: input.id, ...changelogValues(input) });
}

export async function updateChangelogEntry(
  id: string,
  input: ChangelogInput,
): Promise<void> {
  await getDb()
    .update(changelogEntries)
    .set(changelogValues(input))
    .where(eq(changelogEntries.id, id));
}

export async function deleteChangelogEntry(id: string): Promise<void> {
  await getDb().delete(changelogEntries).where(eq(changelogEntries.id, id));
}

// ── Errors ────────────────────────────────────────────────────────────

const CONSTRAINT_MESSAGES: Record<string, string> = {
  players_pkey: "A player with that id already exists.",
  teams_pkey: "A team with that id already exists.",
  tasks_pkey: "A task with that id already exists.",
  tasks_week_number_unique: "Another task already uses that week number.",
  tasks_deadline_after_release: "The deadline must be after the release date.",
  team_members_player_id_unique: "A player can only be in one team.",
  player_accounts_email_unique: "Another player already uses that email.",
  player_accounts_email_lower: "Use a lower-case email address.",
  polls_pkey: "A poll with that id already exists.",
  polls_closes_after_opens: "The poll must close after it opens.",
  polls_max_choices_at_least_min: "The maximum can't be below the minimum.",
  polls_vote_bonus_points_range: "Voting bonus must be between 0 and 100.",
  polls_bonus_task_id_tasks_id_fk: "That bonus week no longer exists.",
  changelog_entries_pkey: "A changelog entry with that id already exists.",
  recaps_moment_player_id_players_id_fk: "That player no longer exists.",
};

/**
 * Turns a Postgres constraint violation into a message an admin can act on.
 * Returns `undefined` for anything unexpected so callers can rethrow.
 */
export function describeWriteError(error: unknown): string | undefined {
  for (let e: unknown = error; e && typeof e === "object";) {
    const { code, constraint } = e as { code?: string; constraint?: string };
    if (constraint && CONSTRAINT_MESSAGES[constraint]) {
      return CONSTRAINT_MESSAGES[constraint];
    }
    if (code === "23505") return "That value is already in use.";
    if (code === "23503") {
      return "A referenced player, team or task no longer exists.";
    }
    if (code === "23514") return "A value is outside the allowed range.";
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}
