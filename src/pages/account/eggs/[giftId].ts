import type { APIRoute } from "astro";
import type { CoinOutcome } from "../../../types";
import { loadFreshPlayerCompetition } from "../../../data/competition";
import { createQueries } from "../../../data/queries";
import { rollCrate } from "../../../data/coins";
import { openGiftedEgg } from "../../../data/shop";
import { withBase } from "../../../lib/url";

// Cracking an egg an admin gifted, from the player's inventory on
// `/account`. Like buying one in the shop (`/account/crates/[crateId]`), the
// roll happens here with a cryptographically random number, from the
// player's personal odds worked out from fresh rows, but it costs nothing.

/** A roll can lose a race (a double-submit won the item first). */
const MAX_ATTEMPTS = 3;

const backToInventory = (params: Record<string, string>, hash: string) =>
  withBase(`/account?${new URLSearchParams(params)}#${hash}`);

const secureRandom = () =>
  crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

export const GET: APIRoute = ({ redirect }) =>
  redirect(withBase("/account#inventory"));

export const POST: APIRoute = async ({ params, locals, redirect }) => {
  const player = locals.player;
  if (!player || player.mustChangePassword) {
    return redirect(withBase("/login"));
  }
  const reply = (outcome: CoinOutcome, pull?: number) =>
    redirect(
      backToInventory(
        {
          coins: outcome,
          ...(pull !== undefined && { pull: String(pull) }),
        },
        pull !== undefined ? "crate-reveal" : "inventory",
      ),
      303,
    );

  const giftId = Number(params.giftId);
  if (!Number.isInteger(giftId) || giftId <= 0) return reply("invalid");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const data = await loadFreshPlayerCompetition(player.playerId);
    if (!data) return reply("invalid");
    if (data.season.status === "closed") return reply("season-closed");
    const egg = createQueries(data)
      .getUnopenedEggs(player.playerId)
      .find((e) => e.gift.id === giftId);
    if (!egg) return reply("invalid");
    if (egg.blocked) return reply("crate-empty");

    const roll = rollCrate(egg.tiers, secureRandom());
    if (!roll) return reply("crate-empty");
    const openedId = await openGiftedEgg(
      player.playerId,
      giftId,
      roll.item.id,
      roll.rarity,
    );
    if (openedId !== undefined) return reply("opened", openedId);
  }
  return reply("invalid");
};
