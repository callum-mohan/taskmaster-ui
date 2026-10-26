import type {
  ActivePowerUpKind,
  CoinAdjustment,
  CoinGift,
  CoinLedgerEntry,
  CoinLedgerKind,
  CoinPurchase,
  CompetitionData,
  Crate,
  CrateOpen,
  CrateTier,
  CrateTierKind,
  CosmeticKind,
  EggGift,
  EntryActivity,
  EquippedItem,
  ItemGift,
  LoadoutSlot,
  Player,
  PowerUpKind,
  PowerUpUse,
  SabotageResolution,
  ShopCategory,
  ShopItem,
  SkillEarnSource,
  SkillPathPick,
  SkillUnlock,
  Wallet,
  Wish,
} from "../types";
import type {
  coinAdjustments as coinAdjustmentsTable,
  coinGifts as coinGiftsTable,
  coinPurchases as coinPurchasesTable,
  crateOpens as crateOpensTable,
  eggGifts as eggGiftsTable,
  equippedItems as equippedItemsTable,
  itemGifts as itemGiftsTable,
  powerUpUses as powerUpUsesTable,
  shopItems as shopItemsTable,
  skillPaths as skillPathsTable,
  skillUnlocks as skillUnlocksTable,
  tasks as tasksTable,
  wishes as wishesTable,
} from "../db/schema";
import { timestamptzToIso, wallClockToIso } from "../lib/time";
import { peoplesChoiceClosesAt } from "./peoples-choice";
import { heldCoins } from "./market-mappers";
import type { DerivedBonusRow } from "./polls";
import {
  DOUBLE_DOWN_POINTS,
  ENTRY_COINS,
  GIFT_WEEKLY_CAP,
  GIFT_WINDOW_MS,
  GOLDEN_WEEK_MULTIPLIER,
  PEOPLES_CHOICE_VOTE_COINS,
  PLACEMENT_COINS,
  POLL_VOTE_COINS,
  PREDICTION_COINS,
  SABOTAGE_POINTS,
  WISH_MAX,
  CRATE_CATEGORIES,
  CRATE_TIER_KINDS,
  RARITIES,
  getCrate,
  inSaleWindow,
  isActivePowerUp,
  rarityOf,
} from "./coin-rules";
import {
  getSkillNode,
  getSkillPath,
  isSkillPathId,
  unlockedNodes,
} from "./skill-trees";

export {
  ACTIVE_POWER_UP_KINDS,
  COSMETIC_KINDS,
  LOADOUT_SLOTS,
  NAME_COLOURS,
  PASSIVE_POWER_UP_KINDS,
  POWER_UP_KINDS,
  PROFILE_THEMES,
  SHOP_CATEGORIES,
  WISH_MAX,
  WISH_POWER_UP,
} from "./coin-rules";

// Clim Coin: a per-season wallet. Earnings are derived from the competition
// records (like the poll and prediction bonuses), so a corrected score or a
// withdrawn vote can never leave stale coins behind. Only purchases, power-up
// uses, equipped items, gifts, admin adjustments and admin item gifts are
// stored; the passive power-ups (Shield, Mirror, Insurance) are worked out
// from them here. The payout and power-up numbers live in `coin-rules.ts`.

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
  { label: string; description: string; passive: boolean }
> = {
  double_down: {
    label: "Double Down",
    description: `A correct winner call this week pays +${DOUBLE_DOWN_POINTS} instead of +1. Call the winner first.`,
    passive: false,
  },
  hint: {
    label: "Taskmaster's Hint",
    description:
      "Reveals the Taskmaster's private hint for this week's task, for your eyes only.",
    passive: false,
  },
  golden_week: {
    label: "Golden Week",
    description: `Your task score this week is multiplied by ${GOLDEN_WEEK_MULTIPLIER} (rounded up) before positions are decided. On team tasks it boosts only your own points.`,
    passive: false,
  },
  sabotage: {
    label: "Sabotage",
    description: `Takes ${-SABOTAGE_POINTS} points from a rival this week. Everyone sees who did it, and each player can only be sabotaged once a week.`,
    passive: false,
  },
  shield: {
    label: "Shield",
    description:
      "Passive: blocks the next Sabotage against you. Nobody knows you have it until that week's results are out.",
    passive: true,
  },
  mirror: {
    label: "Mirror",
    description: `Passive: bounces the next Sabotage against you back onto the saboteur (they lose the ${-SABOTAGE_POINTS} points). Secret until that week's results are out.`,
    passive: true,
  },
  insurance: {
    label: "Insurance",
    description: `Passive: the first week you finish last after buying it, you're paid 3rd-place coins (${PLACEMENT_COINS.third}) instead of ${PLACEMENT_COINS.scored}.`,
    passive: true,
  },
  wish: {
    label: "One Wish Willow",
    description: `Make one wish to the Taskmaster (up to ${WISH_MAX} characters, within reason) from your wallet, any time. They'll grant it or not, entirely at their discretion; either way it's spent.`,
    passive: false,
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
  effect: ActivePowerUpKind,
): Set<string> {
  return new Set(
    uses
      .filter((u) => u.effect === effect)
      .map((u) => `${u.taskId}:${u.playerId}`),
  );
}

const instant = (iso: string) => new Date(iso).getTime();

/**
 * How every Sabotage resolved, by use id. Each Shield or Mirror a target
 * bought is spent on the first Sabotage against them used after they bought
 * it; a Mirror is spent before a Shield. A bounced Sabotage can't itself be
 * blocked or bounced. Resolution never depends on results being out (only
 * whether it's shown does), so it can't change once decided.
 */
export function resolveSabotages(
  uses: readonly PowerUpUse[],
  purchases: readonly CoinPurchase[],
  items: readonly ShopItem[],
): Map<number, SabotageResolution> {
  const effectOf = new Map(items.map((i) => [i.id, i.powerUp]));
  const defences = [...purchases]
    .filter((p) => {
      const effect = effectOf.get(p.itemId);
      return effect === "shield" || effect === "mirror";
    })
    .sort((a, b) => a.id - b.id);
  const spent = new Set<number>();
  const result = new Map<number, SabotageResolution>();
  for (const use of [...uses].sort((a, b) => a.id - b.id)) {
    if (use.effect !== "sabotage" || !use.targetPlayerId) continue;
    const armed = (effect: PowerUpKind) =>
      defences.find(
        (p) =>
          p.playerId === use.targetPlayerId &&
          effectOf.get(p.itemId) === effect &&
          !spent.has(p.id) &&
          instant(p.at) < instant(use.at),
      );
    const mirror = armed("mirror");
    const shield = mirror ? undefined : armed("shield");
    const defence = mirror ?? shield;
    if (defence) spent.add(defence.id);
    result.set(use.id, {
      outcome: mirror ? "reflected" : shield ? "blocked" : "hit",
      ...(defence && { defencePurchaseId: defence.id }),
    });
  }
  return result;
}

/**
 * Every Sabotage as a deduction, in the order they were used. Until a week's
 * results are out (`revealedTaskIds`) it lands on the target as usual, so
 * Shields and Mirrors stay secret; after, a blocked one is dropped and a
 * bounced one lands on the saboteur instead.
 */
export function deriveSabotageBonusRows(
  uses: readonly PowerUpUse[],
  players: readonly Player[],
  resolutions: ReadonlyMap<number, SabotageResolution> = new Map(),
  revealedTaskIds: ReadonlySet<string> = new Set(),
): DerivedBonusRow[] {
  const names = new Map(players.map((p) => [p.id, p.name]));
  return uses.flatMap((use): DerivedBonusRow[] => {
    if (use.effect !== "sabotage" || !use.targetPlayerId) return [];
    const outcome = revealedTaskIds.has(use.taskId)
      ? (resolutions.get(use.id)?.outcome ?? "hit")
      : "hit";
    if (outcome === "blocked") return [];
    if (outcome === "reflected") {
      return [
        {
          taskId: use.taskId,
          playerId: use.playerId,
          points: SABOTAGE_POINTS,
          reason: `Sabotage bounced off ${names.get(use.targetPlayerId) ?? "a rival"}'s Mirror`,
        },
      ];
    }
    return [
      {
        taskId: use.taskId,
        playerId: use.targetPlayerId,
        points: SABOTAGE_POINTS,
        reason: `Sabotaged by ${names.get(use.playerId) ?? "a rival"}`,
      },
    ];
  });
}

// ── Mappers ───────────────────────────────────────────────────────────

type ShopItemRow = typeof shopItemsTable.$inferSelect;
type PurchaseRow = typeof coinPurchasesTable.$inferSelect;
type UseRow = typeof powerUpUsesTable.$inferSelect;
type EquippedRow = typeof equippedItemsTable.$inferSelect;
type AdjustmentRow = typeof coinAdjustmentsTable.$inferSelect;
type CrateOpenRow = typeof crateOpensTable.$inferSelect;
type GiftRow = typeof coinGiftsTable.$inferSelect;
type ItemGiftRow = typeof itemGiftsTable.$inferSelect;
type EggGiftRow = typeof eggGiftsTable.$inferSelect;
type WishRow = typeof wishesTable.$inferSelect;
type TaskRow = typeof tasksTable.$inferSelect;
type SkillPathRow = typeof skillPathsTable.$inferSelect;
type SkillUnlockRow = typeof skillUnlocksTable.$inferSelect;

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
      ...(row.crateId !== null && { crateId: row.crateId }),
      skillOnly: row.skillOnly,
      ...(row.availableFrom !== null && {
        availableFrom: wallClockToIso(row.availableFrom),
      }),
      ...(row.availableUntil !== null && {
        availableUntil: wallClockToIso(row.availableUntil),
      }),
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
    .flatMap((row): PowerUpUse[] => {
      // Passive power-ups are never used (the database refuses them too).
      const effect = row.effect;
      if (!isActivePowerUp(effect)) return [];
      return [
        {
          id: row.id,
          purchaseId: row.purchaseId,
          playerId: row.playerId,
          taskId: row.taskId,
          effect,
          ...(row.targetPlayerId !== null && {
            targetPlayerId: row.targetPlayerId,
          }),
          at: timestamptzToIso(row.createdAt),
        },
      ];
    });
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
      rarity:
        CRATE_TIER_KINDS.find((r) => r === row.rarity) ?? rarityOf(row.price),
      at: timestamptzToIso(row.createdAt),
    }));
}

/** Each week's Taskmaster's Hint, by task id (weeks without one omitted). */
export function mapHints(rows: Pick<TaskRow, "id" | "hint">[]) {
  return Object.fromEntries(
    rows.flatMap((row) => (row.hint ? [[row.id, row.hint] as const] : [])),
  );
}

export function mapGifts(rows: GiftRow[]): CoinGift[] {
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      fromPlayerId: row.fromPlayerId,
      toPlayerId: row.toPlayerId,
      amount: row.amount,
      ...(row.message !== null && { message: row.message }),
      at: timestamptzToIso(row.createdAt),
    }));
}

export function mapItemGifts(rows: ItemGiftRow[]): ItemGift[] {
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      purchaseId: row.purchaseId,
      playerId: row.playerId,
      itemId: row.itemId,
      reason: row.reason,
      actorName: row.actorName,
      at: timestamptzToIso(row.createdAt),
    }));
}

export function mapEggGifts(rows: EggGiftRow[]): EggGift[] {
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      playerId: row.playerId,
      crateId: row.crateId,
      reason: row.reason,
      actorName: row.actorName,
      ...(row.crateOpenId !== null && { crateOpenId: row.crateOpenId }),
      at: timestamptzToIso(row.createdAt),
    }));
}

export function mapWishes(rows: WishRow[]): Wish[] {
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      purchaseId: row.purchaseId,
      playerId: row.playerId,
      wish: row.wish,
      status: row.status,
      ...(row.response !== null && { response: row.response }),
      ...(row.decidedAt !== null && {
        decidedAt: timestamptzToIso(row.decidedAt),
      }),
      ...(row.deciderName !== null && { deciderName: row.deciderName }),
      at: timestamptzToIso(row.createdAt),
    }));
}

/** Pathway picks for pathways that still exist in the catalogue. */
export function mapSkillPaths(rows: SkillPathRow[]): SkillPathPick[] {
  return rows.flatMap((row): SkillPathPick[] =>
    isSkillPathId(row.pathId)
      ? [
          {
            playerId: row.playerId,
            pathId: row.pathId,
            at: timestamptzToIso(row.createdAt),
          },
        ]
      : [],
  );
}

/** Unlocks of nodes that still exist in the catalogue, oldest first. */
export function mapSkillUnlocks(rows: SkillUnlockRow[]): SkillUnlock[] {
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .flatMap((row): SkillUnlock[] =>
      isSkillPathId(row.pathId) && getSkillNode(row.nodeId)
        ? [
            {
              id: row.id,
              playerId: row.playerId,
              pathId: row.pathId,
              nodeId: row.nodeId,
              price: row.price,
              ...(row.purchaseId !== null && { purchaseId: row.purchaseId }),
              at: timestamptzToIso(row.createdAt),
            },
          ]
        : [],
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
  | "players"
>;

/**
 * The week each of a player's Insurance charges paid out on, as task id →
 * purchase id. A charge covers the first week (in week order) whose deadline
 * was after it was bought where the player finished last and their place
 * paid less than 3rd. Results only count once they're out.
 */
export function insuranceClaims(
  data: Pick<WalletData, "tasks" | "scores" | "coins">,
  playerId: string,
): Map<string, number> {
  const effectOf = new Map(data.coins.items.map((i) => [i.id, i.powerUp]));
  const charges = data.coins.purchases
    .filter(
      (p) => p.playerId === playerId && effectOf.get(p.itemId) === "insurance",
    )
    .sort((a, b) => a.id - b.id);
  const claims = new Map<string, number>();
  if (charges.length === 0) return claims;

  const lastPlace = new Map<string, number>();
  for (const s of data.scores) {
    lastPlace.set(s.taskId, Math.max(lastPlace.get(s.taskId) ?? 0, s.position));
  }
  const weeks = [...data.tasks].sort((a, b) => a.weekNumber - b.weekNumber);
  for (const charge of charges) {
    const week = weeks.find((task) => {
      if (claims.has(task.id)) return false;
      if (instant(task.deadline) <= instant(charge.at)) return false;
      const score = data.scores.find(
        (s) => s.taskId === task.id && s.playerId === playerId,
      );
      return (
        score !== undefined &&
        score.position === lastPlace.get(task.id) &&
        placementCoins(score.position) < PLACEMENT_COINS.third
      );
    });
    if (week) claims.set(week.id, charge.id);
  }
  return claims;
}

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
  const insured = insuranceClaims(data, playerId);
  const entries: CoinLedgerEntry[] = [];

  for (const score of data.scores) {
    if (score.playerId !== playerId) continue;
    const task = taskById.get(score.taskId);
    if (!task) continue;
    const place = PLACE_LABELS[score.position - 1];
    entries.push({
      kind: "placement",
      ...(insured.has(task.id)
        ? {
            amount: PLACEMENT_COINS.third,
            label: `${weekLabel(task.weekNumber)}: last place, Insurance paid 3rd-place coins`,
          }
        : {
            amount: placementCoins(score.position),
            label: `${weekLabel(task.weekNumber)}: ${place ? `${place} place` : "scored"}`,
          }),
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

  const miniTasks = new Map(data.coins.miniTasks.map((t) => [t.id, t]));
  for (const done of data.coins.miniTaskCompletions) {
    if (done.playerId !== playerId) continue;
    const miniTask = miniTasks.get(done.miniTaskId);
    if (!miniTask) continue;
    entries.push({
      kind: "mini-task",
      amount: miniTask.reward,
      label: `Mini-task: ${miniTask.title}`,
      at: done.at,
    });
  }

  return [...entries, ...skillPerkEarnings(data, playerId, entries)];
}

const SKILL_EARN_SOURCE: Partial<Record<CoinLedgerKind, SkillEarnSource>> = {
  placement: "placement",
  entry: "entry",
  prediction: "prediction",
  "poll-vote": "poll-vote",
  "peoples-choice-vote": "peoples-choice-vote",
};

/**
 * The extra coins a player's skill tree earning perks pay on `earnings`
 * (and, for Lightning Rod, on power-ups they used on finished weeks). A
 * perk only pays on coins that landed after its node was unlocked.
 */
function skillPerkEarnings(
  data: WalletData,
  playerId: string,
  earnings: readonly CoinLedgerEntry[],
): CoinLedgerEntry[] {
  const unlocks = data.coins.skillUnlocks;
  if (!unlocks.some((u) => u.playerId === playerId)) return [];
  const perkLines = (
    source: SkillEarnSource,
    earning: Pick<CoinLedgerEntry, "label" | "at" | "taskId">,
  ): CoinLedgerEntry[] =>
    unlockedNodes(unlocks, playerId, instant(earning.at)).flatMap((node) =>
      node.perks.flatMap((perk): CoinLedgerEntry[] =>
        perk.kind === "earn_bonus" && perk.source === source
          ? [
              {
                kind: "skill-perk",
                amount: perk.amount,
                label: `${node.name}: ${earning.label}`,
                at: earning.at,
                ...(earning.taskId && { taskId: earning.taskId }),
              },
            ]
          : [],
      ),
    );

  const taskById = new Map(data.tasks.map((t) => [t.id, t]));
  const powerUpUses = data.coins.uses.flatMap((use) => {
    const task = taskById.get(use.taskId);
    if (use.playerId !== playerId || task?.status !== "completed") return [];
    return [
      {
        label: `${weekLabel(task.weekNumber)}: used ${POWER_UP_INFO[use.effect].label}`,
        at: task.deadline,
        taskId: task.id,
      },
    ];
  });
  return [
    ...earnings.flatMap((earning) => {
      const source = SKILL_EARN_SOURCE[earning.kind];
      return source ? perkLines(source, earning) : [];
    }),
    ...powerUpUses.flatMap((use) => perkLines("power-up-use", use)),
  ];
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
  // Crate wins and admin item gifts are owned through a zero-price
  // purchase; their own lines say where the item came from.
  const freeItems = new Set([
    ...data.coins.crateOpens.map((o) => o.purchaseId),
    ...data.coins.itemGifts.map((g) => g.purchaseId),
    ...data.coins.skillUnlocks.flatMap((u) => u.purchaseId ?? []),
    ...data.coins.market.sales.map((sale) => sale.buyerPurchaseId),
  ]);
  const purchases: CoinLedgerEntry[] = [
    ...data.coins.purchases
      .filter((p) => p.playerId === playerId && !freeItems.has(p.id))
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
        } (${o.rarity === "power_up" ? "power-up" : o.rarity})`,
        at: o.at,
      })),
    ...data.coins.skillUnlocks
      .filter((u) => u.playerId === playerId)
      .map((u): CoinLedgerEntry => {
        const node = getSkillNode(u.nodeId);
        const path = getSkillPath(u.pathId);
        const reward = node?.rewardItemId
          ? ` → ${itemNames.get(node.rewardItemId) ?? node.rewardItemId}`
          : "";
        return {
          kind: "skill",
          amount: -u.price,
          label: `Unlocked ${node?.name ?? u.nodeId} (${path?.name ?? u.pathId})${reward}`,
          at: u.at,
        };
      }),
  ];
  const names = new Map(data.players.map((p) => [p.id, p.name]));
  const quoted = (message?: string) => (message ? `: "${message}"` : "");
  const gifts: CoinLedgerEntry[] = data.coins.gifts.flatMap(
    (g): CoinLedgerEntry[] => {
      if (g.toPlayerId === playerId) {
        return [
          {
            kind: "gift-in",
            amount: g.amount,
            label: `Gift from ${names.get(g.fromPlayerId) ?? "someone"}${quoted(g.message)}`,
            at: g.at,
          },
        ];
      }
      if (g.fromPlayerId === playerId) {
        return [
          {
            kind: "gift-out",
            amount: -g.amount,
            label: `Gift to ${names.get(g.toPlayerId) ?? "someone"}${quoted(g.message)}`,
            at: g.at,
          },
        ];
      }
      return [];
    },
  );
  const trades: CoinLedgerEntry[] = data.coins.market.sales.flatMap(
    (sale): CoinLedgerEntry[] => {
      const item = itemNames.get(sale.itemId) ?? sale.itemId;
      if (sale.sellerId === playerId) {
        return [
          {
            kind: "market-sale",
            amount: sale.price,
            label: `Sold ${item} to ${names.get(sale.buyerId) ?? "someone"} on the market`,
            at: sale.at,
          },
        ];
      }
      if (sale.buyerId === playerId) {
        return [
          {
            kind: "market-buy",
            amount: -sale.price,
            label: `Bought ${item} from ${names.get(sale.sellerId) ?? "someone"} on the market`,
            at: sale.at,
          },
        ];
      }
      return [];
    },
  );
  const itemGifts: CoinLedgerEntry[] = data.coins.itemGifts
    .filter((g) => g.playerId === playerId)
    .map((g) => ({
      kind: "item-gift",
      amount: 0,
      label: `Gifted ${itemNames.get(g.itemId) ?? g.itemId}: ${g.reason}`,
      at: g.at,
    }));
  const eggGifts: CoinLedgerEntry[] = data.coins.eggGifts
    .filter((g) => g.playerId === playerId)
    .map((g) => ({
      kind: "item-gift",
      amount: 0,
      label: `Gifted ${getCrate(g.crateId)?.name ?? "an egg"}: ${g.reason}`,
      at: g.at,
    }));
  const sum = (list: CoinLedgerEntry[]) =>
    list.reduce((total, e) => total + e.amount, 0);
  const earned = sum(earnings);
  const adjusted = sum(adjustments);
  const spent = -sum(purchases);
  const gifted = sum(gifts);
  const traded = sum(trades);
  // Pending marketplace offers hold coins until they're decided or lapse.
  const held = heldCoins(data.coins.market, playerId, now);
  return {
    playerId,
    balance: earned + adjusted - spent + gifted + traded - held,
    earned,
    adjusted,
    spent,
    gifted,
    traded,
    held,
    ledger: [
      ...earnings,
      ...adjustments,
      ...purchases,
      ...gifts,
      ...trades,
      ...itemGifts,
      ...eggGifts,
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
  };
}

/**
 * How many coins a player can still gift now: the weekly cap less what
 * they've sent in the last 7 days.
 */
export function giftAllowance(
  gifts: readonly CoinGift[],
  playerId: string,
  now: number = Date.now(),
  cap: number = GIFT_WEEKLY_CAP,
): number {
  const sent = gifts
    .filter(
      (g) =>
        g.fromPlayerId === playerId && now - instant(g.at) < GIFT_WINDOW_MS,
    )
    .reduce((total, g) => total + g.amount, 0);
  return Math.max(0, cap - sent);
}

// ── Crates ────────────────────────────────────────────────────────────

/** Whether an item is for sale (or droppable) at `now`. */
export function isOnSale(item: ShopItem, now: number): boolean {
  return item.available && inSaleWindow(item, now);
}

/**
 * A crate's odds for one player: every pet, avatar and cosmetic on sale
 * now that they don't own yet, grouped by rarity. A seasonal egg drops only
 * its own exclusives, and no other egg drops them. A tier with nothing left
 * in it has its chance shared out among the others in proportion, and items
 * in a tier are equally likely. Returns no tiers when there's nothing left.
 *
 * On top, the crate's small `powerUpChance` drops a power-up whose effect
 * the player hasn't had this season (`ownedEffects`). That chance is never
 * scaled up: with no power-ups left it goes to the other tiers, and a crate
 * with only power-ups left counts as empty, so it can't become a cheap
 * power-up vending machine.
 */
export function crateOdds(
  crate: Crate,
  items: readonly ShopItem[],
  ownedItemIds: ReadonlySet<string>,
  now: number = Date.now(),
  ownedEffects: ReadonlySet<PowerUpKind> = new Set(),
): CrateTier[] {
  const pool = items.filter(
    (item) =>
      isOnSale(item, now) &&
      !item.skillOnly &&
      CRATE_CATEGORIES.some((c) => c === item.category) &&
      (crate.exclusive ? item.crateId === crate.id : !item.crateId) &&
      !ownedItemIds.has(item.id),
  );
  const byTier = RARITIES.map((rarity) => ({
    rarity,
    weight: crate.odds[rarity] ?? 0,
    items: pool.filter((item) => rarityOf(item.price) === rarity),
  })).filter((tier) => tier.weight > 0 && tier.items.length > 0);
  if (byTier.length === 0) return [];
  const powerUps = items.filter(
    (item) =>
      item.powerUp !== undefined &&
      !item.skillOnly &&
      isOnSale(item, now) &&
      !ownedEffects.has(item.powerUp),
  );
  const powerUpChance =
    powerUps.length > 0
      ? Math.min(Math.max(crate.powerUpChance ?? 0, 0), 1)
      : 0;
  const total = byTier.reduce((sum, tier) => sum + tier.weight, 0);
  const tier = (
    rarity: CrateTierKind,
    chance: number,
    drops: readonly ShopItem[],
  ): CrateTier => ({
    rarity,
    chance,
    drops: drops.map((item) => ({ item, chance: chance / drops.length })),
  });
  return [
    ...byTier.map(({ rarity, weight, items: drops }) =>
      tier(rarity, (weight / total) * (1 - powerUpChance), drops),
    ),
    ...(powerUpChance > 0 ? [tier("power_up", powerUpChance, powerUps)] : []),
  ];
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
): { item: ShopItem; rarity: CrateTierKind } | undefined {
  let remaining = random;
  let last: { item: ShopItem; rarity: CrateTierKind } | undefined;
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
