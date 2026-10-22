import { and, eq, sql } from "drizzle-orm";
import type {
  ActivePowerUpKind,
  CoinOutcome,
  Crate,
  CrateTierKind,
  LoadoutSlot,
} from "../types";
import { getDb } from "../db";
import {
  coinAdjustments,
  coinGifts,
  coinPurchases,
  crateOpens,
  equippedItems,
  players,
  powerUpUses,
  shopItems,
  wishes,
} from "../db/schema";
import { violatedConstraint } from "./db-errors";
import { GIFT_WEEKLY_CAP } from "./coin-rules";

// Clim Coin writes a player makes from `/account` (the middleware has
// already required a signed-in player and purges the cached rows after).
// Callers check the rules against the snapshot first; each write re-checks
// the stored facts so a double-submit or a race can't overspend or cheat.

/** The coins a player has left to spend, given their derived `earned`. */
const budget = (playerId: string, earned: number) => sql`
  ${earned}::integer
    + coalesce((select sum(amount) from ${coinAdjustments}
        where player_id = ${playerId}), 0)
    - coalesce((select sum(price) from ${coinPurchases}
        where player_id = ${playerId}), 0)
    - coalesce((select sum(price) from ${crateOpens}
        where player_id = ${playerId}), 0)
    + coalesce((select sum(amount) from ${coinGifts}
        where to_player_id = ${playerId}), 0)
    - coalesce((select sum(amount) from ${coinGifts}
        where from_player_id = ${playerId}), 0)`;

/**
 * Whether `item` (a `shop_items` alias) is in its sale window now. Windows
 * are UK wall-clock times, so compare against the UK wall clock.
 */
const onSaleNow = (item: string) =>
  sql.raw(`
  (${item}.available_from is null
    or ${item}.available_from <= (now() at time zone 'Europe/London'))
  and (${item}.available_until is null
    or ${item}.available_until > (now() at time zone 'Europe/London'))`);

/**
 * Serialises a player's spending, so two at once can't both spend. Admin
 * item gifts take it too, so a gift and a purchase can't both give the item.
 */
export const lockWallet = (playerId: string) =>
  sql`select pg_advisory_xact_lock(hashtext(${`clim-coin:${playerId}`}))`;

/**
 * Buys `itemId` at its current price if the player can afford it and hasn't
 * bought it before. A power-up can be bought once a season (wallets are per
 * season), checked by its effect so a second item with the same effect
 * can't get round it. `earned` is the player's
 * derived earnings, worked out from fresh rows. Spending and grants are
 * summed in the same transaction, under a per-player lock, so two buys at
 * once can't both spend the same coins.
 */
export async function buyItem(
  playerId: string,
  itemId: string,
  earned: number,
): Promise<boolean> {
  const db = getDb();
  const [, inserted] = await db.batch([
    db.execute(lockWallet(playerId)),
    db.execute(sql`
      insert into ${coinPurchases} (player_id, item_id, price)
      select ${playerId}, item.id, item.price
      from ${shopItems} item
      where item.id = ${itemId}
        and item.available
        and ${onSaleNow("item")}
        and not item.crate_only
        and not exists (
          select 1 from ${coinPurchases} owned
          join ${shopItems} owned_item on owned_item.id = owned.item_id
          where owned.player_id = ${playerId}
            and (
              owned.item_id = item.id
              or owned_item.power_up = item.power_up
            )
        )
        and (${budget(playerId, earned)}) >= item.price
      returning id`),
  ]);
  return inserted.rows.length > 0;
}

/**
 * Opens `crate` for the player, giving them `itemId` (rolled by the caller
 * from their personal odds): the item is owned through a zero-price
 * purchase and the crate's price is spent, in one statement under the
 * wallet lock. A power-up won this way is that effect's one charge for the
 * season, exactly as if bought. Returns the opening's id, or `undefined` if
 * they can no longer afford it or already own the item (or, for a power-up,
 * its effect), e.g. a double-submit won it first, so the caller can roll
 * again.
 */
export async function openCrate(
  playerId: string,
  crate: Crate,
  itemId: string,
  rarity: CrateTierKind,
  earned: number,
): Promise<number | undefined> {
  const db = getDb();
  const [, opened] = await db.batch([
    db.execute(lockWallet(playerId)),
    db.execute(sql`
      with won as (
        insert into ${coinPurchases} (player_id, item_id, price)
        select ${playerId}, item.id, 0
        from ${shopItems} item
        where item.id = ${itemId}
          and item.available
          and ${onSaleNow("item")}
          and not exists (
            select 1 from ${coinPurchases} owned
            join ${shopItems} owned_item on owned_item.id = owned.item_id
            where owned.player_id = ${playerId}
              and (
                owned.item_id = item.id
                or owned_item.power_up = item.power_up
              )
          )
          and (${budget(playerId, earned)}) >= ${crate.price}
        returning id, item_id
      )
      insert into ${crateOpens}
        (player_id, crate_id, price, item_id, rarity, purchase_id)
      select ${playerId}, ${crate.id}, ${crate.price}, won.item_id,
        ${rarity}, won.id
      from won
      returning id`),
  ]);
  const id = (opened.rows[0] as { id?: number } | undefined)?.id;
  return typeof id === "number" ? id : undefined;
}

/**
 * Sends `amount` coins from one player to another in the same season, if
 * the sender can afford it and it keeps them within the weekly gift cap
 * (gifts sent in the last 7 days count). `earned` is the sender's derived
 * earnings from fresh rows. Checked under the sender's wallet lock, so two
 * gifts at once can't both spend the same coins or beat the cap.
 */
export async function sendGift(
  fromPlayerId: string,
  toPlayerId: string,
  amount: number,
  message: string | null,
  earned: number,
): Promise<boolean> {
  const db = getDb();
  const [, inserted] = await db.batch([
    db.execute(lockWallet(fromPlayerId)),
    db.execute(sql`
      insert into ${coinGifts}
        (season_id, from_player_id, to_player_id, amount, message)
      select sender.season_id, sender.id, recipient.id, ${amount}::integer,
        ${message}::text
      from ${players} sender
      join ${players} recipient
        on recipient.season_id = sender.season_id
      where sender.id = ${fromPlayerId}
        and recipient.id = ${toPlayerId}
        and recipient.id <> sender.id
        and ${amount}::integer > 0
        and ${amount}::integer + coalesce((select sum(amount) from ${coinGifts}
            where from_player_id = ${fromPlayerId}
              and created_at > now() - interval '7 days'), 0)
          <= ${GIFT_WEEKLY_CAP}
        and (${budget(fromPlayerId, earned)}) >= ${amount}::integer
      returning id`),
  ]);
  return inserted.rows.length > 0;
}

/** Wears an owned item in `slot`, replacing whatever was there. */
export async function equipItem(
  playerId: string,
  slot: LoadoutSlot,
  itemId: string,
): Promise<boolean> {
  const inserted = await getDb().execute(sql`
    insert into ${equippedItems} (player_id, slot, item_id)
    select ${playerId}, ${slot}::loadout_slot, ${itemId}
    where exists (
      select 1 from ${coinPurchases}
      where player_id = ${playerId} and item_id = ${itemId}
    )
    on conflict (player_id, slot)
      do update set item_id = excluded.item_id, updated_at = now()
    returning item_id`);
  return inserted.rows.length > 0;
}

export async function unequipSlot(
  playerId: string,
  slot: LoadoutSlot,
): Promise<void> {
  await getDb()
    .delete(equippedItems)
    .where(
      and(eq(equippedItems.playerId, playerId), eq(equippedItems.slot, slot)),
    );
}

/**
 * Spends the player's unused One Wish Willow charge on `wish`, for the
 * Taskmaster to grant or decline. The unique `purchase_id` stops a
 * double-submit spending one charge twice. Returns whether it was made.
 */
export async function makeWish(
  playerId: string,
  wish: string,
): Promise<boolean> {
  const inserted = await getDb().execute(sql`
    insert into ${wishes} (purchase_id, player_id, wish)
    select charge.id, ${playerId}, ${wish}
    from ${coinPurchases} charge
    join ${shopItems} item on item.id = charge.item_id
    where charge.player_id = ${playerId}
      and item.power_up = 'wish'
      and not exists (
        select 1 from ${wishes} made where made.purchase_id = charge.id
      )
    order by charge.id
    limit 1
    on conflict (purchase_id) do nothing
    returning id`);
  return inserted.rows.length > 0;
}

const USE_CONSTRAINT_OUTCOMES: Record<string, CoinOutcome> = {
  power_up_uses_player_id_task_id_unique: "already-used",
  power_up_uses_player_id_effect_unique: "no-charge",
  power_up_uses_one_sabotage_per_target_idx: "already-sabotaged",
  power_up_uses_purchase_id_unique: "no-charge",
  power_up_uses_not_self: "invalid",
  power_up_uses_target_player_id_players_id_fk: "invalid",
};

/**
 * Spends the player's unused charge of `effect` on `taskId`. The caller has
 * checked the week is live and the target valid; the constraints enforce
 * one use of each power-up per player a season, one power-up per player per
 * week and one Sabotage per target per week.
 */
export async function usePowerUp(
  playerId: string,
  taskId: string,
  effect: ActivePowerUpKind,
  targetPlayerId: string | null,
): Promise<CoinOutcome> {
  try {
    const inserted = await getDb().execute(sql`
      insert into ${powerUpUses}
        (purchase_id, player_id, task_id, effect, target_player_id)
      select charge.id, ${playerId}, ${taskId}, ${effect}::power_up_kind,
        ${targetPlayerId}::text
      from ${coinPurchases} charge
      join ${shopItems} item on item.id = charge.item_id
      where charge.player_id = ${playerId}
        and item.power_up = ${effect}::power_up_kind
        and not exists (
          select 1 from ${powerUpUses} spent where spent.purchase_id = charge.id
        )
      order by charge.id
      limit 1
      returning id`);
    return inserted.rows.length > 0 ? "used" : "no-charge";
  } catch (error) {
    const outcome = USE_CONSTRAINT_OUTCOMES[violatedConstraint(error) ?? ""];
    if (outcome) return outcome;
    throw error;
  }
}
