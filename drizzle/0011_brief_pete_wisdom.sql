CREATE TABLE "price_checks" (
	"key" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"confidence" text,
	"query" text NOT NULL,
	"ml_price_cents" integer NOT NULL,
	"market_low_cents" integer,
	"market_store" text,
	"store_count" integer,
	"offers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_url" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "price_checks_checked_idx" ON "price_checks" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "items_product_idx" ON "items" USING btree ("product_id");