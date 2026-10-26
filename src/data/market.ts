import { sql } from "drizzle-orm";
import type { MarketPriceRange } from "../types";
import { getDb } from "../db";
import {
  coinPurchases,
  equippedItems,
  marketListings,
  marketOffers,
  marketSales,
  players,
  powerUpUses,
  shopItems,
  wishes,
} from "../db/schema";
import { MARKET_POWER_UP_KINDS } from "./coin-rules";
import { budget, heldCopy, listingLive, lockWallet } from "./shop";

// Marketplace writes a player makes from `/account/market` (the middleware
// has already required a signed-in player and purges the cached rows
// after), plus an admin's cancel. Callers check the rules against fresh
// rows first; each write re-checks the stored facts under the wallet lock
// of everyone whose coins or items it moves, so a double-submit or a race
// can't sell one copy twice or overspend.

const tradeablePowerUps = sql.raw(
  MARKET_POWER_UP_KINDS.map((kind) => `'${kind}'`).join(", "),
);

/** Whether `purchase` (an alias) is a charge not yet used or wished on. */
const unspent = (purchase: string) => sql`(
  not exists (
    select 1 from ${powerUpUses} used
    where used.purchase_id = ${sql.raw(purchase)}.id
  )
  and not exists (
    select 1 from ${wishes} made
    where made.purchase_id = ${sql.raw(purchase)}.id
  ))`;

/** Whether `purchase` (an alias) hasn't been sold on. */
const notSold = (purchase: string) => sql`not exists (
  select 1 from ${marketSales} sold
  where sold.source_purchase_id = ${sql.raw(purchase)}.id
)`;

/**
 * Puts the seller's copy (`purchaseId`) on the market at `price`, if it's
 * theirs, still held, unused, tradeable and the price is within `range`
 * (worked out by the caller from the item). A lapsed listing of the same
 * copy is closed first so it can go up again, and the item comes off if
 * it's being worn. Returns the listing's id, or `undefined`.
 */
export async function createListing(
  sellerId: string,
  purchaseId: number,
  price: number,
  range: MarketPriceRange,
): Promise<number | undefined> {
  const db = getDb();
  const [, , listed] = await db.batch([
    db.execute(lockWallet(sellerId)),
    db.execute(sql`
      update ${marketListings}
      set status = 'expired', closed_at = now()
      where purchase_id = ${purchaseId}
        and status = 'open'
        and not ${listingLive("market_listings")}`),
    db.execute(sql`
      with listed as (
        insert into ${marketListings}
          (season_id, seller_id, purchase_id, item_id, price)
        select seller.season_id, seller.id, copy.id, copy.item_id,
          ${price}::integer
        from ${coinPurchases} copy
        join ${players} seller on seller.id = copy.player_id
        join ${shopItems} item on item.id = copy.item_id
        where copy.id = ${purchaseId}
          and copy.player_id = ${sellerId}
          and not item.skill_only
          and (
            item.category <> 'power_up'
            or item.power_up::text in (${tradeablePowerUps})
          )
          and ${heldCopy("copy")}
          and ${unspent("copy")}
          and ${price}::integer
            between ${range.min}::integer and ${range.max}::integer
        on conflict do nothing
        returning id, item_id
      ), unequipped as (
        delete from ${equippedItems} worn
        using listed
        where worn.player_id = ${sellerId} and worn.item_id = listed.item_id
      )
      select id from listed`),
  ]);
  const id = (listed.rows[0] as { id?: number } | undefined)?.id;
  return typeof id === "number" ? id : undefined;
}

/**
 * Takes an open listing off the market and declines its pending offers
 * (releasing their coins). A seller can only cancel their own; an admin
 * (`by.adminName`) can cancel any, and their name is kept on it.
 */
export async function cancelListing(
  listingId: number,
  by: { sellerId: string } | { adminName: string },
): Promise<boolean> {
  const closed = await getDb().execute(sql`
    with closed as (
      update ${marketListings}
      set status = 'cancelled', closed_at = now(),
        cancelled_by_name = ${"adminName" in by ? by.adminName : null}::text
      where id = ${listingId}
        and status = 'open'
        ${"sellerId" in by ? sql`and seller_id = ${by.sellerId}` : sql``}
      returning id
    ), declined as (
      update ${marketOffers} o
      set status = 'declined', decided_at = now()
      from closed
      where o.listing_id = closed.id and o.status = 'pending'
    )
    select id from closed`);
  return closed.rows.length > 0;
}

export interface SaleInput {
  listingId: number;
  sellerId: string;
  buyerId: string;
  /** The listing's price, or the accepted offer's amount. */
  price: number;
  /** Set when the seller is accepting this offer. */
  offerId?: number;
  /** The buyer's derived earnings, from fresh rows. */
  buyerEarned: number;
}

/**
 * Sells a listing to the buyer at `price`: at its listed price, or (with
 * `offerId`) at a pending offer's amount. Everything is re-checked under
 * both wallet locks (taken in a fixed order, so two sales between the same
 * pair can't deadlock): the listing is live and still at that price, the
 * copy is still the seller's and unused, the buyer doesn't already hold the
 * item (or, for a power-up, a charge of its effect) and can afford it with
 * their other offers' coins held. The buyer owns it through a zero-price
 * purchase, the listing closes and its other offers are declined, all in
 * one statement. Returns whether it sold.
 */
export async function completeSale(input: SaleInput): Promise<boolean> {
  const { listingId, sellerId, buyerId, price, offerId, buyerEarned } = input;
  const db = getDb();
  const [first, second] = [sellerId, buyerId].sort();
  const priceMatches =
    offerId === undefined
      ? sql`l.price = ${price}::integer`
      : sql`exists (
          select 1 from ${marketOffers} o
          where o.id = ${offerId}
            and o.listing_id = l.id
            and o.buyer_id = ${buyerId}
            and o.status = 'pending'
            and o.amount = ${price}::integer
        )`;
  const [, , sold] = await db.batch([
    db.execute(lockWallet(first)),
    db.execute(lockWallet(second)),
    db.execute(sql`
      with listing as (
        select l.id, l.season_id, l.purchase_id, l.seller_id
        from ${marketListings} l
        where l.id = ${listingId}
          and l.seller_id = ${sellerId}
          and l.seller_id <> ${buyerId}
          and ${listingLive("l")}
          and ${priceMatches}
      ), eligible as (
        select copy.id as source_id, copy.item_id, listing.id as listing_id,
          listing.season_id
        from listing
        join ${coinPurchases} copy
          on copy.id = listing.purchase_id
          and copy.player_id = listing.seller_id
        join ${shopItems} item on item.id = copy.item_id
        join ${players} buyer
          on buyer.id = ${buyerId}
          and buyer.season_id = listing.season_id
        where ${notSold("copy")}
          and ${unspent("copy")}
          and not exists (
            select 1 from ${coinPurchases} mine
            join ${shopItems} mine_item on mine_item.id = mine.item_id
            where mine.player_id = ${buyerId}
              and ${notSold("mine")}
              and (
                mine.item_id = item.id
                or mine_item.power_up = item.power_up
              )
          )
          and (${budget(buyerId, buyerEarned, listingId)}) >= ${price}::integer
      ), bought as (
        insert into ${coinPurchases} (player_id, item_id, price)
        select ${buyerId}, eligible.item_id, 0 from eligible
        returning id
      ), sale as (
        insert into ${marketSales}
          (season_id, listing_id, seller_id, buyer_id, item_id, price,
            source_purchase_id, buyer_purchase_id, offer_id)
        select eligible.season_id, eligible.listing_id, ${sellerId},
          ${buyerId}, eligible.item_id, ${price}::integer, eligible.source_id,
          bought.id, ${offerId ?? null}::integer
        from eligible cross join bought
        returning id, listing_id
      ), closed as (
        update ${marketListings} l
        set status = 'sold', closed_at = now()
        from sale
        where l.id = sale.listing_id
      ), decided as (
        update ${marketOffers} o
        set status = case
            when o.id = ${offerId ?? null}::integer
              then 'accepted'::market_offer_status
            else 'declined'::market_offer_status
          end,
          decided_at = now()
        from sale
        where o.listing_id = sale.listing_id and o.status = 'pending'
      )
      select id from sale`),
  ]);
  return sold.rows.length > 0;
}

/**
 * Makes (or replaces) the buyer's offer on a live listing: at least
 * `min`, below the listed price, and covered by what they can spend with
 * their other offers' coins held. Checked under the buyer's wallet lock.
 */
export async function makeOffer(
  buyerId: string,
  listingId: number,
  amount: number,
  min: number,
  earned: number,
): Promise<boolean> {
  const db = getDb();
  const [, offered] = await db.batch([
    db.execute(lockWallet(buyerId)),
    db.execute(sql`
      insert into ${marketOffers} (listing_id, buyer_id, amount)
      select l.id, buyer.id, ${amount}::integer
      from ${marketListings} l
      join ${players} buyer
        on buyer.id = ${buyerId} and buyer.season_id = l.season_id
      where l.id = ${listingId}
        and ${listingLive("l")}
        and l.seller_id <> ${buyerId}
        and ${amount}::integer >= ${min}::integer
        and ${amount}::integer < l.price
        and (${budget(buyerId, earned, listingId)}) >= ${amount}::integer
      on conflict (listing_id, buyer_id) where status = 'pending'
        do update set amount = excluded.amount, created_at = now()
      returning id`),
  ]);
  return offered.rows.length > 0;
}

/** Withdraws the buyer's pending offer, releasing its coins. */
export async function withdrawOffer(
  buyerId: string,
  offerId: number,
): Promise<boolean> {
  const withdrawn = await getDb().execute(sql`
    update ${marketOffers}
    set status = 'withdrawn', decided_at = now()
    where id = ${offerId} and buyer_id = ${buyerId} and status = 'pending'
    returning id`);
  return withdrawn.rows.length > 0;
}

/** Declines a pending offer on one of the seller's listings. */
export async function declineOffer(
  sellerId: string,
  offerId: number,
): Promise<boolean> {
  const declined = await getDb().execute(sql`
    update ${marketOffers} o
    set status = 'declined', decided_at = now()
    from ${marketListings} l
    where o.id = ${offerId}
      and o.status = 'pending'
      and l.id = o.listing_id
      and l.seller_id = ${sellerId}
    returning o.id`);
  return declined.rows.length > 0;
}
