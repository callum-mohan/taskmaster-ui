import type { APIRoute } from "astro";
import type { PredictionOutcome, PredictionPick } from "../../../types";
import { savePrediction, withdrawPrediction } from "../../../data/predictions";
import { withBase } from "../../../lib/url";

// Players call a week's winner from the task page. Living under `/account`
// means the middleware has already required a signed-in player (with a
// changed temporary password); Astro's origin check rejects cross-site
// posts. Every outcome goes back to the prediction panel.

const backToPanel = (taskId: string, outcome?: PredictionOutcome) =>
  withBase(
    `/tasks/${encodeURIComponent(taskId)}${
      outcome ? `?${new URLSearchParams({ prediction: outcome })}` : ""
    }#predict`,
  );

// Signing in from the task page lands here (see `/login?next=`).
export const GET: APIRoute = ({ params, redirect }) =>
  redirect(backToPanel(params.taskId ?? ""));

export const POST: APIRoute = async ({ params, locals, request, redirect }) => {
  const player = locals.player;
  if (!player || player.mustChangePassword) {
    return redirect(withBase("/login"));
  }

  const { getTaskById, getPredictionPanel, canPredict } =
    await locals.getQueries();
  const task = getTaskById(params.taskId ?? "");
  if (!task) return redirect(withBase("/tasks"));
  const reply = (outcome: PredictionOutcome) =>
    redirect(backToPanel(task.id, outcome), 303);

  const panel = getPredictionPanel(task, {
    signedIn: true,
    playerId: player.playerId,
  });
  if (panel.status !== "open") return reply("closed");

  const form = await request.formData();
  if (form.get("intent") === "withdraw") {
    await withdrawPrediction(task.id, player.playerId);
    return reply("withdrawn");
  }

  const pickId = String(form.get("pick") ?? "");
  const pick: PredictionPick =
    task.format === "team"
      ? { type: "team", id: pickId }
      : { type: "player", id: pickId };
  if (!canPredict(task, player.playerId, pick)) return reply("invalid");

  await savePrediction(task.id, player.playerId, pick);
  return reply(panel.myPick ? "changed" : "saved");
};
