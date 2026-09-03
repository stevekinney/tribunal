CREATE TABLE "oauth_access_tokens" (
	"access_token_hash" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"scope" text,
	"resource" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_authorization_transactions" (
	"transaction_id_hash" text PRIMARY KEY NOT NULL,
	"csrf_token_hash" text NOT NULL,
	"consent_binding_hash" text NOT NULL,
	"user_id" integer NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text NOT NULL,
	"state" text,
	"issuer" text NOT NULL,
	"resource" text NOT NULL,
	"scope" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"client_id" text PRIMARY KEY NOT NULL,
	"client_secret_hash" text,
	"client_name" text NOT NULL,
	"client_type" text NOT NULL,
	"token_endpoint_auth_method" text NOT NULL,
	"application_type" text,
	"redirect_uris" jsonb NOT NULL,
	"grant_types" jsonb NOT NULL,
	"response_types" jsonb NOT NULL,
	"client_id_metadata_url" text,
	"client_secret_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text NOT NULL,
	"scope" text,
	"state" text,
	"resource" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_tokens" (
	"refresh_token_hash" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"scope" text,
	"resource" text NOT NULL,
	"access_token_hash" text NOT NULL,
	"family_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_transactions" ADD CONSTRAINT "oauth_authorization_transactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_transactions" ADD CONSTRAINT "oauth_authorization_transactions_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_access_token_hash_oauth_access_tokens_access_token_hash_fk" FOREIGN KEY ("access_token_hash") REFERENCES "public"."oauth_access_tokens"("access_token_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_access_user_idx" ON "oauth_access_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_access_expires_idx" ON "oauth_access_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_transactions_binding_idx" ON "oauth_authorization_transactions" USING btree ("consent_binding_hash");--> statement-breakpoint
CREATE INDEX "oauth_transactions_user_idx" ON "oauth_authorization_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_transactions_expires_idx" ON "oauth_authorization_transactions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_codes_user_idx" ON "oauth_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_codes_expires_idx" ON "oauth_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_refresh_user_idx" ON "oauth_refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_family_idx" ON "oauth_refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_access_idx" ON "oauth_refresh_tokens" USING btree ("access_token_hash");--> statement-breakpoint
CREATE INDEX "oauth_refresh_expires_idx" ON "oauth_refresh_tokens" USING btree ("expires_at");