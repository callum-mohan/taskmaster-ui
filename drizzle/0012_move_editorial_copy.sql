-- Moves the editorial copy that used to live in `src/data/changelog.ts` and
-- `src/data/recaps.ts` into the database, so admins can edit it without a
-- deploy. Re-runnable: existing rows are left alone, and recaps for tasks or
-- players that don't exist (e.g. a fresh database) are skipped.
INSERT INTO "changelog_entries" ("id", "date", "title", "description", "category")
VALUES
  ('live-results', '2026-10-18', 'Results night, live', 'The Taskmaster can now hold a week''s results back and reveal them one at a time on the new live page, last place first. Keep it open on results night: it updates by itself.', 'new'),
  ('peoples-choice', '2026-10-18', 'Reactions & People''s Choice', 'React to gallery entries with an emoji, and vote for your favourite entry each week (not your own). Voting runs for 3 days after the deadline, and the most-voted entry earns a People''s Choice bonus point.', 'new'),
  ('predictions', '2026-10-18', 'Call the winner', 'While a task is live, predict who''ll win it (or which squad, on team tasks). Picks stay secret until the deadline; call it right and you earn a bonus point once the results are in.', 'new'),
  ('task-submissions', '2026-10-16', 'Submit entries on the site', 'Tasks can now take entries right here: upload a photo or write a text entry from the task page (your squad shares entries on team tasks). Only you and the Taskmaster see them until the deadline, then every entry goes up in a gallery on the task page.', 'new'),
  ('personal-notifications', '2026-10-16', 'Results, rank & bonus alerts', 'Your notification bell now tells you when a week''s results are in (and where you finished), when you climb the leaderboard, when you''re given bonus points or a deduction, and when a live task has 24 hours left.', 'improved'),
  ('task-search', '2026-10-16', 'Task search & your results', 'Search the tasks page by title, week or winner, and share a filtered view: the status filter and search now live in the URL. Signed-in players also see their own finish on every completed task.', 'improved'),
  ('notifications', '2026-10-15', 'Notifications', 'Signed-in players now get a bell in the navbar that flags new tasks and polls since you last looked. Open it to catch up; your read state follows you across devices.', 'new'),
  ('polls', '2026-10-15', 'Homepage polls', 'The Taskmaster can now run polls on the homepage. Sign in with your player account to vote and earn a bonus point; depending on the poll, results show live, after you vote, or when it closes.', 'new'),
  ('bonus-points', '2026-10-13', 'Bonus points & deductions', 'The Taskmaster can now award bonus points or dock points in any week, with a reason. See them on player profiles and task pages — they count toward the overall leaderboard.', 'new'),
  ('command-palette', '2026-10-06', 'Command palette', 'Press ⌘K / Ctrl+K anywhere to jump to any player, task or team — or type ''rose vs luke'' to open a head-to-head instantly.', 'improved'),
  ('teams', '2026-10-06', 'Teams & squads', 'Browse team rosters and team-format task results on the dedicated teams page.', 'improved'),
  ('head-to-head-compare', '2026-10-05', 'Head-to-head compare', 'Pit any two players against each other with a side-by-side stat breakdown on the new compare page.', 'new'),
  ('crt-themes', '2026-10-05', 'CRT phosphor themes', 'Summon amber, cyan and magenta terminal themes from the command palette. Your choice sticks between visits.', 'new'),
  ('weekly-recaps', '2026-10-05', 'Weekly recaps', 'Relive each week with highlight cards, awards and movers on the recaps page.', 'new'),
  ('share-cards', '2026-10-05', 'Shareable task cards', 'Every task now has a share button and social preview image, so results look sharp when posted.', 'improved')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "recaps" ("task_id", "headline", "summary", "moment", "moment_player_id", "quote_text", "quote_attribution")
SELECT t."id", 'Rose keeps it together while the academy cracks up', 'The opening brief looked gentle — keep an egg alive for seven days — and promptly produced carnage. A third of the roster scored a clean zero, several admitting their charge did not survive the first commute. Rose turned the challenge into performance art and ran away with a perfect 10, with Karen close behind. A nervy, shell-shocked start to the competition.', 'Connor running away with a bag, yet there was no egg inside.',
  (SELECT p."id" FROM "players" AS p WHERE p."id" = 'connor'),
  NULL, NULL
FROM "tasks" AS t
WHERE t."id" = 'week-01'
ON CONFLICT ("task_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "recaps" ("task_id", "headline", "summary", "moment", "moment_player_id", "quote_text", "quote_attribution")
SELECT t."id", 'Eva draws first blood on the map', 'With the cartography brief, the field finally found its feet. Eva posted the week''s standout score of 13 to vault to the top of the table with a convincing horse (or possible yorkshire terrier), overturning Rose''s early lead. Finnbar and Eve bounced back from egg-based tragedy with a tidy 8 apiece, and the midfield bunched up as nearly everyone banked points. The title race has a new frontrunner.', 'Luke basing his Strava routes off photos taken in his first few weeks of the academy with a very fitting presentation.',
  (SELECT p."id" FROM "players" AS p WHERE p."id" = 'luke'),
  NULL, NULL
FROM "tasks" AS t
WHERE t."id" = 'week-02'
ON CONFLICT ("task_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "recaps" ("task_id", "headline", "summary", "moment", "moment_player_id", "quote_text", "quote_attribution")
SELECT t."id", 'Rose strikes twice — the week and the overall lead', 'The Assassin brief turned the academy on itself, and Rose was the deadliest operative in the building. Survival, her initial mission and two extra eliminations added up to a competition-high 14 — enough to win the week outright and, finally, overthrow Eva to take the overall lead for the first time. Caolan D and Andrew shared second on 12, Andrew''s haul dragging him off the foot of the table in the week''s biggest climb. Eve, John, Sophia and Amelia tied the midfield in blood on 10 apiece. A savage, paranoid week where turning your back cost you.', 'Erin going full Sherlock Holmes to track down her mark for a detective''s bonus.',
  (SELECT p."id" FROM "players" AS p WHERE p."id" = 'erin'),
  NULL, NULL
FROM "tasks" AS t
WHERE t."id" = 'week-03'
ON CONFLICT ("task_id") DO NOTHING;
