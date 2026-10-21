import type {
  CompetitionData,
  CratePull,
  CrateView,
  InventoryItem,
  Player,
  PlayerFlair,
  PlayerLoadout,
  PowerUpBlock,
  PowerUpFeedEntry,
  PowerUpKind,
  PowerUpOption,
  PowerUpPanel,
  PowerUpUse,
  PurchaseBlock,
  ShopItem,
  ShopSection,
  Task,
  Wallet,
} from "../types";
import {
  CATEGORY_INFO,
  NAME_COLOURS,
  POWER_UP_INFO,
  POWER_UP_KINDS,
  PROFILE_THEMES,
  SHOP_CATEGORIES,
  crateAverageValue,
  crateOdds,
  deriveWallet,
  slotOf,
} from "./coins";
import { CRATES, getCrate } from "./coin-rules";

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
  const { players, tasks, coins, predictions, season } = data;
  const itemById = new Map(coins.items.map((i) => [i.id, i]));
  const playerById = new Map(players.map((p) => [p.id, p]));
  const seasonClosed = season.status === "closed";
  const usedPurchaseIds = new Set(coins.uses.map((u) => u.purchaseId));

  function getShopItemById(id: string): ShopItem | undefined {
    return itemById.get(id);
  }

  function getWallet(playerId: string, now: number = Date.now()): Wallet {
    return deriveWallet(data, playerId, now);
  }

  /** Ids of the pets, avatars and cosmetics a player owns. */
  function ownedItemIds(playerId: string): Set<string> {
    return new Set(
      coins.purchases
        .filter((p) => p.playerId === playerId)
        .map((p) => p.itemId)
        .filter((id) => itemById.get(id)?.category !== "power_up"),
    );
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
    const charges = new Map<string, number>();
    for (const p of coins.purchases) {
      if (p.playerId !== playerId || usedPurchaseIds.has(p.id)) continue;
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
    return {
      ...(pet?.imageUrl && {
        pet: { name: pet.name, imageUrl: pet.imageUrl },
      }),
      ...(title && { title }),
      ...(nameColour && { nameColour }),
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
      return [
        {
          item,
          ...(slot && { slot }),
          equipped: slot !== undefined && worn.get(slot)?.id === item.id,
          charges: 0,
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
    if (ownedItemIds(viewer.playerId).has(item.id)) return "owned";
    if (!item.available) return "unavailable";
    if (item.crateOnly) return "crate-only";
    if (getWallet(viewer.playerId, now).balance < item.price) {
      return "unaffordable";
    }
    return undefined;
  }

  /** The shop's available items by category, as `viewer` sees them. */
  function getShopSections(
    viewer: ShopViewer,
    now: number = Date.now(),
  ): ShopSection[] {
    const playerId =
      viewer.playerId && playerById.has(viewer.playerId)
        ? viewer.playerId
        : undefined;
    const owned = playerId ? ownedItemIds(playerId) : new Set<string>();
    const effects = playerId ? boughtEffects(playerId) : new Set();
    const charges = playerId ? chargesByItem(playerId) : new Map();
    return SHOP_CATEGORIES.map((category) => ({
      category,
      ...CATEGORY_INFO[category],
      listings: coins.items
        .filter((item) => item.category === category && item.available)
        .map((item) => {
          const blocked = getPurchaseBlock(item, { playerId }, now);
          return {
            item,
            owned: item.powerUp
              ? effects.has(item.powerUp)
              : owned.has(item.id),
            charges: charges.get(item.id) ?? 0,
            ...(blocked && { blocked }),
          };
        }),
    })).filter((section) => section.listings.length > 0);
  }

  const FEED_LABELS: Record<
    PowerUpKind,
    (target: Player | undefined) => string
  > = {
    golden_week: () => "went for a Golden Week",
    double_down: () => "doubled down on their winner call",
    hint: () => "took the Taskmaster's Hint",
    sabotage: (target) => `sabotaged ${target?.name ?? "a rival"}`,
  };

  function toFeedEntry(use: PowerUpUse): PowerUpFeedEntry | undefined {
    const player = playerById.get(use.playerId);
    if (!player) return undefined;
    const target = use.targetPlayerId
      ? playerById.get(use.targetPlayerId)
      : undefined;
    return {
      id: use.id,
      taskId: use.taskId,
      effect: use.effect,
      label: FEED_LABELS[use.effect](target),
      player,
      ...(target && { target }),
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
    effect: PowerUpKind,
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
    const options: PowerUpOption[] = POWER_UP_KINDS.flatMap((effect) => {
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
   * Every crate with `viewer`'s personal odds (items they own never drop).
   * Guests see the odds for a player who owns nothing.
   */
  function getCrateViews(
    viewer: ShopViewer,
    now: number = Date.now(),
  ): CrateView[] {
    const playerId =
      viewer.playerId && playerById.has(viewer.playerId)
        ? viewer.playerId
        : undefined;
    const owned = playerId ? ownedItemIds(playerId) : new Set<string>();
    const balance = playerId ? getWallet(playerId, now).balance : 0;
    return CRATES.map((crate) => {
      const tiers = crateOdds(crate, coins.items, owned);
      const blocked: CrateView["blocked"] = !playerId
        ? "guest"
        : seasonClosed
          ? "season-closed"
          : tiers.length === 0
            ? "empty"
            : balance < crate.price
              ? "unaffordable"
              : undefined;
      return {
        crate,
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

  /** The season's newest crate openings, newest first (public). */
  function getRecentPulls(limit = 10): CratePull[] {
    return [...coins.crateOpens]
      .reverse()
      .slice(0, limit)
      .flatMap((open) => toPull(open) ?? []);
  }

  /** One crate opening, if it was `playerId`'s (for their reveal). */
  function getCratePull(id: number, playerId: string): CratePull | undefined {
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
    getShopItemById,
    getWallet,
    getInventory,
    getLoadout,
    getPlayerFlair,
    getPlayerFlairs,
    getEquippedAvatarUrl,
    getPurchaseBlock,
    getShopSections,
    getPowerUpFeed,
    getSabotagesOf,
    getPowerUpWeek,
    getSabotageTargets,
    getPowerUpBlock,
    getPowerUpPanel,
    getUnlockedHint,
  };
}
