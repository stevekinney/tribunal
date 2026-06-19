DROP INDEX "review_intent_delivery_kind_user_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "review_intent_delivery_kind_user_repository_pr_idx" ON "review_intent" USING btree ("delivery_id","kind","user_id","repository_id","pr_number");
