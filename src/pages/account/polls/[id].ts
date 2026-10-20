import type { APIRoute } from "astro";
import { castVote, retractVote } from "../../../data/votes";
import { parseBallot, type VoteOutcome } from "../../../lib/account-forms";
import { withBase } from "../../../lib/url";

// Players vote from the homepage poll cards. Living under `/account` means
// the middleware has already required a signed-in player (and a changed
// temporary password) before this runs; Astro's origin check rejects
// cross-site posts. Every outcome goes back to the poll on the homepage.

const backToPoll = (pollId: string, outcome?: VoteOutcome) => {
  const query = outcome
    ? `?${new URLSearchParams({ poll: pollId, vote: outcome })}`
    : "";
  return withBase(`/${query}#poll-${encodeURIComponent(pollId)}`);
};

// Signing in from a poll card lands here (see `/login?next=`).
export const GET: APIRoute = ({ params, redirect }) =>
  redirect(backToPoll(params.id ?? ""));

export const POST: APIRoute = async ({ params, locals, request, redirect }) => {
  const player = locals.player;
  if (!player || player.mustChangePassword) {
    return redirect(withBase("/login"));
  }

  const { getPollById, getPollCard } = await locals.getQueries();
  const poll = getPollById(params.id ?? "");
  if (!poll || !poll.published) return redirect(withBase("/"));

  const form = await request.formData();
  const card = getPollCard(poll, { kind: "player", playerId: player.playerId });
  const reply = (outcome: VoteOutcome) =>
    redirect(backToPoll(poll.id, outcome));

  if (poll.status !== "open") return reply("not-open");
  if (!card.canVote) return reply("locked");

  if (form.get("intent") === "retract") {
    if (card.hasVoted) await retractVote(poll.id, player.playerId);
    return reply("retracted");
  }

  const ballot = parseBallot(form, poll);
  if (!ballot.ok) return reply(ballot.outcome);
  await castVote(
    poll.id,
    player.playerId,
    ballot.optionIds,
    poll.allowVoteChange,
  );
  return reply(card.hasVoted ? "changed" : "voted");
};
