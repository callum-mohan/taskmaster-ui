import { asc, desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import type { CompetitionData, TaskRevealContext } from "../types";
import { getDb } from "../db";
import {
  bonusPoints as bonusPointsTable,
  changelogEntries as changelogTable,
  peoplesChoiceVotes as peoplesChoiceVotesTable,
  players as playersTable,
  pollOptions as pollOptionsTable,
  polls as pollsTable,
  pollVotes as pollVotesTable,
  predictions as predictionsTable,
  recaps as recapsTable,
  taskScores as taskScoresTable,
  taskSubmissions as taskSubmissionsTable,
  tasks as tasksTable,
  teamMembers as teamMembersTable,
  teamScores as teamScoresTable,
  teams as teamsTable,
} from "../db/schema";
import { mapPlayers } from "./players";
import { mapTeams } from "./teams";
import { mapTasks } from "./tasks";
import { buildScoreRecords } from "./scores";
import { derivePollBonusRows, mapPolls } from "./polls";
import {
  derivePeoplesChoiceBonusRows,
  mapPeoplesChoiceVotes,
} from "./peoples-choice";
import { derivePredictionBonusRows, mapPredictions } from "./predictions";
import { mapChangelog, mapRecaps } from "./editorial";
import { unlockedTaskIds } from "../lib/task-reveal";
import { timestamptzToIso } from "../lib/time";
import { cachedJson, purgeCached } from "../lib/edge-cache";

/**
 * Who the snapshot is for: public visitors (with any task reveal cookies
 * they carry, keyed by task id) or an admin, who always sees real content.
 */
export type CompetitionViewer =
  | { mode: "public"; revealTokens: ReadonlyMap<string, string> }
  | { mode: "admin" };

// The raw rows are the same for every viewer (reveal cookies, admin mode and
// held results are applied after loading), so public requests share one
// copy cached per Cloudflare data centre. Data only changes through writes,
// and every signed-in write purges it (see `src/middleware.ts`), so the TTL
// only bounds how stale other data centres and script/console edits can be.
const ROWS_CACHE_TTL_SECONDS = 5 * 60;

/**
 * The cache key for the raw rows. It includes the deployed Worker version so
 * a deploy (whose code may expect a new column) never reads rows cached by
 * the previous one. The path isn't a route, and the Worker runs before the
 * cache, so the entry can't be fetched from outside.
 */
const rowsCacheKey = (origin: string) =>
  `${origin}/__cache/competition-rows/${
    env.CF_VERSION_METADATA?.id ?? "local"
  }`;

/** Drops the cached rows in this data centre, after a write. */
export const invalidateCompetitionCache = (origin: string) =>
  purgeCached(rowsCacheKey(origin));

/** Every competition table's rows, in one HTTP round trip. */
async function fetchCompetitionRows() {
  const db = getDb();
  const [
    playerRows,
    teamRows,
    memberRows,
    taskRows,
    taskScoreRows,
    teamScoreRows,
    bonusRows,
    pollRows,
    pollOptionRows,
    pollVoteRows,
    peoplesChoiceRows,
    predictionRows,
    recapRows,
    changelogRows,
  ] = await db.batch([
    db.select().from(playersTable).orderBy(asc(playersTable.sortOrder)),
    db.select().from(teamsTable).orderBy(asc(teamsTable.sortOrder)),
    db
      .select()
      .from(teamMembersTable)
      .orderBy(asc(teamMembersTable.teamId), asc(teamMembersTable.sortOrder)),
    db.select().from(tasksTable).orderBy(asc(tasksTable.weekNumber)),
    db.select().from(taskScoresTable),
    db.select().from(teamScoresTable),
    db.select().from(bonusPointsTable).orderBy(asc(bonusPointsTable.id)),
    db
      .select()
      .from(pollsTable)
      .orderBy(desc(pollsTable.opensAt), desc(pollsTable.createdAt)),
    db.select().from(pollOptionsTable),
    db.select().from(pollVotesTable),
    // Each vote with the entry's owner, so winners resolve without loading
    // every submission.
    db
      .select({
        taskId: peoplesChoiceVotesTable.taskId,
        playerId: peoplesChoiceVotesTable.playerId,
        submissionId: peoplesChoiceVotesTable.submissionId,
        submitterId: taskSubmissionsTable.playerId,
        teamId: taskSubmissionsTable.teamId,
        hiddenAt: taskSubmissionsTable.hiddenAt,
      })
      .from(peoplesChoiceVotesTable)
      .innerJoin(
        taskSubmissionsTable,
        eq(taskSubmissionsTable.id, peoplesChoiceVotesTable.submissionId),
      ),
    db.select().from(predictionsTable).orderBy(asc(predictionsTable.createdAt)),
    db.select().from(recapsTable),
    db
      .select()
      .from(changelogTable)
      .orderBy(desc(changelogTable.date), desc(changelogTable.createdAt)),
  ]);
  return {
    playerRows,
    teamRows,
    memberRows,
    taskRows,
    taskScoreRows,
    teamScoreRows,
    bonusRows,
    pollRows,
    pollOptionRows,
    pollVoteRows,
    peoplesChoiceRows,
    predictionRows,
    recapRows,
    changelogRows,
  };
}

type CompetitionRows = Awaited<ReturnType<typeof fetchCompetitionRows>>;

/**
 * Loads every competition record for the current request and maps the rows
 * onto the `src/types` shapes. Admins always read the database directly;
 * public requests (given the site `origin` for the cache key) share the
 * cached rows. Derived state (task status, deadlines) is worked out from
 * the rows on every request, so it's never stale.
 */
export async function loadCompetition(
  viewer: CompetitionViewer = { mode: "public", revealTokens: new Map() },
  cacheOrigin?: string,
): Promise<CompetitionData> {
  const rows =
    viewer.mode === "admin" || !cacheOrigin
      ? await fetchCompetitionRows()
      : await cachedJson<CompetitionRows>(
          rowsCacheKey(cacheOrigin),
          ROWS_CACHE_TTL_SECONDS,
          fetchCompetitionRows,
        );
  return buildCompetition(rows, viewer);
}

async function buildCompetition(
  {
    playerRows,
    teamRows,
    memberRows,
    taskRows,
    taskScoreRows,
    teamScoreRows,
    bonusRows,
    pollRows,
    pollOptionRows,
    pollVoteRows,
    peoplesChoiceRows,
    predictionRows,
    recapRows,
    changelogRows,
  }: CompetitionRows,
  viewer: CompetitionViewer,
): Promise<CompetitionData> {
  const players = mapPlayers(playerRows);
  const teams = mapTeams(teamRows, memberRows);
  const reveal: TaskRevealContext =
    viewer.mode === "admin"
      ? viewer
      : {
          mode: "public",
          unlockedTaskIds: await unlockedTaskIds(
            viewer.revealTokens,
            new Map(
              taskRows.flatMap((row) =>
                row.revealPassword ? [[row.id, row.revealPassword]] : [],
              ),
            ),
          ),
        };
  const tasks = mapTasks(taskRows, reveal);
  const polls = mapPolls(pollRows, pollOptionRows, pollVoteRows, tasks);
  const peoplesChoiceVotes = mapPeoplesChoiceVotes(peoplesChoiceRows);
  const predictions = mapPredictions(predictionRows);

  // Results night: the public never sees a held week's scores or recorded
  // bonuses (they go out one at a time on `/live`); admins always do.
  const heldTaskIds = new Set(
    viewer.mode === "admin"
      ? []
      : taskRows.filter((row) => row.resultsHeldAt !== null).map((r) => r.id),
  );
  const published = <Row extends { taskId: string }>(rows: Row[]) =>
    rows.filter((row) => !heldTaskIds.has(row.taskId));
  const publishedAt = Object.fromEntries(
    taskRows.flatMap((row) =>
      row.resultsPublishedAt ? [[row.id, row.resultsPublishedAt]] : [],
    ),
  );

  const scoreRows = {
    taskScores: published(taskScoreRows),
    teamScores: published(teamScoreRows),
  };
  const context = { players, teams, tasks, publishedAt };
  // Recorded bonuses first, then the ones earned by voting in polls and in
  // People's Choice. A held week's bonuses count as given when its results
  // were published, so their notifications arrive after the show.
  const bonusPoints = [
    ...published(bonusRows).map((row) => {
      const at = publishedAt[row.taskId];
      const instant = (value: string) =>
        new Date(timestamptzToIso(value)).getTime();
      return at && instant(at) > instant(row.createdAt)
        ? { ...row, createdAt: at }
        : row;
    }),
    ...derivePollBonusRows(polls),
    ...derivePeoplesChoiceBonusRows(peoplesChoiceVotes, tasks, teams),
  ];
  // Correct predictions depend on the week's finishing positions, so rank
  // once without them, then again with their bonuses added (bonuses never
  // change positions).
  const ranked = buildScoreRecords({ ...scoreRows, bonusPoints }, context);
  const predictionBonuses = derivePredictionBonusRows(
    predictions,
    ranked,
    players,
    new Map(teams.map((t) => [t.id, t.name])),
  );
  const records =
    predictionBonuses.length === 0
      ? ranked
      : buildScoreRecords(
          { ...scoreRows, bonusPoints: [...bonusPoints, ...predictionBonuses] },
          context,
        );

  return {
    players,
    teams,
    tasks,
    ...records,
    polls,
    peoplesChoiceVotes,
    predictions,
    recaps: mapRecaps(recapRows),
    changelog: mapChangelog(changelogRows),
  };
}
