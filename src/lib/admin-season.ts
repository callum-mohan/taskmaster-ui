// Which season an admin screen is working on. Screens about one record
// (a week, a player, a squad) are in that record's season; screens about a
// whole season (the weeks list, the roster, the "new" forms) take it from
// `?season=`, defaulting to the current one. Kept free of Astro runtime
// imports so the rules can be unit tested.
import type { Season, SeasonDirectory } from "../types";

export const SEASON_PARAM = "season";

/** Set on the redirect after a write to a closed season is refused. */
export const CLOSED_PARAM = "closed";

const RECORD_ROUTES: [
  RegExp,
  (seasons: SeasonDirectory, id: string) => Season | undefined,
][] = [
  [/^\/admin\/weeks\/\[id\](?:\/[a-z]+)?\/?$/, (s, id) => s.seasonOfTask(id)],
  [/^\/admin\/players\/\[id\]\/?$/, (s, id) => s.seasonOfPlayer(id)],
  [/^\/admin\/teams\/\[id\]\/?$/, (s, id) => s.seasonOfTeam(id)],
];

const SEASON_ROUTES =
  /^\/admin\/(?:weeks|roster|weeks\/new|players\/new|teams\/new)\/?$/;

/** Whether the screen works on a whole season picked with `?season=`. */
export const isSeasonScopedRoute = (route: string) => SEASON_ROUTES.test(route);

/** The season picked with `?season=`, else the current season. */
export function selectedSeason(
  url: URL,
  seasons: SeasonDirectory,
): Season | undefined {
  const id = url.searchParams.get(SEASON_PARAM);
  return (id ? seasons.getSeason(id) : undefined) ?? seasons.current;
}

/**
 * The season an admin route works on, or `undefined` for screens that
 * aren't about a season (polls, changelog, the seasons screens themselves)
 * and for unknown records (which 404).
 */
export function adminSeasonOf(
  route: string,
  params: Record<string, string | undefined>,
  url: URL,
  seasons: SeasonDirectory,
): Season | undefined {
  for (const [pattern, lookup] of RECORD_ROUTES) {
    if (pattern.test(route)) {
      return params.id === undefined ? undefined : lookup(seasons, params.id);
    }
  }
  return isSeasonScopedRoute(route) ? selectedSeason(url, seasons) : undefined;
}

/**
 * `href` with `?season=` set, unless `season` is the current one (its
 * default), so links keep the season an admin is working on.
 */
export function withSeason(href: string, season: Season | undefined): string {
  if (!season || season.isCurrent) return href;
  const [path, hash] = href.split("#");
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}${SEASON_PARAM}=${encodeURIComponent(season.id)}${
    hash ? `#${hash}` : ""
  }`;
}

/**
 * The id a new week gets when the admin leaves it blank: `week-NN` in the
 * first season, then prefixed with the season's id so later seasons' week
 * URLs never collide with earlier ones.
 */
export function defaultWeekId(
  season: Season,
  weekNumber: number,
  seasons: readonly Season[],
): string {
  const week = `week-${String(weekNumber).padStart(2, "0")}`;
  return seasons[0]?.id === season.id ? week : `${season.id}-${week}`;
}
