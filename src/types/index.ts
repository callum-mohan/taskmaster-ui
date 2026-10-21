// Shared domain types for the Taskmaster competition UI.
// These intentionally describe plain data shapes: the data layer maps
// Postgres rows (see `src/db/schema.ts`) onto them, so the UI components
// never depend on the database.

export type TaskStatus = "upcoming" | "live" | "completed";

/**
 * Derived from the season's weeks and whether an admin has closed it:
 *   no week released yet   → "upcoming"
 *   a week released        → "running"
 *   closed by an admin     → "closed" (champion crowned)
 */
export type SeasonStatus = "upcoming" | "running" | "closed";

/**
 * One run of the competition (an academy cohort). Players, squads and weeks
 * each belong to exactly one season; the public site shows the current one.
 */
export interface Season {
  id: string;
  /** Display name, e.g. "Cohort 2026". */
  name: string;
  /** Whether this is the season the public site shows. */
  isCurrent: boolean;
  /** When an admin closed the season and crowned its champion (ISO 8601). */
  closedAt?: string;
  createdAt: string;
  status: SeasonStatus;
  /** First week's release, once the season has weeks (ISO 8601). */
  startsAt?: string;
  /** Last week's deadline, once the season has weeks (ISO 8601). */
  endsAt?: string;
  weekCount: number;
}

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
  seasonId: string;
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
  seasonId: string;
  name: string;
  /** Player ids that make up the squad (4–5 members). */
  memberIds: string[];
  /** Short command-style tagline shown on the team's card/page. */
  tagline?: string;
}

export interface Task {
  id: string;
  seasonId: string;
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
  /** Who may submit entries on the site, and how many (see `task_submissions`). */
  submissions: TaskSubmissionSettings;
  /**
   * Results night: an admin is holding this week's results back. The public
   * snapshot leaves out its scores and recorded bonuses until they're
   * published; `/live` reveals them one at a time.
   */
  resultsHeld: boolean;
  /** How many results `/live` has revealed so far (bottom first). */
  resultsRevealCount: number;
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
  /** The player used Golden Week on this task (their points are boosted). */
  goldenWeek?: boolean;
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
  /** The season this snapshot covers. */
  season: Season;
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
  /** Every People's Choice vote, with the entry it went to. */
  peoplesChoiceVotes: PeoplesChoiceVote[];
  /** Every winner prediction. */
  predictions: Prediction[];
  /** Editorial recap copy, keyed by task id. */
  recaps: Record<string, WeekRecapContent>;
  /** The site changelog, newest first. */
  changelog: FeatureUpdate[];
  /** Clim Coin: the shop, and the season's purchases, uses and grants. */
  coins: ClimCoinData;
  /** Site-wide feature flags, toggled in `/admin/site` (off unless set). */
  features: FeatureFlags;
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
 * `"admin"` entries are only included for signed-in admins.
 */
export type CommandPaletteGroup =
  "page" | "task" | "team" | "player" | "admin" | "action";

/** One area of the admin panel (sub-nav tab, dashboard shortcut, palette entry). */
export interface AdminSection {
  /** Root-relative path, e.g. `/admin/weeks`. */
  href: string;
  /** Short tab label in the admin sub-nav. */
  label: string;
  /** Action-style title for the dashboard and command palette. */
  title: string;
  /** One-line description of what the section is for. */
  hint: string;
  /** Extra command-palette search terms. */
  keywords?: string;
  /** Other root-relative path prefixes that belong to this section. */
  match?: string[];
}

/** A step of a week's admin workflow, and the tab that handles it. */
export type WeekStepId = "brief" | "judge" | "live" | "recap";

/**
 * Where a week stands on a step: `done`; `active` (needs doing now);
 * `waiting` (can't happen yet); `optional` (nothing required).
 */
export type WeekStepState = "done" | "active" | "waiting" | "optional";

export interface WeekStep {
  id: WeekStepId;
  /** Tab label, e.g. `judge`. */
  label: string;
  /** Root-relative admin path of the step's tab. */
  href: string;
  state: WeekStepState;
  /** Short status line, e.g. `8 / 12 scored`. */
  detail: string;
}

/** Admin-side counts for one week, behind its workflow steps. */
export interface WeekCounts {
  individualScores: number;
  teamScores: number;
  bonuses: number;
  entries: number;
  hiddenEntries: number;
  recapWritten: boolean;
}

/** A week's progress through the admin workflow (brief → recap). */
export interface WeekProgress {
  steps: WeekStep[];
  /** The first step that needs doing now, if any. */
  next?: WeekStep;
  /** Players (or squads, on team tasks) with a score this week. */
  scored: number;
  /** Players (or squads) that can be scored. */
  roster: number;
}

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
  /** Path to the player's assigned avatar image (already base-prefixed). */
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
  /** Still in progress (e.g. a streak that's still going). */
  active?: boolean;
}

// ─── Streaks & comebacks ─────────────────────────────────────────────────
// Derived in `streak-queries.ts` from each scored week's results and the
// overall standings straight after it.

/** What a streak counts: weekly wins, top-3 finishes, or weeks with points. */
export type StreakKind = "win" | "podium" | "scoring";

/** A run of consecutive scored weeks that all met a streak's condition. */
export interface StreakRun {
  kind: StreakKind;
  length: number;
  fromWeek: number;
  toWeek: number;
  /**
   * Still going: the run includes the latest scored week of a season that
   * isn't over yet.
   */
  active: boolean;
}

/** Places gained in the overall standings over one week's results. */
export interface RankClimb {
  task: Task;
  fromRank: number;
  toRank: number;
  places: number;
}

/** A recovery from a player's lowest overall rank to where they stand now. */
export interface Comeback {
  /** Their worst rank after any scored week (the latest such week). */
  lowRank: number;
  lowWeek: number;
  /** Their rank now (the final rank once the season is closed). */
  rank: number;
  places: number;
}

/** One player's streaks, best climb and comeback across a season. */
export interface PlayerStreaks {
  player: Player;
  /** The longest run of each kind (earliest on a tie), when there was one. */
  longest: Partial<Record<StreakKind, StreakRun>>;
  biggestClimb?: RankClimb;
  comeback?: Comeback;
  /** Best rank held after any scored week (the earliest such week). */
  peak?: { rank: number; weekNumber: number };
  /** Scored weeks after which they were top of the table (ties included). */
  weeksAtTop: number;
}

// ─── Season "wrapped" ────────────────────────────────────────────────────
// The end-of-season summary, public once a season is closed. Derived in
// `wrapped-queries.ts` from the season's snapshot.

/** A player and how many scored weeks they spent top of the table. */
export interface TitleRaceLeader {
  player: Player;
  weeks: number;
}

/** The whole season, wrapped up. */
export interface SeasonWrapped {
  season: Season;
  /** Final standings (every player, ranked). */
  standings: LeaderboardRow[];
  /** The top three who played, champion first. */
  podium: LeaderboardRow[];
  /** The champion's points lead over the runner-up. */
  margin?: number;
  winningSquad?: TeamStanding;
  stats: CompetitionStats;
  /** Weeks that were scored. */
  weeksScored: number;
  /** Net bonus points handed out across the season. */
  bonusPoints: number;
  /** Times a new outright leader took over after a week's results. */
  leadChanges: number;
  /** Everyone who topped the table after a week, most weeks first. */
  leaders: TitleRaceLeader[];
  /** The champion led after every scored week. */
  wireToWire: boolean;
  /** The season's streak and comeback leaders. */
  streaks: Award[];
  /** The season's superlatives (the champion is crowned separately). */
  awards: Award[];
}

/** A short, playful label for how a player's season went. */
export interface WrappedPersona {
  title: string;
  blurb: string;
}

/** A neighbour on the final standings, and the points between you. */
export interface WrappedNeighbour {
  player: Player;
  rank: number;
  gap: number;
}

/** One player's season, wrapped up. */
export interface PlayerWrapped {
  season: Season;
  standing: LeaderboardRow;
  persona: WrappedPersona;
  playerCount: number;
  weeksScored: number;
  /** Players who finished below them. */
  beaten: number;
  podiums: number;
  /** Their highest-scoring week (best finish, then earliest, on a tie). */
  bestWeek?: PlayerTaskResult;
  /** Their lowest finish, when it differs from their best week. */
  toughestWeek?: PlayerTaskResult;
  /** Peak rank, streaks, best climb and comeback as cards. */
  highlights: Award[];
  /** Season awards and streak titles they won (unnamed: they're theirs). */
  awardsWon: Award[];
  bonus: PlayerBonusSummary;
  squad?: TeamStanding;
  /** The player directly above on the final standings. */
  chasing?: WrappedNeighbour;
  /** The player directly below on the final standings. */
  holdingOff?: WrappedNeighbour;
  chart?: PointsChartData;
}

// ─── Weekly "episode" recap ──────────────────────────────────────────────
// A recap turns a completed week into an episode page: who won, who climbed,
// how the title race swung, and the editorial colour (headline, summary, the
// funniest moment). Raw editorial copy is a record (`WeekRecapContent`);
// everything else is derived in queries.ts from scores + standings.

/**
 * Hand-written editorial colour for a week, from the `recaps` table (edited
 * in the week's recap tab, `/admin/weeks/<task>/recap`). Every field is
 * optional — the recap page falls back to auto-generated text when a week
 * has not been written up yet.
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
  | "points-deducted"
  | "sabotaged"
  | "shielded"
  | "reflected"
  | "gift-received";

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

// ── Task submissions ──────────────────────────────────────────────────

/** "photo" → an image in Object Storage (with an optional caption); "text" → a written entry. */
export type SubmissionKind = "photo" | "text";

/** A task's submission rules, set by an admin. */
export interface TaskSubmissionSettings {
  /** Entries allowed per player (or per squad on team tasks); 0 = closed. */
  max: number;
  /** Which kinds of entry are accepted. Empty when closed. */
  kinds: SubmissionKind[];
}

/** One entry from `task_submissions`. */
export interface TaskSubmission {
  id: number;
  taskId: string;
  /** The player who submitted it. */
  playerId: string;
  /** The squad that owns it, on team tasks. */
  teamId?: string;
  kind: SubmissionKind;
  /** The text entry, or a photo's caption. */
  text?: string;
  /** Photos only: where the image lives in the storage bucket. */
  objectKey?: string;
  contentType?: string;
  sizeBytes?: number;
  /** An admin hid it from the public gallery. */
  hidden: boolean;
  /** When it was submitted (ISO 8601). */
  createdAt: string;
}

/** Whose entry slots a submission uses: the player's, or their squad's. */
export type SubmissionOwnerRef =
  { type: "player"; id: string } | { type: "team"; id: string };

/** A submission owner ready to render. */
export interface SubmissionOwner {
  type: "player" | "team";
  id: string;
  name: string;
  /** Base-prefixed profile link. */
  href: string;
}

/** A submission ready to render, with its submitter and image link. */
export interface SubmissionEntry extends TaskSubmission {
  submitterName: string;
  /** Base-prefixed, access-checked image URL (photos only). */
  mediaUrl?: string;
}

/** Who is looking at a task's submissions. */
export interface SubmissionViewer {
  signedIn: boolean;
  isAdmin: boolean;
  /** Set when the account is linked to a player profile. */
  playerId?: string;
}

/**
 * Why a viewer can't submit right now:
 *   "upcoming" / "completed" → outside the task window;
 *   "encrypted" → the brief is still password-locked for them;
 *   "closed"    → the task doesn't take entries on the site;
 *   "guest"     → not signed in; "no-player" → account has no player profile;
 *   "no-team"   → team task, but the player isn't in a squad;
 *   "full"      → every entry slot is used.
 */
export type SubmissionBlockReason =
  | "upcoming"
  | "completed"
  | "encrypted"
  | "closed"
  | "guest"
  | "no-player"
  | "no-team"
  | "full";

/** The "your entries" panel on a task page. */
export interface SubmissionPanel {
  settings: TaskSubmissionSettings;
  /** Set when the viewer has entry slots on this task. */
  owner?: SubmissionOwner;
  /** The owner's own entries, oldest first. */
  entries: SubmissionEntry[];
  remaining: number;
  canSubmit: boolean;
  blockedBy?: SubmissionBlockReason;
  /** Entries can still be withdrawn (the task is live). */
  canDelete: boolean;
}

/** One player's or squad's entries in a gallery. */
export interface SubmissionGalleryGroup {
  owner: SubmissionOwner;
  entries: SubmissionEntry[];
}

/** A player an admin can add an entry for. */
export interface SubmitterOption {
  id: string;
  name: string;
}

/** Players an admin can add entries for, grouped by squad on team tasks. */
export interface SubmitterOptionGroup {
  /** The squad's name (team tasks only). */
  label?: string;
  players: SubmitterOption[];
}

/** What happened to a player's submission attempt (shown on the task page). */
export type SubmissionOutcome =
  | "submitted"
  | "deleted"
  | "closed"
  | "full"
  | "kind"
  | "invalid"
  | "too-large"
  | "bad-type"
  | "heic"
  | "upload-failed";

// ── Reactions & People's Choice ───────────────────────────────────────

/** The emoji reactions a player can leave on a gallery entry. */
export type ReactionKind = "laugh" | "fire" | "clap" | "mind_blown" | "egg";

/** One player's reaction to an entry (`submission_reactions`). */
export interface SubmissionReaction {
  submissionId: number;
  playerId: string;
  kind: ReactionKind;
}

/** One reaction button under a gallery entry. */
export interface ReactionTally {
  kind: ReactionKind;
  /** Decorative glyph (pair it with `label`). */
  emoji: string;
  label: string;
  count: number;
  /** The viewer left this reaction. */
  mine: boolean;
  /** Who reacted, for the tooltip. */
  names: string[];
}

/** A People's Choice vote (`peoples_choice_votes`) with the entry it went to. */
export interface PeoplesChoiceVote {
  taskId: string;
  /** The voter. */
  playerId: string;
  submissionId: number;
  /** Who submitted the entry, and their squad on team tasks. */
  submitterId: string;
  teamId?: string;
  /** The entry was hidden by an admin, so the vote doesn't count. */
  entryHidden: boolean;
}

/**
 * Where a task's People's Choice vote is up to: it opens at the deadline
 * (when the gallery goes up) and closes a fixed time later, when the bonus
 * is awarded.
 */
export type PeoplesChoiceStatus = "not-open" | "open" | "closed";

/** The People's Choice vote on one task, for one viewer. */
export interface PeoplesChoiceSummary {
  status: PeoplesChoiceStatus;
  /** When voting closes (ISO 8601). */
  closesAt: string;
  /** Points each winner earns. */
  bonusPoints: number;
  /** Players who have voted. */
  voterCount: number;
  /** The viewer is a player and voting is open. */
  canVote: boolean;
  /** The entry the viewer voted for. */
  myVote?: number;
  /** Winning entry ids (closed votes with at least one vote). */
  winners: number[];
}

/** What a viewer can do with one gallery entry, and how it's doing. */
export interface GalleryEntrySocial {
  reactions: ReactionTally[];
  /** The viewer is a player, so the reaction buttons work. */
  canReact: boolean;
  /** The viewer may vote for this entry (open vote, not their own). */
  canVote: boolean;
  /** The viewer's People's Choice vote went here. */
  votedFor: boolean;
  /** People's Choice votes, once voting has closed. */
  votes?: number;
  /** Won (or tied for) People's Choice. */
  winner: boolean;
}

/** A gallery entry with its reactions and People's Choice state. */
export interface GalleryEntry extends SubmissionEntry {
  social: GalleryEntrySocial;
}

/** One player's or squad's entries in the public gallery. */
export interface PublicGalleryGroup {
  owner: SubmissionOwner;
  entries: GalleryEntry[];
}

/** What happened to a reaction or People's Choice vote (shown on the task page). */
export type GalleryOutcome =
  | "reacted"
  | "unreacted"
  | "voted"
  | "vote-changed"
  | "vote-withdrawn"
  | "vote-closed"
  | "own-entry"
  | "invalid";

// ── Predictions ───────────────────────────────────────────────────────

/** Who a prediction backs: a player, or a squad on team tasks. */
export type PredictionPick =
  { type: "player"; id: string } | { type: "team"; id: string };

/** A player's call on who wins a week (`predictions`). */
export interface Prediction {
  taskId: string;
  /** The player making the call. */
  playerId: string;
  pick: PredictionPick;
}

/** A pick ready to render. */
export interface PredictionChoice {
  type: "player" | "team";
  id: string;
  name: string;
  /** Base-prefixed profile link. */
  href: string;
}

/** Everyone who backed one pick, once predictions are revealed. */
export interface PredictionTallyRow {
  choice: PredictionChoice;
  backers: Player[];
  /** The pick won (set once results are in). */
  correct?: boolean;
}

/**
 * Where a week's predictions are up to:
 *   "open"     → the task is live, calls can be made or changed;
 *   "locked"   → the deadline passed, calls are revealed, results pending;
 *   "settled"  → the results are in and correct calls earned their bonus;
 *   "upcoming" → the task hasn't been released yet.
 */
export type PredictionStatus = "upcoming" | "open" | "locked" | "settled";

/** The "call the winner" panel on a task page, for one viewer. */
export interface PredictionPanel {
  status: PredictionStatus;
  /** Points a correct call earns. */
  bonusPoints: number;
  /** The viewer is a player and calls are open. */
  canPredict: boolean;
  /** Why a signed-out or non-player viewer can't predict. */
  viewer: "guest" | "non-player" | "player";
  /** Who the viewer can back (never themselves or their own squad). */
  options: PredictionChoice[];
  myPick?: PredictionChoice;
  /** The viewer's call won (settled weeks only). */
  myPickCorrect?: boolean;
  /** How many players have made a call. */
  count: number;
  /** Every pick and its backers, once the deadline has passed. */
  tally: PredictionTallyRow[];
}

/** What happened to a player's prediction (shown on the task page). */
export type PredictionOutcome =
  "saved" | "changed" | "withdrawn" | "closed" | "invalid";

// ── Live results night ────────────────────────────────────────────────

/** One revealed result on the live board. */
export interface LiveResultRow {
  position: number;
  type: "player" | "team";
  id: string;
  name: string;
  /** Base-prefixed profile link. */
  href: string;
  points: number;
  comment?: string;
  /** Squad members, on team tasks. */
  members?: Player[];
  /** Player avatar source, on individual tasks. */
  player?: Player;
  /** The most recent reveal. */
  latest: boolean;
}

/**
 * The live results board for the week being revealed. Unrevealed results
 * are only counted, never sent to the page.
 */
export interface LiveShow {
  task: Task;
  /** Results to reveal in total. */
  total: number;
  /** Revealed so far, best position first. */
  revealed: LiveResultRow[];
  /** Results still to come. */
  hiddenCount: number;
  /** Every result is out (the winner included). */
  complete: boolean;
  /** Changes whenever the board does; the page polls for it. */
  version: string;
}

/** One step of an admin's reveal running order. */
export interface LiveRunStep {
  /** 1 = revealed first (last place). */
  step: number;
  position: number;
  name: string;
  points: number;
  revealed: boolean;
}

/**
 * A week whose results are held, as read straight from the database (the
 * cached snapshot may be a few minutes behind the show).
 */
export interface LiveHold {
  taskId: string;
  revealCount: number;
}

// ── Rules ─────────────────────────────────────────────────────────────

/**
 * The competition facts the rules page quotes, read from the same constants
 * and data the app enforces so the copy can't drift from the real rules.
 */
export interface GameRules {
  totalWeeks: number;
  individualTasks: number;
  teamTasks: number;
  playerCount: number;
  teamCount: number;
  /** Smallest and largest squad sizes (equal when every squad matches). */
  teamSize: { min: number; max: number };
  peoplesChoice: { bonusPoints: number; windowDays: number };
  predictionBonusPoints: number;
  submissions: {
    maxPhotoMb: number;
    maxTextChars: number;
    maxCaptionChars: number;
  };
  coins: CoinRules;
}

// ── Seasons & Hall of Fame ───────────────────────────────────────────

/**
 * Which season each player, squad and week belongs to, plus the season list
 * (oldest first). Lets detail pages load the right season's snapshot.
 */
export interface SeasonDirectory {
  seasons: Season[];
  current?: Season;
  getSeason(id: string): Season | undefined;
  seasonOfPlayer(playerId: string): Season | undefined;
  seasonOfTeam(teamId: string): Season | undefined;
  seasonOfTask(taskId: string): Season | undefined;
}

/** A closed season's honours, derived from its final standings. */
export interface HallOfFameSeason {
  season: Season;
  /** The top three (fewer when the roster is smaller), champion first. */
  podium: LeaderboardRow[];
  /** The top squad, when the season had team tasks scored. */
  winningSquad?: TeamStanding;
  awards: Award[];
  playerCount: number;
  weekCount: number;
}

/** An all-time record across every closed season. */
export interface AllTimeRecord {
  id: string;
  /** Record name, e.g. "Highest season total". */
  title: string;
  /** Command-style sub-label, e.g. "max season.points". */
  command: string;
  player: Player;
  season: Season;
  /** Headline value, pre-formatted, e.g. "142 pts". */
  value: string;
  /** Supporting context, e.g. the week it was set in. */
  detail?: string;
  accent: "acid" | "magenta" | "amber" | "cyan";
}

export interface HallOfFame {
  /** Closed seasons, most recent first. */
  seasons: HallOfFameSeason[];
  records: AllTimeRecord[];
}

/** Where one page sits within a longer, paginated list. */
export interface PageInfo {
  /** 1-based current page, clamped to the available pages. */
  page: number;
  /** Always at least 1, even for an empty list. */
  pageCount: number;
  pageSize: number;
  total: number;
  /** 1-based position of the first item shown (0 when the list is empty). */
  from: number;
  /** 1-based position of the last item shown (0 when the list is empty). */
  to: number;
}

/** One page of a longer list. */
export interface Page<T> extends PageInfo {
  items: T[];
}

/** A slot in a pagination control: a page number, or a gap ("…"). */
export type PageLinkSlot = number | "gap";

// ── Feature flags ─────────────────────────────────────────────────────

/** A site feature an admin can switch on or off (see `feature-flags.ts`). */
export type FeatureFlagKey = "shop_eggs";

/** Whether each feature is on. */
export type FeatureFlags = Record<FeatureFlagKey, boolean>;

/** A flag as the admin screen lists it. */
export interface FeatureFlagView {
  key: FeatureFlagKey;
  label: string;
  description: string;
  enabled: boolean;
  /** Who last changed it, and when (ISO 8601); unset if never changed. */
  changedBy?: string;
  changedAt?: string;
}

// ── Clim Coin ─────────────────────────────────────────────────────────

export type ShopCategory = "pet" | "avatar" | "cosmetic" | "power_up";
export type CosmeticKind = "title" | "name_colour" | "theme";
/** Power-ups a player spends on a live week (a `power_up_uses` row). */
export type ActivePowerUpKind =
  "double_down" | "hint" | "golden_week" | "sabotage";
/** Power-ups that work by themselves once bought (effects derived). */
export type PassivePowerUpKind = "shield" | "mirror" | "insurance";
export type PowerUpKind = ActivePowerUpKind | PassivePowerUpKind;
/** Where an owned item is worn: one item per slot. */
export type LoadoutSlot = "pet" | "avatar" | "title" | "name_colour" | "theme";
/** Name colour cosmetics: accent tokens, plus a few special effects. */
export type NameColour =
  | "acid"
  | "amber"
  | "magenta"
  | "cyan"
  | "gold"
  | "pumpkin"
  | "glitch"
  | "rainbow";
/** Profile terminal themes a theme cosmetic may use. */
export type ProfileTheme =
  | "phosphor"
  | "amber"
  | "synthwave"
  | "ice"
  | "matrix"
  | "vaporwave"
  | "blueprint";

/** An item in the (site-wide, admin-managed) shop catalogue. */
export interface ShopItem {
  id: string;
  name: string;
  description: string;
  category: ShopCategory;
  price: number;
  /** Root-relative path or https URL. Always set for pets and avatars. */
  imageUrl?: string;
  /** Cosmetics only. */
  cosmetic?: { kind: CosmeticKind; value: string };
  /** Power-ups only. */
  powerUp?: PowerUpKind;
  /** Retired items stay with their owners but can't be bought. */
  available: boolean;
  /** Crate exclusive: only drops from crates, never sold directly. */
  crateOnly: boolean;
  /** Seasonal egg exclusive: only drops from this crate (by id). */
  crateId?: string;
  /** Limited-time stock: on sale from / until these instants (ISO 8601). */
  availableFrom?: string;
  availableUntil?: string;
  sortOrder: number;
}

/** How rare an item is, derived from its price (see `coin-rules.ts`). */
export type Rarity = "common" | "rare" | "epic" | "legendary";
/** A crate's tiers: the rarities, plus its small power-up chance. */
export type CrateTierKind = Rarity | "power_up";

/** A lootbox: what it costs and the chance of each rarity tier. */
export interface Crate {
  id: string;
  name: string;
  description: string;
  price: number;
  /** Chance of each tier, out of 1 (tiers left out never drop). */
  odds: Partial<Record<Rarity, number>>;
  /**
   * Chance (out of 1) of a power-up instead, taken off the top of the other
   * tiers. It's never scaled up when tiers empty. Unset = never.
   */
  powerUpChance?: number;
  /**
   * A seasonal egg: drops only the items exclusive to it (`crateId`), which
   * no other egg drops.
   */
  exclusive?: boolean;
  /** On sale from / until these instants (ISO 8601); unset = always. */
  availableFrom?: string;
  availableUntil?: string;
}

/** A crate a player opened, and what it gave them. */
export interface CrateOpen {
  id: number;
  /** The zero-price purchase that makes the player own the item. */
  purchaseId: number;
  playerId: string;
  crateId: string;
  price: number;
  itemId: string;
  rarity: CrateTierKind;
  /** ISO 8601. */
  at: string;
}

/** One item's chance of dropping from a crate, for one viewer. */
export interface CrateDrop {
  item: ShopItem;
  /** Out of 1. */
  chance: number;
}

/** A rarity tier's share of a crate, and the items in it. */
export interface CrateTier {
  rarity: CrateTierKind;
  /** Out of 1, after empty tiers are shared out. */
  chance: number;
  drops: CrateDrop[];
}

/** Why a viewer can't open a crate right now. */
export type CrateBlock = "guest" | "empty" | "unaffordable" | "season-closed";

/** A crate as one viewer sees it in the shop: their personal odds. */
export interface CrateView {
  crate: Crate;
  tiers: CrateTier[];
  /** Average shop value of one roll, in coins. */
  averageValue: number;
  blocked?: CrateBlock;
}

/** A crate opening, as the public "recent pulls" feed shows it. */
export interface CratePull {
  id: number;
  player: Player;
  crate: Crate;
  item: ShopItem;
  rarity: CrateTierKind;
  at: string;
}

/** A purchase, at the price paid then. */
export interface CoinPurchase {
  id: number;
  playerId: string;
  itemId: string;
  price: number;
  /** ISO 8601. */
  at: string;
}

/** A power-up charge spent on a week. */
export interface PowerUpUse {
  id: number;
  purchaseId: number;
  playerId: string;
  taskId: string;
  effect: ActivePowerUpKind;
  /** Sabotage only: who lost the point. */
  targetPlayerId?: string;
  /** ISO 8601. */
  at: string;
}

/**
 * What a Sabotage did: hit its target, was blocked by their Shield, or was
 * bounced back onto the saboteur by their Mirror. Shields and Mirrors stay
 * secret until the week's results are out.
 */
export type SabotageOutcome = "hit" | "blocked" | "reflected";

/** How a Sabotage resolved, and the defence charge it used up (if any). */
export interface SabotageResolution {
  outcome: SabotageOutcome;
  /** The Shield or Mirror purchase that was spent on it. */
  defencePurchaseId?: number;
}

/** Clim Coin one player sent another. */
export interface CoinGift {
  id: number;
  fromPlayerId: string;
  toPlayerId: string;
  amount: number;
  message?: string;
  /** ISO 8601. */
  at: string;
}

export interface EquippedItem {
  playerId: string;
  slot: LoadoutSlot;
  itemId: string;
}

/** An admin grant (positive) or deduction (negative) of coins. */
export interface CoinAdjustment {
  id: number;
  playerId: string;
  amount: number;
  reason: string;
  actorName: string;
  /** ISO 8601. */
  at: string;
}

/** A player's first visible entry on a task (earns the entry payout). */
export interface EntryActivity {
  taskId: string;
  playerId: string;
}

/** Clim Coin records for one season's snapshot. */
export interface ClimCoinData {
  /** The whole catalogue, in display order (retired items included). */
  items: ShopItem[];
  purchases: CoinPurchase[];
  uses: PowerUpUse[];
  equipped: EquippedItem[];
  adjustments: CoinAdjustment[];
  entries: EntryActivity[];
  /** Crates opened, oldest first. */
  crateOpens: CrateOpen[];
  /** Gifts between this season's players, oldest first. */
  gifts: CoinGift[];
  /** Taskmaster's Hints by task id; only shown to players who used Hint. */
  hints: Record<string, string>;
}

/** The payout table, as `/rules` and the shop explain it. */
export interface CoinRules {
  placement: { first: number; second: number; third: number; scored: number };
  entry: number;
  pollVote: number;
  peoplesChoiceVote: number;
  prediction: number;
  goldenWeekMultiplier: number;
  doubleDownPoints: number;
  sabotagePoints: number;
  /** The most coins a player can gift in any 7 days. */
  giftWeeklyCap: number;
}

export type CoinLedgerKind =
  | "placement"
  | "entry"
  | "poll-vote"
  | "peoples-choice-vote"
  | "prediction"
  | "adjustment"
  | "purchase"
  | "crate"
  | "gift-in"
  | "gift-out";

/** One line in a wallet's history. */
export interface CoinLedgerEntry {
  kind: CoinLedgerKind;
  /** Coins in (positive) or out (negative). */
  amount: number;
  label: string;
  /** When the coins landed (ISO 8601). */
  at: string;
  taskId?: string;
}

/** A player's Clim Coin balance and history. */
export interface Wallet {
  playerId: string;
  balance: number;
  earned: number;
  adjusted: number;
  spent: number;
  /** Gifts received minus gifts sent. */
  gifted: number;
  /** Newest first. */
  ledger: CoinLedgerEntry[];
}

/** What a player is wearing (only items they still own). */
export interface PlayerLoadout {
  pet?: ShopItem;
  avatar?: ShopItem;
  title?: string;
  nameColour?: NameColour;
  theme?: ProfileTheme;
}

/** An owned item in a player's inventory. */
export interface InventoryItem {
  item: ShopItem;
  /** Unset for power-ups, which are used rather than equipped. */
  slot?: LoadoutSlot;
  equipped: boolean;
  /** Power-ups: unused charges. */
  charges: number;
}

/** Why a shop item can't be bought right now. */
export type PurchaseBlock =
  | "guest"
  | "owned"
  /** Power-ups: bought and already used this season. */
  | "used"
  /** Crate exclusives: never sold directly. */
  | "crate-only"
  | "unaffordable"
  | "unavailable"
  | "season-closed";

/** A catalogue item as one viewer sees it in the shop. */
export interface ShopListing {
  item: ShopItem;
  /** Already bought (power-ups: this season, used or not). */
  owned: boolean;
  /** Power-ups: unused charges held. */
  charges: number;
  /** Why it can't be bought; unset when it can. */
  blocked?: PurchaseBlock;
}

export interface ShopSection {
  category: ShopCategory;
  label: string;
  command: string;
  listings: ShopListing[];
}

/** A power-up used on a week, as the task page's feed shows it. */
export interface PowerUpFeedEntry {
  id: number;
  taskId: string;
  effect: ActivePowerUpKind;
  label: string;
  player: Player;
  target?: Player;
  /** Sabotage only, once the week's results reveal Shields and Mirrors. */
  outcome?: SabotageOutcome;
  at: string;
}

/** Why a player can't use a power-up on a week right now. */
export type PowerUpBlock =
  | "no-charge"
  | "not-live"
  | "already-used"
  | "no-prediction"
  | "no-hint"
  | "season-closed";

/** A power-up a player could use on the live week. */
export interface PowerUpOption {
  effect: ActivePowerUpKind;
  label: string;
  description: string;
  charges: number;
  blocked?: PowerUpBlock;
}

/** The wallet page's "use a power-up" panel for the live week. */
export interface PowerUpPanel {
  task?: Task;
  /** The power-up already used on `task`, if any. */
  used?: PowerUpFeedEntry;
  options: PowerUpOption[];
  /** Sabotage targets: everyone else on the roster not yet sabotaged. */
  targets: Player[];
}

/** Outcome of a wallet action, shown after the redirect. */
export type CoinOutcome =
  | "bought"
  | "opened"
  | "crate-empty"
  | "owned"
  | "unaffordable"
  | "unavailable"
  | "season-closed"
  | "equipped"
  | "unequipped"
  | "used"
  | "invalid"
  | "already-used"
  | "already-sabotaged"
  | "no-prediction"
  | "no-hint"
  | "not-live"
  | "no-charge"
  | "gifted"
  | "gift-limit";

/** Why a player can't send a gift right now. */
export type GiftBlock =
  "season-closed" | "limit" | "unaffordable" | "no-recipients";

/** The wallet's "send coins" form. */
export interface GiftPanel {
  /** Everyone else in the player's season. */
  recipients: Player[];
  /** The most anyone can send in any 7 days. */
  cap: number;
  /** What's left of the cap now (gifts sent in the last 7 days count). */
  allowance: number;
  /** The most they can send now: the allowance, or their balance if lower. */
  max: number;
  blocked?: GiftBlock;
}

/** A player's cosmetics as public lists show them. */
export interface PlayerFlair {
  pet?: { name: string; imageUrl: string };
  title?: string;
  nameColour?: NameColour;
}
