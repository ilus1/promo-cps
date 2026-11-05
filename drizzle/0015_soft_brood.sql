CREATE TABLE "crawler_state" (
	"site" text PRIMARY KEY NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"backoff_level" integer DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone,
	"day_key" text,
	"pages_today" integer DEFAULT 0 NOT NULL,
	"last_page_at" timestamp with time zone,
	"pass_started_at" timestamp with time zone,
	"bestsellers_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_offers" (
	"key" text PRIMARY KEY NOT NULL,
	"retailer" text NOT NULL,
	"listing_id" text NOT NULL,
	"title" text NOT NULL,
	"brand" text,
	"seller" text,
	"price_cents" integer NOT NULL,
	"list_price_cents" integer,
	"regular_price_cents" integer,
	"price_until" timestamp with time zone,
	"in_stock" boolean NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"tokens" text[] NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_searches" (
	"key" text PRIMARY KEY NOT NULL,
	"query" text NOT NULL,
	"searched_at" timestamp with time zone,
	"status" text,
	"result_count" integer,
	"priority_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "market_offers_tokens_idx" ON "market_offers" USING gin ("tokens") WITH (fastupdate=false);--> statement-breakpoint
CREATE INDEX "market_offers_retailer_seen_idx" ON "market_offers" USING btree ("retailer","last_seen_at");--> statement-breakpoint
CREATE INDEX "market_offers_seen_idx" ON "market_offers" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "market_searches_searched_idx" ON "market_searches" USING btree ("searched_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_check_key_idx" ON "items" USING btree ((coalesce("product_id", 'item:' || "id")));