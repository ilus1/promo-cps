CREATE TABLE "listing_price_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	"final_cents" integer NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watch_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"price_cents" integer NOT NULL,
	"listing_id" uuid,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watched_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"retailer" text NOT NULL,
	"merchant" text DEFAULT '' NOT NULL,
	"merchant_key" text DEFAULT '' NOT NULL,
	"ref" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"match" text NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"price_cents" integer,
	"list_price_cents" integer,
	"final_cents" integer,
	"in_stock" boolean,
	"checked_at" timestamp with time zone,
	"unavailable_since" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watched_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"ean" text,
	"ean_source" text,
	"target_price_cents" integer,
	"drop_percent" integer DEFAULT 10 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "listing_price_segments" ADD CONSTRAINT "listing_price_segments_listing_id_watched_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."watched_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_alerts" ADD CONSTRAINT "watch_alerts_product_id_watched_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."watched_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_alerts" ADD CONSTRAINT "watch_alerts_listing_id_watched_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."watched_listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watched_listings" ADD CONSTRAINT "watched_listings_product_id_watched_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."watched_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_segments_listing_idx" ON "listing_price_segments" USING btree ("listing_id","last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watch_alerts_once_idx" ON "watch_alerts" USING btree ("product_id","kind","price_cents");--> statement-breakpoint
CREATE UNIQUE INDEX "watched_listings_key_idx" ON "watched_listings" USING btree ("product_id","retailer","ref","merchant_key");--> statement-breakpoint
CREATE UNIQUE INDEX "watched_listings_live_idx" ON "watched_listings" USING btree ("product_id","retailer","merchant_key") WHERE "watched_listings"."removed" = false;--> statement-breakpoint
CREATE INDEX "watched_listings_due_idx" ON "watched_listings" USING btree ("retailer","checked_at");--> statement-breakpoint
CREATE INDEX "watched_products_active_resolved_idx" ON "watched_products" USING btree ("active","resolved_at");