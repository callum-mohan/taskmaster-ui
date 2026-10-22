CREATE TABLE "item_gifts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "item_gifts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" text NOT NULL,
	"item_id" text NOT NULL,
	"purchase_id" integer NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_gifts_purchase_id_unique" UNIQUE("purchase_id")
);
--> statement-breakpoint
ALTER TABLE "item_gifts" ADD CONSTRAINT "item_gifts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_gifts" ADD CONSTRAINT "item_gifts_item_id_shop_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_gifts" ADD CONSTRAINT "item_gifts_purchase_id_coin_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."coin_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_gifts_player_id_idx" ON "item_gifts" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "item_gifts_item_id_idx" ON "item_gifts" USING btree ("item_id");