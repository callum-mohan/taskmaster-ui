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
  coinAdjustments,
  coinPurchases,
  crateOpens,
  eggGifts,
  equippedItems,
  featureFlags,
  itemGifts,
  marketListings,
  marketOffers,
  marketSales,
  miniTaskCompletions,
  miniTasks,
  powerUpUses,
  shopItems,
  playerAccounts,
  players,
  pollOptions,
  polls,
  pollVotes,
  peoplesChoiceVotes,
  predictions,
  recaps,
  scoreAuditLog,
  seasons,
  submissionReactions,
  taskScores,
  taskSubmissions,
  tasks,
  teamMembers,
  teamScores,
  teams,
  skillUnlocks,
  wishes,
} from "../db/schema";
import type { BatchItem } from "drizzle-orm/batch";
import type {
  AdminUser,
  AdminWish,
  FeatureFlagKey,
  FeatureFlagView,
  Page,
  ScoreAuditEntry,
  SubmissionOwnerRef,
  WeekScoreAuditEntry,
  WeekCounts,
} from "../types";
import { EMPTY_WEEK_COUNTS } from "./week-progress";
import { featureFlagViews } from "./feature-flags";
import { lockWallet } from "./shop";
import { timestamptzToIso } from "../lib/time";
import { LIST_PAGE_SIZE, pageInfo } from "../lib/pagination";
import { deleteObjects, putObject } from "../lib/storage";
import { submissionObjectKey } from "../lib/submission-forms";
import type {
  AddEntryInput,
  BonusInput,
  ChangelogInput,
  CoinAdjustmentInput,
  EggGiftInput,
  ItemGiftInput,
  MiniTaskInput,
  WishDecisionInput,
  PlayerInput,
  PollInput,
  RecapInput,
  SeasonInput,
  ShopItemInput,
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
export type ShopItemRecord = typeof shopItems.$inferSelect;
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

export async function listPlayers(seasonId?: string): Promise<PlayerRecord[]> {
  return getDb()
    .select()
    .from(players)
    .where(seasonId === undefined ? undefined : eq(players.seasonId, seasonId))
    .orderBy(asc(players.sortOrder));
}

export async function getPlayer(id: string): Promise<PlayerRecord | undefined> {
  const [row] = await getDb().select().from(players).where(eq(players.id, id));
  return row;
}

/**
 * Creates a player and, given an email, their (not yet provisioned) account
 * invite in the same transaction. The sign-in account itself is created in
 * Neon Auth afterwards and linked with `linkPlayerAccount`.
 */
export async function createPlayer(
  seasonId: string,
  input: PlayerInput & { email?: string | null },
): Promise<void> {
  const db = getDb();
  const insertPlayer = db.insert(players).values({
    id: input.id,
    seasonId,
    name: input.name,
    bio: input.bio,
    avatarUrl: input.avatarUrl,
    sortOrder: input.sortOrder ?? nextSortOrder(players),
  });
  if (!input.email) {
    await insertPlayer;
    return;
  }
  await db.batch([
    insertPlayer,
    db
      .insert(playerAccounts)
      .values({ playerId: input.id, email: input.email }),
  ]);
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
  const [[s], [b], [m], [a], [e], [p], [v], [r], [c], [g], [o], [i], [x], [k]] =
    await db.batch([
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
      db
        .select({ n: count() })
        .from(coinPurchases)
        .where(eq(coinPurchases.playerId, id)),
      db
        .select({ n: count() })
        .from(coinAdjustments)
        .where(eq(coinAdjustments.playerId, id)),
      db
        .select({ n: count() })
        .from(crateOpens)
        .where(eq(crateOpens.playerId, id)),
      db
        .select({ n: count() })
        .from(itemGifts)
        .where(eq(itemGifts.playerId, id)),
      db.select({ n: count() }).from(eggGifts).where(eq(eggGifts.playerId, id)),
      db
        .select({ n: count() })
        .from(skillUnlocks)
        .where(eq(skillUnlocks.playerId, id)),
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
    { label: "Clim Coin purchase", count: c.n },
    { label: "Clim Coin grant / deduction", count: g.n },
    { label: "mystery egg cracked", count: o.n },
    { label: "gifted item", count: i.n },
    { label: "gifted egg", count: x.n },
    { label: "skill tree unlock", count: k.n },
  ];
}

export async function deletePlayer(id: string): Promise<void> {
  await deleteWithSubmissions(
    eq(taskSubmissions.playerId, id),
    getDb().delete(players).where(eq(players.id, id)),
  );
}

// ── Seasons ───────────────────────────────────────────────────────────

export async function createSeason(input: SeasonInput): Promise<void> {
  await getDb().insert(seasons).values({ id: input.id, name: input.name });
}

export async function updateSeason(
  id: string,
  input: Pick<SeasonInput, "name">,
): Promise<void> {
  await getDb()
    .update(seasons)
    .set({ name: input.name })
    .where(eq(seasons.id, id));
}

/** Makes `id` the season the public site shows (exactly one is current). */
export async function setCurrentSeason(id: string): Promise<void> {
  const db = getDb();
  await db.batch([
    db
      .update(seasons)
      .set({ isCurrent: false })
      .where(and(eq(seasons.isCurrent, true), sql`${seasons.id} <> ${id}`)),
    db.update(seasons).set({ isCurrent: true }).where(eq(seasons.id, id)),
  ]);
}

/**
 * Closes a season, crowning its champion, or reopens it. A closed season's
 * weeks, roster and scores are read-only (see the middleware). Closing also
 * takes its open marketplace listings down and declines their pending
 * offers, so items go back to their sellers and offered coins are freed.
 */
export async function setSeasonClosed(
  id: string,
  closed: boolean,
): Promise<void> {
  const db = getDb();
  const close = db
    .update(seasons)
    .set({ closedAt: closed ? sql`now()` : null })
    .where(eq(seasons.id, id));
  if (!closed) {
    await close;
    return;
  }
  await db.batch([
    close,
    db.execute(sql`
      update ${marketOffers} o
      set status = 'declined', decided_at = now()
      from ${marketListings} l
      where l.id = o.listing_id
        and l.season_id = ${id}
        and l.status = 'open'
        and o.status = 'pending'`),
    db.execute(sql`
      update ${marketListings}
      set status = 'cancelled', closed_at = now()
      where season_id = ${id} and status = 'open'`),
  ]);
}

/** What still belongs to a season; only an empty season can be deleted. */
export async function getSeasonContents(id: string): Promise<DeleteImpact[]> {
  const db = getDb();
  const [[p], [t], [k]] = await db.batch([
    db.select({ n: count() }).from(players).where(eq(players.seasonId, id)),
    db.select({ n: count() }).from(teams).where(eq(teams.seasonId, id)),
    db.select({ n: count() }).from(tasks).where(eq(tasks.seasonId, id)),
  ]);
  return [
    { label: "player", count: p.n },
    { label: "squad", count: t.n },
    { label: "week", count: k.n },
  ];
}

/** Deletes an empty season that isn't current. */
export async function deleteSeason(id: string): Promise<void> {
  await getDb()
    .delete(seasons)
    .where(and(eq(seasons.id, id), eq(seasons.isCurrent, false)));
}

// ── Teams ─────────────────────────────────────────────────────────────

export async function listTeams(seasonId?: string): Promise<TeamRecord[]> {
  const db = getDb();
  const [teamRows, memberRows] = await db.batch([
    db
      .select()
      .from(teams)
      .where(seasonId === undefined ? undefined : eq(teams.seasonId, seasonId))
      .orderBy(asc(teams.sortOrder)),
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
function replaceMembers(teamId: string, seasonId: string, memberIds: string[]) {
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
            seasonId,
            sortOrder: index + 1,
          })),
        ),
      ] as const)
    : ([removeExisting] as const);
}

export async function createTeam(
  seasonId: string,
  input: TeamInput,
): Promise<void> {
  const db = getDb();
  await db.batch([
    db.insert(teams).values({
      id: input.id,
      seasonId,
      name: input.name,
      tagline: input.tagline,
      sortOrder: input.sortOrder ?? nextSortOrder(teams),
    }),
    ...replaceMembers(input.id, seasonId, input.memberIds),
  ]);
}

export async function updateTeam(
  team: Pick<TeamRecord, "id" | "seasonId">,
  input: TeamInput,
): Promise<void> {
  const { id } = team;
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
    ...replaceMembers(id, team.seasonId, input.memberIds),
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
  hint: input.hint,
  maxSubmissions: input.maxSubmissions,
  submissionKinds: input.submissionKinds,
});

export async function createTask(
  seasonId: string,
  input: TaskInput,
): Promise<void> {
  await getDb()
    .insert(tasks)
    .values({ id: input.id, seasonId, ...taskValues(input) });
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

/** Every week's scores, bonuses, entries and recap in one round trip. */
export async function getWeekCounts(): Promise<Map<string, WeekCounts>> {
  const db = getDb();
  const [individual, team, bonus, entries, written] = await db.batch([
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
    db
      .select({
        taskId: taskSubmissions.taskId,
        n: count(),
        hidden: count(taskSubmissions.hiddenAt),
      })
      .from(taskSubmissions)
      .groupBy(taskSubmissions.taskId),
    db.select({ taskId: recaps.taskId }).from(recaps),
  ]);
  const counts = new Map<string, WeekCounts>();
  const entry = (taskId: string) => {
    let value = counts.get(taskId);
    if (!value) counts.set(taskId, (value = { ...EMPTY_WEEK_COUNTS }));
    return value;
  };
  for (const row of individual) entry(row.taskId).individualScores = row.n;
  for (const row of team) entry(row.taskId).teamScores = row.n;
  for (const row of bonus) entry(row.taskId).bonuses = row.n;
  for (const row of entries) {
    entry(row.taskId).entries = row.n;
    entry(row.taskId).hiddenEntries = row.hidden;
  }
  for (const row of written) entry(row.taskId).recapWritten = true;
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

/** One page of a week's score and bonus history, newest change first. */
export async function getScoreAuditLog(
  taskId: string,
  page = 1,
  pageSize = LIST_PAGE_SIZE,
): Promise<Page<ScoreAuditEntry>> {
  const db = getDb();
  const ofTask = eq(scoreAuditLog.taskId, taskId);
  const selectPage = (n: number) =>
    db
      .select()
      .from(scoreAuditLog)
      .where(ofTask)
      .orderBy(desc(scoreAuditLog.at), desc(scoreAuditLog.id))
      .limit(pageSize)
      .offset((n - 1) * pageSize);
  const [[counted], requested] = await db.batch([
    db.select({ n: count() }).from(scoreAuditLog).where(ofTask),
    selectPage(Math.max(1, page)),
  ]);
  const info = pageInfo(counted?.n ?? 0, page, pageSize);
  // Past the last page: show the last page instead.
  const rows =
    info.page === page || info.total === 0
      ? requested
      : await selectPage(info.page);
  return { ...info, items: rows.map(mapAuditRow) };
}

function mapAuditRow(row: typeof scoreAuditLog.$inferSelect): ScoreAuditEntry {
  return {
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
  };
}

/**
 * Every score and bonus change on `taskIds` (a season's weeks), newest
 * first, for the activity log.
 */
export async function listScoreAuditForWeeks(
  taskIds: readonly string[],
): Promise<WeekScoreAuditEntry[]> {
  if (taskIds.length === 0) return [];
  const rows = await getDb()
    .select()
    .from(scoreAuditLog)
    .where(inArray(scoreAuditLog.taskId, [...taskIds]))
    .orderBy(desc(scoreAuditLog.at), desc(scoreAuditLog.id));
  return rows.map((row) => ({ ...mapAuditRow(row), taskId: row.taskId }));
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

// ── Feature flags ─────────────────────────────────────────────────────

/** Every feature flag with its state and who last changed it. */
export async function listFeatureFlags(): Promise<FeatureFlagView[]> {
  return featureFlagViews(await getDb().select().from(featureFlags));
}

/** Turns a feature on or off, recording who did. */
export async function setFeatureFlag(
  key: FeatureFlagKey,
  enabled: boolean,
  actor: AdminUser,
): Promise<void> {
  const fields = { enabled, ...actorFields(actor) };
  await getDb()
    .insert(featureFlags)
    .values({ key, ...fields })
    .onConflictDoUpdate({
      target: featureFlags.key,
      set: { ...fields, updatedAt: sql`now()` },
    });
}

// ── Clim Coin ─────────────────────────────────────────────────────────

/** The catalogue in display order, with how many times each was bought. */
export async function listShopItems(): Promise<
  (ShopItemRecord & { purchases: number })[]
> {
  const db = getDb();
  const [items, counts] = await db.batch([
    db
      .select()
      .from(shopItems)
      .orderBy(
        asc(shopItems.category),
        asc(shopItems.sortOrder),
        asc(shopItems.name),
      ),
    db
      .select({ itemId: coinPurchases.itemId, n: count() })
      .from(coinPurchases)
      .groupBy(coinPurchases.itemId),
  ]);
  const bought = new Map(counts.map((c) => [c.itemId, c.n]));
  return items.map((item) => ({
    ...item,
    purchases: bought.get(item.id) ?? 0,
  }));
}

export async function getShopItem(
  id: string,
): Promise<ShopItemRecord | undefined> {
  const [row] = await getDb()
    .select()
    .from(shopItems)
    .where(eq(shopItems.id, id));
  return row;
}

export async function createShopItem(input: ShopItemInput): Promise<void> {
  await getDb()
    .insert(shopItems)
    .values({ ...input, sortOrder: input.sortOrder ?? 0 });
}

/**
 * Saves an item's editable fields. Its id, category, cosmetic kind and
 * power-up are fixed once created, so owned items keep their slot and effect.
 */
export async function updateShopItem(
  id: string,
  input: ShopItemInput,
): Promise<void> {
  await getDb()
    .update(shopItems)
    .set({
      name: input.name,
      description: input.description,
      price: input.price,
      imageUrl: input.imageUrl,
      cosmeticValue: input.cosmeticValue,
      available: input.available,
      crateOnly: input.crateOnly,
      crateId: input.crateId,
      availableFrom: input.availableFrom,
      availableUntil: input.availableUntil,
      ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
    })
    .where(eq(shopItems.id, id));
}

export async function getShopItemPurchaseCount(id: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(coinPurchases)
    .where(eq(coinPurchases.itemId, id));
  return row?.n ?? 0;
}

/** Deletes an item nobody bought (owned items can only be retired). */
export async function deleteShopItem(id: string): Promise<void> {
  await getDb().delete(shopItems).where(eq(shopItems.id, id));
}

/** A player's Clim Coin grants and deductions, newest first. */
export async function listCoinAdjustments(playerId: string) {
  return getDb()
    .select()
    .from(coinAdjustments)
    .where(eq(coinAdjustments.playerId, playerId))
    .orderBy(desc(coinAdjustments.id));
}

export async function addCoinAdjustment(
  playerId: string,
  input: CoinAdjustmentInput,
  actor: AdminUser,
): Promise<void> {
  await getDb()
    .insert(coinAdjustments)
    .values({ playerId, ...input, ...actorFields(actor) });
}

export async function deleteCoinAdjustment(
  playerId: string,
  id: number,
): Promise<void> {
  await getDb()
    .delete(coinAdjustments)
    .where(
      and(eq(coinAdjustments.id, id), eq(coinAdjustments.playerId, playerId)),
    );
}

/**
 * Gifts a player a shop item: owned through a zero-price purchase, written
 * with its `item_gifts` row in one statement under the player's wallet lock.
 * Any catalogue item can be gifted (retired, egg-exclusive or out of its
 * sale window too), but not one they already own, nor a power-up whose
 * effect they've had this season (each effect is used once a season, so a
 * second charge would be dead). Returns whether it was gifted.
 */
export async function giftItem(
  playerId: string,
  input: ItemGiftInput,
  actor: AdminUser,
): Promise<boolean> {
  const { actorId, actorName } = actorFields(actor);
  const db = getDb();
  const [, gifted] = await db.batch([
    db.execute(lockWallet(playerId)),
    db.execute(sql`
      with given as (
        insert into ${coinPurchases} (player_id, item_id, price)
        select player.id, item.id, 0
        from ${players} player
        cross join ${shopItems} item
        where player.id = ${playerId}
          and item.id = ${input.itemId}
          and not exists (
            select 1 from ${coinPurchases} owned
            join ${shopItems} owned_item on owned_item.id = owned.item_id
            where owned.player_id = player.id
              and (
                owned.item_id = item.id
                or owned_item.power_up = item.power_up
              )
          )
        returning id, item_id
      )
      insert into ${itemGifts}
        (player_id, item_id, purchase_id, reason, actor_id, actor_name)
      select ${playerId}, given.item_id, given.id, ${input.reason},
        ${actorId}, ${actorName}
      from given
      returning id`),
  ]);
  return gifted.rows.length > 0;
}

/**
 * Takes back an item an admin gifted: its free purchase goes (and the gift
 * row with it), and the player stops wearing it. A power-up charge already
 * used on a week is kept (revoke the use in the week's judge tab first).
 * Returns whether it was taken back.
 */
export async function revokeItemGift(
  playerId: string,
  giftId: number,
): Promise<boolean> {
  const db = getDb();
  const [revoked] = await db.batch([
    db.execute(sql`
      delete from ${coinPurchases}
      where id = (
          select purchase_id from ${itemGifts}
          where id = ${giftId} and player_id = ${playerId}
        )
        and not exists (
          select 1 from ${powerUpUses} used
          where used.purchase_id = ${coinPurchases.id}
        )
        and not exists (
          select 1 from ${wishes} made
          where made.purchase_id = ${coinPurchases.id}
        )
        and not exists (
          select 1 from ${marketSales} sold
          where sold.source_purchase_id = ${coinPurchases.id}
        )
      returning id`),
    db.delete(equippedItems).where(
      and(
        eq(equippedItems.playerId, playerId),
        sql`not exists (
            select 1 from ${coinPurchases} owned
            where owned.player_id = ${equippedItems.playerId}
              and owned.item_id = ${equippedItems.itemId}
          )`,
      ),
    ),
  ]);
  return revoked.rows.length > 0;
}

/**
 * Gifts a player a mystery egg (`crateId`, any egg, on sale or not) to
 * crack from their inventory, free. Returns whether it was gifted (the
 * player still exists).
 */
export async function giftEgg(
  playerId: string,
  input: EggGiftInput,
  actor: AdminUser,
): Promise<boolean> {
  const { actorId, actorName } = actorFields(actor);
  const result = await getDb().execute(sql`
    insert into ${eggGifts}
      (player_id, crate_id, reason, actor_id, actor_name)
    select player.id, ${input.crateId}, ${input.reason}, ${actorId},
      ${actorName}
    from ${players} player
    where player.id = ${playerId}
    returning id`);
  return result.rows.length > 0;
}

/**
 * Takes back a gifted egg the player hasn't cracked yet. Returns whether it
 * was taken back (a cracked one stays: what it hatched is theirs).
 */
export async function revokeEggGift(
  playerId: string,
  giftId: number,
): Promise<boolean> {
  const db = getDb();
  const [, revoked] = await db.batch([
    db.execute(lockWallet(playerId)),
    db.execute(sql`
      delete from ${eggGifts}
      where id = ${giftId}
        and player_id = ${playerId}
        and crate_open_id is null
      returning id`),
  ]);
  return revoked.rows.length > 0;
}

// ── Wishes ────────────────────────────────────────────────────────────

/** How many decided wishes the dashboard shows under the pending ones. */
const RECENT_WISHES = 5;

/**
 * Wishes for the admin dashboard, from every season: all pending ones
 * (oldest first, so they're answered in order) and the newest few decided.
 */
export async function listWishes(): Promise<{
  pending: AdminWish[];
  recent: AdminWish[];
}> {
  const db = getDb();
  const columns = {
    id: wishes.id,
    playerId: wishes.playerId,
    playerName: players.name,
    wish: wishes.wish,
    status: wishes.status,
    response: wishes.response,
    deciderName: wishes.deciderName,
    decidedAt: wishes.decidedAt,
    createdAt: wishes.createdAt,
  };
  const [pending, recent] = await db.batch([
    db
      .select(columns)
      .from(wishes)
      .innerJoin(players, eq(players.id, wishes.playerId))
      .where(eq(wishes.status, "pending"))
      .orderBy(asc(wishes.id)),
    db
      .select(columns)
      .from(wishes)
      .innerJoin(players, eq(players.id, wishes.playerId))
      .where(notInArray(wishes.status, ["pending"]))
      .orderBy(desc(wishes.decidedAt), desc(wishes.id))
      .limit(RECENT_WISHES),
  ]);
  const toWish = (row: (typeof pending)[number]): AdminWish => ({
    id: row.id,
    playerId: row.playerId,
    playerName: row.playerName,
    wish: row.wish,
    status: row.status,
    ...(row.response !== null && { response: row.response }),
    ...(row.deciderName !== null && { deciderName: row.deciderName }),
    ...(row.decidedAt !== null && {
      decidedAt: timestamptzToIso(row.decidedAt),
    }),
    at: timestamptzToIso(row.createdAt),
  });
  return { pending: pending.map(toWish), recent: recent.map(toWish) };
}

/**
 * Grants or declines a pending wish, with an optional reply for the player.
 * A decision is final; returns `false` if it was already decided (e.g. by
 * another admin at the same time).
 */
export async function decideWish(
  input: WishDecisionInput,
  actor: AdminUser,
): Promise<boolean> {
  const { actorId, actorName } = actorFields(actor);
  const decided = await getDb()
    .update(wishes)
    .set({
      status: input.decision,
      response: input.response,
      deciderId: actorId,
      deciderName: actorName,
      decidedAt: sql`now()`,
    })
    .where(and(eq(wishes.id, input.rowId), eq(wishes.status, "pending")))
    .returning({ id: wishes.id });
  return decided.length > 0;
}

/**
 * Cancels a power-up used on a week: its effect goes and the charge returns
 * to the player's wallet, unused.
 */
export async function revokePowerUpUse(
  taskId: string,
  id: number,
): Promise<void> {
  await getDb()
    .delete(powerUpUses)
    .where(and(eq(powerUpUses.id, id), eq(powerUpUses.taskId, taskId)));
}

// ── Errors ────────────────────────────────────────────────────────────

const CONSTRAINT_MESSAGES: Record<string, string> = {
  mini_tasks_reward_range: "A mini-task pays between 1 and 5 Clim Coin.",
  mini_tasks_ends_after_start: "The last day can't be before the first.",
  players_pkey: "A player with that id already exists.",
  teams_pkey: "A team with that id already exists.",
  tasks_pkey: "A task with that id already exists.",
  tasks_season_id_week_number_unique:
    "Another week this season already uses that week number.",
  team_members_player_season_fk:
    "Squad members must be players from the squad's season.",
  seasons_pkey: "A season with that id already exists.",
  seasons_one_current_idx: "Only one season can be current.",
  players_season_id_seasons_id_fk:
    "That season still has players, squads or weeks.",
  teams_season_id_seasons_id_fk:
    "That season still has players, squads or weeks.",
  tasks_season_id_seasons_id_fk:
    "That season still has players, squads or weeks.",
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
  shop_items_pkey: "A shop item with that id already exists.",
  shop_items_price_range: "Price must be between 0 and 10000.",
  shop_items_image_when_visual: "Pets and avatars need an image.",
  coin_purchases_item_id_shop_items_id_fk:
    "Players own this item, so it can't be deleted. Retire it instead.",
  coin_adjustments_amount_range: "Use a non-zero amount up to 10000.",
  item_gifts_item_id_shop_items_id_fk:
    "Players were gifted this item, so it can't be deleted. Retire it instead.",
  shop_items_crate_only_droppable: "Power-ups can't be egg exclusives.",
  shop_items_skill_only_not_crate_only:
    "Skill tree rewards can't be egg exclusives.",
  crate_opens_item_id_shop_items_id_fk:
    "Players hatched this item from an egg, so it can't be deleted. Retire it instead.",
};

// ── Mini-tasks ────────────────────────────────────────────────────────

export type MiniTaskRecord = typeof miniTasks.$inferSelect;

/** A season's mini-tasks, newest start first, with how many completed each. */
export async function listMiniTasks(
  seasonId: string,
): Promise<(MiniTaskRecord & { completions: number })[]> {
  const db = getDb();
  const [rows, counts] = await db.batch([
    db
      .select()
      .from(miniTasks)
      .where(eq(miniTasks.seasonId, seasonId))
      .orderBy(desc(miniTasks.startsOn), desc(miniTasks.id)),
    db
      .select({ id: miniTaskCompletions.miniTaskId, n: count() })
      .from(miniTaskCompletions)
      .where(eq(miniTaskCompletions.seasonId, seasonId))
      .groupBy(miniTaskCompletions.miniTaskId),
  ]);
  const done = new Map(counts.map((c) => [c.id, c.n]));
  return rows.map((row) => ({ ...row, completions: done.get(row.id) ?? 0 }));
}

/** A mini-task with the ids of the players who completed it. */
export async function getMiniTask(
  id: number,
): Promise<(MiniTaskRecord & { completedBy: string[] }) | undefined> {
  const db = getDb();
  const [[row], done] = await db.batch([
    db.select().from(miniTasks).where(eq(miniTasks.id, id)),
    db
      .select({ playerId: miniTaskCompletions.playerId })
      .from(miniTaskCompletions)
      .where(eq(miniTaskCompletions.miniTaskId, id)),
  ]);
  return row && { ...row, completedBy: done.map((d) => d.playerId) };
}

/** Creates a mini-task in `seasonId`, returning its id. */
export async function createMiniTask(
  seasonId: string,
  input: MiniTaskInput,
): Promise<number> {
  const [row] = await getDb()
    .insert(miniTasks)
    .values({ seasonId, ...input })
    .returning({ id: miniTasks.id });
  return row.id;
}

export async function updateMiniTask(
  id: number,
  input: MiniTaskInput,
): Promise<void> {
  await getDb().update(miniTasks).set(input).where(eq(miniTasks.id, id));
}

export async function getMiniTaskDeleteImpact(
  id: number,
): Promise<DeleteImpact[]> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(miniTaskCompletions)
    .where(eq(miniTaskCompletions.miniTaskId, id));
  return [{ label: "completion", count: row?.n ?? 0 }];
}

/** Deletes a mini-task; its completions (and their coin) go with it. */
export async function deleteMiniTask(id: number): Promise<void> {
  await getDb().delete(miniTasks).where(eq(miniTasks.id, id));
}

/**
 * Sets exactly who has completed a mini-task. Players already ticked keep
 * their original time and actor; newly ticked ones are recorded as `actor`,
 * now. Players outside the mini-task's season are rejected by the foreign
 * key. One transaction.
 */
export async function setMiniTaskCompletions(
  task: Pick<MiniTaskRecord, "id" | "seasonId">,
  playerIds: readonly string[],
  actor: AdminUser,
): Promise<void> {
  const db = getDb();
  const ofTask = eq(miniTaskCompletions.miniTaskId, task.id);
  const remove = db
    .delete(miniTaskCompletions)
    .where(
      playerIds.length === 0
        ? ofTask
        : and(ofTask, notInArray(miniTaskCompletions.playerId, [...playerIds])),
    );
  if (playerIds.length === 0) {
    await remove;
    return;
  }
  await db.batch([
    remove,
    db
      .insert(miniTaskCompletions)
      .values(
        playerIds.map((playerId) => ({
          miniTaskId: task.id,
          playerId,
          seasonId: task.seasonId,
          ...actorFields(actor),
        })),
      )
      .onConflictDoNothing(),
  ]);
}

export { violatedConstraint } from "./db-errors";

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
