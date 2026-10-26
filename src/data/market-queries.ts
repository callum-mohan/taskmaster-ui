import type {
  CompetitionData,
  ListableItem,
  MarketBuyBlock,
  MarketListing,
  MarketListingDetail,
  MarketListingView,
  MarketOfferView,
  MarketSale,
  MarketSaleView,
  MarketSort,
  PlayerMarket,
  ShopCategory,
  ShopItem,
  Wallet,
} from "../types";
import { isTradeable, marketPriceRange } from "./coin-rules";
import {
  listingExpiry,
  listingStatus,
  liveListingsByPurchase,
  offerStatus,
  soldPurchaseIds,
} from "./market-mappers";

/** Recent sales the market page lists. */
export const RECENT_SALES = 10;

interface MarketDeps {
  getWallet: (playerId: string, now?: number) => Wallet;
}

/**
 * Marketplace selectors (spread into `createQueries`): open listings, one
 * listing as a viewer sees it, a player's side of the market and the
 * season's sales. Pure over the snapshot; the writes in `market.ts`
 * re-check the stored facts. Everything is gated on the `marketplace`
 * feature flag: off, nothing can be listed, bought or offered.
 */
export function createMarketQueries(data: CompetitionData, deps: MarketDeps) {
  const { players, coins, season, features } = data;
  const { market } = coins;
  const enabled = features.marketplace;
  const seasonClosed = season.status === "closed";
  const itemById = new Map(coins.items.map((i) => [i.id, i]));
  const playerById = new Map(players.map((p) => [p.id, p]));
  const listingById = new Map(market.listings.map((l) => [l.id, l]));
  const saleByListing = new Map(market.sales.map((s) => [s.listingId, s]));
  const sold = soldPurchaseIds(market);
  const spentPurchaseIds = new Set([
    ...coins.uses.map((u) => u.purchaseId),
    ...coins.wishes.map((w) => w.purchaseId),
  ]);

  function toSaleView(sale: MarketSale): MarketSaleView | undefined {
    const item = itemById.get(sale.itemId);
    const seller = playerById.get(sale.sellerId);
    const buyer = playerById.get(sale.buyerId);
    if (!item || !seller || !buyer) return undefined;
    return { sale, item, seller, buyer };
  }

  function toView(
    listing: MarketListing,
    now: number,
  ): MarketListingView | undefined {
    const item = itemById.get(listing.itemId);
    const seller = playerById.get(listing.sellerId);
    if (!item || !seller) return undefined;
    const status = listingStatus(listing, now);
    const live = market.offers.filter(
      (o) =>
        o.listingId === listing.id &&
        offerStatus(o, listing, now) === "pending",
    );
    const sale = saleByListing.get(listing.id);
    const saleView = sale && toSaleView(sale);
    return {
      listing,
      status,
      item,
      seller,
      expiresAt: new Date(listingExpiry(listing)).toISOString(),
      range: marketPriceRange(item),
      offerCount: live.length,
      ...(live.length > 0 && {
        bestOffer: Math.max(...live.map((o) => o.amount)),
      }),
      ...(saleView && { sale: saleView }),
    };
  }

  function toOfferView(
    offer: CompetitionData["coins"]["market"]["offers"][number],
    now: number,
  ): MarketOfferView | undefined {
    const listing = listingById.get(offer.listingId);
    const buyer = playerById.get(offer.buyerId);
    const view = listing && toView(listing, now);
    if (!view || !buyer) return undefined;
    return {
      offer,
      status: offerStatus(offer, listing, now),
      buyer,
      listing: view,
    };
  }

  /** Whether a player holds `item` now (power-ups: any charge of it). */
  function holdsItem(playerId: string, item: ShopItem): boolean {
    return coins.purchases.some((p) => {
      if (p.playerId !== playerId || sold.has(p.id)) return false;
      if (p.itemId === item.id) return true;
      return (
        item.powerUp !== undefined &&
        itemById.get(p.itemId)?.powerUp === item.powerUp
      );
    });
  }

  /** Why `playerId` can't buy (or offer on) a listing now. */
  function getMarketBuyBlock(
    view: MarketListingView,
    playerId: string | undefined,
    now: number = Date.now(),
  ): MarketBuyBlock | undefined {
    if (!enabled) return "disabled";
    if (!playerId || !playerById.has(playerId)) return "guest";
    if (seasonClosed) return "season-closed";
    if (view.status !== "open") return "closed";
    if (view.listing.sellerId === playerId) return "own-listing";
    if (holdsItem(playerId, view.item)) return "owned";
    const available =
      deps.getWallet(playerId, now).balance + heldOn(view, playerId, now);
    if (available < view.listing.price) return "unaffordable";
    return undefined;
  }

  /** Why `playerId` can't make an offer on a listing now. */
  function getMarketOfferBlock(
    view: MarketListingView,
    playerId: string | undefined,
    now: number = Date.now(),
  ): MarketBuyBlock | undefined {
    const blocked = getMarketBuyBlock(view, playerId, now);
    if (blocked && blocked !== "unaffordable") return blocked;
    if (view.listing.price <= view.range.min) return "no-offers";
    if (!playerId) return "guest";
    const available =
      deps.getWallet(playerId, now).balance + heldOn(view, playerId, now);
    return available < view.range.min ? "unaffordable" : undefined;
  }

  /** Coins `playerId`'s own offer on this listing holds (spendable on it). */
  function heldOn(
    view: MarketListingView,
    playerId: string,
    now: number,
  ): number {
    return market.offers
      .filter(
        (o) =>
          o.listingId === view.listing.id &&
          o.buyerId === playerId &&
          offerStatus(o, view.listing, now) === "pending",
      )
      .reduce((sum, o) => sum + o.amount, 0);
  }

  /** Open listings, optionally of one shop category. */
  function getMarketListings(
    options: { category?: ShopCategory; sort?: MarketSort } = {},
    now: number = Date.now(),
  ): MarketListingView[] {
    const views = market.listings
      .filter((l) => listingStatus(l, now) === "open")
      .flatMap((l) => toView(l, now) ?? [])
      .filter((v) => !options.category || v.item.category === options.category);
    const sort = options.sort ?? "newest";
    return views.sort((a, b) =>
      sort === "price-asc"
        ? a.listing.price - b.listing.price || b.listing.id - a.listing.id
        : sort === "price-desc"
          ? b.listing.price - a.listing.price || b.listing.id - a.listing.id
          : b.listing.id - a.listing.id,
    );
  }

  /** Every listing this season, newest first (any state; for admins). */
  function getAllMarketListings(now: number = Date.now()): MarketListingView[] {
    return [...market.listings].reverse().flatMap((l) => toView(l, now) ?? []);
  }

  /** The season's sales, newest first. */
  function getRecentMarketSales(limit = RECENT_SALES): MarketSaleView[] {
    return [...market.sales]
      .reverse()
      .flatMap((s) => toSaleView(s) ?? [])
      .slice(0, limit);
  }

  /** Every sale of `itemId` this season, newest first. */
  function getItemPriceHistory(itemId: string): MarketSaleView[] {
    return [...market.sales]
      .reverse()
      .filter((s) => s.itemId === itemId)
      .flatMap((s) => toSaleView(s) ?? []);
  }

  /** One listing as `playerId` (or a guest) sees it. */
  function getMarketListing(
    id: number,
    playerId: string | undefined,
    now: number = Date.now(),
  ): MarketListingDetail | undefined {
    const listing = listingById.get(id);
    const view = listing && toView(listing, now);
    if (!view) return undefined;
    const isSeller = playerId === view.listing.sellerId;
    const offers = market.offers
      .filter((o) => o.listingId === id)
      .flatMap((o) => toOfferView(o, now) ?? []);
    const myOffer = playerId
      ? offers.find(
          (o) => o.offer.buyerId === playerId && o.status === "pending",
        )
      : undefined;
    const buyBlocked = getMarketBuyBlock(view, playerId, now);
    const offerBlocked = getMarketOfferBlock(view, playerId, now);
    const known = playerId !== undefined && playerById.has(playerId);
    return {
      view,
      history: getItemPriceHistory(view.item.id).filter(
        (s) => s.sale.listingId !== id,
      ),
      ...(buyBlocked && { buyBlocked }),
      ...(offerBlocked && { offerBlocked }),
      ...(myOffer && { myOffer }),
      offers: isSeller
        ? offers
            .filter((o) => o.status === "pending")
            .sort((a, b) => b.offer.amount - a.offer.amount)
        : [],
      ...(known && { available: deps.getWallet(playerId, now).balance }),
    };
  }

  /** What a player owns that could go on sale, and why not when it can't. */
  function getListableItems(
    playerId: string,
    now: number = Date.now(),
  ): ListableItem[] {
    const live = liveListingsByPurchase(market, now);
    return coins.purchases.flatMap((p): ListableItem[] => {
      const item = itemById.get(p.itemId);
      if (p.playerId !== playerId || sold.has(p.id) || !item) return [];
      const listing = live.get(p.id);
      const view = listing && toView(listing, now);
      const blocked: ListableItem["blocked"] = !enabled
        ? "disabled"
        : seasonClosed
          ? "season-closed"
          : !isTradeable(item)
            ? "untradeable"
            : spentPurchaseIds.has(p.id)
              ? "spent"
              : undefined;
      return [
        {
          purchaseId: p.id,
          item,
          range: marketPriceRange(item),
          ...(view && { listing: view }),
          ...(blocked && { blocked }),
        },
      ];
    });
  }

  /** A player's side of the market: listings, offers both ways, holdings. */
  function getPlayerMarket(
    playerId: string,
    now: number = Date.now(),
  ): PlayerMarket {
    const listings = [...market.listings]
      .reverse()
      .filter((l) => l.sellerId === playerId)
      .flatMap((l) => toView(l, now) ?? []);
    const offers = [...market.offers]
      .reverse()
      .flatMap((o) => toOfferView(o, now) ?? []);
    const offersMade = offers.filter((o) => o.offer.buyerId === playerId);
    return {
      listings,
      offersMade,
      offersReceived: offers.filter(
        (o) =>
          o.listing.listing.sellerId === playerId && o.status === "pending",
      ),
      listable: getListableItems(playerId, now),
      held: deps.getWallet(playerId, now).held,
    };
  }

  /** A listing's state for a purchase id (the account page's sell form). */
  function getListableItem(
    playerId: string,
    purchaseId: number,
    now: number = Date.now(),
  ): ListableItem | undefined {
    return getListableItems(playerId, now).find(
      (l) => l.purchaseId === purchaseId,
    );
  }

  /** A pending offer by id, as either side sees it. */
  function getMarketOffer(
    offerId: number,
    now: number = Date.now(),
  ): MarketOfferView | undefined {
    const offer = market.offers.find((o) => o.id === offerId);
    return offer && toOfferView(offer, now);
  }

  return {
    marketEnabled: enabled,
    getMarketListings,
    getAllMarketListings,
    getMarketListing,
    getMarketBuyBlock,
    getMarketOfferBlock,
    getRecentMarketSales,
    getItemPriceHistory,
    getListableItems,
    getListableItem,
    getPlayerMarket,
    getMarketOffer,
  };
}
