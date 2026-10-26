import type {
  ActivePowerUpKind,
  CompetitionData,
  CratePull,
  CrateView,
  EggGiftView,
  GiftPanel,
  GiftableItemGroup,
  InventoryItem,
  ItemGiftView,
  Player,
  PlayerFlair,
  PlayerLoadout,
  PowerUpBlock,
  PowerUpFeedEntry,
  PowerUpKind,
  PowerUpOption,
  ShopListing,
  PowerUpPanel,
  PowerUpUse,
  PurchaseBlock,
  ShopItem,
  ShopSection,
  SkillPerks,
  Task,
  UnopenedEgg,
  Wallet,
  WishPanel,
} from "../types";
import {
  ACTIVE_POWER_UP_KINDS,
  CATEGORY_INFO,
  NAME_COLOURS,
  POWER_UP_INFO,
  PROFILE_THEMES,
  SHOP_CATEGORIES,
  crateAverageValue,
  crateOdds,
  deriveWallet,
  giftAllowance,
  insuranceClaims,
  isOnSale,
  resolveSabotages,
  slotOf,
} from "./coins";
import {
  GIFT_WEEKLY_CAP,
  cratesOnSale,
  getCrate,
  inSaleWindow,
} from "./coin-rules";
import { liveListingsByPurchase, soldPurchaseIds } from "./market-mappers";
import {
  discountedPrice,
  eggPrice,
  getSkillPath,
  luckyCrate,
  skillPerksFor,
} from "./skill-trees";

/** What a viewer of the shop is: a signed-in player (by id) or a guest. */
export interface ShopViewer {
  playerId?: string;
}

/**
 * Clim Coin selectors (spread into `createQueries`): wallets, inventories,
 * what each player is wearing, the shop as one viewer sees it, and power-up
 * eligibility. Pure over the snapshot; the writes in `shop.ts` re-check the
 * stored facts.
 */
export function createCoinQueries(data: CompetitionData) {
  const { players, tasks, coins, predictions, season, features } = data;
  // The mystery eggs feature flag: off hides every crate and what they drop.
  const eggsOn = features.shop_eggs;
  const skillTreesOn = features.skill_trees;
  const itemById = new Map(coins.items.map((i) => [i.id, i]));
  const playerById = new Map(players.map((p) => [p.id, p]));
  const seasonClosed = season.status === "closed";
  // Charges spent on a week, or (the One Wish Willow) on a wish.
  const usedPurchaseIds = new Set([
    ...coins.uses.map((u) => u.purchaseId),
    ...coins.wishes.map((w) => w.purchaseId),
  ]);
  // Passive power-ups: how each Sabotage resolved (Shields and Mirrors are
  // only shown once the week's results are out), and spent defences.
  const sabotages = resolveSabotages(coins.uses, coins.purchases, coins.items);
  const spentDefenceIds = new Set(
    [...sabotages.values()].flatMap((r) => r.defencePurchaseId ?? []),
  );
  const resultsOut = (taskId: string) => taskId in data.resultsPostedAt;
  // Marketplace: copies sold on are no longer the seller's, and a copy on
  // sale can't be worn or used until its listing closes or lapses.
  const sold = soldPurchaseIds(coins.market);
  const heldPurchases = coins.purchases.filter((p) => !sold.has(p.id));
  const liveListings = liveListingsByPurchase(coins.market, Date.now());
  // Limited stock counts only copies bought from the shop this season: the
  // zero-price copies eggs, gifts, skill nodes and resales give don't.
  const grantedPurchaseIds = new Set([
    ...coins.crateOpens.map((o) => o.purchaseId),
    ...coins.itemGifts.map((g) => g.purchaseId),
    ...coins.skillUnlocks.flatMap((u) =>
      u.purchaseId === undefined ? [] : [u.purchaseId],
    ),
    ...coins.market.sales.map((s) => s.buyerPurchaseId),
  ]);
  const shopSales = new Map<string, number>();
  for (const p of coins.purchases) {
    if (grantedPurchaseIds.has(p.id)) continue;
    shopSales.set(p.itemId, (shopSales.get(p.itemId) ?? 0) + 1);
  }

  /** How many of a limited-stock item the shop has left this season. */
  function getStockLeft(item: ShopItem): number | undefined {
    if (item.stock === undefined) return undefined;
    return Math.max(item.stock - (shopSales.get(item.id) ?? 0), 0);
  }

  /** Purchase ids of a player's power-up charges that are used up. */
  function spentChargeIds(playerId: string): Set<number> {
    return new Set([
      ...usedPurchaseIds,
      ...spentDefenceIds,
      ...insuranceClaims(data, playerId).values(),
    ]);
  }

  function getShopItemById(id: string): ShopItem | undefined {
    return itemById.get(id);
  }

  function getWallet(playerId: string, now: number = Date.now()): Wallet {
    return deriveWallet(data, playerId, now);
  }

  /** A player's skill tree perks, added up. */
  function getSkillPerks(playerId: string): SkillPerks {
    return skillPerksFor(coins.skillUnlocks, playerId);
  }

  /** What `item` costs `playerId` now, after their skill tree discounts. */
  function getItemPrice(item: ShopItem, playerId: string | undefined): number {
    return playerId
      ? discountedPrice(item, getSkillPerks(playerId))
      : item.price;
  }

  const wearableIds = (purchases: readonly { itemId: string }[]) =>
    new Set(
      purchases
        .map((p) => p.itemId)
        .filter((id) => itemById.get(id)?.category !== "power_up"),
    );

  /** Ids of the pets, avatars and cosmetics a player owns now. */
  function ownedItemIds(playerId: string): Set<string> {
    return wearableIds(heldPurchases.filter((p) => p.playerId === playerId));
  }

  /**
   * Ids of the pets, avatars and cosmetics a player has had this season,
   * sold on or not: the shop, eggs and admin gifts never give one twice.
   */
  function everOwnedItemIds(playerId: string): Set<string> {
    return wearableIds(coins.purchases.filter((p) => p.playerId === playerId));
  }

  /**
   * Power-up effects a player has bought this season, used or not. Each is
   * one charge, bought at most once and used at most once a season.
   */
  function boughtEffects(playerId: string): Set<PowerUpKind> {
    return new Set(
      coins.purchases.flatMap((p) => {
        const effect =
          p.playerId === playerId && itemById.get(p.itemId)?.powerUp;
        return effect ? [effect] : [];
      }),
    );
  }

  /** Unused power-up charges a player holds, by item id. */
  function chargesByItem(playerId: string): Map<string, number> {
    const spent = spentChargeIds(playerId);
    const charges = new Map<string, number>();
    for (const p of heldPurchases) {
      if (p.playerId !== playerId || spent.has(p.id)) continue;
      if (liveListings.has(p.id)) continue;
      if (itemById.get(p.itemId)?.category !== "power_up") continue;
      charges.set(p.itemId, (charges.get(p.itemId) ?? 0) + 1);
    }
    return charges;
  }

  function chargesFor(playerId: string, effect: PowerUpKind): number {
    let total = 0;
    for (const [itemId, n] of chargesByItem(playerId)) {
      if (itemById.get(itemId)?.powerUp === effect) total += n;
    }
    return total;
  }

  /** Equipped items that are still owned and still fit their slot. */
  function equippedItems(playerId: string): Map<string, ShopItem> {
    const owned = ownedItemIds(playerId);
    const result = new Map<string, ShopItem>();
    for (const e of coins.equipped) {
      if (e.playerId !== playerId || !owned.has(e.itemId)) continue;
      if (listedCopy(playerId, e.itemId)) continue;
      const item = itemById.get(e.itemId);
      if (item && slotOf(item) === e.slot) result.set(e.slot, item);
    }
    return result;
  }

  function getLoadout(playerId: string): PlayerLoadout {
    const worn = equippedItems(playerId);
    const value = (slot: string) => worn.get(slot)?.cosmetic?.value;
    const nameColour = NAME_COLOURS.find((c) => c === value("name_colour"));
    const theme = PROFILE_THEMES.find((t) => t === value("theme"));
    const pet = worn.get("pet");
    const avatar = worn.get("avatar");
    const title = value("title");
    return {
      ...(pet && { pet }),
      ...(avatar && { avatar }),
      ...(title && { title }),
      ...(nameColour && { nameColour }),
      ...(theme && { theme }),
    };
  }

  /** The cosmetics public lists (leaderboard, player cards) show. */
  function getPlayerFlair(playerId: string): PlayerFlair {
    const { pet, title, nameColour } = getLoadout(playerId);
    // The pathway sigil goes with the skill trees flag.
    const pick = skillTreesOn
      ? coins.skillPaths.find((p) => p.playerId === playerId)
      : undefined;
    const path = pick && getSkillPath(pick.pathId);
    return {
      ...(pet?.imageUrl && {
        pet: { name: pet.name, imageUrl: pet.imageUrl },
      }),
      ...(title && { title }),
      ...(nameColour && { nameColour }),
      ...(path && {
        skillPath: { id: path.id, name: path.name, accent: path.accent },
      }),
    };
  }

  /** Every player's flair with any set, by player id (for lists). */
  function getPlayerFlairs(): Record<string, PlayerFlair> {
    return Object.fromEntries(
      players.flatMap((p) => {
        const flair = getPlayerFlair(p.id);
        return Object.keys(flair).length > 0 ? [[p.id, flair] as const] : [];
      }),
    );
  }

  /** The image of a player's equipped shop avatar, if any. */
  function getEquippedAvatarUrl(playerId: string): string | undefined {
    return equippedItems(playerId).get("avatar")?.imageUrl;
  }

  /** The live listing of a player's copy of `itemId`, if it's on sale. */
  function listedCopy(playerId: string, itemId: string) {
    for (const p of heldPurchases) {
      if (p.playerId !== playerId || p.itemId !== itemId) continue;
      const listing = liveListings.get(p.id);
      if (listing) return listing;
    }
    return undefined;
  }

  /** Every owned item, equippable ones first, then power-ups with charges. */
  function getInventory(playerId: string): InventoryItem[] {
    const owned = ownedItemIds(playerId);
    const worn = equippedItems(playerId);
    const charges = chargesByItem(playerId);
    return coins.items.flatMap((item): InventoryItem[] => {
      if (item.category === "power_up") {
        const n = charges.get(item.id) ?? 0;
        return n > 0 ? [{ item, equipped: false, charges: n }] : [];
      }
      if (!owned.has(item.id)) return [];
      const slot = slotOf(item);
      const listing = listedCopy(playerId, item.id);
      return [
        {
          item,
          ...(slot && { slot }),
          equipped: slot !== undefined && worn.get(slot)?.id === item.id,
          charges: 0,
          ...(listing && { listingId: listing.id }),
        },
      ];
    });
  }

  /**
   * What an admin can gift a player, by shop category: any item in the
   * catalogue (retired, egg-exclusive and out-of-window ones included) that
   * they don't own yet, and power-ups whose effect they haven't had this
   * season (a second charge could never be used).
   */
  function getGiftableItems(playerId: string): GiftableItemGroup[] {
    const owned = everOwnedItemIds(playerId);
    const effects = boughtEffects(playerId);
    return SHOP_CATEGORIES.flatMap((category): GiftableItemGroup[] => {
      const items = coins.items.filter(
        (item) =>
          item.category === category &&
          !owned.has(item.id) &&
          !(item.powerUp && effects.has(item.powerUp)),
      );
      return items.length > 0
        ? [{ category, label: CATEGORY_INFO[category].label, items }]
        : [];
    });
  }

  /** Items admins gifted a player, newest first. */
  function getItemGifts(playerId: string): ItemGiftView[] {
    const spent = spentChargeIds(playerId);
    return [...coins.itemGifts].reverse().flatMap((gift): ItemGiftView[] => {
      const item = itemById.get(gift.itemId);
      if (gift.playerId !== playerId || !item) return [];
      return [
        {
          gift,
          item,
          spent: item.category === "power_up" && spent.has(gift.purchaseId),
        },
      ];
    });
  }

  /** Why `viewer` can't buy `item` now, or `undefined` when they can. */
  function getPurchaseBlock(
    item: ShopItem,
    viewer: ShopViewer,
    now: number = Date.now(),
  ): PurchaseBlock | undefined {
    if (!viewer.playerId || !playerById.has(viewer.playerId)) return "guest";
    if (seasonClosed) return "season-closed";
    if (item.powerUp && boughtEffects(viewer.playerId).has(item.powerUp)) {
      return chargesFor(viewer.playerId, item.powerUp) > 0 ? "owned" : "used";
    }
    if (everOwnedItemIds(viewer.playerId).has(item.id)) return "owned";
    if (item.skillOnly) return "skill-only";
    if (!isOnSale(item, now)) return "unavailable";
    if (item.crateOnly) return "crate-only";
    if (getStockLeft(item) === 0) return "sold-out";
    if (
      getWallet(viewer.playerId, now).balance <
      getItemPrice(item, viewer.playerId)
    ) {
      return "unaffordable";
    }
    return undefined;
  }

  /**
   * Whether the shop lists `item` now: on sale, and (for an egg exclusive)
   * only while eggs are on, and a seasonal egg's only while that egg is.
   */
  function isListed(item: ShopItem, now: number): boolean {
    if (!isOnSale(item, now) || item.skillOnly) return false;
    // Egg exclusives can't be got any other way, so they go with the eggs.
    if (item.crateOnly && !eggsOn) return false;
    if (!item.crateId) return true;
    const crate = getCrate(item.crateId);
    return crate !== undefined && inSaleWindow(crate, now);
  }

  /** Limited-time stock sold directly: shown on its own shelf. */
  const isLimited = (item: ShopItem) =>
    item.availableUntil !== undefined && !item.crateOnly;

  function toListings(
    items: readonly ShopItem[],
    viewer: ShopViewer,
    now: number,
  ): ShopListing[] {
    const playerId =
      viewer.playerId && playerById.has(viewer.playerId)
        ? viewer.playerId
        : undefined;
    const owned = playerId ? ownedItemIds(playerId) : new Set<string>();
    const effects = playerId ? boughtEffects(playerId) : new Set();
    const charges = playerId ? chargesByItem(playerId) : new Map();
    return items.map((item) => {
      const blocked = getPurchaseBlock(item, { playerId }, now);
      const remaining = item.crateOnly ? undefined : getStockLeft(item);
      return {
        item,
        price: getItemPrice(item, playerId),
        owned: item.powerUp ? effects.has(item.powerUp) : owned.has(item.id),
        charges: charges.get(item.id) ?? 0,
        ...(remaining !== undefined && { remaining }),
        ...(blocked && { blocked }),
      };
    });
  }

  /** The shop's items on sale by category, as `viewer` sees them. */
  function getShopSections(
    viewer: ShopViewer,
    now: number = Date.now(),
  ): ShopSection[] {
    return SHOP_CATEGORIES.map((category) => ({
      category,
      ...CATEGORY_INFO[category],
      listings: toListings(
        coins.items.filter(
          (item) =>
            item.category === category &&
            isListed(item, now) &&
            !isLimited(item),
        ),
        viewer,
        now,
      ),
    })).filter((section) => section.listings.length > 0);
  }

  /** Limited-time stock on sale now, leaving soonest first. */
  function getLimitedListings(
    viewer: ShopViewer,
    now: number = Date.now(),
  ): ShopListing[] {
    const leaves = (item: ShopItem) =>
      new Date(item.availableUntil ?? 0).getTime();
    return toListings(
      coins.items
        .filter((item) => isLimited(item) && isListed(item, now))
        .sort((a, b) => leaves(a) - leaves(b)),
      viewer,
      now,
    );
  }

  const FEED_LABELS: Record<
    ActivePowerUpKind,
    (target: Player | undefined) => string
  > = {
    golden_week: () => "went for a Golden Week",
    double_down: () => "doubled down on their winner call",
    hint: () => "took the Taskmaster's Hint",
    sabotage: (target) => `sabotaged ${target?.name ?? "a rival"}`,
  };

  const SABOTAGE_TWIST: Record<
    "blocked" | "reflected",
    (target: string) => string
  > = {
    blocked: (target) => `, but ${target}'s Shield blocked it`,
    reflected: (target) => `, but it bounced off ${target}'s Mirror`,
  };

  function toFeedEntry(use: PowerUpUse): PowerUpFeedEntry | undefined {
    const player = playerById.get(use.playerId);
    if (!player) return undefined;
    const target = use.targetPlayerId
      ? playerById.get(use.targetPlayerId)
      : undefined;
    // Shields and Mirrors stay secret until the week's results are out.
    const outcome =
      use.effect === "sabotage" && resultsOut(use.taskId)
        ? (sabotages.get(use.id)?.outcome ?? "hit")
        : undefined;
    const twist =
      outcome === "blocked" || outcome === "reflected"
        ? SABOTAGE_TWIST[outcome](target?.name ?? "their target")
        : "";
    return {
      id: use.id,
      taskId: use.taskId,
      effect: use.effect,
      label: `${FEED_LABELS[use.effect](target)}${twist}`,
      player,
      ...(target && { target }),
      ...(outcome && { outcome }),
      at: use.at,
    };
  }

  /** Power-ups used on a week, oldest first. Public as soon as they're used. */
  function getPowerUpFeed(taskId: string): PowerUpFeedEntry[] {
    return coins.uses
      .filter((u) => u.taskId === taskId)
      .flatMap((u) => toFeedEntry(u) ?? []);
  }

  /** Every Sabotage that hit a player, oldest first (for notifications). */
  function getSabotagesOf(playerId: string): PowerUpFeedEntry[] {
    return coins.uses
      .filter((u) => u.effect === "sabotage" && u.targetPlayerId === playerId)
      .flatMap((u) => toFeedEntry(u) ?? []);
  }

  /** Every Sabotage a player used, oldest first (for notifications). */
  function getSabotagesBy(playerId: string): PowerUpFeedEntry[] {
    return coins.uses
      .filter((u) => u.effect === "sabotage" && u.playerId === playerId)
      .flatMap((u) => toFeedEntry(u) ?? []);
  }

  /** The week power-ups can be used on now: the live, unheld week. */
  function getPowerUpWeek(): Task | undefined {
    return seasonClosed
      ? undefined
      : tasks.find((t) => t.status === "live" && !t.resultsHeld);
  }

  /** Players `playerId` may sabotage on `taskId` (squad-mates included). */
  function getSabotageTargets(playerId: string, taskId: string): Player[] {
    const hit = new Set(
      coins.uses
        .filter((u) => u.taskId === taskId && u.effect === "sabotage")
        .map((u) => u.targetPlayerId),
    );
    return players.filter((p) => p.id !== playerId && !hit.has(p.id));
  }

  /** Why `effect` can't be used on `task` now, or `undefined` when it can. */
  function getPowerUpBlock(
    playerId: string,
    task: Task | undefined,
    effect: ActivePowerUpKind,
  ): PowerUpBlock | undefined {
    if (seasonClosed) return "season-closed";
    if (chargesFor(playerId, effect) === 0) return "no-charge";
    const week = getPowerUpWeek();
    if (!task || !week || week.id !== task.id) return "not-live";
    if (
      coins.uses.some((u) => u.taskId === task.id && u.playerId === playerId)
    ) {
      return "already-used";
    }
    if (
      effect === "double_down" &&
      !predictions.some((p) => p.taskId === task.id && p.playerId === playerId)
    ) {
      return "no-prediction";
    }
    if (effect === "hint" && !coins.hints[task.id]) return "no-hint";
    return undefined;
  }

  /** The wallet page's "use a power-up" panel, for the live week. */
  function getPowerUpPanel(playerId: string): PowerUpPanel {
    const task = getPowerUpWeek();
    const usedRow = task
      ? coins.uses.find((u) => u.taskId === task.id && u.playerId === playerId)
      : undefined;
    const used = usedRow ? toFeedEntry(usedRow) : undefined;
    const options: PowerUpOption[] = ACTIVE_POWER_UP_KINDS.flatMap((effect) => {
      const charges = chargesFor(playerId, effect);
      if (charges === 0) return [];
      const blocked = getPowerUpBlock(playerId, task, effect);
      return [
        {
          effect,
          ...POWER_UP_INFO[effect],
          charges,
          ...(blocked && { blocked }),
        },
      ];
    });
    return {
      ...(task && { task }),
      ...(used && { used }),
      options,
      targets: task ? getSabotageTargets(playerId, task.id) : [],
    };
  }

  /** The wallet's One Wish Willow panel: unused charges and past wishes. */
  function getWishPanel(playerId: string): WishPanel {
    const charges = chargesFor(playerId, "wish");
    const blocked: WishPanel["blocked"] = seasonClosed
      ? "season-closed"
      : charges === 0
        ? "no-charge"
        : undefined;
    return {
      charges,
      ...(blocked && { blocked }),
      wishes: coins.wishes.filter((w) => w.playerId === playerId).reverse(),
    };
  }

  /** The most `playerId` can gift in any 7 days (skill trees raise it). */
  function getGiftCap(playerId: string): number {
    return GIFT_WEEKLY_CAP + getSkillPerks(playerId).giftCap;
  }

  /** The wallet's "send coins" form for `playerId`. */
  function getGiftPanel(playerId: string, now: number = Date.now()): GiftPanel {
    const recipients = players.filter((p) => p.id !== playerId);
    const cap = getGiftCap(playerId);
    const allowance = giftAllowance(coins.gifts, playerId, now, cap);
    const balance = getWallet(playerId, now).balance;
    const max = Math.max(0, Math.min(allowance, balance));
    const blocked: GiftPanel["blocked"] = seasonClosed
      ? "season-closed"
      : recipients.length === 0
        ? "no-recipients"
        : allowance === 0
          ? "limit"
          : max === 0
            ? "unaffordable"
            : undefined;
    return {
      recipients,
      cap,
      allowance,
      max,
      ...(blocked && { blocked }),
    };
  }

  /** The week's hint, only for a player who used Hint on it. */
  function getUnlockedHint(
    taskId: string,
    playerId: string | undefined,
  ): string | undefined {
    if (!playerId) return undefined;
    const used = coins.uses.some(
      (u) =>
        u.taskId === taskId && u.playerId === playerId && u.effect === "hint",
    );
    return used ? coins.hints[taskId] : undefined;
  }

  /**
   * Every crate on sale with `viewer`'s personal odds (items they own never
   * drop). Guests see the odds for a player who owns nothing. None while the
   * mystery eggs flag is off, so they can't be opened either.
   */
  function getCrateViews(
    viewer: ShopViewer,
    now: number = Date.now(),
  ): CrateView[] {
    const playerId =
      viewer.playerId && playerById.has(viewer.playerId)
        ? viewer.playerId
        : undefined;
    if (!eggsOn) return [];
    const owned = playerId ? everOwnedItemIds(playerId) : new Set<string>();
    // Power-ups are once a season by effect, bought or hatched.
    const effects = playerId ? boughtEffects(playerId) : new Set<PowerUpKind>();
    const balance = playerId ? getWallet(playerId, now).balance : 0;
    const perks = playerId ? getSkillPerks(playerId) : undefined;
    return cratesOnSale(now).map((base) => {
      // Skill tree egg luck shifts the odds; the crate shown is the lucky one.
      const crate = perks ? luckyCrate(base, perks.eggLuck) : base;
      const price = perks ? eggPrice(crate, perks) : crate.price;
      const tiers = crateOdds(crate, coins.items, owned, now, effects);
      const blocked: CrateView["blocked"] = !playerId
        ? "guest"
        : seasonClosed
          ? "season-closed"
          : tiers.length === 0
            ? "empty"
            : balance < price
              ? "unaffordable"
              : undefined;
      return {
        crate,
        price,
        tiers,
        averageValue: crateAverageValue(tiers),
        ...(blocked && { blocked }),
      };
    });
  }

  function toPull(
    open: (typeof coins.crateOpens)[number],
  ): CratePull | undefined {
    const player = playerById.get(open.playerId);
    const crate = getCrate(open.crateId);
    const item = itemById.get(open.itemId);
    if (!player || !crate || !item) return undefined;
    return {
      id: open.id,
      player,
      crate,
      item,
      rarity: open.rarity,
      at: open.at,
    };
  }

  /** Eggs admins gifted a player, newest first, with what each hatched. */
  function getEggGifts(playerId: string): EggGiftView[] {
    const opens = new Map(coins.crateOpens.map((o) => [o.id, o]));
    return [...coins.eggGifts].reverse().flatMap((gift): EggGiftView[] => {
      const crate = getCrate(gift.crateId);
      if (gift.playerId !== playerId || !crate) return [];
      const open =
        gift.crateOpenId !== undefined
          ? opens.get(gift.crateOpenId)
          : undefined;
      const hatched = open && itemById.get(open.itemId);
      return [{ gift, crate, ...(hatched && { hatched }) }];
    });
  }

  /**
   * A player's gifted eggs still waiting to be cracked, oldest first, with
   * their personal odds (like `getCrateViews`, but free and whether or not
   * the egg is on sale). None while the mystery eggs flag is off.
   */
  function getUnopenedEggs(
    playerId: string,
    now: number = Date.now(),
  ): UnopenedEgg[] {
    if (!eggsOn || !playerById.has(playerId)) return [];
    const waiting = coins.eggGifts.filter(
      (g) => g.playerId === playerId && g.crateOpenId === undefined,
    );
    if (waiting.length === 0) return [];
    const owned = everOwnedItemIds(playerId);
    const effects = boughtEffects(playerId);
    const perks = getSkillPerks(playerId);
    return waiting.flatMap((gift): UnopenedEgg[] => {
      const base = getCrate(gift.crateId);
      if (!base) return [];
      const crate = luckyCrate(base, perks.eggLuck);
      const tiers = crateOdds(crate, coins.items, owned, now, effects);
      return [
        { gift, crate, tiers, ...(tiers.length === 0 && { blocked: "empty" }) },
      ];
    });
  }

  /** The season's newest crate openings, newest first (public). */
  function getRecentPulls(limit = 10): CratePull[] {
    if (!eggsOn) return [];
    return [...coins.crateOpens]
      .reverse()
      .slice(0, limit)
      .flatMap((open) => toPull(open) ?? []);
  }

  /** One crate opening, if it was `playerId`'s (for their reveal). */
  function getCratePull(id: number, playerId: string): CratePull | undefined {
    if (!eggsOn) return undefined;
    const open = coins.crateOpens.find(
      (o) => o.id === id && o.playerId === playerId,
    );
    return open && toPull(open);
  }

  return {
    shopItems: coins.items,
    getCrateViews,
    getRecentPulls,
    getCratePull,
    getEggGifts,
    getUnopenedEggs,
    getShopItemById,
    getWallet,
    getSkillPerks,
    getItemPrice,
    getGiftCap,
    getInventory,
    getGiftableItems,
    getItemGifts,
    getLoadout,
    getPlayerFlair,
    getPlayerFlairs,
    getEquippedAvatarUrl,
    getPurchaseBlock,
    getStockLeft,
    getShopSections,
    getLimitedListings,
    getPowerUpFeed,
    getSabotagesOf,
    getSabotagesBy,
    getGiftPanel,
    getWishPanel,
    getPowerUpWeek,
    getSabotageTargets,
    getPowerUpBlock,
    getPowerUpPanel,
    getUnlockedHint,
  };
}
