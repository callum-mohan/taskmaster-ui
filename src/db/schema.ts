import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Raw competition records. Only facts are stored here: finishing positions,
// task status and leaderboard totals are derived in `src/data/*` so they can
// never drift out of sync with the points. Column names are camelCase here
// and snake_case in Postgres (`casing: "snake_case"` in the client/config).

export const taskFormat = pgEnum("task_format", ["individual", "team"]);

export const players = pgTable("players", {
  id: text().primaryKey(),
  name: text().notNull(),
  bio: text(),
  avatarUrl: text(),
  // Roster order: display order and the tie-breaker for equal points.
  sortOrder: integer().notNull(),
});

export const teams = pgTable("teams", {
  id: text().primaryKey(),
  name: text().notNull(),
  tagline: text(),
  // Team order: display order and the tie-breaker for equal team points.
  sortOrder: integer().notNull(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: text()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    // Unique: a player belongs to at most one squad.
    playerId: text()
      .notNull()
      .unique("team_members_player_id_unique")
      .references(() => players.id, { onDelete: "cascade" }),
    sortOrder: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.playerId] })],
);

export const tasks = pgTable(
  "tasks",
  {
    id: text().primaryKey(),
    weekNumber: integer().notNull().unique("tasks_week_number_unique"),
    title: text().notNull(),
    description: text().notNull().default(""),
    // Prose (string) or a bullet list (string[]); see `Task.brief`.
    brief: jsonb().$type<string | string[]>(),
    // Wall-clock (local) times with no zone, matching the site's ISO strings.
    releaseDate: timestamp({ mode: "string" }).notNull(),
    deadline: timestamp({ mode: "string" }).notNull(),
    format: taskFormat().notNull().default("individual"),
  },
  (t) => [
    check(
      "tasks_deadline_after_release",
      sql`${t.deadline} > ${t.releaseDate}`,
    ),
  ],
);

/** Points a player earned on an individual task. */
export const taskScores = pgTable(
  "task_scores",
  {
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    points: integer().notNull(),
    comment: text(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.playerId] }),
    index("task_scores_player_id_idx").on(t.playerId),
  ],
);

/** Points a squad earned on a team task (also credited to every member). */
export const teamScores = pgTable(
  "team_scores",
  {
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    teamId: text()
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    points: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.teamId] }),
    index("team_scores_team_id_idx").on(t.teamId),
  ],
);

/** One-off bonuses (positive) and deductions (negative). */
export const bonusPoints = pgTable(
  "bonus_points",
  {
    // Identity order preserves the order adjustments were recorded in.
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    points: integer().notNull(),
    reason: text().notNull(),
  },
  (t) => [
    index("bonus_points_task_id_idx").on(t.taskId),
    index("bonus_points_player_id_idx").on(t.playerId),
  ],
);

/**
 * A player's sign-in account. An admin sets `email` (the invite); the
 * `players:accounts` script creates the Neon Auth user with a temporary
 * password and records its id in `userId`. Kept out of `players` so emails
 * never reach the public competition snapshot.
 */
export const playerAccounts = pgTable(
  "player_accounts",
  {
    playerId: text()
      .primaryKey()
      .references(() => players.id, { onDelete: "cascade" }),
    // Stored lower-cased so it matches Better Auth's normalised emails.
    email: text().notNull().unique("player_accounts_email_unique"),
    // The Neon Auth user id; null until the account is provisioned.
    userId: text().unique("player_accounts_user_id_unique"),
    mustChangePassword: boolean().notNull().default(true),
    createdAt: timestamp({ mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    check("player_accounts_email_lower", sql`${t.email} = lower(${t.email})`),
  ],
);
