import type { APIRoute } from "astro";
import { getSubmission } from "../../../data/submissions";
import { presignGet } from "../../../lib/storage";
import { queriesForTask } from "../../../lib/season-scope";

// A stable, access-checked link to a photo entry. The bucket is private, so
// this checks who's asking (see `canViewSubmission`) and redirects to a
// short-lived presigned URL. Pages embed this route rather than the signed
// URL, so a cached page never holds an expired link.

const LINK_SECONDS = 15 * 60;

const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });

export const GET: APIRoute = async ({ params, locals }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return notFound();
  const submission = await getSubmission(id);
  if (!submission?.objectKey) return notFound();

  const [{ getTaskById, canViewSubmission }, viewer] = await Promise.all([
    queriesForTask(locals, submission.taskId),
    locals.getViewer(),
  ]);
  const task = getTaskById(submission.taskId);
  const allowed =
    task &&
    canViewSubmission(task, submission, {
      signedIn: viewer !== undefined,
      isAdmin: viewer?.isAdmin ?? false,
      ...(viewer?.playerId && { playerId: viewer.playerId }),
    });
  // Hidden and not-yet-public entries look the same as missing ones.
  if (!allowed) return notFound();

  return new Response(null, {
    status: 302,
    headers: {
      Location: await presignGet(submission.objectKey, LINK_SECONDS),
      // Entries are sign-in only, so no shared cache may keep the link.
      "Cache-Control": "private, no-store",
    },
  });
};
