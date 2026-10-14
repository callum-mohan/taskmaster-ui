import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  bonusPoints,
  playerAccounts,
  players,
  taskScores,
  tasks,
  teamMembers,
  teamScores,
  teams,
} from "../db/schema";
import type {
  BonusInput,
  PlayerInput,
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

/** Rows a delete will also remove through `ON DELETE CASCADE`. */
export interface DeleteImpact {
  label: string;
  count: number;
}

const nextSortOrder = (table: typeof players | typeof teams) =>
  sql<number>`(select coalesce(max(${table.sortOrder}), 0) + 1 from ${table})`;

// ── Dashboard ─────────────────────────────────────────────────────────

export async function getAdminCounts() {
  const db = getDb();
  const [[p], [t], [k], [s], [ts], [b]] = await db.batch([
    db.select({ n: count() }).from(players),
    db.select({ n: count() }).from(teams),
    db.select({ n: count() }).from(tasks),
    db.select({ n: count() }).from(taskScores),
    db.select({ n: count() }).from(teamScores),
    db.select({ n: count() }).from(bonusPoints),
  ]);
  return {
    players: p.n,
    teams: t.n,
    tasks: k.n,
    scores: s.n + ts.n,
    bonuses: b.n,
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
  const [[s], [b], [m], [a]] = await db.batch([
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
  ]);
  return [
    { label: "individual score", count: s.n },
    { label: "bonus / deduction", count: b.n },
    { label: "team membership", count: m.n },
    { label: "sign-in account link", count: a.n },
  ];
}

export async function deletePlayer(id: string): Promise<void> {
  await getDb().delete(players).where(eq(players.id, id));
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
  const [[s], [m]] = await db.batch([
    db.select({ n: count() }).from(teamScores).where(eq(teamScores.teamId, id)),
    db
      .select({ n: count() })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, id)),
  ]);
  return [
    { label: "team score", count: s.n },
    { label: "team membership", count: m.n },
  ];
}

export async function deleteTeam(id: string): Promise<void> {
  await getDb().delete(teams).where(eq(teams.id, id));
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
});

export async function createTask(input: TaskInput): Promise<void> {
  await getDb()
    .insert(tasks)
    .values({ id: input.id, ...taskValues(input) });
}

export async function updateTask(id: string, input: TaskInput): Promise<void> {
  await getDb().update(tasks).set(taskValues(input)).where(eq(tasks.id, id));
}

export async function getTaskDeleteImpact(id: string): Promise<DeleteImpact[]> {
  const db = getDb();
  const [[s], [t], [b]] = await db.batch([
    db.select({ n: count() }).from(taskScores).where(eq(taskScores.taskId, id)),
    db.select({ n: count() }).from(teamScores).where(eq(teamScores.taskId, id)),
    db
      .select({ n: count() })
      .from(bonusPoints)
      .where(eq(bonusPoints.taskId, id)),
  ]);
  return [
    { label: "individual score", count: s.n },
    { label: "team score", count: t.n },
    { label: "bonus / deduction", count: b.n },
  ];
}

export async function deleteTask(id: string): Promise<void> {
  await getDb().delete(tasks).where(eq(tasks.id, id));
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

/** Replaces every individual score for a task in one transaction. */
export async function saveTaskScores(
  taskId: string,
  entries: TaskScoreInput[],
): Promise<void> {
  const db = getDb();
  const clear = db.delete(taskScores).where(eq(taskScores.taskId, taskId));
  if (entries.length === 0) {
    await clear;
    return;
  }
  await db.batch([
    clear,
    db
      .insert(taskScores)
      .values(entries.map((entry) => ({ taskId, ...entry }))),
  ]);
}

/** Replaces every squad score for a team task in one transaction. */
export async function saveTeamScores(
  taskId: string,
  entries: TeamScoreInput[],
): Promise<void> {
  const db = getDb();
  const clear = db.delete(teamScores).where(eq(teamScores.taskId, taskId));
  if (entries.length === 0) {
    await clear;
    return;
  }
  await db.batch([
    clear,
    db
      .insert(teamScores)
      .values(entries.map((entry) => ({ taskId, ...entry }))),
  ]);
}

export async function addBonus(
  taskId: string,
  input: BonusInput,
): Promise<void> {
  await getDb()
    .insert(bonusPoints)
    .values({ taskId, ...input });
}

export async function updateBonus(
  taskId: string,
  id: number,
  input: BonusInput,
): Promise<void> {
  await getDb()
    .update(bonusPoints)
    .set(input)
    .where(and(eq(bonusPoints.id, id), eq(bonusPoints.taskId, taskId)));
}

export async function deleteBonus(taskId: string, id: number): Promise<void> {
  await getDb()
    .delete(bonusPoints)
    .where(and(eq(bonusPoints.id, id), eq(bonusPoints.taskId, taskId)));
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
