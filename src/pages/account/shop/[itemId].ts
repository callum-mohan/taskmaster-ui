import type { APIRoute } from "astro";
import type { CoinOutcome, PurchaseBlock } from "../../../types";
import { loadFreshPlayerCompetition } from "../../../data/competition";
import { createQueries } from "../../../data/queries";
import { buyItem } from "../../../data/shop";
import { withBase } from "../../../lib/url";

// Buying from `/shop`. Living under `/account` means the middleware has
// already required a signed-in player (with a changed temporary password)
// and purges the cached rows after; Astro's origin check rejects cross-site
// posts. The balance is checked against fresh rows, then re-checked by the
// write itself.

const BLOCK_OUTCOME: Record<PurchaseBlock, CoinOutcome> = {
  guest: "invalid",
  owned: "owned",
  used: "owned",
  "crate-only": "unavailable",
  unaffordable: "unaffordable",
  unavailable: "unavailable",
  "season-closed": "season-closed",
};

const backToShop = (itemId: string, outcome?: CoinOutcome) => {
  const search = outcome ? `?${new URLSearchParams({ coins: outcome })}` : "";
  return withBase(`/shop${search}#item-${encodeURIComponent(itemId)}`);
};

// Signing in from the shop lands here (see `/login?next=`).
export const GET: APIRoute = ({ params, redirect }) =>
  redirect(backToShop(params.itemId ?? ""));

export const POST: APIRoute = async ({ params, locals, redirect }) => {
  const player = locals.player;
  if (!player || player.mustChangePassword) {
    return redirect(withBase("/login"));
  }
  const itemId = params.itemId ?? "";
  const reply = (outcome: CoinOutcome) =>
    redirect(backToShop(itemId, outcome), 303);

  const data = await loadFreshPlayerCompetition(player.playerId);
  if (!data) return reply("invalid");
  const { getShopItemById, getPurchaseBlock, getWallet } = createQueries(data);
  const item = getShopItemById(itemId);
  if (!item) return reply("unavailable");
  const blocked = getPurchaseBlock(item, { playerId: player.playerId });
  if (blocked) return reply(BLOCK_OUTCOME[blocked]);

  const bought = await buyItem(
    player.playerId,
    item.id,
    getWallet(player.playerId).earned,
  );
  return reply(bought ? "bought" : "unaffordable");
};
