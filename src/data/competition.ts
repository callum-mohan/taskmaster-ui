import { asc } from "drizzle-orm";
import type { CompetitionData } from "../types";
import { getDb } from "../db";
import {
  bonusPoints as bonusPointsTable,
  players as playersTable,
  taskScores as taskScoresTable,
  tasks as tasksTable,
  teamMembers as teamMembersTable,
  teamScores as teamScoresTable,
  teams as teamsTable,
} from "../db/schema";
import { mapPlayers } from "./players";
import { mapTeams } from "./teams";
import { mapTasks } from "./tasks";
import { buildScoreRecords } from "./scores";

/**
 * Loads every competition record for the current request in one HTTP round
 * trip and maps the rows onto the `src/types` shapes. Nothing is cached, so
 * admin edits are visible on the very next page view.
 */
export async function loadCompetition(): Promise<CompetitionData> {
  const db = getDb();
  const [
    playerRows,
    teamRows,
    memberRows,
    taskRows,
    taskScoreRows,
    teamScoreRows,
    bonusRows,
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
  ]);

  const players = mapPlayers(playerRows);
  const teams = mapTeams(teamRows, memberRows);
  const tasks = mapTasks(taskRows);
  const records = buildScoreRecords(
    {
      taskScores: taskScoreRows,
      teamScores: teamScoreRows,
      bonusPoints: bonusRows,
    },
    { players, teams, tasks },
  );

  return { players, teams, tasks, ...records };
}
