CREATE TABLE IF NOT EXISTS "cost_budget_day" (
	"user_id" integer NOT NULL,
	"day_started_at" timestamp with time zone NOT NULL,
	"spent_usd" numeric DEFAULT '0' NOT NULL,
	"reserved_usd" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_budget_day_user_id_day_started_at_pk" PRIMARY KEY("user_id","day_started_at"),
	CONSTRAINT "cost_budget_day_spent_usd_check" CHECK ("cost_budget_day"."spent_usd" >= 0),
	CONSTRAINT "cost_budget_day_reserved_usd_check" CHECK ("cost_budget_day"."reserved_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cost_reservation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"day_started_at" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount_usd" numeric NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_reservation_amount_usd_check" CHECK ("cost_reservation"."amount_usd" > 0),
	CONSTRAINT "cost_reservation_expiry_check" CHECK ("cost_reservation"."expires_at" > "cost_reservation"."created_at")
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'cost_budget_day_user_id_user_id_fk'
			AND connamespace = 'public'::regnamespace
	) THEN
		ALTER TABLE "cost_budget_day" ADD CONSTRAINT "cost_budget_day_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'cost_reservation_user_id_user_id_fk'
			AND connamespace = 'public'::regnamespace
	) THEN
		ALTER TABLE "cost_reservation" ADD CONSTRAINT "cost_reservation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cost_reservation_active_idempotency_key_idx" ON "cost_reservation" USING btree ("idempotency_key") WHERE "cost_reservation"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_reservation_user_day_active_idx" ON "cost_reservation" USING btree ("user_id","day_started_at","released_at","expires_at");
