import type { APIRoute } from "astro";
import { createAuth } from "../lib/auth";
import { withBase } from "../lib/url";

// POST-only so a link or image can't sign someone out; Astro's origin check
// rejects cross-site posts. Admins return to the admin portal, everyone else
// to the player portal.
export const POST: APIRoute = async (context) => {
  const form = await context.request.formData().catch(() => undefined);
  const portal = form?.get("portal") === "admin" ? "/admin/login" : "/login";
  await createAuth(context).signOut();
  return context.redirect(withBase(`${portal}?signedOut=1`));
};
