import type { CoinOutcome, Season } from "../types";
import type { WalletAction } from "../lib/account-forms";
import { createQueries, type Queries } from "./queries";
import { loadFreshPlayerCompetition } from "./competition";
import { equipItem, unequipSlot, usePowerUp } from "./shop";
import { slotOf } from "./coins";

/**
 * Carries out a wallet action from the account page (equip, take off, or use
 * a power-up) and says how it went. Power-ups change scores, so they're
 * checked against fresh rows; the writes re-check the stored facts too.
 */
export async function runWalletAction(
  playerId: string,
  season: Season,
  action: WalletAction,
  getQueries: (seasonId: string) => Promise<Queries>,
): Promise<CoinOutcome> {
  if (season.status === "closed") return "season-closed";

  if (action.intent === "unequip") {
    await unequipSlot(playerId, action.slot);
    return "unequipped";
  }
  if (action.intent === "equip") {
    const { getShopItemById } = await getQueries(season.id);
    const item = getShopItemById(action.itemId);
    const slot = item && slotOf(item);
    if (!item || !slot) return "invalid";
    return (await equipItem(playerId, slot, item.id)) ? "equipped" : "invalid";
  }

  const fresh = await loadFreshPlayerCompetition(playerId);
  if (!fresh) return "invalid";
  const { getTaskById, getPowerUpBlock, getSabotageTargets } =
    createQueries(fresh);
  const task = getTaskById(action.taskId);
  const blocked = getPowerUpBlock(playerId, task, action.effect);
  if (blocked) return blocked;
  if (
    action.targetPlayerId !== null &&
    !getSabotageTargets(playerId, action.taskId).some(
      (p) => p.id === action.targetPlayerId,
    )
  ) {
    return "already-sabotaged";
  }
  return usePowerUp(
    playerId,
    action.taskId,
    action.effect,
    action.targetPlayerId,
  );
}
