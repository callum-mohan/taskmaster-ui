import { asc, desc, eq } from "drizzle-orm";
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

/**
 * Who the snapshot is for: public visitors (with any task reveal cookies
 * they carry, keyed by task id) or an admin, who always sees real content.
 */
export type CompetitionViewer =
  | { mode: "public"; revealTokens: ReadonlyMap<string, string> }
  | { mode: "admin" };

/**
 * Loads every competition record for the current request in one HTTP round
 * trip and maps the rows onto the `src/types` shapes. Nothing is cached, so
 * admin edits are visible on the very next page view.
 */
export async function loadCompetition(
  viewer: CompetitionViewer = { mode: "public", revealTokens: new Map() },
): Promise<CompetitionData> {
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
