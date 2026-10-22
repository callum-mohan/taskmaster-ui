import type { CoinOutcome, Season } from "../types";
import type { WalletAction } from "../lib/account-forms";
import { createQueries, type Queries } from "./queries";
import { loadFreshPlayerCompetition } from "./competition";
import { equipItem, makeWish, sendGift, unequipSlot, usePowerUp } from "./shop";
import { slotOf } from "./coins";

/**
 * Carries out a wallet action from the account page (equip, take off, use
 * a power-up, make a wish or send a gift) and says how it went. Power-ups
 * change scores and gifts spend coins, so they're checked against fresh
 * rows; the writes re-check the stored facts too.
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

  if (action.intent === "wish") {
    const { blocked } = createQueries(fresh).getWishPanel(playerId);
    if (blocked) return blocked;
    return (await makeWish(playerId, action.wish)) ? "wished" : "no-charge";
  }

  if (action.intent === "gift") {
    const { getGiftPanel, getWallet } = createQueries(fresh);
    const panel = getGiftPanel(playerId);
    if (!panel.recipients.some((p) => p.id === action.toPlayerId)) {
      return "invalid";
    }
    if (action.amount > panel.allowance) return "gift-limit";
    if (action.amount > panel.max) return "unaffordable";
    const sent = await sendGift(
      playerId,
      action.toPlayerId,
      action.amount,
      action.message,
      getWallet(playerId).earned,
      panel.cap,
    );
    return sent ? "gifted" : "invalid";
  }

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
