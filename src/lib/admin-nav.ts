import type { AdminSection, WeekStepId } from "../types";

export const ADMIN_HOME = "/admin";
export const ADMIN_WEEKS = "/admin/weeks";
export const ADMIN_SEASONS = "/admin/seasons";
export const ADMIN_ROSTER = "/admin/roster";
export const ADMIN_SITE = "/admin/site";
export const ADMIN_ACTIVITY = "/admin/activity";
export const ADMIN_POOL = "/admin/pool";
export const ADMIN_GUIDE = "/admin/guide";

/**
 * Every area of the admin panel after the dashboard, in nav order. The single
 * source for the admin sub-nav, the dashboard shortcuts and the admin
 * command-palette entries.
 */
export const ADMIN_SECTIONS: AdminSection[] = [
  {
    href: ADMIN_WEEKS,
    label: "weeks",
    title: "Run the weeks",
    hint: "seasons, briefs, entries, scores, results night and recaps",
    keywords:
      "tasks briefs scores points bonus entries submissions judge live reveal results recaps seasons cohorts champion close",
    match: [ADMIN_SEASONS],
  },
  {
    href: ADMIN_ROSTER,
    label: "roster",
    title: "Manage the roster",
    hint: "players, sign-in accounts and squads",
    keywords: "players teams squads accounts invite password members",
    match: ["/admin/players", "/admin/teams"],
  },
  {
    href: ADMIN_SITE,
    label: "site",
    title: "Polls, mini-tasks, changelog & shop",
    hint: "feature flags, homepage polls, mini-tasks, the what's new list, the Clim Coin shop and marketplace",
    keywords:
      "feature flags toggles switches enable disable polls votes questions mini-tasks daily bonus side quests tick off completions changelog whats new release notes clim coin shop pets avatars cosmetics power-ups items prices mystery eggs crates marketplace market listings offers trades take down",
    match: [
      "/admin/polls",
      "/admin/mini-tasks",
      "/admin/changelog",
      "/admin/shop",
      "/admin/market",
    ],
  },
  {
    href: ADMIN_ACTIVITY,
    label: "activity",
    title: "Check the activity log",
    hint: "one timeline of score changes, coin grants, gifts, purchases and mini-tasks",
    keywords:
      "activity log audit history timeline disputes who changed what score changes coin adjustments grants deductions gifts purchases crates power-ups sabotage skills wishes mini-tasks",
  },
  {
    href: ADMIN_POOL,
    label: "pool",
    title: "Run the pool bracket",
    hint: "pool pairs, weekly draws and match results",
    keywords: "pool bracket pairs draw matches knockout tournament winner",
  },
  {
    href: ADMIN_GUIDE,
    label: "guide",
    title: "How to use the admin",
    hint: "the weekly runbook and what every screen does",
    keywords: "help docs manual how to instructions",
  },
];

/** Whether `href` (or one of `match`) is the admin area being visited. */
export function isAdminSectionActive(
  pathname: string,
  href: string,
  match: readonly string[] = [],
): boolean {
  const path = pathname.replace(/\/$/, "");
  if (href === ADMIN_HOME) return path === ADMIN_HOME;
  return [href, ...match].some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** The workflow steps of a week, in order, with their tab labels. */
export const WEEK_STEPS: { id: WeekStepId; label: string; hint: string }[] = [
  { id: "brief", label: "brief", hint: "title, dates, format, entries" },
  { id: "judge", label: "judge", hint: "entries, points and bonuses" },
  { id: "live", label: "results night", hint: "optional live reveal" },
  { id: "recap", label: "recap", hint: "episode write-up" },
];

const weekStepPath: Record<WeekStepId, string> = {
  brief: "",
  judge: "/judge",
  live: "/live",
  recap: "/recap",
};

/** Root-relative admin path of a week's tab. */
export function weekHref(taskId: string, step: WeekStepId = "brief"): string {
  return `${ADMIN_WEEKS}/${encodeURIComponent(taskId)}${weekStepPath[step]}`;
}

// Admin URLs from before the panel was regrouped, mapped to where that screen
// lives now so bookmarks keep working. `:id` is a single path segment.
const LEGACY_ROUTES: [RegExp, (id?: string) => string][] = [
  [/^\/admin\/tasks\/new$/, () => `${ADMIN_WEEKS}/new`],
  [/^\/admin\/tasks\/([^/]+)$/, (id) => weekHref(id!)],
  [
    /^\/admin\/(?:scores|submissions)\/([^/]+)$/,
    (id) => weekHref(id!, "judge"),
  ],
  [/^\/admin\/live\/([^/]+)$/, (id) => weekHref(id!, "live")],
  [/^\/admin\/recaps\/([^/]+)$/, (id) => weekHref(id!, "recap")],
  [/^\/admin\/(?:tasks|scores|submissions|live|recaps)$/, () => ADMIN_WEEKS],
  [/^\/admin\/players$/, () => ADMIN_ROSTER],
  [/^\/admin\/teams$/, () => `${ADMIN_ROSTER}#squads`],
  [/^\/admin\/polls$/, () => ADMIN_SITE],
  [/^\/admin\/changelog$/, () => `${ADMIN_SITE}#changelog`],
  [/^\/admin\/shop$/, () => `${ADMIN_SITE}#shop`],
  [/^\/admin\/mini-tasks$/, () => `${ADMIN_SITE}#mini-tasks`],
];

/**
 * Where an old admin path now lives (root-relative, before any `base`), or
 * `undefined` when the path isn't a retired one.
 */
export function legacyAdminPath(pathname: string): string | undefined {
  const path = pathname.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1");
  for (const [pattern, target] of LEGACY_ROUTES) {
    const found = pattern.exec(path);
    if (!found) continue;
    if (found[1] === undefined) return target();
    try {
      return target(decodeURIComponent(found[1]));
    } catch {
      // A malformed escape can't name a real task; let it 404.
      return undefined;
    }
  }
  return undefined;
}
