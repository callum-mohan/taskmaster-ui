import type {
  CoinAdjustment,
  CoinLedgerEntry,
  CoinPurchase,
  CompetitionData,
  Crate,
  CrateOpen,
  CrateTier,
  CosmeticKind,
  EntryActivity,
  EquippedItem,
  LoadoutSlot,
  Player,
  PowerUpKind,
  PowerUpUse,
  Rarity,
  ShopCategory,
  ShopItem,
  Wallet,
} from "../types";
import type {
  coinAdjustments as coinAdjustmentsTable,
  coinPurchases as coinPurchasesTable,
  crateOpens as crateOpensTable,
  equippedItems as equippedItemsTable,
  powerUpUses as powerUpUsesTable,
  shopItems as shopItemsTable,
  tasks as tasksTable,
} from "../db/schema";
import { timestamptzToIso } from "../lib/time";
import { peoplesChoiceClosesAt } from "./peoples-choice";
import type { DerivedBonusRow } from "./polls";
import {
  DOUBLE_DOWN_POINTS,
  ENTRY_COINS,
  GOLDEN_WEEK_MULTIPLIER,
  PEOPLES_CHOICE_VOTE_COINS,
  PLACEMENT_COINS,
  POLL_VOTE_COINS,
  PREDICTION_COINS,
  SABOTAGE_POINTS,
  CRATE_CATEGORIES,
  RARITIES,
  getCrate,
  rarityOf,
} from "./coin-rules";

export {
  COSMETIC_KINDS,
  LOADOUT_SLOTS,
  NAME_COLOURS,
  POWER_UP_KINDS,
  PROFILE_THEMES,
  SHOP_CATEGORIES,
} from "./coin-rules";

// Clim Coin: a per-season wallet. Earnings are derived from the competition
// records (like the poll and prediction bonuses), so a corrected score or a
// withdrawn vote can never leave stale coins behind. Only purchases, power-up
// uses, equipped items and admin adjustments are stored. The payout and
// power-up numbers live in `coin-rules.ts`.

export const CATEGORY_INFO: Record<
  ShopCategory,
  { label: string; command: string }
> = {
  pet: { label: "Pets", command: "ls ./pets" },
  avatar: { label: "Avatars", command: "ls ./avatars" },
  cosmetic: { label: "Cosmetics", command: "ls ./flair" },
  power_up: { label: "Power-ups", command: "ls ./power-ups" },
};

export const COSMETIC_KIND_LABELS: Record<CosmeticKind, string> = {
  title: "Title",
  name_colour: "Name colour",
  theme: "Profile theme",
};

export const POWER_UP_INFO: Record<
  PowerUpKind,
  { label: string; description: string }
> = {
  double_down: {
    label: "Double Down",
    description: `A correct winner call this week pays +${DOUBLE_DOWN_POINTS} instead of +1. Call the winner first.`,
  },
  hint: {
    label: "Taskmaster's Hint",
    description:
      "Reveals the Taskmaster's private hint for this week's task, for your eyes only.",
  },
  golden_week: {
    label: "Golden Week",
    description: `Your task score this week is multiplied by ${GOLDEN_WEEK_MULTIPLIER} (rounded up) before positions are decided. On team tasks it boosts only your own points.`,
  },
  sabotage: {
    label: "Sabotage",
    description: `Takes ${-SABOTAGE_POINTS} points from a rival this week. Everyone sees who did it, and each player can only be sabotaged once a week.`,
  },
};

/** The slot an item is worn in; power-ups aren't worn. */
export function slotOf(item: ShopItem): LoadoutSlot | undefined {
  if (item.category === "pet" || item.category === "avatar") {
    return item.category;
  }
  return item.cosmetic?.kind;
}

/** `${taskId}:${playerId}` keys of uses with `effect`. */
export function powerUpKeys(
  uses: readonly Pick<PowerUpUse, "taskId" | "playerId" | "effect">[],
  effect: PowerUpKind,
): Set<string> {
  return new Set(
    uses
      .filter((u) => u.effect === effect)
      .map((u) => `${u.taskId}:${u.playerId}`),
  );
}

/** Every Sabotage as a deduction on its target, in the order they were used. */
export function deriveSabotageBonusRows(
  uses: readonly PowerUpUse[],
  players: readonly Player[],
): DerivedBonusRow[] {
  const names = new Map(players.map((p) => [p.id, p.name]));
  return uses.flatMap((use) =>
    use.effect === "sabotage" && use.targetPlayerId
      ? [
          {
            taskId: use.taskId,
            playerId: use.targetPlayerId,
            points: SABOTAGE_POINTS,
            reason: `Sabotaged by ${names.get(use.playerId) ?? "a rival"}`,
          },
        ]
      : [],
  );
}

// ── Mappers ───────────────────────────────────────────────────────────

type ShopItemRow = typeof shopItemsTable.$inferSelect;
type PurchaseRow = typeof coinPurchasesTable.$inferSelect;
type UseRow = typeof powerUpUsesTable.$inferSelect;
type EquippedRow = typeof equippedItemsTable.$inferSelect;
type AdjustmentRow = typeof coinAdjustmentsTable.$inferSelect;
type CrateOpenRow = typeof crateOpensTable.$inferSelect;
type TaskRow = typeof tasksTable.$inferSelect;

export function mapShopItems(rows: ShopItemRow[]): ShopItem[] {
  return [...rows]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      price: row.price,
      ...(row.imageUrl !== null && { imageUrl: row.imageUrl }),
      ...(row.cosmeticKind !== null &&
        row.cosmeticValue !== null && {
          cosmetic: { kind: row.cosmeticKind, value: row.cosmeticValue },
        }),
      ...(row.powerUp !== null && { powerUp: row.powerUp }),
      available: row.available,
      crateOnly: row.crateOnly,
      sortOrder: row.sortOrder,
    }));
}

export function mapPurchases(rows: PurchaseRow[]): CoinPurchase[] {
  return rows.map((row) => ({
    id: row.id,
    playerId: row.playerId,
    itemId: row.itemId,
    price: row.price,
    at: timestamptzToIso(row.createdAt),
  }));
}

export function mapPowerUpUses(rows: UseRow[]): PowerUpUse[] {
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      purchaseId: row.purchaseId,
      playerId: row.playerId,
      taskId: row.taskId,
      effect: row.effect,
      ...(row.targetPlayerId !== null && {
        targetPlayerId: row.targetPlayerId,
      }),
      at: timestamptzToIso(row.createdAt),
    }));
}

export function mapEquipped(rows: EquippedRow[]): EquippedItem[] {
  return rows.map(({ playerId, slot, itemId }) => ({ playerId, slot, itemId }));
}

export function mapAdjustments(rows: AdjustmentRow[]): CoinAdjustment[] {
  return rows.map((row) => ({
    id: row.id,
    playerId: row.playerId,
    amount: row.amount,
    reason: row.reason,
    actorName: row.actorName,
    at: timestamptzToIso(row.createdAt),
  }));
}

export function mapCrateOpens(rows: CrateOpenRow[]): CrateOpen[] {
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      purchaseId: row.purchaseId,
      playerId: row.playerId,
      crateId: row.crateId,
      price: row.price,
      itemId: row.itemId,
      rarity: RARITIES.find((r) => r === row.rarity) ?? rarityOf(row.price),
      at: timestamptzToIso(row.createdAt),
    }));
}

/** Each week's Taskmaster's Hint, by task id (weeks without one omitted). */
export function mapHints(rows: Pick<TaskRow, "id" | "hint">[]) {
  return Object.fromEntries(
    rows.flatMap((row) => (row.hint ? [[row.id, row.hint] as const] : [])),
  );
}

export function mapEntries(rows: EntryActivity[]): EntryActivity[] {
  return rows.map(({ taskId, playerId }) => ({ taskId, playerId }));
}

// ── Wallet ────────────────────────────────────────────────────────────

const weekLabel = (weekNumber: number) =>
  `Week ${String(weekNumber).padStart(2, "0")}`;

const PLACE_LABELS = ["1st", "2nd", "3rd"];

/** Coins a finishing position pays. */
export function placementCoins(position: number): number {
  return (
    [PLACEMENT_COINS.first, PLACEMENT_COINS.second, PLACEMENT_COINS.third][
      position - 1
    ] ?? PLACEMENT_COINS.scored
  );
}

type WalletData = Pick<
  CompetitionData,
  | "tasks"
  | "scores"
  | "polls"
  | "peoplesChoiceVotes"
  | "predictions"
  | "resultsPostedAt"
  | "coins"
>;

/**
 * The coins a player has earned, newest first. Results pay once they're
 * published; activity pays once it locks in (entries and calls at the
 * deadline, votes when voting closes), so withdrawing can't be farmed.
 */
export function deriveEarnings(
  data: WalletData,
  playerId: string,
  now: number = Date.now(),
): CoinLedgerEntry[] {
  const taskById = new Map(data.tasks.map((t) => [t.id, t]));
  const entries: CoinLedgerEntry[] = [];

  for (const score of data.scores) {
    if (score.playerId !== playerId) continue;
    const task = taskById.get(score.taskId);
    if (!task) continue;
    const place = PLACE_LABELS[score.position - 1];
    entries.push({
      kind: "placement",
      amount: placementCoins(score.position),
      label: `${weekLabel(task.weekNumber)}: ${place ? `${place} place` : "scored"}`,
      at: data.resultsPostedAt[task.id] ?? task.deadline,
      taskId: task.id,
    });
  }

  const enteredTaskIds = new Set(
    data.coins.entries
      .filter((e) => e.playerId === playerId)
      .map((e) => e.taskId),
  );
  for (const taskId of enteredTaskIds) {
    const task = taskById.get(taskId);
    if (!task || task.status !== "completed") continue;
    entries.push({
      kind: "entry",
      amount: ENTRY_COINS,
      label: `${weekLabel(task.weekNumber)}: entry submitted`,
      at: task.deadline,
      taskId,
    });
  }

  for (const poll of data.polls) {
    if (!poll.published || poll.status !== "closed") continue;
    if (!poll.votes.some((v) => v.playerId === playerId)) continue;
    entries.push({
      kind: "poll-vote",
      amount: POLL_VOTE_COINS,
      label: `Voted: "${poll.question}"`,
      at: poll.closesAt,
    });
  }

  for (const vote of data.peoplesChoiceVotes) {
    // A vote for an entry an admin hid doesn't count, so it doesn't pay.
    if (vote.playerId !== playerId || vote.entryHidden) continue;
    const task = taskById.get(vote.taskId);
    if (!task) continue;
    const closesAt = peoplesChoiceClosesAt(task);
    if (new Date(closesAt).getTime() > now) continue;
    entries.push({
      kind: "peoples-choice-vote",
      amount: PEOPLES_CHOICE_VOTE_COINS,
      label: `${weekLabel(task.weekNumber)}: People's Choice vote`,
      at: closesAt,
      taskId: task.id,
    });
  }

  for (const call of data.predictions) {
    if (call.playerId !== playerId) continue;
    const task = taskById.get(call.taskId);
    if (!task || task.status !== "completed") continue;
    entries.push({
      kind: "prediction",
      amount: PREDICTION_COINS,
      label: `${weekLabel(task.weekNumber)}: called a winner`,
      at: task.deadline,
      taskId: task.id,
    });
  }

  return entries;
}

/** A player's balance and full history (earnings, grants and spending). */
export function deriveWallet(
  data: WalletData,
  playerId: string,
  now: number = Date.now(),
): Wallet {
  const itemNames = new Map(data.coins.items.map((i) => [i.id, i.name]));
  const earnings = deriveEarnings(data, playerId, now);
  const adjustments: CoinLedgerEntry[] = data.coins.adjustments
    .filter((a) => a.playerId === playerId)
    .map((a) => ({
      kind: "adjustment",
      amount: a.amount,
      label: a.reason,
      at: a.at,
    }));
  // Crate wins are owned through a zero-price purchase; the crate's own
  // line shows the cost and what it gave.
  const crateWins = new Set(data.coins.crateOpens.map((o) => o.purchaseId));
  const purchases: CoinLedgerEntry[] = [
    ...data.coins.purchases
      .filter((p) => p.playerId === playerId && !crateWins.has(p.id))
      .map((p): CoinLedgerEntry => ({
        kind: "purchase",
        amount: -p.price,
        label: `Bought ${itemNames.get(p.itemId) ?? p.itemId}`,
        at: p.at,
      })),
    ...data.coins.crateOpens
      .filter((o) => o.playerId === playerId)
      .map((o): CoinLedgerEntry => ({
        kind: "crate",
        amount: -o.price,
        label: `${getCrate(o.crateId)?.name ?? "Crate"} → ${
          itemNames.get(o.itemId) ?? o.itemId
        } (${o.rarity})`,
        at: o.at,
      })),
  ];
  const sum = (list: CoinLedgerEntry[]) =>
    list.reduce((total, e) => total + e.amount, 0);
  const earned = sum(earnings);
  const adjusted = sum(adjustments);
  const spent = -sum(purchases);
  return {
    playerId,
    balance: earned + adjusted - spent,
    earned,
    adjusted,
    spent,
    ledger: [...earnings, ...adjustments, ...purchases].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    ),
  };
}

// ── Crates ────────────────────────────────────────────────────────────

/**
 * A crate's odds for one player: every available pet, avatar and cosmetic
 * they don't own yet, grouped by rarity. A tier with nothing left in it has
 * its chance shared out among the others in proportion, and items in a tier
 * are equally likely. Returns no tiers when there's nothing left to win.
 */
export function crateOdds(
  crate: Crate,
  items: readonly ShopItem[],
  ownedItemIds: ReadonlySet<string>,
): CrateTier[] {
  const pool = items.filter(
    (item) =>
      item.available &&
      CRATE_CATEGORIES.some((c) => c === item.category) &&
      !ownedItemIds.has(item.id),
  );
  const byTier = RARITIES.map((rarity) => ({
    rarity,
    weight: crate.odds[rarity] ?? 0,
    items: pool.filter((item) => rarityOf(item.price) === rarity),
  })).filter((tier) => tier.weight > 0 && tier.items.length > 0);
  const total = byTier.reduce((sum, tier) => sum + tier.weight, 0);
  return byTier.map(({ rarity, weight, items: drops }) => {
    const chance = weight / total;
    return {
      rarity,
      chance,
      drops: drops.map((item) => ({ item, chance: chance / drops.length })),
    };
  });
}

/** The average shop value of one roll, in coins. */
export function crateAverageValue(tiers: readonly CrateTier[]): number {
  return tiers.reduce(
    (sum, tier) =>
      sum + tier.drops.reduce((s, d) => s + d.chance * d.item.price, 0),
    0,
  );
}

/**
 * Picks an item with the odds in `tiers`. `random` is a number in [0, 1);
 * the server passes a cryptographically random one.
 */
export function rollCrate(
  tiers: readonly CrateTier[],
  random: number,
): { item: ShopItem; rarity: Rarity } | undefined {
  let remaining = random;
  let last: { item: ShopItem; rarity: Rarity } | undefined;
  for (const tier of tiers) {
    for (const drop of tier.drops) {
      last = { item: drop.item, rarity: tier.rarity };
      if (remaining < drop.chance) return last;
      remaining -= drop.chance;
    }
  }
  // Floating-point slack at the very top of the range lands on the last item.
  return last;
}
