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
  uniqueIndex,
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
export const shopCategory = pgEnum("shop_category", [
  "pet",
  "avatar",
  "cosmetic",
  "power_up",
]);
export const cosmeticKind = pgEnum("cosmetic_kind", [
  "title",
  "name_colour",
  "theme",
]);
export const powerUpKind = pgEnum("power_up_kind", [
  "double_down",
  "hint",
  "golden_week",
  "sabotage",
  // Passive: never "used" on a week (no `power_up_uses` row). Their effect
  // is derived from the records; see `src/data/coins.ts`.
  "shield",
  "mirror",
  "insurance",
  // Spent by making a wish (a `wishes` row), never on a week.
  "wish",
]);
export const wishStatus = pgEnum("wish_status", [
  "pending",
  "granted",
  "declined",
]);
export const loadoutSlot = pgEnum("loadout_slot", [
  "pet",
  "avatar",
  "title",
  "name_colour",
  "theme",
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

/**
 * A run of the competition (one academy cohort). Players, squads and weeks
 * all belong to one season. Exactly one season is current: the one the
 * public site shows. `closedAt` is set when an admin closes the season and
 * crowns its champion (the standings themselves are always derived).
 */
export const seasons = pgTable(
  "seasons",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    isCurrent: boolean().notNull().default(false),
    closedAt: timestamp({ withTimezone: true, mode: "string" }),
    ...recordedTimestamps(),
  },
  (t) => [
    uniqueIndex("seasons_one_current_idx")
      .on(t.isCurrent)
      .where(sql`${t.isCurrent}`),
  ],
);

// A season with players, squads or weeks can't be deleted.
const seasonId = () =>
  text()
    .notNull()
    .references(() => seasons.id, { onDelete: "restrict" });

export const players = pgTable(
  "players",
  {
    id: text().primaryKey(),
    seasonId: seasonId(),
    name: text().notNull(),
    bio: text(),
    avatarUrl: text(),
    // Roster order: display order and the tie-breaker for equal points.
    sortOrder: integer().notNull(),
  },
  (t) => [
    index("players_season_id_idx").on(t.seasonId),
    // Target of `team_members`' composite key, so squads stay in one season.
    unique("players_id_season_id_unique").on(t.id, t.seasonId),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: text().primaryKey(),
    seasonId: seasonId(),
    name: text().notNull(),
    tagline: text(),
    // Team order: display order and the tie-breaker for equal team points.
    sortOrder: integer().notNull(),
  },
  (t) => [
    index("teams_season_id_idx").on(t.seasonId),
    unique("teams_id_season_id_unique").on(t.id, t.seasonId),
  ],
);

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
    // Denormalised so the composite keys below keep a squad's members in
    // the squad's season.
    seasonId: seasonId(),
    sortOrder: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.playerId] }),
    foreignKey({
      name: "team_members_team_season_fk",
      columns: [t.teamId, t.seasonId],
      foreignColumns: [teams.id, teams.seasonId],
    }).onDelete("cascade"),
    foreignKey({
      name: "team_members_player_season_fk",
      columns: [t.playerId, t.seasonId],
      foreignColumns: [players.id, players.seasonId],
    }).onDelete("cascade"),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: text().primaryKey(),
    seasonId: seasonId(),
    weekNumber: integer().notNull(),
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
    // The Taskmaster's Hint: only players who use the Hint power-up on this
    // week ever see it (see `power_up_uses`).
    hint: text(),
  },
  (t) => [
    unique("tasks_season_id_week_number_unique").on(t.seasonId, t.weekNumber),
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
 * A player's sign-in account. An admin sets `email` (the invite); the Neon
 * Auth user is created with a temporary password (from the new-player form
 * in `/admin`, or by the `players:accounts` script) and its id recorded in
 * `userId`. Kept out of `players` so emails never reach the public
 * competition snapshot.
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

// ── Clim Coin ─────────────────────────────────────────────────────────
// A per-season wallet. Earnings (placements, entries, votes, predictions)
// are derived from the competition records in `src/data/coins.ts`, never
// stored; only what players spend, equip and use, and what admins grant or
// deduct, is written here.

/**
 * Site-wide feature flags, switched on and off in `/admin/site`. Keys are
 * the ones in `src/data/feature-flags.ts`; a flag with no row is off, so new
 * features ship disabled. The actor's name is copied in, like
 * `coin_adjustments`.
 */
export const featureFlags = pgTable("feature_flags", {
  key: text().primaryKey(),
  enabled: boolean().notNull().default(false),
  actorId: text().notNull(),
  actorName: text().notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
});

/**
 * The shop catalogue (site-wide, managed in `/admin/shop`). Category, cosmetic
 * kind and power-up are fixed once created so owned items keep their slot
 * and effect. Items someone bought can't be deleted, only retired.
 */
export const shopItems = pgTable(
  "shop_items",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    description: text().notNull().default(""),
    category: shopCategory().notNull(),
    price: integer().notNull(),
    // A `/shop/...` path or https URL; required for pets and avatars.
    imageUrl: text(),
    cosmeticKind: cosmeticKind(),
    // The title text, name colour token or profile theme id.
    cosmeticValue: text(),
    powerUp: powerUpKind(),
    // Retired items stay with their owners but can't be bought.
    available: boolean().notNull().default(true),
    // Crate exclusives only drop from crates; they're never sold directly.
    crateOnly: boolean().notNull().default(false),
    // A seasonal egg's exclusive (a crate id from `coin-rules.ts`): it only
    // drops from that egg, and no other egg drops it.
    crateId: text(),
    // A skill tree reward (see `src/data/skill-trees.ts`): never sold or
    // dropped by eggs, only granted by unlocking its skill node.
    skillOnly: boolean().notNull().default(false),
    // Limited-time stock: on sale (and droppable) only between these UK
    // wall-clock times (Europe/London, no zone, like task dates). Unset = open.
    availableFrom: timestamp({ mode: "string" }),
    availableUntil: timestamp({ mode: "string" }),
    sortOrder: integer().notNull().default(0),
    ...recordedTimestamps(),
  },
  (t) => [
    check("shop_items_price_range", sql`${t.price} between 0 and 10000`),
    check(
      "shop_items_crate_id_crate_only",
      sql`${t.crateId} is null or ${t.crateOnly}`,
    ),
    check(
      "shop_items_skill_only_not_crate_only",
      sql`not (${t.skillOnly} and ${t.crateOnly})`,
    ),
    check(
      "shop_items_sale_window_order",
      sql`${t.availableFrom} is null or ${t.availableUntil} is null or ${t.availableUntil} > ${t.availableFrom}`,
    ),
    check(
      "shop_items_image_when_visual",
      sql`${t.category} not in ('pet', 'avatar') or ${t.imageUrl} is not null`,
    ),
    check(
      "shop_items_cosmetic_fields",
      sql`(${t.category} = 'cosmetic') = (${t.cosmeticKind} is not null and ${t.cosmeticValue} is not null)`,
    ),
    check(
      "shop_items_power_up_field",
      sql`(${t.category} = 'power_up') = (${t.powerUp} is not null)`,
    ),
    // Power-ups drop from every crate through its small power-up chance, so
    // one can't be crate-only (or a seasonal egg's exclusive).
    check(
      "shop_items_crate_only_droppable",
      sql`not (${t.crateOnly} and ${t.category} = 'power_up')`,
    ),
  ],
);

/**
 * A purchase, at the price paid then (later price changes never rewrite a
 * wallet). Every item is bought at most once a season (players are per
 * season); a power-up purchase is its single charge, spent by a
 * `power_up_uses` row.
 */
export const coinPurchases = pgTable(
  "coin_purchases",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    itemId: text()
      .notNull()
      .references(() => shopItems.id, { onDelete: "restrict" }),
    price: integer().notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("coin_purchases_price_positive", sql`${t.price} >= 0`),
    index("coin_purchases_player_id_idx").on(t.playerId),
    index("coin_purchases_item_id_idx").on(t.itemId),
  ],
);

/**
 * A power-up charge spent on a live week: each power-up once per player a
 * season, at most one per player per week, and a player can be sabotaged at
 * most once per week. The effect is copied
 * from the item so it can't change after use. Effects (Golden Week, Double
 * Down, Sabotage) are applied when the snapshot is derived.
 */
export const powerUpUses = pgTable(
  "power_up_uses",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    purchaseId: integer()
      .notNull()
      .unique("power_up_uses_purchase_id_unique")
      .references(() => coinPurchases.id, { onDelete: "cascade" }),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    taskId: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    effect: powerUpKind().notNull(),
    targetPlayerId: text().references(() => players.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp({ withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("power_up_uses_player_id_task_id_unique").on(t.playerId, t.taskId),
    unique("power_up_uses_player_id_effect_unique").on(t.playerId, t.effect),
    uniqueIndex("power_up_uses_one_sabotage_per_target_idx")
      .on(t.taskId, t.targetPlayerId)
      .where(sql`${t.effect} = 'sabotage'`),
    check(
      "power_up_uses_target_when_sabotage",
      sql`(${t.effect} = 'sabotage') = (${t.targetPlayerId} is not null)`,
    ),
    check(
      "power_up_uses_not_self",
      sql`${t.targetPlayerId} is distinct from ${t.playerId}`,
    ),
    // Shield, Mirror and Insurance are passive, and a wish is spent on a
    // `wishes` row. Compared as text so the check doesn't use the enum
    // values added in the same migration.
    check(
      "power_up_uses_active_effect",
      sql`${t.effect}::text not in ('shield', 'mirror', 'insurance', 'wish')`,
    ),
    index("power_up_uses_task_id_idx").on(t.taskId),
    index("power_up_uses_target_player_id_idx").on(t.targetPlayerId),
  ],
);

/** What a player has equipped, one item per slot (owned items only). */
export const equippedItems = pgTable(
  "equipped_items",
  {
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    slot: loadoutSlot().notNull(),
    itemId: text()
      .notNull()
      .references(() => shopItems.id, { onDelete: "cascade" }),
    updatedAt: timestamp({ withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.slot] }),
    index("equipped_items_item_id_idx").on(t.itemId),
  ],
);

/**
 * Admin grants (positive) and deductions (negative) of Clim Coin. The actor's
 * name is copied in, like `score_audit_log`.
 */
export const coinAdjustments = pgTable(
  "coin_adjustments",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    amount: integer().notNull(),
    reason: text().notNull(),
    actorId: text().notNull(),
    actorName: text().notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "coin_adjustments_amount_range",
      sql`${t.amount} <> 0 and ${t.amount} between -10000 and 10000`,
    ),
    index("coin_adjustments_player_id_idx").on(t.playerId),
  ],
);

/**
 * A shop item (pet, avatar, cosmetic or power-up) an admin gifted a player.
 * Like a crate win, it's owned through `purchaseId`, a zero-price
 * `coin_purchases` row written in the same statement, so ownership works
 * exactly like buying. The actor's name is copied in, like
 * `coin_adjustments`.
 */
export const itemGifts = pgTable(
  "item_gifts",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    itemId: text()
      .notNull()
      .references(() => shopItems.id, { onDelete: "restrict" }),
    purchaseId: integer()
      .notNull()
      .unique("item_gifts_purchase_id_unique")
      .references(() => coinPurchases.id, { onDelete: "cascade" }),
    reason: text().notNull(),
    actorId: text().notNull(),
    actorName: text().notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("item_gifts_player_id_idx").on(t.playerId),
    index("item_gifts_item_id_idx").on(t.itemId),
  ],
);

/**
 * A wish made with the One Wish Willow power-up: its `purchaseId` is the
 * charge it spent (so one wish per charge). The Taskmaster grants or
 * declines it from the admin dashboard; either way it's spent. The
 * decider's name is copied in, like `coin_adjustments`.
 */
export const wishes = pgTable(
  "wishes",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    purchaseId: integer()
      .notNull()
      .unique("wishes_purchase_id_unique")
      .references(() => coinPurchases.id, { onDelete: "cascade" }),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    wish: text().notNull(),
    status: wishStatus().notNull().default("pending"),
    // The Taskmaster's reply, shown to the player with the decision.
    response: text(),
    deciderId: text(),
    deciderName: text(),
    decidedAt: timestamp({ withTimezone: true, mode: "string" }),
    createdAt: timestamp({ withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("wishes_wish_length", sql`char_length(${t.wish}) between 1 and 200`),
    check(
      "wishes_response_length",
      sql`${t.response} is null or char_length(${t.response}) <= 200`,
    ),
    check(
      "wishes_decided_when_not_pending",
      sql`(${t.status} = 'pending') = (${t.decidedAt} is null)`,
    ),
    index("wishes_player_id_idx").on(t.playerId),
  ],
);

/**
 * Clim Coin one player sent another. Both are in the same season (composite
 * keys, like `team_members`), so a gift never crosses wallets' seasons. The
 * weekly cap and the sender's balance are checked by the write, under the
 * sender's wallet lock (`src/data/shop.ts`).
 */
export const coinGifts = pgTable(
  "coin_gifts",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    seasonId: seasonId(),
    fromPlayerId: text().notNull(),
    toPlayerId: text().notNull(),
    amount: integer().notNull(),
    message: text(),
    createdAt: timestamp({ withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "coin_gifts_from_player_season_fk",
      columns: [t.fromPlayerId, t.seasonId],
      foreignColumns: [players.id, players.seasonId],
    }).onDelete("cascade"),
    foreignKey({
      name: "coin_gifts_to_player_season_fk",
      columns: [t.toPlayerId, t.seasonId],
      foreignColumns: [players.id, players.seasonId],
    }).onDelete("cascade"),
    check("coin_gifts_not_self", sql`${t.fromPlayerId} <> ${t.toPlayerId}`),
    check("coin_gifts_amount_positive", sql`${t.amount} > 0`),
    check(
      "coin_gifts_message_length",
      sql`${t.message} is null or char_length(${t.message}) <= 80`,
    ),
    index("coin_gifts_from_player_id_idx").on(t.fromPlayerId),
    index("coin_gifts_to_player_id_idx").on(t.toPlayerId),
  ],
);

/**
 * A crate (lootbox) a player opened. The crates themselves are defined in
 * code (`src/data/coin-rules.ts`); `crateId` names one. The item won is
 * owned through `purchaseId`, a zero-price `coin_purchases` row written in
 * the same statement, so ownership works exactly like buying. `price` is
 * what the crate cost then, and `rarity` the tier it rolled (a rarity, or
 * `power_up` for its small power-up chance).
 */
export const crateOpens = pgTable(
  "crate_opens",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    crateId: text().notNull(),
    price: integer().notNull(),
    itemId: text()
      .notNull()
      .references(() => shopItems.id, { onDelete: "restrict" }),
    rarity: text().notNull(),
    purchaseId: integer()
      .notNull()
      .unique("crate_opens_purchase_id_unique")
      .references(() => coinPurchases.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("crate_opens_price_positive", sql`${t.price} >= 0`),
    check(
      "crate_opens_rarity_known",
      sql`${t.rarity} in ('common', 'rare', 'epic', 'legendary', 'power_up')`,
    ),
    index("crate_opens_player_id_idx").on(t.playerId),
    index("crate_opens_item_id_idx").on(t.itemId),
  ],
);

/**
 * The skill pathway a player committed to: one per player (players are per
 * season), written with their first unlock and never changed (no respec).
 * The pathways are defined in code (`src/data/skill-trees.ts`).
 */
export const skillPaths = pgTable(
  "skill_paths",
  {
    playerId: text()
      .primaryKey()
      .references(() => players.id, { onDelete: "cascade" }),
    pathId: text().notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("skill_paths_player_id_path_id_unique").on(t.playerId, t.pathId),
  ],
);

/**
 * A skill node a player unlocked, at the price paid then. The composite key
 * keeps every unlock in the player's one pathway. A node that grants a
 * cosmetic owns it through `purchaseId`, a zero-price `coin_purchases` row
 * written in the same statement, like crate wins.
 */
export const skillUnlocks = pgTable(
  "skill_unlocks",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    playerId: text().notNull(),
    pathId: text().notNull(),
    nodeId: text().notNull(),
    price: integer().notNull(),
    purchaseId: integer()
      .unique("skill_unlocks_purchase_id_unique")
      .references(() => coinPurchases.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "skill_unlocks_player_path_fk",
      columns: [t.playerId, t.pathId],
      foreignColumns: [skillPaths.playerId, skillPaths.pathId],
    }).onDelete("cascade"),
    unique("skill_unlocks_player_id_node_id_unique").on(t.playerId, t.nodeId),
    check("skill_unlocks_price_positive", sql`${t.price} >= 0`),
  ],
);

// ── Mini-tasks ────────────────────────────────────────────────────────

/**
 * A small daily or bonus challenge between the weekly tasks, worth a little
 * Clim Coin. It runs from `startsOn` to `endsOn` (UK dates, inclusive); an
 * admin ticks off who completed it, and the reward is derived from those
 * completions (see `deriveEarnings`), never stored as a balance.
 */
export const miniTasks = pgTable(
  "mini_tasks",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    seasonId: seasonId(),
    title: text().notNull(),
    description: text().notNull().default(""),
    reward: integer().notNull(),
    startsOn: date({ mode: "string" }).notNull(),
    endsOn: date({ mode: "string" }).notNull(),
    ...recordedTimestamps(),
  },
  (t) => [
    unique("mini_tasks_id_season_id_unique").on(t.id, t.seasonId),
    check("mini_tasks_reward_range", sql`${t.reward} between 1 and 5`),
    check("mini_tasks_ends_after_start", sql`${t.endsOn} >= ${t.startsOn}`),
    index("mini_tasks_season_id_starts_on_idx").on(t.seasonId, t.startsOn),
  ],
);

/**
 * A player an admin marked as having completed a mini-task. The composite
 * keys keep the player in the mini-task's season. The actor's name is copied
 * in, like `coin_adjustments`.
 */
export const miniTaskCompletions = pgTable(
  "mini_task_completions",
  {
    miniTaskId: integer().notNull(),
    playerId: text().notNull(),
    seasonId: seasonId(),
    actorId: text().notNull(),
    actorName: text().notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.miniTaskId, t.playerId] }),
    foreignKey({
      name: "mini_task_completions_task_season_fk",
      columns: [t.miniTaskId, t.seasonId],
      foreignColumns: [miniTasks.id, miniTasks.seasonId],
    }).onDelete("cascade"),
    foreignKey({
      name: "mini_task_completions_player_season_fk",
      columns: [t.playerId, t.seasonId],
      foreignColumns: [players.id, players.seasonId],
    }).onDelete("cascade"),
    index("mini_task_completions_player_id_idx").on(t.playerId),
  ],
);
