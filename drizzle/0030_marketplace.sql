CREATE TYPE "public"."market_listing_status" AS ENUM('open', 'sold', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."market_offer_status" AS ENUM('pending', 'accepted', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TABLE "market_listings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "market_listings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"season_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"purchase_id" integer NOT NULL,
	"item_id" text NOT NULL,
	"price" integer NOT NULL,
	"status" "market_listing_status" DEFAULT 'open' NOT NULL,
	"cancelled_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "market_listings_price_range" CHECK ("market_listings"."price" between 1 and 30000),
	CONSTRAINT "market_listings_closed_when_not_open" CHECK (("market_listings"."status" = 'open') = ("market_listings"."closed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "market_offers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "market_offers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"listing_id" integer NOT NULL,
	"buyer_id" text NOT NULL,
	"amount" integer NOT NULL,
	"status" "market_offer_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "market_offers_amount_positive" CHECK ("market_offers"."amount" > 0),
	CONSTRAINT "market_offers_decided_when_not_pending" CHECK (("market_offers"."status" = 'pending') = ("market_offers"."decided_at" is null))
);
--> statement-breakpoint
CREATE TABLE "market_sales" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "market_sales_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"season_id" text NOT NULL,
	"listing_id" integer NOT NULL,
	"seller_id" text NOT NULL,
	"buyer_id" text NOT NULL,
	"item_id" text NOT NULL,
	"price" integer NOT NULL,
	"source_purchase_id" integer NOT NULL,
	"buyer_purchase_id" integer NOT NULL,
	"offer_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_sales_listing_id_unique" UNIQUE("listing_id"),
	CONSTRAINT "market_sales_source_purchase_id_unique" UNIQUE("source_purchase_id"),
	CONSTRAINT "market_sales_buyer_purchase_id_unique" UNIQUE("buyer_purchase_id"),
	CONSTRAINT "market_sales_not_self" CHECK ("market_sales"."seller_id" <> "market_sales"."buyer_id"),
	CONSTRAINT "market_sales_price_positive" CHECK ("market_sales"."price" > 0)
);
--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_purchase_id_coin_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."coin_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_item_id_shop_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_seller_season_fk" FOREIGN KEY ("seller_id","season_id") REFERENCES "public"."players"("id","season_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_offers" ADD CONSTRAINT "market_offers_listing_id_market_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."market_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_offers" ADD CONSTRAINT "market_offers_buyer_id_players_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_sales" ADD CONSTRAINT "market_sales_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_sales" ADD CONSTRAINT "market_sales_listing_id_market_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."market_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_sales" ADD CONSTRAINT "market_sales_item_id_shop_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_sales" ADD CONSTRAINT "market_sales_source_purchase_id_coin_purchases_id_fk" FOREIGN KEY ("source_purchase_id") REFERENCES "public"."coin_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_sales" ADD CONSTRAINT "market_sales_buyer_purchase_id_coin_purchases_id_fk" FOREIGN KEY ("buyer_purchase_id") REFERENCES "public"."coin_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_sales" ADD CONSTRAINT "market_sales_offer_id_market_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."market_offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_sales" ADD CONSTRAINT "market_sales_seller_season_fk" FOREIGN KEY ("seller_id","season_id") REFERENCES "public"."players"("id","season_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_sales" ADD CONSTRAINT "market_sales_buyer_season_fk" FOREIGN KEY ("buyer_id","season_id") REFERENCES "public"."players"("id","season_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "market_listings_one_open_per_purchase_idx" ON "market_listings" USING btree ("purchase_id") WHERE "market_listings"."status" = 'open';--> statement-breakpoint
CREATE INDEX "market_listings_seller_id_idx" ON "market_listings" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "market_listings_item_id_idx" ON "market_listings" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_offers_one_pending_per_buyer_idx" ON "market_offers" USING btree ("listing_id","buyer_id") WHERE "market_offers"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "market_offers_buyer_id_idx" ON "market_offers" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "market_sales_seller_id_idx" ON "market_sales" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "market_sales_buyer_id_idx" ON "market_sales" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "market_sales_item_id_idx" ON "market_sales" USING btree ("item_id");