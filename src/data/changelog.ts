import type { FeatureUpdate } from "../types";

// Mock changelog of site features, authored newest-first. Like the other mock
// arrays, this will become a Supabase query (or content collection) later, so
// keep the shape stable and add new entries at the top.
export const changelog: FeatureUpdate[] = [
  {
    id: "command-palette",
    date: "2026-10-06",
    title: "Command palette",
    description:
      "Press ⌘K / Ctrl+K anywhere to jump to any player, task or team — or type 'rose vs luke' to open a head-to-head instantly.",
    category: "improved",
  },
  {
    id: "teams",
    date: "2026-10-06",
    title: "Teams & squads",
    description:
      "Browse team rosters and team-format task results on the dedicated teams page.",
    category: "improved",
  },
  {
    id: "head-to-head-compare",
    date: "2026-10-05",
    title: "Head-to-head compare",
    description:
      "Pit any two players against each other with a side-by-side stat breakdown on the new compare page.",
    category: "new",
  },
  {
    id: "crt-themes",
    date: "2026-10-05",
    title: "CRT phosphor themes",
    description:
      "Summon amber, cyan and magenta terminal themes from the command palette. Your choice sticks between visits.",
    category: "new",
  },
  {
    id: "weekly-recaps",
    date: "2026-10-05",
    title: "Weekly recaps",
    description:
      "Relive each week with highlight cards, awards and movers on the recaps page.",
    category: "new",
  },
  {
    id: "share-cards",
    date: "2026-10-05",
    title: "Shareable task cards",
    description:
      "Every task now has a share button and social preview image, so results look sharp when posted.",
    category: "improved",
  },
];

export function getChangelogById(id: string): FeatureUpdate | undefined {
  return changelog.find((entry) => entry.id === id);
}
