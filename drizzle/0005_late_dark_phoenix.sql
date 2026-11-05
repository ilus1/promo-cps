CREATE UNIQUE INDEX "alerts_query_unique" ON "alerts" USING btree ("query");--> statement-breakpoint
CREATE UNIQUE INDEX "searches_url_unique" ON "searches" USING btree ("url");