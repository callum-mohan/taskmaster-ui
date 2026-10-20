import type { APIRoute } from "astro";
import { withBase } from "../lib/url";
import { isSeasonPublic, isWrappedLive } from "../data/seasons";

const STATIC_PATHS = [
  "/",
  "/about",
  "/rules",
  "/leaderboard",
  "/stats",
  "/tasks",
  "/players",
  "/teams",
  "/recaps",
  "/compare",
  "/hall-of-fame",
];

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Generated from live data so new players, tasks and recaps appear as soon as
// they are added, for every public season (the current one and the archive).
// The head-to-head `/compare/a/b` pages (every ordered pair of players) stay
// crawlable but are left out to keep the sitemap focused.
export const GET: APIRoute = async ({ site, url, locals }) => {
  const { seasons } = await locals.getSeasons();
  const seasonPaths = await Promise.all(
    seasons.filter(isSeasonPublic).map(async (season) => {
      const { players, tasks, teams, getRecapTaskIds } =
        await locals.getQueries(season.id);
      const wrapped = isWrappedLive(season)
        ? [
            `/seasons/${season.id}/wrapped`,
            ...players.map((p) => `/seasons/${season.id}/wrapped/${p.id}`),
          ]
        : [];
      return [
        `/seasons/${season.id}`,
        ...wrapped,
        ...tasks.map((t) => `/tasks/${t.id}`),
        ...players.map((p) => `/players/${p.id}`),
        ...teams.map((t) => `/teams/${t.id}`),
        ...getRecapTaskIds().map((id) => `/recaps/${id}`),
      ];
    }),
  );
  const paths = [...STATIC_PATHS, ...seasonPaths.flat()];
  const origin = site ?? url.origin;
  const entries = paths
    .map(
      (path) =>
        `<url><loc>${escapeXml(new URL(withBase(path), origin).href)}</loc></url>`,
    )
    .join("");
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>
`;
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
