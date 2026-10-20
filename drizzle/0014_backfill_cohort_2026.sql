-- Everything recorded before seasons existed belongs to the first cohort,
-- which becomes the current season. Re-runnable: the season is only created
-- once and only rows without a season are touched.
INSERT INTO "seasons" ("id", "name", "is_current")
SELECT 'cohort-2026', 'Cohort 2026', NOT EXISTS (SELECT 1 FROM "seasons" WHERE "is_current")
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "players" SET "season_id" = 'cohort-2026' WHERE "season_id" IS NULL;--> statement-breakpoint
UPDATE "teams" SET "season_id" = 'cohort-2026' WHERE "season_id" IS NULL;--> statement-breakpoint
UPDATE "tasks" SET "season_id" = 'cohort-2026' WHERE "season_id" IS NULL;--> statement-breakpoint
UPDATE "team_members" SET "season_id" = 'cohort-2026' WHERE "season_id" IS NULL;--> statement-breakpoint
INSERT INTO "changelog_entries" ("id", "date", "title", "description", "category")
VALUES
  ('seasons-hall-of-fame', '2026-10-20', 'Seasons & the Hall of Fame', 'The competition now runs in seasons, starting with Cohort 2026. When a season ends its champion, podium, winning squad and awards go up in the new Hall of Fame, alongside all-time records, and every past season keeps its own page.', 'new')
ON CONFLICT ("id") DO NOTHING;
