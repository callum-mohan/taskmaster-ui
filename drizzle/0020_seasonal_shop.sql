ALTER TYPE "public"."power_up_kind" ADD VALUE 'shield';--> statement-breakpoint
ALTER TYPE "public"."power_up_kind" ADD VALUE 'mirror';--> statement-breakpoint
ALTER TYPE "public"."power_up_kind" ADD VALUE 'insurance';--> statement-breakpoint
CREATE TABLE "coin_gifts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "coin_gifts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"season_id" text NOT NULL,
	"from_player_id" text NOT NULL,
	"to_player_id" text NOT NULL,
	"amount" integer NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coin_gifts_not_self" CHECK ("coin_gifts"."from_player_id" <> "coin_gifts"."to_player_id"),
	CONSTRAINT "coin_gifts_amount_positive" CHECK ("coin_gifts"."amount" > 0),
	CONSTRAINT "coin_gifts_message_length" CHECK ("coin_gifts"."message" is null or char_length("coin_gifts"."message") <= 80)
);
--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "crate_id" text;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "available_from" timestamp;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "available_until" timestamp;--> statement-breakpoint
ALTER TABLE "coin_gifts" ADD CONSTRAINT "coin_gifts_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_gifts" ADD CONSTRAINT "coin_gifts_from_player_season_fk" FOREIGN KEY ("from_player_id","season_id") REFERENCES "public"."players"("id","season_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_gifts" ADD CONSTRAINT "coin_gifts_to_player_season_fk" FOREIGN KEY ("to_player_id","season_id") REFERENCES "public"."players"("id","season_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coin_gifts_from_player_id_idx" ON "coin_gifts" USING btree ("from_player_id");--> statement-breakpoint
CREATE INDEX "coin_gifts_to_player_id_idx" ON "coin_gifts" USING btree ("to_player_id");--> statement-breakpoint
ALTER TABLE "power_up_uses" ADD CONSTRAINT "power_up_uses_active_effect" CHECK ("power_up_uses"."effect"::text not in ('shield', 'mirror', 'insurance'));--> statement-breakpoint
ALTER TABLE "shop_items" ADD CONSTRAINT "shop_items_crate_id_crate_only" CHECK ("shop_items"."crate_id" is null or "shop_items"."crate_only");--> statement-breakpoint
ALTER TABLE "shop_items" ADD CONSTRAINT "shop_items_sale_window_order" CHECK ("shop_items"."available_from" is null or "shop_items"."available_until" is null or "shop_items"."available_until" > "shop_items"."available_from");