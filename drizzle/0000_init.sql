CREATE TYPE "public"."task_format" AS ENUM('individual', 'team');--> statement-breakpoint
CREATE TABLE "bonus_points" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bonus_points_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" text NOT NULL,
	"player_id" text NOT NULL,
	"points" integer NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bio" text,
	"avatar_url" text,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_scores" (
	"task_id" text NOT NULL,
	"player_id" text NOT NULL,
	"points" integer NOT NULL,
	"comment" text,
	CONSTRAINT "task_scores_task_id_player_id_pk" PRIMARY KEY("task_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"week_number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"brief" jsonb,
	"release_date" timestamp NOT NULL,
	"deadline" timestamp NOT NULL,
	"format" "task_format" DEFAULT 'individual' NOT NULL,
	CONSTRAINT "tasks_week_number_unique" UNIQUE("week_number"),
	CONSTRAINT "tasks_deadline_after_release" CHECK ("tasks"."deadline" > "tasks"."release_date")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" text NOT NULL,
	"player_id" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "team_members_team_id_player_id_pk" PRIMARY KEY("team_id","player_id"),
	CONSTRAINT "team_members_player_id_unique" UNIQUE("player_id")
);
--> statement-breakpoint
CREATE TABLE "team_scores" (
	"task_id" text NOT NULL,
	"team_id" text NOT NULL,
	"points" integer NOT NULL,
	CONSTRAINT "team_scores_task_id_team_id_pk" PRIMARY KEY("task_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bonus_points" ADD CONSTRAINT "bonus_points_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_points" ADD CONSTRAINT "bonus_points_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_scores" ADD CONSTRAINT "task_scores_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_scores" ADD CONSTRAINT "task_scores_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_scores" ADD CONSTRAINT "team_scores_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_scores" ADD CONSTRAINT "team_scores_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bonus_points_task_id_idx" ON "bonus_points" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "bonus_points_player_id_idx" ON "bonus_points" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "task_scores_player_id_idx" ON "task_scores" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "team_scores_team_id_idx" ON "team_scores" USING btree ("team_id");