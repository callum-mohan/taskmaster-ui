// Shared domain types for the Taskmaster competition UI.
// These intentionally describe plain data shapes: the data layer maps
// Postgres rows (see `src/db/schema.ts`) onto them, so the UI components
// never depend on the database.

export type TaskStatus = "upcoming" | "live" | "completed";

/**
 * How a task is contested and scored:
 *   "individual" → every player competes and is scored on their own.
 *   "team"       → players compete in fixed teams; the squad's points are
 *                  awarded to the team *and* to each of its members, so the
 *                  individual standings stay complete while a separate team
 *                  leaderboard is also derived (see `data/queries.ts`).
 */
export type TaskFormat = "individual" | "team";

export interface Player {
  id: string;
  name: string;
  /** Optional team grouping, reserved for a future feature. */
  team?: string;
  /** Optional avatar image. When absent, a generated icon is rendered. */
  avatarUrl?: string;
  /** Short player bio. Empty for now; shown as a placeholder until filled in. */
  bio?: string;
}

/**
 * A fixed squad of players (4–5) for team-format tasks. `memberIds` is the
 * single source of truth for who is on the team; the roster order is
 * irrelevant. Stored in the `teams` / `team_members` tables.
 */
export interface Team {
  id: string;
  name: string;
  /** Player ids that make up the squad (4–5 members). */
  memberIds: string[];
  /** Short command-style tagline shown on the team's card/page. */
  tagline?: string;
}

export interface Task {
  id: string;
  weekNumber: number;
  title: string;
  /** Short summary shown on cards. Hidden for upcoming tasks. */
  description: string;
  /**
   * Longer Taskmaster-style brief, shown on the task detail page. A plain
   * string renders as prose; an array of strings renders as a terminal-style
   * bullet list (one entry per point).
   */
  brief?: string | string[];
  releaseDate: string; // ISO 8601
  deadline: string; // ISO 8601
  status: TaskStatus;
  /** Whether the task is contested individually or in teams. */
  format: TaskFormat;
  /**
   * Whether an admin set a reveal password. The password itself is never
   * part of the public record.
   */
  passwordProtected: boolean;
  /** An admin revealed this password-protected task to everyone. */
  revealedToAll: boolean;
  /**
   * The task's content is withheld from this visitor: a password-protected,
   * not-yet-completed task they haven't unlocked. When true, `title` is
   * "???", `description` is empty and `brief` is absent.
   */
  locked: boolean;
}

/**
 * How the request's task snapshot treats password-protected tasks:
 * `public` redacts locked tasks unless the visitor unlocked them;
 * `admin` never redacts (admins edit the real content).
 */
export type TaskRevealContext =
  { mode: "public"; unlockedTaskIds: ReadonlySet<string> } | { mode: "admin" };

/** Why a reveal-password attempt on a task page failed. */
export type RevealError = "denied" | "throttled";

export interface Score {
  taskId: string;
  playerId: string;
  points: number;
  /** Finishing position for the task (1 = winner). */
  position: number;
  comment?: string;
}

/**
 * A one-off points adjustment for a player, tied to the task week it was
 * given in. Positive values are bonuses, negative values are deductions.
 * Adjustments count toward the player's overall total but never change that
 * week's finishing positions. Stored in the `bonus_points` table.
 */
export interface BonusPoint {
  taskId: string;
  playerId: string;
  /** Points added (positive) or deducted (negative). */
  points: number;
  /** Why the bonus or deduction was given. */
  reason: string;
  /**
   * The `bonus_points` row and when it was recorded (ISO 8601). Unset for
   * bonuses derived from poll votes, which aren't stored as rows.
   */
  id?: number;
  awardedAt?: string;
}

/**
 * A team's result on a single team-format task. The raw record the team
 * leaderboard is derived from (points from `team_scores`, position derived).
 */
export interface TeamScore {
  taskId: string;
  teamId: string;
  points: number;
  /** Finishing position for the task among teams (1 = winning team). */
  position: number;
  comment?: string;
}

/**
 * The signed-in user behind an admin request (from Neon Auth). Only users with
 * the `admin` role may use the admin area.
 */
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

export type ScoreAuditEntity = "task_score" | "team_score" | "bonus";
export type ScoreAuditAction = "created" | "updated" | "deleted";

/**
 * One change to a week's scores or bonuses, from `score_audit_log`. Points and
 * notes are unset on the side that didn't exist (before a create, after a
 * delete).
 */
export interface ScoreAuditEntry {
  id: number;
  /** When the change was made (ISO 8601). */
  at: string;
  actorName: string;
  entity: ScoreAuditEntity;
  action: ScoreAuditAction;
  /** Player id (task scores, bonuses) or team id (team scores). */
  subjectId: string;
  pointsBefore?: number;
  pointsAfter?: number;
  /** Score comment or bonus reason. */
  noteBefore?: string;
  noteAfter?: string;
}

/**
 * Where a player's sign-in account is up to:
 *   "none"    → no email set, so no account can be made.
 *   "invited" → email set; waiting for `npm run players:accounts`.
 *   "pending" → account created; still on the temporary password.
 *   "active"  → the player has set their own password.
 */
export type PlayerAccountStatus = "none" | "invited" | "pending" | "active";

/** A player's sign-in account (`player_accounts`), as the admin sees it. */
export interface PlayerAccount {
  playerId: string;
  email: string;
  userId?: string;
  mustChangePassword: boolean;
}

/** The signed-in player behind an `/account` request. */
export interface SessionPlayer {
  userId: string;
  email: string;
  playerId: string;
  playerName: string;
  bio?: string;
  avatarUrl?: string;
  mustChangePassword: boolean;
  /** Also holds the `admin` role, so `/admin` is available too. */
  isAdmin: boolean;
  /** When they last opened their notifications (ISO 8601); unset if never. */
  notificationsReadAt?: string;
}

/**
 * Whoever is signed in on a public page, for the navbar: players get a
 * profile link, admins an admin link, and everyone signed in a logout.
 */
export interface Viewer {
  name: string;
  isAdmin: boolean;
  /** Set when the account is linked to a player profile. */
  playerId?: string;
  /** Linked players only: when they last opened their notifications. */
  notificationsReadAt?: string;
}

/**
 * Every raw record for one request, loaded from Postgres in a single batch
 * (see `data/competition.ts`). The selectors in `data/queries.ts` are pure
 * computation over this snapshot.
 */
export interface CompetitionData {
  players: Player[];
  teams: Team[];
  /** Ascending by week number, with status derived at load time. */
  tasks: Task[];
  scores: Score[];
  teamScores: TeamScore[];
  bonusPoints: BonusPoint[];
  /**
   * When each task's results were first recorded (ISO 8601), keyed by task id.
   * Only tasks with scores for their format appear.
   */
  resultsPostedAt: Record<string, string>;
  /** Every poll (drafts included), newest opening first. */
  polls: Poll[];
}

// ── Polls ─────────────────────────────────────────────────────────────

/** "single" → pick exactly one option; "multiple" → pick min–max options. */
export type PollKind = "single" | "multiple";

/**
 * Derived from the poll's dates, like `TaskStatus`:
 *   now < opensAt               → "scheduled"
 *   opensAt <= now < closesAt   → "open"
 *   now >= closesAt             → "closed"
 */
export type PollStatus = "scheduled" | "open" | "closed";

/**
 * Who sees the tallies (admins always do):
 *   "always"      → everyone, even before voting.
 *   "after_vote"  → players once they've voted; everyone once it closes.
 *   "after_close" → everyone, but only once it closes.
 *   "admin_only"  → never published.
 */
export type PollResultsVisibility =
  "always" | "after_vote" | "after_close" | "admin_only";

export interface PollOption {
  id: number;
  label: string;
}

/** One option a player picked. */
export interface PollVote {
  optionId: number;
  playerId: string;
}

/** A poll's settings (no votes), safe to hand to components. */
export interface PollSettings {
  id: string;
  question: string;
  description?: string;
  kind: PollKind;
  /** Options a voter must pick (1 for single choice). */
  minChoices: number;
  /** Options a voter may pick (1 for single choice; capped at the option count). */
  maxChoices: number;
  opensAt: string; // ISO 8601
  closesAt: string; // ISO 8601
  resultsVisibility: PollResultsVisibility;
  allowVoteChange: boolean;
  /** Anonymous polls publish counts only; public polls name the voters. */
  anonymous: boolean;
  /** Days a closed poll stays on the homepage (0 = gone once closed). */
  showOnHomeDays: number;
  /** Drafts (false) are hidden from the site whatever the dates. */
  published: boolean;
  /** Bonus points each voter earns (0 = none). */
  voteBonusPoints: number;
  /**
   * The week the voting bonus counts in: the admin's pick, or else the week
   * live when the poll opens. Absent only when there are no tasks at all.
   */
  bonusTaskId?: string;
  /** True when `bonusTaskId` was picked by an admin rather than derived. */
  bonusTaskPinned: boolean;
  status: PollStatus;
  /** In display order. */
  options: PollOption[];
}

/** A poll with its raw votes. Votes never leave the data layer as-is. */
export interface Poll extends PollSettings {
  votes: PollVote[];
}

// Derived view models used by the UI. Keeping these separate from the
// raw records means pages receive ready-to-render data.

export interface LeaderboardRow {
  rank: number;
  player: Player;
  /** Overall total: task points plus net bonus points. */
  points: number;
  /** Net bonus points (bonuses less deductions) included in `points`. */
  bonusPoints: number;
  tasksCompleted: number;
  wins: number;
  averagePosition: number;
  /** Recent finishing positions, most recent last. */
  form: number[];
  /** Rank on the standings before the most recent completed task. */
  previousRank?: number;
  /** Places gained since the previous standings (positive = moved up). */
  movement?: number;
}

export interface TaskResult {
  task: Task;
  winner: Player;
  winningScore: number;
  completionDate: string;
}

/** A task plus its outcome, used by task cards and the tasks grid. */
export interface TaskSummary {
  task: Task;
  /** Winner of a completed individual task, if any. */
  winner?: Player;
  /** The winner's score for a completed task, if any. */
  winningScore?: number;
  /** Winning squad of a completed team task, if any. */
  winningTeam?: Team;
}

/** A bonus or deduction with its task and player resolved, for display. */
export interface BonusEntry {
  task: Task;
  player: Player;
  /** Points added (positive) or deducted (negative). */
  points: number;
  reason: string;
}

/** A player's bonus/deduction ledger with running totals. */
export interface PlayerBonusSummary {
  /** Every adjustment for the player, oldest week first. */
  entries: BonusEntry[];
  /** Sum of all bonuses (positive adjustments). */
  awarded: number;
  /** Sum of all deductions (a negative number, or 0). */
  deducted: number;
  /** Net effect on the player's overall total. */
  net: number;
}

/** One row of a completed task's full results table. */
export interface TaskResultRow {
  position: number;
  player: Player;
  points: number;
  comment?: string;
}

// ─── Team view models ───────────────────────────────────────────────────
// Derived, ready-to-render team data. Mirrors the individual view models
// (LeaderboardRow / TaskResultRow) so the UI patterns stay consistent.

/** A team's row in the team leaderboard, with its members resolved. */
export interface TeamStanding {
  rank: number;
  team: Team;
  members: Player[];
  points: number;
  /** Team tasks the squad has been scored on. */
  tasksCompleted: number;
  /** Team tasks the squad has won. */
  wins: number;
  averagePosition: number;
  /** Recent finishing positions, most recent last. */
  form: number[];
  /** Rank on the team standings before the most recent scored team task. */
  previousRank?: number;
  /** Places gained since the previous team standings (positive = moved up). */
  movement?: number;
}

/** One row of a completed team task's results table. */
export interface TeamTaskResultRow {
  position: number;
  team: Team;
  members: Player[];
  points: number;
  comment?: string;
}

/** Summary counts for the teams overview page. */
export interface TeamStats {
  totalTeams: number;
  /** Smallest squad size across all teams. */
  minTeamSize: number;
  /** Largest squad size across all teams. */
  maxTeamSize: number;
  /** Team-format tasks on the schedule. */
  teamTasks: number;
  /** Team-format tasks that have been scored. */
  teamTasksScored: number;
}

/**
 * The "what changed since you last visited" signal: the current task used to
 * highlight when a new week has gone live. `taskId` is the change key the
 * client compares against the visitor's last acknowledged task.
 */
export interface WhatsNewInfo {
  taskId: string;
  weekNumber: number;
  /** Display title, falling back to the week label for unrevealed tasks. */
  title: string;
  status: TaskStatus;
  /** Link to the task detail page. */
  href: string;
}

/**
 * How a changelog entry is tagged, driving its badge colour in the "what's
 * new" modal: a brand-new capability, an improvement to an existing one, or a
 * bug fix.
 */
export type FeatureCategory = "new" | "improved" | "fixed";

/**
 * One entry in the site changelog — a feature or change shipped to the
 * Taskmaster UI, surfaced newest-first in the homepage "what's new" modal.
 * Dates are ISO 8601 strings, formatted at the page level.
 */
export interface FeatureUpdate {
  /** Stable id; also the change key for the trigger's unseen indicator. */
  id: string;
  /** ISO 8601 date the change shipped. */
  date: string;
  title: string;
  description: string;
  category: FeatureCategory;
}

/** One side of the previous/next task pager on a task detail page. */
export interface TaskPagerLink {
  href: string;
  weekNumber: number;
  /** Display title, falling back to the week label for unrevealed tasks. */
  title: string;
  status: TaskStatus;
}

/** Adjacent tasks either side of the one being viewed. */
export interface TaskPager {
  prev?: TaskPagerLink;
  next?: TaskPagerLink;
}

/** One selectable opponent in the player-profile compare picker. */
export interface CompareOpponent {
  id: string;
  name: string;
  rank: number;
}

/** Data for the "compare with…" entry point on a player profile. */
export interface PlayerCompareOptions {
  /** Suggested opponent: the player directly adjacent on the standings. */
  rival?: CompareOpponent;
  /** Every other player, ordered by rank, for the dropdown. */
  opponents: CompareOpponent[];
}

/** A player's rank before and straight after one week's results. */
export interface PlayerRankChange {
  task: Task;
  rank: number;
  previousRank: number;
  /** When the week's results were posted (ISO 8601). */
  at: string;
}

/** A single player's outcome on one task, for the player detail page. */
export interface PlayerTaskResult {
  task: Task;
  position: number;
  points: number;
  comment?: string;
}

/** One player's figures on a single task within a head-to-head comparison. */
export interface ComparisonSide {
  position: number;
  points: number;
}

/** A single task row comparing two players side by side. */
export interface ComparisonTaskRow {
  task: Task;
  /** Player A's result, if they were scored on this task. */
  a?: ComparisonSide;
  /** Player B's result, if they were scored on this task. */
  b?: ComparisonSide;
  /** Who finished higher on this task (lower position wins). */
  leader: "a" | "b" | "tie";
}

/** Two players compared head to head, with a per-task breakdown. */
export interface PlayerComparison {
  a: LeaderboardRow;
  b: LeaderboardRow;
  /** Each task either player was scored on, ordered by week. */
  tasks: ComparisonTaskRow[];
  /** Record over tasks both players completed. */
  headToHead: {
    aWins: number;
    bWins: number;
    ties: number;
    shared: number;
  };
}

/**
 * Which bucket a command-palette entry belongs to (section + icon). `"action"`
 * entries are synthesized on the client for dynamic commands (e.g. "jump to
 * week N", "compare X vs Y") and are never emitted by the data layer.
 */
export type CommandPaletteGroup =
  "page" | "task" | "team" | "player" | "action";

/** A single searchable destination in the global command palette. */
export interface CommandPaletteItem {
  /** Stable unique id, used as the DOM key for the rendered row. */
  id: string;
  /** Primary label shown in the list. */
  label: string;
  /** Grouping used for the section heading and leading glyph. */
  group: CommandPaletteGroup;
  /** Destination URL. */
  href: string;
  /** Optional supporting text, e.g. a week label, rank or status. */
  hint?: string;
  /** Extra terms folded into the fuzzy-search haystack but not displayed. */
  keywords?: string;
}

/** The player a follower needs to overtake next (directly ahead of them). */
export interface FollowRival {
  id: string;
  name: string;
  rank: number;
  /** Link to the rival's profile page. */
  href: string;
  /** Points the rival is ahead by (0 when level on points but ahead on tie-break). */
  gap: number;
}

/**
 * One player's at-a-glance standing for the "this is me" follow widget. The
 * visitor's chosen identity is resolved on the client (localStorage), so the
 * widget ships every player's row and renders whichever one was picked.
 */
export interface FollowStanding {
  id: string;
  name: string;
  /** Path to the player's assigned avatar SVG (already base-prefixed). */
  icon: string;
  rank: number;
  points: number;
  wins: number;
  tasksCompleted: number;
  /** Link to this player's profile page. */
  href: string;
  /** True when this player tops the standings (no one to overtake). */
  isLeader: boolean;
  /** The player directly ahead on the standings, if any. */
  rival?: FollowRival;
}

export interface CompetitionStats {
  totalPlayers: number;
  tasksCompleted: number;
  pointsAwarded: number;
  differentWinners: number;
}

/** Accent token used to colour a chart series or achievement badge. */
export type ChartAccent = "acid" | "magenta" | "cyan" | "amber" | "ink-dim";

/** One line on a points chart: a label plus a cumulative value per week. */
export interface ChartSeries {
  id: string;
  label: string;
  accent: ChartAccent;
  /** Cumulative points, one entry per week on the shared x-axis. */
  values: number[];
  /** Final cumulative total, for the legend. */
  total: number;
}

/** A points-over-time chart: shared week axis plus one or more series. */
export interface PointsChartData {
  /** Shared x-axis, one entry per scored week (ascending). */
  weeks: { weekNumber: number; label: string }[];
  series: ChartSeries[];
  /** Largest cumulative value across all series, for y-axis scaling. */
  maxValue: number;
}

/** A single earned badge shown on a player profile. */
export interface Achievement {
  id: string;
  /** Badge name, e.g. "Serial Winner". */
  label: string;
  /** Short supporting detail, e.g. "Won 2 tasks". */
  detail: string;
  /** Decorative glyph (rendered aria-hidden). */
  icon: string;
  accent: Exclude<ChartAccent, "ink-dim">;
}

/** A single Hall of Fame / superlative award for the stats page. */
export interface Award {
  id: string;
  /** Award name, e.g. "Most Wins". */
  title: string;
  /** Command-style sub-label, e.g. "max wins". */
  command: string;
  /** The honoured player, when the award belongs to someone. */
  player?: Player;
  /** Headline value, pre-formatted, e.g. "3 wins". */
  value: string;
  /** Supporting context, e.g. the task it relates to. */
  detail?: string;
  accent: "acid" | "magenta" | "amber" | "cyan";
}

// ─── Weekly "episode" recap ──────────────────────────────────────────────
// A recap turns a completed week into an episode page: who won, who climbed,
// how the title race swung, and the editorial colour (headline, summary, the
// funniest moment). Raw editorial copy is a record (`WeekRecapContent`);
// everything else is derived in queries.ts from scores + standings.

/**
 * Hand-written editorial colour for a week, keyed by task id in
 * `src/data/recaps.ts`. Every field is optional — the recap page falls back
 * to auto-generated text when a week has not been written up yet. Becomes a
 * Supabase table later; keep the shape stable.
 */
export interface WeekRecapContent {
  /** Punchy episode headline, e.g. "Rose cracks the opener". */
  headline?: string;
  /** A short narrative paragraph recapping the week. */
  summary?: string;
  /** The funniest moment of the week (the "edit suite" highlight). */
  moment?: string;
  /** Player the moment is about, so it can link to their profile. */
  momentPlayerId?: string;
  /** An optional memorable quote from the week. */
  quote?: { text: string; attribution?: string };
}

/** A player who moved up or down the standings during a single week. */
export interface RecapMover {
  player: Player;
  /** Overall rank before this week's result (1 = top). */
  fromRank: number;
  /** Overall rank after this week's result. */
  toRank: number;
  /** Places gained this week (positive = climbed). */
  places: number;
  /** Points earned in this week's task. */
  weekPoints: number;
}

/** The state of the title race at the top of the table after a week. */
export interface RecapTitleRace {
  leader: Player;
  /** The runner-up, if there is one. */
  runnerUp?: Player;
  /** Leader's points margin over the runner-up after this week. */
  lead: number;
  /** The same margin before this week (absent for the first scored week). */
  previousLead?: number;
  /** Change in the lead this week (positive = the leader pulled away). */
  swing?: number;
  /** True when this week produced a new outright leader. */
  changedHands: boolean;
}

/** A fully-derived episode recap for one completed week. */
export interface WeekRecap {
  task: Task;
  /** Display label, e.g. "WEEK 03". */
  weekLabel: string;
  /** Episode number (equals the week number). */
  episodeNumber: number;
  /** The task winner and their winning margin, if the week was scored. */
  winner?: { player: Player; points: number; margin: number };
  /** Top three finishers for the week. */
  podium: TaskResultRow[];
  /** Biggest climber of the week, if anyone moved up. */
  biggestClimber?: RecapMover;
  /** Biggest faller of the week, if anyone moved down. */
  biggestFaller?: RecapMover;
  /** The title race after this week. */
  titleRace?: RecapTitleRace;
  /** Total points awarded across the week. */
  weekPoints: number;
  /** How many players were scored this week. */
  playersScored: number;
  /** Overall standings after this week, annotated with weekly movement. */
  standings: LeaderboardRow[];
  /** Editorial copy, merged with sensible auto-generated fallbacks. */
  headline: string;
  summary: string;
  moment?: string;
  momentPlayer?: Player;
  quote?: { text: string; attribution?: string };
  /** Previous / next completed recap for the episode pager. */
  prev?: TaskPagerLink;
  next?: TaskPagerLink;
}

/** A condensed recap for the episode index grid. */
export interface RecapSummary {
  task: Task;
  weekLabel: string;
  episodeNumber: number;
  headline: string;
  winner?: Player;
  winningScore?: number;
  biggestClimber?: RecapMover;
}

/**
 * A released task as filed in the 404 page's `lost.sh` text adventure, where
 * the "archive" room lets players leaf through briefs that have aired so far.
 */
export interface LostArchiveEntry {
  weekNumber: number;
  title: string;
  description: string;
}

// ── Poll view models ──────────────────────────────────────────────────

/** Who is looking at a poll, which decides what they can do with it. */
export type PollViewerKind = "guest" | "non-player" | "player";

export interface PollViewer {
  kind: PollViewerKind;
  /** Set for `"player"` viewers. */
  playerId?: string;
}

export interface PollOptionResult {
  option: PollOption;
  votes: number;
  /** Share of voters (not of ticks) who picked it, 0–100, rounded. */
  percent: number;
  /** Has the most votes (ties all lead); false when nobody has voted. */
  leading: boolean;
  /** Who picked it, only for public (non-anonymous) polls. */
  voters?: Player[];
}

export interface PollResults {
  /** Players who voted. */
  voterCount: number;
  /** Roster size, for turnout ("12 of 25 voted"). */
  eligibleCount: number;
  options: PollOptionResult[];
}

/** Everything a homepage poll card needs for one viewer. */
export interface PollCard {
  poll: PollSettings;
  viewer: PollViewerKind;
  /** Option ids this viewer picked (empty if they haven't voted). */
  myChoices: number[];
  hasVoted: boolean;
  /** The ballot form is shown (open poll, player, and not locked in). */
  canVote: boolean;
  /** Tallies, when this viewer may see them. */
  results?: PollResults;
  /** Why results are hidden, e.g. "Results appear once you vote." */
  resultsHint?: string;
}

/** A row in the admin poll list. */
export interface PollSummary {
  poll: PollSettings;
  voterCount: number;
}

// ── Notifications ─────────────────────────────────────────────────────

/**
 * What happened; each kind is derived from records already in the snapshot.
 * Results, rank, bonus and deduction notifications are personal to a player.
 */
export type NotificationKind =
  | "task-released"
  | "poll-opened"
  | "deadline-soon"
  | "results-posted"
  | "rank-up"
  | "bonus-awarded"
  | "points-deducted";

/** One entry in a player's notification feed. */
export interface NotificationItem {
  /** Stable per event, e.g. `task:week-05`, `poll:best-egg` or `bonus:12`. */
  id: string;
  kind: NotificationKind;
  title: string;
  /** Secondary line, e.g. "Week 05 · team task". */
  detail?: string;
  /** Base-prefixed link to what the notification is about. */
  href: string;
  /** When it happened (ISO 8601). */
  at: string;
  /** Happened after the player last opened their notifications. */
  unread: boolean;
}

/** A player's newest notifications, newest first. */
export interface NotificationFeed {
  items: NotificationItem[];
  unreadCount: number;
}
