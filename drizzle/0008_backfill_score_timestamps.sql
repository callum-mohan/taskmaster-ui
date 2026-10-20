-- Rows recorded before scores carried timestamps get their task's deadline
-- (a UK wall-clock time) as the best guess, capped at now. Without this they
-- would all read as recorded at migration time and every past week's results
-- would resurface as new notifications.
UPDATE "task_scores" AS s
SET "created_at" = LEAST(t."deadline" AT TIME ZONE 'Europe/London', now()),
    "updated_at" = LEAST(t."deadline" AT TIME ZONE 'Europe/London', now())
FROM "tasks" AS t
WHERE t."id" = s."task_id";--> statement-breakpoint
UPDATE "team_scores" AS s
SET "created_at" = LEAST(t."deadline" AT TIME ZONE 'Europe/London', now()),
    "updated_at" = LEAST(t."deadline" AT TIME ZONE 'Europe/London', now())
FROM "tasks" AS t
WHERE t."id" = s."task_id";--> statement-breakpoint
UPDATE "bonus_points" AS b
SET "created_at" = LEAST(t."deadline" AT TIME ZONE 'Europe/London', now()),
    "updated_at" = LEAST(t."deadline" AT TIME ZONE 'Europe/London', now())
FROM "tasks" AS t
WHERE t."id" = b."task_id";
