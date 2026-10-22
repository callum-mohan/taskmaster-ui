CREATE TYPE "public"."wish_status" AS ENUM('pending', 'granted', 'declined');--> statement-breakpoint
ALTER TYPE "public"."power_up_kind" ADD VALUE 'wish';--> statement-breakpoint
CREATE TABLE "wishes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wishes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"purchase_id" integer NOT NULL,
	"player_id" text NOT NULL,
	"wish" text NOT NULL,
	"status" "wish_status" DEFAULT 'pending' NOT NULL,
	"response" text,
	"decider_id" text,
	"decider_name" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishes_purchase_id_unique" UNIQUE("purchase_id"),
	CONSTRAINT "wishes_wish_length" CHECK (char_length("wishes"."wish") between 1 and 200),
	CONSTRAINT "wishes_response_length" CHECK ("wishes"."response" is null or char_length("wishes"."response") <= 200),
	CONSTRAINT "wishes_decided_when_not_pending" CHECK (("wishes"."status" = 'pending') = ("wishes"."decided_at" is null))
);
--> statement-breakpoint
ALTER TABLE "power_up_uses" DROP CONSTRAINT "power_up_uses_active_effect";--> statement-breakpoint
ALTER TABLE "wishes" ADD CONSTRAINT "wishes_purchase_id_coin_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."coin_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishes" ADD CONSTRAINT "wishes_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wishes_player_id_idx" ON "wishes" USING btree ("player_id");--> statement-breakpoint
ALTER TABLE "power_up_uses" ADD CONSTRAINT "power_up_uses_active_effect" CHECK ("power_up_uses"."effect"::text not in ('shield', 'mirror', 'insurance', 'wish'));