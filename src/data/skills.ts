import { sql } from "drizzle-orm";
import type { SkillNode } from "../types";
import { getDb } from "../db";
import {
  coinPurchases,
  shopItems,
  skillPaths,
  skillUnlocks,
} from "../db/schema";
import { budget, lockWallet } from "./shop";

// Skill tree writes a player makes from `/account` (the middleware has
// already required a signed-in player and purges the cached rows after).
// The caller checks the rules against fresh rows first; the write re-checks
// the stored facts so a double-submit or a race can't overspend or cheat.

/**
 * Unlocks `node` for the player at its price, if they can afford it, have
 * unlocked its prerequisites and haven't committed to a different pathway.
 * Their first unlock commits them to the node's pathway (for good). A node
 * with a reward grants it through a zero-price purchase, like a crate win
 * (skipped if they already own it). One statement under the wallet lock, so
 * two unlocks at once can't spend the same coins. Returns whether it worked.
 */
export async function unlockSkillNode(
  playerId: string,
  node: SkillNode,
  earned: number,
): Promise<boolean> {
  const db = getDb();
  const prerequisitesMet =
    node.requires.length === 0
      ? sql`true`
      : sql`(select count(*) from ${skillUnlocks}
            where player_id = ${playerId}
              and node_id in (${sql.join(
                node.requires.map((id) => sql`${id}`),
                sql`, `,
              )})) = ${node.requires.length}`;
  const [, unlocked] = await db.batch([
    db.execute(lockWallet(playerId)),
    db.execute(sql`
      with eligible as (
        select 1
        where not exists (
            select 1 from ${skillUnlocks}
            where player_id = ${playerId} and node_id = ${node.id}
          )
          and not exists (
            select 1 from ${skillPaths}
            where player_id = ${playerId} and path_id <> ${node.pathId}
          )
          and ${prerequisitesMet}
          and (${budget(playerId, earned)}) >= ${node.price}::integer
      ),
      path as (
        insert into ${skillPaths} (player_id, path_id)
        select ${playerId}, ${node.pathId} from eligible
        on conflict (player_id) do nothing
      ),
      reward as (
        insert into ${coinPurchases} (player_id, item_id, price)
        select ${playerId}, item.id, 0
        from ${shopItems} item, eligible
        where item.id = ${node.rewardItemId ?? null}
          and not exists (
            select 1 from ${coinPurchases} owned
            where owned.player_id = ${playerId} and owned.item_id = item.id
          )
        returning id
      )
      insert into ${skillUnlocks}
        (player_id, path_id, node_id, price, purchase_id)
      select ${playerId}, ${node.pathId}, ${node.id}, ${node.price}::integer,
        (select id from reward)
      from eligible
      returning id`),
  ]);
  return unlocked.rows.length > 0;
}
