CREATE TABLE "seasons" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "season_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "season_id" text;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "season_id" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "season_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_one_current_idx" ON "seasons" USING btree ("is_current") WHERE "seasons"."is_current";--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;