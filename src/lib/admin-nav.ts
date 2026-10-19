import type { AdminSection } from "../types";

export const ADMIN_HOME = "/admin";

/**
 * Every area of the admin panel, in nav order. The single source for the
 * admin sub-nav, the dashboard shortcuts and the admin command-palette entries.
 */
export const ADMIN_SECTIONS: AdminSection[] = [
  {
    href: "/admin/scores",
    label: "scores",
    title: "Record scores",
    hint: "per-week grid + bonus points",
    keywords: "points grid bonus results marks",
  },
  {
    href: "/admin/submissions",
    label: "entries",
    title: "Review entries",
    hint: "players' photo and text entries, scored in a gallery",
    keywords: "submissions photos gallery media",
  },
  {
    href: "/admin/tasks",
    label: "tasks",
    title: "Manage tasks",
    hint: "briefs, dates and formats",
    keywords: "weeks briefs password reveal",
  },
  {
    href: "/admin/players",
    label: "players",
    title: "Manage players",
    hint: "roster, bios, avatars and accounts",
    keywords: "roster accounts invite password",
  },
  {
    href: "/admin/teams",
    label: "teams",
    title: "Manage teams",
    hint: "squads and members",
    keywords: "squads groups members",
  },
  {
    href: "/admin/polls",
    label: "polls",
    title: "Run polls",
    hint: "homepage polls, schedules and results",
    keywords: "votes questions",
  },
  {
    href: "/admin/live",
    label: "live",
    title: "Results night",
    hint: "hold a week's results and reveal them live",
    keywords: "reveal live show results night",
  },
  {
    href: "/admin/recaps",
    label: "recaps",
    title: "Write recaps",
    hint: "episode headlines, summaries and moments",
    keywords: "episodes headlines moments",
  },
  {
    href: "/admin/changelog",
    label: "changelog",
    title: "Edit changelog",
    hint: "the homepage what's new list",
    keywords: "whats new release notes",
  },
];

/** Whether `href` is the admin area the visitor is currently in. */
export function isAdminSectionActive(pathname: string, href: string): boolean {
  const path = pathname.replace(/\/$/, "");
  return href === ADMIN_HOME
    ? path === ADMIN_HOME
    : path === href || path.startsWith(`${href}/`);
}
