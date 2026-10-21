import type { APIRoute } from "astro";
import { withBase } from "../../lib/url";

// The wallet moved into the account page; keep old links and bookmarks
// working (308 keeps a form post from an old tab a post).
const target = (url: URL) => withBase(`/account${url.search}#wallet`);

export const GET: APIRoute = ({ url, redirect }) => redirect(target(url), 301);
export const POST: APIRoute = ({ url, redirect }) => redirect(target(url), 308);
