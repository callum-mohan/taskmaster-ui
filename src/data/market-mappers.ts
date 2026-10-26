import type {
  MarketData,
  MarketListing,
  MarketListingStatus,
  MarketOffer,
  MarketOfferStatus,
  MarketSale,
} from "../types";
import type {
  marketListings as marketListingsTable,
  marketOffers as marketOffersTable,
  marketSales as marketSalesTable,
} from "../db/schema";
import { timestamptzToIso } from "../lib/time";
import { MARKET_LISTING_MS } from "./coin-rules";

// The player-to-player marketplace: mappers and the pure rules every
// selector shares. Expiry is derived from when a listing was made, so a
// listing lapses (and its offers stop holding coins) without anything
// having to run; the writes in `market.ts` apply the same rule in SQL.

type ListingRow = typeof marketListingsTable.$inferSelect;
type OfferRow = typeof marketOffersTable.$inferSelect;
type SaleRow = typeof marketSalesTable.$inferSelect;

const byId = <Row extends { id: number }>(rows: Row[]) =>
  [...rows].sort((a, b) => a.id - b.id);

export function mapMarket(
  listingRows: ListingRow[],
  offerRows: OfferRow[],
  saleRows: SaleRow[],
): MarketData {
  return {
    listings: byId(listingRows).map(
      (row): MarketListing => ({
        id: row.id,
        sellerId: row.sellerId,
        purchaseId: row.purchaseId,
        itemId: row.itemId,
        price: row.price,
        status: row.status,
        ...(row.cancelledByName !== null && {
          cancelledByName: row.cancelledByName,
        }),
        at: timestamptzToIso(row.createdAt),
        ...(row.closedAt !== null && {
          closedAt: timestamptzToIso(row.closedAt),
        }),
      }),
    ),
    offers: byId(offerRows).map(
      (row): MarketOffer => ({
        id: row.id,
        listingId: row.listingId,
        buyerId: row.buyerId,
        amount: row.amount,
        status: row.status,
        at: timestamptzToIso(row.createdAt),
        ...(row.decidedAt !== null && {
          decidedAt: timestamptzToIso(row.decidedAt),
        }),
      }),
    ),
    sales: byId(saleRows).map(
      (row): MarketSale => ({
        id: row.id,
        listingId: row.listingId,
        sellerId: row.sellerId,
        buyerId: row.buyerId,
        itemId: row.itemId,
        price: row.price,
        sourcePurchaseId: row.sourcePurchaseId,
        buyerPurchaseId: row.buyerPurchaseId,
        ...(row.offerId !== null && { offerId: row.offerId }),
        at: timestamptzToIso(row.createdAt),
      }),
    ),
  };
}

const instant = (iso: string) => new Date(iso).getTime();

/** When a listing lapses if nobody buys it. */
export function listingExpiry(listing: Pick<MarketListing, "at">): number {
  return instant(listing.at) + MARKET_LISTING_MS;
}

/** A listing's state at `now`: an open one past its expiry has expired. */
export function listingStatus(
  listing: Pick<MarketListing, "at" | "status">,
  now: number,
): MarketListingStatus {
  return listing.status === "open" && now >= listingExpiry(listing)
    ? "expired"
    : listing.status;
}

/** An offer's state at `now`: a pending one lapses with its listing. */
export function offerStatus(
  offer: Pick<MarketOffer, "status">,
  listing: Pick<MarketListing, "at" | "status"> | undefined,
  now: number,
): MarketOfferStatus {
  if (offer.status !== "pending") return offer.status;
  return listing && listingStatus(listing, now) === "open"
    ? "pending"
    : "expired";
}

/** Purchase ids of copies sold on: they no longer belong to the seller. */
export function soldPurchaseIds(market: MarketData): Set<number> {
  return new Set(market.sales.map((s) => s.sourcePurchaseId));
}

/** Open, unexpired listings by the purchase (copy) they're selling. */
export function liveListingsByPurchase(
  market: MarketData,
  now: number,
): Map<number, MarketListing> {
  return new Map(
    market.listings
      .filter((l) => listingStatus(l, now) === "open")
      .map((l) => [l.purchaseId, l]),
  );
}

/** Pending offers that still hold coins (their listing is live). */
export function liveOffers(market: MarketData, now: number): MarketOffer[] {
  const listings = new Map(market.listings.map((l) => [l.id, l]));
  return market.offers.filter(
    (o) => offerStatus(o, listings.get(o.listingId), now) === "pending",
  );
}

/** The coins a player's pending offers hold. */
export function heldCoins(
  market: MarketData,
  playerId: string,
  now: number,
): number {
  return liveOffers(market, now)
    .filter((o) => o.buyerId === playerId)
    .reduce((sum, o) => sum + o.amount, 0);
}
