import type { APIRoute } from "astro";
import { withBase } from "../../lib/url";

// The old admin sign-in page. Everyone signs in at `/login` now; keep any
// `next` destination (it's validated there) so bookmarks still land right.
export const GET: APIRoute = ({ url, redirect }) => {
  const next = url.searchParams.get("next") ?? "/admin";
  return redirect(
    `${withBase("/login")}?${new URLSearchParams({ next })}`,
    301,
  );
};
