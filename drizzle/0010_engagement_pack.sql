CREATE TYPE "public"."feature_category" AS ENUM('new', 'improved', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."reaction_kind" AS ENUM('laugh', 'fire', 'clap', 'mind_blown', 'egg');--> statement-breakpoint
CREATE TABLE "changelog_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" "feature_category" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"task_id" text NOT NULL,
	"player_id" text NOT NULL,
	"picked_player_id" text,
	"picked_team_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "predictions_task_id_player_id_pk" PRIMARY KEY("task_id","player_id"),
	CONSTRAINT "predictions_one_pick" CHECK (num_nonnulls("predictions"."picked_player_id", "predictions"."picked_team_id") = 1),
	CONSTRAINT "predictions_not_self" CHECK ("predictions"."picked_player_id" is distinct from "predictions"."player_id")
);
--> statement-breakpoint
CREATE TABLE "recaps" (
	"task_id" text PRIMARY KEY NOT NULL,
	"headline" text,
	"summary" text,
	"moment" text,
	"moment_player_id" text,
	"quote_text" text,
	"quote_attribution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_reactions" (
	"submission_id" integer NOT NULL,
	"player_id" text NOT NULL,
	"kind" "reaction_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_reactions_submission_id_player_id_kind_pk" PRIMARY KEY("submission_id","player_id","kind")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "results_held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "results_reveal_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "results_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_picked_player_id_players_id_fk" FOREIGN KEY ("picked_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_picked_team_id_teams_id_fk" FOREIGN KEY ("picked_team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recaps" ADD CONSTRAINT "recaps_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recaps" ADD CONSTRAINT "recaps_moment_player_id_players_id_fk" FOREIGN KEY ("moment_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_reactions" ADD CONSTRAINT "submission_reactions_submission_id_task_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."task_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_reactions" ADD CONSTRAINT "submission_reactions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "changelog_entries_date_idx" ON "changelog_entries" USING btree ("date");--> statement-breakpoint
CREATE INDEX "predictions_player_id_idx" ON "predictions" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "predictions_picked_player_id_idx" ON "predictions" USING btree ("picked_player_id");--> statement-breakpoint
CREATE INDEX "predictions_picked_team_id_idx" ON "predictions" USING btree ("picked_team_id");--> statement-breakpoint
CREATE INDEX "submission_reactions_player_id_idx" ON "submission_reactions" USING btree ("player_id");--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_id_task_id_unique" UNIQUE("id","task_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_results_reveal_count_positive" CHECK ("tasks"."results_reveal_count" >= 0);