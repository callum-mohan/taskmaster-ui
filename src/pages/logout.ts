import type { APIRoute } from "astro";
import { createAuth } from "../lib/auth";
import { withBase } from "../lib/url";

// POST-only so a link or image can't sign someone out; Astro's origin check
// rejects cross-site posts.
export const POST: APIRoute = async (context) => {
  await createAuth(context).signOut();
  return context.redirect(withBase("/login?signedOut=1"));
};
