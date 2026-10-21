// Builders for data-layer tests: each returns a complete, valid record so a
// test only spells out the fields it is about.
import type {
  pollOptions,
  polls,
  pollVotes,
  tasks,
  taskScores,
  teamScores,
} from "../db/schema";
import type {
  ClimCoinData,
  CompetitionData,
  Player,
  Poll,
  Season,
  ShopItem,
  Task,
  Team,
} from "../types";

type TaskRow = typeof tasks.$inferSelect;
type PollRow = typeof polls.$inferSelect;
type PollOptionRow = typeof pollOptions.$inferSelect;
type PollVoteRow = typeof pollVotes.$inferSelect;
type TaskScoreRow = typeof taskScores.$inferSelect;
type TeamScoreRow = typeof teamScores.$inferSelect;

/** A `Date.now()`-style timestamp for an ISO 8601 instant. */
export const at = (iso: string): number => new Date(iso).getTime();

export const SEASON_ID = "cohort-2026";

export function season(overrides: Partial<Season> = {}): Season {
  return {
    id: SEASON_ID,
    name: "Cohort 2026",
    isCurrent: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "running",
    weekCount: 0,
    ...overrides,
  };
}

export function taskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "week-01",
    seasonId: SEASON_ID,
    weekNumber: 1,
    title: "Make the best paper plane",
    description: "Furthest flight wins.",
    brief: null,
    releaseDate: "2026-01-05 09:00:00",
    deadline: "2026-01-12 09:00:00",
    format: "individual",
    revealPassword: null,
    revealedAt: null,
    maxSubmissions: 0,
    submissionKinds: [],
    resultsHeldAt: null,
    resultsRevealCount: 0,
    resultsPublishedAt: null,
    hint: null,
    ...overrides,
  };
}

export function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "week-01",
    seasonId: SEASON_ID,
    weekNumber: 1,
    title: "Make the best paper plane",
    description: "Furthest flight wins.",
    releaseDate: "2026-01-05T09:00:00.000Z",
    deadline: "2026-01-12T09:00:00.000Z",
    status: "completed",
    format: "individual",
    passwordProtected: false,
    revealedToAll: false,
    locked: false,
    submissions: { max: 0, kinds: [] },
    resultsHeld: false,
    resultsRevealCount: 0,
    ...overrides,
  };
}

export const player = (
  id: string,
  name = id,
  seasonId = SEASON_ID,
): Player => ({ id, seasonId, name });

export const team = (
  id: string,
  memberIds: string[],
  seasonId = SEASON_ID,
): Team => ({
  id,
  seasonId,
  name: id,
  memberIds,
});

export function pollRow(overrides: Partial<PollRow> = {}): PollRow {
  return {
    id: "best-snack",
    question: "Best snack?",
    description: null,
    kind: "single",
    minChoices: 1,
    maxChoices: null,
    opensAt: "2026-01-06 12:00:00",
    closesAt: "2026-01-08 12:00:00",
    resultsVisibility: "after_vote",
    allowVoteChange: true,
    anonymous: true,
    showOnHomeDays: 3,
    published: true,
    voteBonusPoints: 1,
    bonusTaskId: null,
    createdAt: "2026-01-01 00:00:00",
    ...overrides,
  };
}

export const pollOptionRow = (
  id: number,
  sortOrder: number,
  pollId = "best-snack",
): PollOptionRow => ({ id, pollId, label: `Option ${id}`, sortOrder });

export const pollVoteRow = (
  optionId: number,
  playerId: string,
  pollId = "best-snack",
): PollVoteRow => ({
  pollId,
  optionId,
  playerId,
  createdAt: "2026-01-07 00:00:00",
});

export function poll(overrides: Partial<Poll> = {}): Poll {
  return {
    id: "best-snack",
    question: "Best snack?",
    kind: "single",
    minChoices: 1,
    maxChoices: 1,
    opensAt: "2026-01-06T12:00:00.000Z",
    closesAt: "2026-01-08T12:00:00.000Z",
    resultsVisibility: "after_vote",
    allowVoteChange: true,
    anonymous: true,
    showOnHomeDays: 3,
    published: true,
    voteBonusPoints: 1,
    bonusTaskId: "week-01",
    bonusTaskPinned: false,
    status: "closed",
    options: [],
    votes: [],
    ...overrides,
  };
}

const RECORDED = "2026-01-12 10:00:00+00";

export const taskScoreRow = (
  taskId: string,
  playerId: string,
  points: number,
  overrides: Partial<TaskScoreRow> = {},
): TaskScoreRow => ({
  taskId,
  playerId,
  points,
  comment: null,
  createdAt: RECORDED,
  updatedAt: RECORDED,
  ...overrides,
});

export const teamScoreRow = (
  taskId: string,
  teamId: string,
  points: number,
  overrides: Partial<TeamScoreRow> = {},
): TeamScoreRow => ({
  taskId,
  teamId,
  points,
  comment: null,
  createdAt: RECORDED,
  updatedAt: RECORDED,
  ...overrides,
});

export function competitionData(
  overrides: Partial<CompetitionData> = {},
): CompetitionData {
  return {
    season: season(),
    players: [],
    teams: [],
    tasks: [],
    scores: [],
    teamScores: [],
    bonusPoints: [],
    resultsPostedAt: {},
    polls: [],
    peoplesChoiceVotes: [],
    predictions: [],
    recaps: {},
    changelog: [],
    coins: coinData(),
    ...overrides,
  };
}

export function coinData(overrides: Partial<ClimCoinData> = {}): ClimCoinData {
  return {
    items: [],
    purchases: [],
    uses: [],
    equipped: [],
    adjustments: [],
    entries: [],
    crateOpens: [],
    hints: {},
    ...overrides,
  };
}

export function shopItem(overrides: Partial<ShopItem> = {}): ShopItem {
  return {
    id: "rubber-duck",
    name: "Rubber Duck",
    description: "Quacks at bugs.",
    category: "pet",
    price: 10,
    imageUrl: "/shop/pets/rubber-duck.svg",
    available: true,
    crateOnly: false,
    sortOrder: 0,
    ...overrides,
  };
}
