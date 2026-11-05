CREATE TABLE "alert_hits" (
	"alert_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"price_cents" integer NOT NULL,
	"alerted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_hits_alert_id_item_id_pk" PRIMARY KEY("alert_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"campaign_id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"percent_off" numeric,
	"amount_off_cents" integer,
	"min_payment_cents" integer,
	"cap_cents" integer,
	"scope_label" text,
	"is_store" boolean NOT NULL,
	"status" text NOT NULL,
	"activation_type" text,
	"activate_code" text,
	"listing_url" text,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"raw" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"activation_tried_at" timestamp with time zone,
	"activation_error" text,
	"last_discovered_at" timestamp with time zone,
	"discovery_tried_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "item_sources" (
	"item_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_sources_item_id_source_type_source_id_pk" PRIMARY KEY("item_id","source_type","source_id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text,
	"title" text NOT NULL,
	"thumbnail" text,
	"url" text,
	"category_id" text,
	"domain_id" text,
	"seller_label" text,
	"price_cents" integer NOT NULL,
	"basis" text NOT NULL,
	"basis_text" text,
	"list_price_cents" integer,
	"ml_discount_pct" integer,
	"sold_quantity" integer,
	"full" boolean,
	"free_shipping" boolean,
	"observed_at" timestamp with time zone NOT NULL,
	"drop_ratio" double precision,
	"status" text DEFAULT 'NOT_SEEN' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"price_cents" integer NOT NULL,
	"basis" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text,
	"pages" integer DEFAULT 0 NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"run_every_hours" integer DEFAULT 3 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_hits" ADD CONSTRAINT "alert_hits_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_hits" ADD CONSTRAINT "alert_hits_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_sources" ADD CONSTRAINT "item_sources_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_segments" ADD CONSTRAINT "price_segments_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sources_source_idx" ON "item_sources" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "items_observed_idx" ON "items" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "items_discount_idx" ON "items" USING btree ("ml_discount_pct" DESC NULLS LAST,"observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "items_first_seen_idx" ON "items" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "segments_item_idx" ON "price_segments" USING btree ("item_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "runs_kind_started_idx" ON "runs" USING btree ("kind","started_at");