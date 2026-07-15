ALTER TABLE "event_listener_delivery" DROP CONSTRAINT "event_listener_delivery_listener_id_repository_event_listener_id_fk";
--> statement-breakpoint
ALTER TABLE "event_listener_delivery" ALTER COLUMN "listener_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "event_listener_delivery" ADD COLUMN "listener_user_id" integer;--> statement-breakpoint
ALTER TABLE "event_listener_delivery" ADD COLUMN "listener_name" text;--> statement-breakpoint
UPDATE "event_listener_delivery" AS "delivery"
SET
	"listener_user_id" = "listener"."user_id",
	"listener_name" = "listener"."name"
FROM "repository_event_listener" AS "listener"
WHERE "delivery"."listener_id" = "listener"."id"
	AND ("delivery"."listener_user_id" IS NULL OR "delivery"."listener_name" IS NULL);--> statement-breakpoint
ALTER TABLE "event_listener_delivery" ALTER COLUMN "listener_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "event_listener_delivery" ALTER COLUMN "listener_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "event_listener_delivery" ADD CONSTRAINT "event_listener_delivery_listener_user_id_user_id_fk" FOREIGN KEY ("listener_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_listener_delivery" ADD CONSTRAINT "event_listener_delivery_listener_id_repository_event_listener_id_fk" FOREIGN KEY ("listener_id") REFERENCES "public"."repository_event_listener"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_listener_delivery_listener_user_idx" ON "event_listener_delivery" USING btree ("listener_user_id");--> statement-breakpoint
ALTER TABLE "event_listener_delivery" ADD CONSTRAINT "event_listener_delivery_listener_name_not_blank_check" CHECK (length(trim("event_listener_delivery"."listener_name")) > 0);
