import type { APIRoute } from "astro";
import type { GalleryOutcome } from "../../../types";
import { getSubmission } from "../../../data/submissions";
import { loadTaskReactions, toggleReaction } from "../../../data/reactions";
import {
  castPeoplesChoiceVote,
  withdrawPeoplesChoiceVote,
} from "../../../data/peoples-choice";
import { isReactionKind } from "../../../lib/reactions";
import { parseRowId } from "../../../lib/admin-forms";
import { withBase } from "../../../lib/url";
import { parsePage } from "../../../lib/pagination";
import { queriesForTask } from "../../../lib/season-scope";

// Players react to gallery entries and cast their People's Choice vote from
// the task page. Living under `/account` means the middleware has already
// required a signed-in player (with a changed temporary password); Astro's
// origin check rejects cross-site posts. Plain forms work without JS (every
// outcome goes back to the entry); the reaction buttons' script asks for
// JSON instead so the page doesn't jump.

const backToEntry = (
  taskId: string,
  outcome?: GalleryOutcome,
  entryId?: number,
  page = 1,
) => {
  const query = new URLSearchParams({
    ...(outcome && { gallery: outcome }),
    ...(page > 1 && { entries: String(page) }),
  }).toString();
  return withBase(
    `/tasks/${encodeURIComponent(taskId)}${query ? `?${query}` : ""}#${
      entryId ? `entry-${entryId}` : "entries"
    }`,
  );
};

// Signing in from the task page lands here (see `/login?next=`).
export const GET: APIRoute = ({ params, redirect }) =>
  redirect(backToEntry(params.taskId ?? ""));

export const POST: APIRoute = async ({ params, locals, request, redirect }) => {
  const player = locals.player;
  if (!player || player.mustChangePassword) {
    return redirect(withBase("/login"));
  }

  const {
    getTaskById,
    canReactOnTask,
    canVoteForEntry,
    canViewSubmission,
    getPeoplesChoice,
    getReactionTallies,
  } = await queriesForTask(locals, params.taskId);
  const task = getTaskById(params.taskId ?? "");
  if (!task) return redirect(withBase("/tasks"));

  const wantsJson = (request.headers.get("accept") ?? "").includes(
    "application/json",
  );
  const form = await request.formData();
  const intent = form.get("intent");
  const entryId = parseRowId(form, "submissionId");
  // The gallery page the form was on (paged galleries post it back).
  const pageField = form.get("entries");
  const page = parsePage(typeof pageField === "string" ? pageField : null);
  const reply = (outcome: GalleryOutcome, status = 200) =>
    wantsJson
      ? Response.json({ outcome }, { status })
      : redirect(backToEntry(task.id, outcome, entryId, page), 303);

  const viewer = {
    signedIn: true,
    isAdmin: false,
    playerId: player.playerId,
  };
  const choice = getPeoplesChoice(task, viewer);

  if (intent === "unvote") {
    if (choice.status !== "open") return reply("vote-closed", 403);
    await withdrawPeoplesChoiceVote(task.id, player.playerId);
    return reply("vote-withdrawn");
  }

  const entry = entryId ? await getSubmission(entryId) : undefined;
  if (
    !entry ||
    entry.taskId !== task.id ||
    entry.hidden ||
    !canViewSubmission(task, entry, viewer)
  ) {
    return reply("invalid", 404);
  }

  if (intent === "react") {
    const kind = form.get("kind");
    if (!isReactionKind(kind) || !canReactOnTask(task, viewer)) {
      return reply("invalid", 400);
    }
    const on = await toggleReaction(entry.id, player.playerId, kind);
    if (!wantsJson) return reply(on ? "reacted" : "unreacted");
    const reactions = getReactionTallies(
      entry.id,
      await loadTaskReactions(task.id),
      player.playerId,
    );
    return Response.json({ outcome: on ? "reacted" : "unreacted", reactions });
  }

  if (intent === "vote") {
    if (choice.status !== "open") return reply("vote-closed", 403);
    // Open vote and a visible entry on this task, so it must be their own.
    if (!canVoteForEntry(task, entry, player.playerId)) {
      return reply("own-entry", 403);
    }
    await castPeoplesChoiceVote(task.id, player.playerId, entry.id);
    return reply(choice.myVote === undefined ? "voted" : "vote-changed");
  }

  return reply("invalid", 400);
};
