UPDATE "items" SET "seen_price_cents" = "price_cents" WHERE "status" IN ('SEEN', 'SAVED') AND "seen_price_cents" IS NULL;
