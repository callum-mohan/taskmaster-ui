import type { FeatureUpdate, WeekRecapContent } from "../types";
import type { changelogEntries, recaps } from "../db/schema";

// Editorial copy written in the admin area: the weekly recap colour and the
// site changelog. Rows → `src/types` shapes, leaving out empty fields.

type RecapRow = typeof recaps.$inferSelect;
type ChangelogRow = typeof changelogEntries.$inferSelect;

export function mapRecap(row: RecapRow): WeekRecapContent {
  return {
    ...(row.headline !== null && { headline: row.headline }),
    ...(row.summary !== null && { summary: row.summary }),
    ...(row.moment !== null && { moment: row.moment }),
    ...(row.momentPlayerId !== null && { momentPlayerId: row.momentPlayerId }),
    ...(row.quoteText !== null && {
      quote: {
        text: row.quoteText,
        ...(row.quoteAttribution !== null && {
          attribution: row.quoteAttribution,
        }),
      },
    }),
  };
}

/** Recap copy keyed by task id. */
export function mapRecaps(rows: RecapRow[]): Record<string, WeekRecapContent> {
  return Object.fromEntries(rows.map((row) => [row.taskId, mapRecap(row)]));
}

/** Changelog rows → entries, newest first (ties keep the newest row first). */
export function mapChangelog(rows: ChangelogRow[]): FeatureUpdate[] {
  return [...rows]
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    )
    .map((row) => ({
      id: row.id,
      date: row.date,
      title: row.title,
      description: row.description,
      category: row.category,
    }));
}
