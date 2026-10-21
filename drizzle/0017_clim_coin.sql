CREATE TYPE "public"."cosmetic_kind" AS ENUM('title', 'name_colour', 'theme');--> statement-breakpoint
CREATE TYPE "public"."loadout_slot" AS ENUM('pet', 'avatar', 'title', 'name_colour', 'theme');--> statement-breakpoint
CREATE TYPE "public"."power_up_kind" AS ENUM('double_down', 'hint', 'golden_week', 'sabotage');--> statement-breakpoint
CREATE TYPE "public"."shop_category" AS ENUM('pet', 'avatar', 'cosmetic', 'power_up');--> statement-breakpoint
CREATE TABLE "coin_adjustments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "coin_adjustments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coin_adjustments_amount_range" CHECK ("coin_adjustments"."amount" <> 0 and "coin_adjustments"."amount" between -10000 and 10000)
);
--> statement-breakpoint
CREATE TABLE "coin_purchases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "coin_purchases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" text NOT NULL,
	"item_id" text NOT NULL,
	"price" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coin_purchases_price_positive" CHECK ("coin_purchases"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "equipped_items" (
	"player_id" text NOT NULL,
	"slot" "loadout_slot" NOT NULL,
	"item_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipped_items_player_id_slot_pk" PRIMARY KEY("player_id","slot")
);
--> statement-breakpoint
CREATE TABLE "power_up_uses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "power_up_uses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"purchase_id" integer NOT NULL,
	"player_id" text NOT NULL,
	"task_id" text NOT NULL,
	"effect" "power_up_kind" NOT NULL,
	"target_player_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "power_up_uses_purchase_id_unique" UNIQUE("purchase_id"),
	CONSTRAINT "power_up_uses_player_id_task_id_unique" UNIQUE("player_id","task_id"),
	CONSTRAINT "power_up_uses_target_when_sabotage" CHECK (("power_up_uses"."effect" = 'sabotage') = ("power_up_uses"."target_player_id" is not null)),
	CONSTRAINT "power_up_uses_not_self" CHECK ("power_up_uses"."target_player_id" is distinct from "power_up_uses"."player_id")
);
--> statement-breakpoint
CREATE TABLE "shop_items" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" "shop_category" NOT NULL,
	"price" integer NOT NULL,
	"image_url" text,
	"cosmetic_kind" "cosmetic_kind",
	"cosmetic_value" text,
	"power_up" "power_up_kind",
	"available" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_items_price_range" CHECK ("shop_items"."price" between 0 and 10000),
	CONSTRAINT "shop_items_image_when_visual" CHECK ("shop_items"."category" not in ('pet', 'avatar') or "shop_items"."image_url" is not null),
	CONSTRAINT "shop_items_cosmetic_fields" CHECK (("shop_items"."category" = 'cosmetic') = ("shop_items"."cosmetic_kind" is not null and "shop_items"."cosmetic_value" is not null)),
	CONSTRAINT "shop_items_power_up_field" CHECK (("shop_items"."category" = 'power_up') = ("shop_items"."power_up" is not null))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "hint" text;--> statement-breakpoint
ALTER TABLE "coin_adjustments" ADD CONSTRAINT "coin_adjustments_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_purchases" ADD CONSTRAINT "coin_purchases_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_purchases" ADD CONSTRAINT "coin_purchases_item_id_shop_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipped_items" ADD CONSTRAINT "equipped_items_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipped_items" ADD CONSTRAINT "equipped_items_item_id_shop_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_up_uses" ADD CONSTRAINT "power_up_uses_purchase_id_coin_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."coin_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_up_uses" ADD CONSTRAINT "power_up_uses_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_up_uses" ADD CONSTRAINT "power_up_uses_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_up_uses" ADD CONSTRAINT "power_up_uses_target_player_id_players_id_fk" FOREIGN KEY ("target_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coin_adjustments_player_id_idx" ON "coin_adjustments" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "coin_purchases_player_id_idx" ON "coin_purchases" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "coin_purchases_item_id_idx" ON "coin_purchases" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "equipped_items_item_id_idx" ON "equipped_items" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "power_up_uses_one_sabotage_per_target_idx" ON "power_up_uses" USING btree ("task_id","target_player_id") WHERE "power_up_uses"."effect" = 'sabotage';--> statement-breakpoint
CREATE INDEX "power_up_uses_task_id_idx" ON "power_up_uses" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "power_up_uses_target_player_id_idx" ON "power_up_uses" USING btree ("target_player_id");