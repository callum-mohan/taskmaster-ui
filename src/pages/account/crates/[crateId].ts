import type { APIRoute } from "astro";
import type { CoinOutcome, CrateBlock } from "../../../types";
import { loadFreshPlayerCompetition } from "../../../data/competition";
import { createQueries } from "../../../data/queries";
import { getCrate } from "../../../data/coin-rules";
import { rollCrate } from "../../../data/coins";
import { openCrate } from "../../../data/shop";
import { withBase } from "../../../lib/url";

// Cracking an egg (a crate) from `/shop`. Living under `/account` means the middleware
// has already required a signed-in player and purges the cached rows after.
// The roll happens here, on the server, with a cryptographically random
// number, from the player's personal odds worked out from fresh rows.

const BLOCK_OUTCOME: Record<CrateBlock, CoinOutcome> = {
  guest: "invalid",
  empty: "crate-empty",
  unaffordable: "unaffordable",
  "season-closed": "season-closed",
};

/** A crate roll can lose a race (a double-submit won the item first). */
const MAX_ATTEMPTS = 3;

// A cracked egg lands on its reveal; anything else back on the eggs.
const backToShop = (params?: Record<string, string>, hash = "crates") => {
  const search = params ? `?${new URLSearchParams(params)}` : "";
  return withBase(`/shop${search}#${hash}`);
};

const secureRandom = () =>
  crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

// Signing in from the shop lands here (see `/login?next=`).
export const GET: APIRoute = ({ redirect }) => redirect(backToShop());

export const POST: APIRoute = async ({ params, locals, redirect }) => {
  const player = locals.player;
  if (!player || player.mustChangePassword) {
    return redirect(withBase("/login"));
  }
  const reply = (outcome: CoinOutcome, pull?: number) =>
    redirect(
      backToShop(
        {
          coins: outcome,
          ...(pull !== undefined && { pull: String(pull) }),
        },
        pull !== undefined ? "crate-reveal" : "crates",
      ),
      303,
    );

  const crate = getCrate(params.crateId ?? "");
  if (!crate) return reply("unavailable");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const data = await loadFreshPlayerCompetition(player.playerId);
    if (!data) return reply("invalid");
    const { getCrateViews, getWallet } = createQueries(data);
    const view = getCrateViews({ playerId: player.playerId }).find(
      (v) => v.crate.id === crate.id,
    );
    if (!view) return reply("unavailable");
    if (view.blocked) return reply(BLOCK_OUTCOME[view.blocked]);

    const roll = rollCrate(view.tiers, secureRandom());
    if (!roll) return reply("crate-empty");
    // The player's skill tree discount is what they pay.
    const openedId = await openCrate(
      player.playerId,
      { ...view.crate, price: view.price },
      roll.item.id,
      roll.rarity,
      getWallet(player.playerId).earned,
    );
    if (openedId !== undefined) return reply("opened", openedId);
  }
  return reply("invalid");
};
