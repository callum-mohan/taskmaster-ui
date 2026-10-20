import type { APIRoute } from "astro";
import type { SubmissionOutcome } from "../../../types";
import {
  createSubmission,
  deleteOwnSubmission,
  loadTaskSubmissions,
} from "../../../data/submissions";
import { deleteObjects, putObject } from "../../../lib/storage";
import {
  MAX_SUBMISSION_REQUEST_BYTES,
  parsePhotoEntry,
  parseSubmissionId,
  parseSubmissionIntent,
  parseTextEntry,
  submissionObjectKey,
} from "../../../lib/submission-forms";
import { withBase } from "../../../lib/url";
import { queriesForTask } from "../../../lib/season-scope";

// Players submit and withdraw task entries from the task page. Living under
// `/account` means the middleware has already required a signed-in player
// (with a changed temporary password); Astro's origin check rejects
// cross-site posts. Photos are small enough (≤ 15 MB) to pass through the
// Worker, so this is a plain multipart form that works without JS. Every
// outcome goes back to the task page (post/redirect/get).

const backToTask = (taskId: string, outcome?: SubmissionOutcome) =>
  withBase(
    `/tasks/${encodeURIComponent(taskId)}${
      outcome ? `?${new URLSearchParams({ entry: outcome })}` : ""
    }#entries`,
  );

// Signing in from the task page lands here (see `/login?next=`).
export const GET: APIRoute = ({ params, redirect }) =>
  redirect(backToTask(params.taskId ?? ""));

export const POST: APIRoute = async ({ params, locals, request, redirect }) => {
  const player = locals.player;
  if (!player || player.mustChangePassword) {
    return redirect(withBase("/login"));
  }

  const { getTaskById, getSubmissionPanel, getSubmissionOwnerRef } =
    await queriesForTask(locals, params.taskId);
  const task = getTaskById(params.taskId ?? "");
  if (!task) return redirect(withBase("/tasks"));
  const reply = (outcome: SubmissionOutcome) =>
    redirect(backToTask(task.id, outcome), 303);

  // Refuse oversized uploads before reading the body.
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_SUBMISSION_REQUEST_BYTES) return reply("too-large");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reply("invalid");
  }
  const intent = parseSubmissionIntent(form);
  if (!intent) return reply("invalid");

  const panel = getSubmissionPanel(task, await loadTaskSubmissions(task.id), {
    signedIn: true,
    isAdmin: player.isAdmin,
    playerId: player.playerId,
  });
  const owner = getSubmissionOwnerRef(task, player.playerId);

  if (intent === "delete") {
    const id = parseSubmissionId(form);
    if (!panel.canDelete || !owner) return reply("closed");
    if (!id) return reply("invalid");
    const removed = await deleteOwnSubmission(id, task.id, owner);
    if (!removed) return reply("invalid");
    if (removed.objectKey) await deleteObjects([removed.objectKey]);
    return reply("deleted");
  }

  if (!panel.canSubmit || !owner) {
    return reply(panel.blockedBy === "full" ? "full" : "closed");
  }
  const kind = intent === "create-photo" ? "photo" : "text";
  if (!panel.settings.kinds.includes(kind)) return reply("kind");
  const base = { taskId: task.id, playerId: player.playerId, owner };

  if (kind === "text") {
    const text = parseTextEntry(form);
    if (!text.ok) return reply(text.outcome);
    const saved = await createSubmission(
      { ...base, kind, text: text.data },
      panel.settings.max,
    );
    return reply(saved ? "submitted" : "full");
  }

  const photo = await parsePhotoEntry(form);
  if (!photo.ok) return reply(photo.outcome);
  const { bytes, type, caption } = photo.data;
  const objectKey = submissionObjectKey(task.id, owner, type);
  try {
    await putObject(objectKey, bytes, type.contentType);
  } catch (error) {
    console.error("Submission upload failed", error);
    return reply("upload-failed");
  }
  let saved = false;
  try {
    saved = await createSubmission(
      {
        ...base,
        kind,
        text: caption,
        objectKey,
        contentType: type.contentType,
        sizeBytes: bytes.byteLength,
      },
      panel.settings.max,
    );
  } finally {
    // Don't leave an orphaned image when the entry wasn't recorded.
    if (!saved) await deleteObjects([objectKey]);
  }
  return reply(saved ? "submitted" : "full");
};
