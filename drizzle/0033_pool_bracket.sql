CREATE TABLE "pool_bracket_entries" (
	"bracket_id" integer NOT NULL,
	"slot" integer NOT NULL,
	"team_id" text NOT NULL,
	CONSTRAINT "pool_bracket_entries_bracket_id_slot_pk" PRIMARY KEY("bracket_id","slot"),
	CONSTRAINT "pool_bracket_entries_bracket_id_team_id_unique" UNIQUE("bracket_id","team_id"),
	CONSTRAINT "pool_bracket_entries_slot_range" CHECK ("pool_bracket_entries"."slot" between 0 and 15)
);
--> statement-breakpoint
CREATE TABLE "pool_brackets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pool_brackets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"season_id" text NOT NULL,
	"week_number" integer NOT NULL,
	"reveal_at" timestamp NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_brackets_season_id_week_number_unique" UNIQUE("season_id","week_number"),
	CONSTRAINT "pool_brackets_week_number_positive" CHECK ("pool_brackets"."week_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "pool_match_reports" (
	"bracket_id" integer NOT NULL,
	"round" integer NOT NULL,
	"match_index" integer NOT NULL,
	"team_id" text NOT NULL,
	"winner_team_id" text NOT NULL,
	"player_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_match_reports_bracket_id_round_match_index_team_id_pk" PRIMARY KEY("bracket_id","round","match_index","team_id")
);
--> statement-breakpoint
CREATE TABLE "pool_match_results" (
	"bracket_id" integer NOT NULL,
	"round" integer NOT NULL,
	"match_index" integer NOT NULL,
	"winner_team_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_match_results_bracket_id_round_match_index_pk" PRIMARY KEY("bracket_id","round","match_index"),
	CONSTRAINT "pool_match_results_position_range" CHECK ("pool_match_results"."round" >= 0 and "pool_match_results"."match_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pool_team_members" (
	"team_id" text NOT NULL,
	"player_id" text NOT NULL,
	"season_id" text NOT NULL,
	CONSTRAINT "pool_team_members_team_id_player_id_pk" PRIMARY KEY("team_id","player_id"),
	CONSTRAINT "pool_team_members_player_id_unique" UNIQUE("player_id")
);
--> statement-breakpoint
CREATE TABLE "pool_teams" (
	"id" text PRIMARY KEY NOT NULL,
	"season_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_teams_id_season_id_unique" UNIQUE("id","season_id")
);
--> statement-breakpoint
ALTER TABLE "pool_bracket_entries" ADD CONSTRAINT "pool_bracket_entries_bracket_id_pool_brackets_id_fk" FOREIGN KEY ("bracket_id") REFERENCES "public"."pool_brackets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_bracket_entries" ADD CONSTRAINT "pool_bracket_entries_team_id_pool_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."pool_teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_brackets" ADD CONSTRAINT "pool_brackets_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_match_reports" ADD CONSTRAINT "pool_match_reports_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_match_reports" ADD CONSTRAINT "pool_match_reports_team_entry_fk" FOREIGN KEY ("bracket_id","team_id") REFERENCES "public"."pool_bracket_entries"("bracket_id","team_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_match_reports" ADD CONSTRAINT "pool_match_reports_winner_entry_fk" FOREIGN KEY ("bracket_id","winner_team_id") REFERENCES "public"."pool_bracket_entries"("bracket_id","team_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_match_results" ADD CONSTRAINT "pool_match_results_entry_fk" FOREIGN KEY ("bracket_id","winner_team_id") REFERENCES "public"."pool_bracket_entries"("bracket_id","team_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_team_members" ADD CONSTRAINT "pool_team_members_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_team_members" ADD CONSTRAINT "pool_team_members_team_season_fk" FOREIGN KEY ("team_id","season_id") REFERENCES "public"."pool_teams"("id","season_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_team_members" ADD CONSTRAINT "pool_team_members_player_season_fk" FOREIGN KEY ("player_id","season_id") REFERENCES "public"."players"("id","season_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_teams" ADD CONSTRAINT "pool_teams_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pool_bracket_entries_team_id_idx" ON "pool_bracket_entries" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "pool_match_reports_player_id_idx" ON "pool_match_reports" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "pool_teams_season_id_idx" ON "pool_teams" USING btree ("season_id");