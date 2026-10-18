import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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
export const submissionKind = pgEnum("submission_kind", ["photo", "text"]);
export const scoreAuditEntity = pgEnum("score_audit_entity", [
  "task_score",
  "team_score",
  "bonus",
]);
export const scoreAuditAction = pgEnum("score_audit_action", [
  "created",
  "updated",
  "deleted",
]);
export const reactionKind = pgEnum("reaction_kind", [
  "laugh",
  "fire",
  "clap",
  "mind_blown",
  "egg",
]);
export const featureCategory = pgEnum("feature_category", [
  "new",
  "improved",
  "fixed",
]);

// When a score or bonus was first recorded and last changed. Real instants
// (unlike the UK wall-clock task dates), so they carry a time zone. Notifications
// use `createdAt` to say when results and bonuses arrived.
const recordedTimestamps = () => ({
  createdAt: timestamp({ withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp({ withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
});

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
    // UK wall-clock times (Europe/London, GMT/BST) with no zone; see `lib/time`.
    releaseDate: timestamp({ mode: "string" }).notNull(),
    deadline: timestamp({ mode: "string" }).notNull(),
    format: taskFormat().notNull().default("individual"),
    // Optional shared secret that keeps a live task's title and brief
    // encrypted until a visitor enters it. Stored as entered (it's announced
    // to everyone), matched trimmed and case-insensitively.
    revealPassword: text(),
    // Set when an admin reveals a password-protected task to everyone.
    revealedAt: timestamp({ mode: "string" }),
    // How many entries each player (or squad, on team tasks) may submit;
    // 0 keeps on-site submissions closed. See `task_submissions`.
    maxSubmissions: integer().notNull().default(0),
    submissionKinds: submissionKind()
      .array()
      .notNull()
      .default(sql`'{}'`),
    // Results night: while held, the week's scores and recorded bonuses stay
    // off the public site; `/live` reveals them one by one (bottom first) up
    // to `resultsRevealCount`, then publishing clears the hold.
    resultsHeldAt: timestamp({ withTimezone: true, mode: "string" }),
    resultsRevealCount: integer().notNull().default(0),
    // When held results were published, so notifications date from then.
    resultsPublishedAt: timestamp({ withTimezone: true, mode: "string" }),
  },
  (t) => [
    check(
      "tasks_results_reveal_count_positive",
      sql`${t.resultsRevealCount} >= 0`,
    ),
    check(
      "tasks_deadline_after_release",
      sql`${t.deadline} > ${t.releaseDate}`,
    ),
    check(
      "tasks_max_submissions_range",
      sql`${t.maxSubmissions} between 0 and 10`,
    ),
    check(
      "tasks_submission_kinds_when_open",
      sql`${t.maxSubmissions} = 0 or cardinality(${t.submissionKinds}) > 0`,
    ),
  ],
);

/**
 * A player's entry for a task: a photo (stored in Object Storage under
 * `objectKey`, with an optional caption in `text`) or a text entry. On team
 * tasks the entry belongs to the squad in `teamId`; `playerId` is always the
 * member who submitted it. Entries are public once the task's deadline passes
 * unless an admin hid them.
 */
export const taskSubmissions = pgTable(
  "task_submissions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    teamId: text().references(() => teams.id, { onDelete: "cascade" }),
    kind: submissionKind().notNull(),
    text: text(),
    objectKey: text().unique("task_submissions_object_key_unique"),
    contentType: text(),
    sizeBytes: integer(),
    hiddenAt: timestamp({ withTimezone: true, mode: "string" }),
    createdAt: timestamp({ withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "task_submissions_photo_has_object",
      sql`(${t.kind} = 'photo') = (${t.objectKey} is not null)`,
    ),
    check(
      "task_submissions_text_has_body",
      sql`${t.kind} <> 'text' or coalesce(length(trim(${t.text})), 0) > 0`,
    ),
    index("task_submissions_task_id_player_id_idx").on(t.taskId, t.playerId),
    index("task_submissions_task_id_team_id_idx").on(t.taskId, t.teamId),
    index("task_submissions_player_id_idx").on(t.playerId),
    index("task_submissions_team_id_idx").on(t.teamId),
    // Target of the People's Choice votes' composite key, so a vote's entry
    // must belong to the vote's task.
    unique("task_submissions_id_task_id_unique").on(t.id, t.taskId),
  ],
);

/** A player's emoji reaction to a gallery entry (one of each kind at most). */
export const submissionReactions = pgTable(
  "submission_reactions",
  {
    submissionId: integer()
      .notNull()
      .references(() => taskSubmissions.id, { onDelete: "cascade" }),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    kind: reactionKind().notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.submissionId, t.playerId, t.kind] }),
    index("submission_reactions_player_id_idx").on(t.playerId),
  ],
);

/**
 * A player's People's Choice vote: one entry per task, never their own (or
 * their squad's). The winners' bonus is derived from these, not stored.
 */
export const peoplesChoiceVotes = pgTable(
  "peoples_choice_votes",
  {
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    submissionId: integer().notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.playerId] }),
    foreignKey({
      name: "peoples_choice_votes_submission_fk",
      columns: [t.submissionId, t.taskId],
      foreignColumns: [taskSubmissions.id, taskSubmissions.taskId],
    }).onDelete("cascade"),
    index("peoples_choice_votes_submission_id_idx").on(t.submissionId),
    index("peoples_choice_votes_player_id_idx").on(t.playerId),
  ],
);

/**
 * A player's call on who wins a week: a player on individual tasks, a squad
 * on team tasks (never themselves or their own squad). The bonus for a
 * correct call is derived from the results, not stored.
 */
export const predictions = pgTable(
  "predictions",
  {
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    pickedPlayerId: text().references(() => players.id, {
      onDelete: "cascade",
    }),
    pickedTeamId: text().references(() => teams.id, { onDelete: "cascade" }),
    ...recordedTimestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.playerId] }),
    check(
      "predictions_one_pick",
      sql`num_nonnulls(${t.pickedPlayerId}, ${t.pickedTeamId}) = 1`,
    ),
    check(
      "predictions_not_self",
      sql`${t.pickedPlayerId} is distinct from ${t.playerId}`,
    ),
    index("predictions_player_id_idx").on(t.playerId),
    index("predictions_picked_player_id_idx").on(t.pickedPlayerId),
    index("predictions_picked_team_id_idx").on(t.pickedTeamId),
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
    ...recordedTimestamps(),
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
    comment: text(),
    ...recordedTimestamps(),
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
    ...recordedTimestamps(),
  },
  (t) => [
    index("bonus_points_task_id_idx").on(t.taskId),
    index("bonus_points_player_id_idx").on(t.playerId),
  ],
);

/**
 * Who changed which score or bonus, and how. Append-only, written in the same
 * transaction as the change. Ids are plain text (no foreign keys) and the
 * actor's name is copied in, so the history outlives deleted players, teams,
 * tasks and admin accounts.
 */
export const scoreAuditLog = pgTable(
  "score_audit_log",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp({ withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    // The Neon Auth user who made the change, and their name at the time.
    actorId: text().notNull(),
    actorName: text().notNull(),
    taskId: text().notNull(),
    entity: scoreAuditEntity().notNull(),
    action: scoreAuditAction().notNull(),
    // The player (task score, bonus) or team (team score) affected.
    subjectId: text().notNull(),
    // The bonus row, for bonus entries.
    bonusId: integer(),
    pointsBefore: integer(),
    pointsAfter: integer(),
    // The score comment or bonus reason, before and after.
    noteBefore: text(),
    noteAfter: text(),
  },
  (t) => [index("score_audit_log_task_id_at_idx").on(t.taskId, t.at)],
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
    // When the player last opened their notifications; null until they do.
    // A real instant (set with `now()`), so it carries a time zone.
    notificationsReadAt: timestamp({ withTimezone: true, mode: "string" }),
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
    // UK wall-clock times with no zone, like `tasks`.
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

/**
 * Hand-written editorial colour for a week's episode recap. Every field is
 * optional: the recap page falls back to copy derived from the results.
 */
export const recaps = pgTable("recaps", {
  taskId: text()
    .primaryKey()
    .references(() => tasks.id, { onDelete: "cascade" }),
  headline: text(),
  summary: text(),
  moment: text(),
  momentPlayerId: text().references(() => players.id, {
    onDelete: "set null",
  }),
  quoteText: text(),
  quoteAttribution: text(),
  ...recordedTimestamps(),
});

/** The site changelog shown in the homepage "what's new" modal. */
export const changelogEntries = pgTable(
  "changelog_entries",
  {
    // Stable id; also the change key for the modal's unseen indicator.
    id: text().primaryKey(),
    date: date({ mode: "string" }).notNull(),
    title: text().notNull(),
    description: text().notNull(),
    category: featureCategory().notNull(),
    ...recordedTimestamps(),
  },
  (t) => [index("changelog_entries_date_idx").on(t.date)],
);
