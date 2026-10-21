import { and, eq, sql } from "drizzle-orm";
import type {
  Player,
  Prediction,
  PredictionPick,
  Score,
  TeamScore,
} from "../types";
import { getDb } from "../db";
import { predictions } from "../db/schema";
import type { DerivedBonusRow } from "./polls";
import { DOUBLE_DOWN_POINTS } from "./coin-rules";

// "Call the winner": while a task is live, each player can back who they
// think will win it (a squad on team tasks), never themselves or their own
// squad. A correct call earns a bonus once the results are in, derived from
// the results rather than stored, so a corrected score can't leave a stale
// bonus behind.

/** Points a correct call earns. */
export const PREDICTION_BONUS_POINTS = 1;

type PredictionRow = typeof predictions.$inferSelect;

export function mapPredictions(rows: PredictionRow[]): Prediction[] {
  return rows.flatMap((row): Prediction[] => {
    const pick: PredictionPick | undefined = row.pickedTeamId
      ? { type: "team", id: row.pickedTeamId }
      : row.pickedPlayerId
        ? { type: "player", id: row.pickedPlayerId }
        : undefined;
    return pick ? [{ taskId: row.taskId, playerId: row.playerId, pick }] : [];
  });
}

/** Whether a call backed a winner (a shared first place counts). */
export function isWinningPick(
  prediction: Prediction,
  scores: Score[],
  teamScores: TeamScore[],
): boolean {
  const { taskId, pick } = prediction;
  return pick.type === "team"
    ? teamScores.some(
        (s) => s.taskId === taskId && s.teamId === pick.id && s.position === 1,
      )
    : scores.some(
        (s) =>
          s.taskId === taskId && s.playerId === pick.id && s.position === 1,
      );
}

/**
 * The bonus for every correct call, in the order the calls are listed. Only
 * published results count (held results aren't in the public snapshot).
 */
export function derivePredictionBonusRows(
  calls: Prediction[],
  { scores, teamScores }: { scores: Score[]; teamScores: TeamScore[] },
  players: Player[],
  teamNames: Map<string, string>,
  /** `${taskId}:${playerId}` of every Double Down used. */
  doubleDownKeys: ReadonlySet<string> = new Set(),
): DerivedBonusRow[] {
  const playerNames = new Map(players.map((p) => [p.id, p.name]));
  return calls.flatMap((call) => {
    if (!isWinningPick(call, scores, teamScores)) return [];
    const name =
      call.pick.type === "team"
        ? teamNames.get(call.pick.id)
        : playerNames.get(call.pick.id);
    const doubled = doubleDownKeys.has(`${call.taskId}:${call.playerId}`);
    return [
      {
        taskId: call.taskId,
        playerId: call.playerId,
        points: doubled ? DOUBLE_DOWN_POINTS : PREDICTION_BONUS_POINTS,
        reason: `Called the winner${name ? ` (${name})` : ""}${
          doubled ? " · Double Down" : ""
        }`,
      },
    ];
  });
}

/** Records or changes a player's call. The caller checks the window and pick. */
export async function savePrediction(
  taskId: string,
  playerId: string,
  pick: PredictionPick,
): Promise<void> {
  const picked = {
    pickedPlayerId: pick.type === "player" ? pick.id : null,
    pickedTeamId: pick.type === "team" ? pick.id : null,
  };
  await getDb()
    .insert(predictions)
    .values({ taskId, playerId, ...picked })
    .onConflictDoUpdate({
      target: [predictions.taskId, predictions.playerId],
      set: { ...picked, updatedAt: sql`now()` },
    });
}

export async function withdrawPrediction(
  taskId: string,
  playerId: string,
): Promise<void> {
  await getDb()
    .delete(predictions)
    .where(
      and(eq(predictions.taskId, taskId), eq(predictions.playerId, playerId)),
    );
}
