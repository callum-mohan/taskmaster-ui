CREATE TABLE "egg_gifts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "egg_gifts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" text NOT NULL,
	"crate_id" text NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"crate_open_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "egg_gifts_crate_open_id_unique" UNIQUE("crate_open_id")
);
--> statement-breakpoint
ALTER TABLE "egg_gifts" ADD CONSTRAINT "egg_gifts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "egg_gifts" ADD CONSTRAINT "egg_gifts_crate_open_id_crate_opens_id_fk" FOREIGN KEY ("crate_open_id") REFERENCES "public"."crate_opens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "egg_gifts_player_id_idx" ON "egg_gifts" USING btree ("player_id");