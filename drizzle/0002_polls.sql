CREATE TYPE "public"."poll_kind" AS ENUM('single', 'multiple');--> statement-breakpoint
CREATE TYPE "public"."poll_results_visibility" AS ENUM('always', 'after_vote', 'after_close', 'admin_only');--> statement-breakpoint
CREATE TABLE "poll_options" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "poll_options_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"poll_id" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "poll_options_id_poll_id_unique" UNIQUE("id","poll_id")
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"poll_id" text NOT NULL,
	"option_id" integer NOT NULL,
	"player_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_option_id_player_id_pk" PRIMARY KEY("option_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" text PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"description" text,
	"kind" "poll_kind" DEFAULT 'single' NOT NULL,
	"min_choices" integer DEFAULT 1 NOT NULL,
	"max_choices" integer,
	"opens_at" timestamp NOT NULL,
	"closes_at" timestamp NOT NULL,
	"results_visibility" "poll_results_visibility" DEFAULT 'after_vote' NOT NULL,
	"allow_vote_change" boolean DEFAULT true NOT NULL,
	"anonymous" boolean DEFAULT true NOT NULL,
	"show_on_home_days" integer DEFAULT 3 NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "polls_closes_after_opens" CHECK ("polls"."closes_at" > "polls"."opens_at"),
	CONSTRAINT "polls_min_choices_positive" CHECK ("polls"."min_choices" >= 1),
	CONSTRAINT "polls_max_choices_at_least_min" CHECK ("polls"."max_choices" is null or "polls"."max_choices" >= "polls"."min_choices"),
	CONSTRAINT "polls_show_on_home_days_range" CHECK ("polls"."show_on_home_days" >= 0)
);
--> statement-breakpoint
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_option_fk" FOREIGN KEY ("option_id","poll_id") REFERENCES "public"."poll_options"("id","poll_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "poll_options_poll_id_idx" ON "poll_options" USING btree ("poll_id");--> statement-breakpoint
CREATE INDEX "poll_votes_poll_id_player_id_idx" ON "poll_votes" USING btree ("poll_id","player_id");--> statement-breakpoint
CREATE INDEX "poll_votes_player_id_idx" ON "poll_votes" USING btree ("player_id");