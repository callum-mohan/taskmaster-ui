import type { APIRoute } from "astro";
import type { SkillBlock, SkillOutcome } from "../../../types";
import { loadFreshPlayerCompetition } from "../../../data/competition";
import { createQueries } from "../../../data/queries";
import { getSkillNode } from "../../../data/skill-trees";
import { unlockSkillNode } from "../../../data/skills";
import { withBase } from "../../../lib/url";

// Unlocking a skill node from `/skills`. Living under `/account` means the
// middleware has already required a signed-in player (with a changed
// temporary password) and purges the cached rows after; Astro's origin
// check rejects cross-site posts. The rules are checked against fresh rows,
// then re-checked by the write itself.

const BLOCK_OUTCOME: Record<SkillBlock, SkillOutcome> = {
  guest: "invalid",
  "season-closed": "season-closed",
  unlocked: "owned",
  "other-path": "other-path",
  locked: "locked",
  unaffordable: "unaffordable",
};

const backToSkills = (nodeId: string, outcome?: SkillOutcome) => {
  const search = outcome ? `?${new URLSearchParams({ skills: outcome })}` : "";
  return withBase(`/skills${search}#node-${encodeURIComponent(nodeId)}`);
};

// Signing in from `/skills` lands here (see `/login?next=`).
export const GET: APIRoute = ({ params, redirect }) =>
  redirect(backToSkills(params.nodeId ?? ""));

export const POST: APIRoute = async ({ params, locals, redirect }) => {
  const player = locals.player;
  if (!player || player.mustChangePassword) {
    return redirect(withBase("/login"));
  }
  const nodeId = params.nodeId ?? "";
  const reply = (outcome: SkillOutcome) =>
    redirect(backToSkills(nodeId, outcome), 303);

  const node = getSkillNode(nodeId);
  if (!node) return reply("invalid");
  const data = await loadFreshPlayerCompetition(player.playerId);
  if (!data) return reply("invalid");
  if (!data.features.skill_trees) return reply("unavailable");
  const { getSkillBlock, getWallet } = createQueries(data);
  const blocked = getSkillBlock(node, { playerId: player.playerId });
  if (blocked) return reply(BLOCK_OUTCOME[blocked]);

  const unlocked = await unlockSkillNode(
    player.playerId,
    node,
    getWallet(player.playerId).earned,
  );
  return reply(unlocked ? "unlocked" : "unaffordable");
};
