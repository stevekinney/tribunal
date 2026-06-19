DROP INDEX "review_intent_delivery_kind_repository_pr_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "review_intent_delivery_kind_idx" ON "review_intent" USING btree ("delivery_id","kind");