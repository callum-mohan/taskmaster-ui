import type { APIRoute } from "astro";
import { withBase } from "../lib/url";

// Kept at the URL the old static sitemap integration used (and that
// `robots.txt` advertises), pointing at the live sitemap below.
export const GET: APIRoute = ({ site, url }) => {
  const sitemapUrl = new URL(withBase("/sitemap-0.xml"), site ?? url.origin);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${sitemapUrl.href}</loc></sitemap></sitemapindex>
`;
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
