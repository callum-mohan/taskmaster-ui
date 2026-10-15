import type { APIRoute } from "astro";
import { markNotificationsRead } from "../../../data/accounts";
import { withBase } from "../../../lib/url";

// Marks a player's notifications read. The navbar panel posts here with
// `fetch` when it opens (and gets a 204); the no-JS notifications page
// posts a plain form and is sent back to the list. Living under `/account`
// means the middleware has already required a signed-in player, and Astro's
// origin check rejects cross-site posts.

const LIST_PATH = "/account/notifications";

export const GET: APIRoute = ({ redirect }) => redirect(withBase(LIST_PATH));

export const POST: APIRoute = async ({ locals, request, redirect }) => {
  const player = locals.player;
  if (!player || player.mustChangePassword) {
    return redirect(withBase("/login"));
  }

  await markNotificationsRead(player.playerId);

  if (request.headers.get("X-Requested-With") === "fetch") {
    return new Response(null, { status: 204 });
  }
  return redirect(withBase(`${LIST_PATH}?done=read`));
};
