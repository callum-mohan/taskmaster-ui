import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import { getDb } from "../db";
import { pollOptions, pollVotes } from "../db/schema";

// A player's own poll votes. The rules (open window, choice counts, locked
// votes) are checked by the caller against the request snapshot; these
// writes only ever touch the given player's ballot on the given poll.

const ballotOf = (pollId: string, playerId: string) =>
  and(eq(pollVotes.pollId, pollId), eq(pollVotes.playerId, playerId));

/**
 * Records a ballot. With `replace`, any earlier ballot is swapped out in the
 * same transaction; without it, nothing is written if the player has already
 * voted (so a double-submit can't stack two ballots on a locked poll).
 * Options must belong to the poll (also enforced by a composite key).
 */
export async function castVote(
  pollId: string,
  playerId: string,
  optionIds: number[],
  replace: boolean,
): Promise<void> {
  const db = getDb();
  const insert = db.insert(pollVotes).select(
    db
      .select({
        pollId: pollOptions.pollId,
        optionId: pollOptions.id,
        playerId: sql<string>`${playerId}`.as("player_id"),
        createdAt: sql<string>`now()`.as("created_at"),
      })
      .from(pollOptions)
      .where(
        and(
          eq(pollOptions.pollId, pollId),
          inArray(pollOptions.id, optionIds),
          ...(replace
            ? []
            : [
                notExists(
                  db
                    .select({ one: sql`1` })
                    .from(pollVotes)
                    .where(ballotOf(pollId, playerId)),
                ),
              ]),
        ),
      ),
  );
  if (replace) {
    await db.batch([
      db.delete(pollVotes).where(ballotOf(pollId, playerId)),
      insert,
    ]);
  } else {
    await insert;
  }
}

/** Withdraws a player's ballot on a poll. */
export async function retractVote(
  pollId: string,
  playerId: string,
): Promise<void> {
  await getDb().delete(pollVotes).where(ballotOf(pollId, playerId));
}
