import type { MarketBuyBlock, MarketOutcome } from "../types";
import type { MarketAction } from "../lib/account-forms";
import { createQueries } from "./queries";
import { loadFreshPlayerCompetition } from "./competition";
import {
  cancelListing,
  completeSale,
  createListing,
  declineOffer,
  makeOffer,
  withdrawOffer,
} from "./market";

const BLOCK_OUTCOME: Record<MarketBuyBlock, MarketOutcome> = {
  guest: "invalid",
  disabled: "disabled",
  "season-closed": "season-closed",
  closed: "closed",
  "own-listing": "invalid",
  owned: "owned",
  "no-offers": "out-of-range",
  unaffordable: "unaffordable",
};

export interface MarketResult {
  outcome: MarketOutcome;
  /** The listing the action was about, to send the player back to. */
  listingId?: number;
}

/**
 * Carries out a marketplace action for a signed-in player and says how it
 * went. Everything is checked against fresh rows (the edge-cached ones may
 * be a few minutes old), then re-checked by the write itself.
 */
export async function runMarketAction(
  playerId: string,
  action: MarketAction,
): Promise<MarketResult> {
  const fresh = await loadFreshPlayerCompetition(playerId);
  if (!fresh) return { outcome: "invalid" };
  if (!fresh.features.marketplace) return { outcome: "disabled" };
  if (fresh.season.status === "closed") return { outcome: "season-closed" };
  const q = createQueries(fresh);
  const now = Date.now();

  switch (action.intent) {
    case "list": {
      const copy = q.getListableItem(playerId, action.purchaseId, now);
      if (!copy || copy.listing) return { outcome: "invalid" };
      if (copy.blocked) return { outcome: copy.blocked };
      const { min, max } = copy.range;
      if (action.price < min || action.price > max) {
        return { outcome: "out-of-range" };
      }
      const id = await createListing(
        playerId,
        copy.purchaseId,
        action.price,
        copy.range,
      );
      return id === undefined
        ? { outcome: "invalid" }
        : { outcome: "listed", listingId: id };
    }
    case "cancel": {
      const done = await cancelListing(action.listingId, {
        sellerId: playerId,
      });
      return {
        outcome: done ? "cancelled" : "closed",
        listingId: action.listingId,
      };
    }
    case "buy": {
      const listingId = action.listingId;
      const detail = q.getMarketListing(listingId, playerId, now);
      if (!detail) return { outcome: "invalid" };
      if (detail.buyBlocked) {
        return { outcome: BLOCK_OUTCOME[detail.buyBlocked], listingId };
      }
      const { listing } = detail.view;
      if (listing.price !== action.price)
        return { outcome: "invalid", listingId };
      const sold = await completeSale({
        listingId,
        sellerId: listing.sellerId,
        buyerId: playerId,
        price: listing.price,
        buyerEarned: q.getWallet(playerId, now).earned,
      });
      return { outcome: sold ? "bought" : "invalid", listingId };
    }
    case "offer": {
      const listingId = action.listingId;
      const detail = q.getMarketListing(listingId, playerId, now);
      if (!detail) return { outcome: "invalid" };
      if (detail.offerBlocked) {
        return { outcome: BLOCK_OUTCOME[detail.offerBlocked], listingId };
      }
      const { listing, range } = detail.view;
      if (action.amount < range.min || action.amount >= listing.price) {
        return { outcome: "out-of-range", listingId };
      }
      if (
        action.amount >
        (detail.available ?? 0) + (detail.myOffer?.offer.amount ?? 0)
      ) {
        return { outcome: "unaffordable", listingId };
      }
      const offered = await makeOffer(
        playerId,
        listingId,
        action.amount,
        range.min,
        q.getWallet(playerId, now).earned,
      );
      return { outcome: offered ? "offered" : "invalid", listingId };
    }
    case "withdraw": {
      const offer = q.getMarketOffer(action.offerId, now);
      const done = await withdrawOffer(playerId, action.offerId);
      return {
        outcome: done ? "withdrawn" : "invalid",
        ...(offer && { listingId: offer.listing.listing.id }),
      };
    }
    case "accept": {
      const offer = q.getMarketOffer(action.offerId, now);
      if (!offer || offer.listing.listing.sellerId !== playerId) {
        return { outcome: "invalid" };
      }
      const listingId = offer.listing.listing.id;
      if (offer.status !== "pending") return { outcome: "closed", listingId };
      const sold = await completeSale({
        listingId,
        sellerId: playerId,
        buyerId: offer.offer.buyerId,
        price: offer.offer.amount,
        offerId: offer.offer.id,
        buyerEarned: q.getWallet(offer.offer.buyerId, now).earned,
      });
      return { outcome: sold ? "accepted" : "invalid", listingId };
    }
    case "decline": {
      const offer = q.getMarketOffer(action.offerId, now);
      const done = await declineOffer(playerId, action.offerId);
      return {
        outcome: done ? "declined" : "invalid",
        ...(offer && { listingId: offer.listing.listing.id }),
      };
    }
  }
}
