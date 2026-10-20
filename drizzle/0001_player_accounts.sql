CREATE TABLE "player_accounts" (
	"player_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "player_accounts_email_unique" UNIQUE("email"),
	CONSTRAINT "player_accounts_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "player_accounts_email_lower" CHECK ("player_accounts"."email" = lower("player_accounts"."email"))
);
--> statement-breakpoint
ALTER TABLE "player_accounts" ADD CONSTRAINT "player_accounts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;