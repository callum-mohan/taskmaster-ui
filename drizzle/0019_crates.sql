CREATE TABLE "crate_opens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "crate_opens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" text NOT NULL,
	"crate_id" text NOT NULL,
	"price" integer NOT NULL,
	"item_id" text NOT NULL,
	"rarity" text NOT NULL,
	"purchase_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crate_opens_purchase_id_unique" UNIQUE("purchase_id"),
	CONSTRAINT "crate_opens_price_positive" CHECK ("crate_opens"."price" >= 0),
	CONSTRAINT "crate_opens_rarity_known" CHECK ("crate_opens"."rarity" in ('common', 'rare', 'epic', 'legendary'))
);
--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "crate_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crate_opens" ADD CONSTRAINT "crate_opens_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crate_opens" ADD CONSTRAINT "crate_opens_item_id_shop_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crate_opens" ADD CONSTRAINT "crate_opens_purchase_id_coin_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."coin_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crate_opens_player_id_idx" ON "crate_opens" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "crate_opens_item_id_idx" ON "crate_opens" USING btree ("item_id");--> statement-breakpoint
ALTER TABLE "shop_items" ADD CONSTRAINT "shop_items_crate_only_droppable" CHECK (not ("shop_items"."crate_only" and "shop_items"."category" = 'power_up'));