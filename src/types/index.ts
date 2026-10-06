// Shared domain types for the Taskmaster competition UI.
// These intentionally describe plain data shapes so the current mock
// data layer can later be swapped for Supabase queries without touching
// the UI components.

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
 * irrelevant. Becomes a Supabase table later — keep the shape stable.
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
}

export interface Score {
  taskId: string;
  playerId: string;
  points: number;
  /** Finishing position for the task (1 = winner). */
  position: number;
  comment?: string;
}

/**
 * A team's result on a single team-format task. The raw record the team
 * leaderboard is derived from; becomes a Supabase row later.
 */
export interface TeamScore {
  taskId: string;
  teamId: string;
  points: number;
  /** Finishing position for the task among teams (1 = winning team). */
  position: number;
  comment?: string;
}

// Derived view models used by the UI. Keeping these separate from the
// raw records means pages receive ready-to-render data.

export interface LeaderboardRow {
  rank: number;
  player: Player;
  points: number;
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
