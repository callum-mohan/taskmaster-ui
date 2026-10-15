import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// Raw competition records. Only facts are stored here: finishing positions,
// task status and leaderboard totals are derived in `src/data/*` so they can
// never drift out of sync with the points. Column names are camelCase here
// and snake_case in Postgres (`casing: "snake_case"` in the client/config).

export const taskFormat = pgEnum("task_format", ["individual", "team"]);
export const pollKind = pgEnum("poll_kind", ["single", "multiple"]);
export const pollResultsVisibility = pgEnum("poll_results_visibility", [
  "always",
  "after_vote",
  "after_close",
  "admin_only",
]);

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

/**
 * A homepage poll. Its status (scheduled / open / closed) is derived from
 * `opensAt` / `closesAt`, like a task's, so it can never go stale.
 */
export const polls = pgTable(
  "polls",
  {
    id: text().primaryKey(),
    question: text().notNull(),
    description: text(),
    kind: pollKind().notNull().default("single"),
    // How many options a voter must / may pick (both 1 for single choice).
    minChoices: integer().notNull().default(1),
    // Null means "up to every option".
    maxChoices: integer(),
    // Wall-clock (local) times with no zone, like `tasks`.
    opensAt: timestamp({ mode: "string" }).notNull(),
    closesAt: timestamp({ mode: "string" }).notNull(),
    resultsVisibility: pollResultsVisibility().notNull().default("after_vote"),
    allowVoteChange: boolean().notNull().default(true),
    // Anonymous polls only ever publish counts; public ones name the voters.
    anonymous: boolean().notNull().default(true),
    // Days a closed poll stays on the homepage (0 hides it once it closes).
    showOnHomeDays: integer().notNull().default(3),
    // Unpublished polls are drafts: hidden from the site whatever the dates.
    published: boolean().notNull().default(true),
    // Bonus points each voter earns (0 = none). Derived from the votes, so
    // withdrawing a vote or deleting the poll takes the points away too.
    voteBonusPoints: integer().notNull().default(1),
    // The week the bonus counts in; null = the week live when the poll opens.
    bonusTaskId: text().references(() => tasks.id, { onDelete: "set null" }),
    createdAt: timestamp({ mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    check("polls_closes_after_opens", sql`${t.closesAt} > ${t.opensAt}`),
    check("polls_min_choices_positive", sql`${t.minChoices} >= 1`),
    check(
      "polls_max_choices_at_least_min",
      sql`${t.maxChoices} is null or ${t.maxChoices} >= ${t.minChoices}`,
    ),
    check("polls_show_on_home_days_range", sql`${t.showOnHomeDays} >= 0`),
    check(
      "polls_vote_bonus_points_range",
      sql`${t.voteBonusPoints} between 0 and 100`,
    ),
  ],
);

export const pollOptions = pgTable(
  "poll_options",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    pollId: text()
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    label: text().notNull(),
    sortOrder: integer().notNull(),
  },
  (t) => [
    index("poll_options_poll_id_idx").on(t.pollId),
    // Target of the votes' composite key, so a vote's option must belong to
    // the vote's poll.
    unique("poll_options_id_poll_id_unique").on(t.id, t.pollId),
  ],
);

/** One row per option a player picked. Only player accounts can vote. */
export const pollVotes = pgTable(
  "poll_votes",
  {
    // Denormalised from the option so "this player's vote on this poll" is
    // a single indexed lookup / delete.
    pollId: text()
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    optionId: integer().notNull(),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    createdAt: timestamp({ mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.optionId, t.playerId] }),
    foreignKey({
      name: "poll_votes_option_fk",
      columns: [t.optionId, t.pollId],
      foreignColumns: [pollOptions.id, pollOptions.pollId],
    }).onDelete("cascade"),
    index("poll_votes_poll_id_player_id_idx").on(t.pollId, t.playerId),
    index("poll_votes_player_id_idx").on(t.playerId),
  ],
);
