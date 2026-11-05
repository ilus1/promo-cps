ALTER TABLE "items" ADD COLUMN "coupon_hint_percent" numeric;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "coupon_hint_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "coupon_hint_price_after_cents" integer;