import type { APIRoute } from "astro";
import { withBase } from "../../lib/url";

// Seasons are listed in the Hall of Fame.
export const GET: APIRoute = ({ redirect }) =>
  redirect(withBase("/hall-of-fame"), 301);
