ALTER TABLE "tasks" DROP CONSTRAINT "tasks_week_number_unique";--> statement-breakpoint
ALTER TABLE "players" ALTER COLUMN "season_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "season_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "season_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "season_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "players_season_id_idx" ON "players" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "teams_season_id_idx" ON "teams" USING btree ("season_id");--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_id_season_id_unique" UNIQUE("id","season_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_season_id_week_number_unique" UNIQUE("season_id","week_number");--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_id_season_id_unique" UNIQUE("id","season_id");