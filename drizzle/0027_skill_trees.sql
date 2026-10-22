CREATE TABLE "skill_paths" (
	"player_id" text PRIMARY KEY NOT NULL,
	"path_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_paths_player_id_path_id_unique" UNIQUE("player_id","path_id")
);
--> statement-breakpoint
CREATE TABLE "skill_unlocks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "skill_unlocks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" text NOT NULL,
	"path_id" text NOT NULL,
	"node_id" text NOT NULL,
	"price" integer NOT NULL,
	"purchase_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_unlocks_purchase_id_unique" UNIQUE("purchase_id"),
	CONSTRAINT "skill_unlocks_player_id_node_id_unique" UNIQUE("player_id","node_id"),
	CONSTRAINT "skill_unlocks_price_positive" CHECK ("skill_unlocks"."price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "skill_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_paths" ADD CONSTRAINT "skill_paths_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_unlocks" ADD CONSTRAINT "skill_unlocks_purchase_id_coin_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."coin_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_unlocks" ADD CONSTRAINT "skill_unlocks_player_path_fk" FOREIGN KEY ("player_id","path_id") REFERENCES "public"."skill_paths"("player_id","path_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_items" ADD CONSTRAINT "shop_items_skill_only_not_crate_only" CHECK (not ("shop_items"."skill_only" and "shop_items"."crate_only"));--> statement-breakpoint
-- The skill tree rewards (`SKILL_REWARD_ITEMS` in `src/data/skill-trees.ts`):
-- skill-only cosmetics, never sold, granted by unlocking their node.
-- Re-runnable: existing ids are left alone.
INSERT INTO "shop_items" ("id", "name", "description", "category", "price", "cosmetic_kind", "cosmetic_value", "available", "skill_only", "sort_order") VALUES
	('skill-title-stormbrewer', 'Title: Stormbrewer', 'Stormbrewer skill tree title. Can''t be bought.', 'cosmetic', 0, 'title', 'Stormbrewer', true, true, 900),
	('skill-colour-storm', 'Storm Name', 'Stormbrewer capstone name colour. Can''t be bought.', 'cosmetic', 0, 'name_colour', 'storm', true, true, 901),
	('skill-title-elite-hacker', 'Title: Elite Hacker', 'Elite Hacker skill tree title. Can''t be bought.', 'cosmetic', 0, 'title', 'Elite Hacker', true, true, 902),
	('skill-colour-hacker', 'Hacker Name', 'Elite Hacker capstone name colour. Can''t be bought.', 'cosmetic', 0, 'name_colour', 'hacker', true, true, 903),
	('skill-title-friendkeeper', 'Title: Friendkeeper', 'Friendkeeper skill tree title. Can''t be bought.', 'cosmetic', 0, 'title', 'Friendkeeper', true, true, 904),
	('skill-colour-friendship', 'Friendship Name', 'Friendkeeper capstone name colour. Can''t be bought.', 'cosmetic', 0, 'name_colour', 'friendship', true, true, 905),
	('skill-title-overachiever', 'Title: Overachiever', 'Overachiever skill tree title. Can''t be bought.', 'cosmetic', 0, 'title', 'Overachiever', true, true, 906),
	('skill-colour-platinum', 'Platinum Name', 'Overachiever capstone name colour. Can''t be bought.', 'cosmetic', 0, 'name_colour', 'platinum', true, true, 907),
	('skill-title-cartographer', 'Title: Elephant Cartographer', 'Elephant Cartographer skill tree title. Can''t be bought.', 'cosmetic', 0, 'title', 'Elephant Cartographer', true, true, 908),
	('skill-colour-cartographer', 'Cartographer Name', 'Elephant Cartographer capstone name colour. Can''t be bought.', 'cosmetic', 0, 'name_colour', 'cartographer', true, true, 909)
ON CONFLICT ("id") DO NOTHING;
