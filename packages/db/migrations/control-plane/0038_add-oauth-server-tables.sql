CREATE TABLE "control_plane"."oauth_access_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"oauth_grant_id" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_hash_algorithm" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."oauth_client_grant_types" (
	"oauth_client_id" text NOT NULL,
	"grant_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_client_grant_types_oauth_client_id_grant_type_pk" PRIMARY KEY("oauth_client_id","grant_type")
);
--> statement-breakpoint
CREATE TABLE "control_plane"."oauth_client_redirect_uris" (
	"oauth_client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_client_redirect_uris_oauth_client_id_redirect_uri_pk" PRIMARY KEY("oauth_client_id","redirect_uri")
);
--> statement-breakpoint
CREATE TABLE "control_plane"."oauth_client_scopes" (
	"oauth_client_id" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_client_scopes_oauth_client_id_scope_pk" PRIMARY KEY("oauth_client_id","scope")
);
--> statement-breakpoint
CREATE TABLE "control_plane"."oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"client_type" text NOT NULL,
	"application_type" text NOT NULL,
	"registration_kind" text NOT NULL,
	"client_secret_hash" text,
	"client_secret_hash_algorithm" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."oauth_grant_scopes" (
	"oauth_grant_id" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_grant_scopes_oauth_grant_id_scope_pk" PRIMARY KEY("oauth_grant_id","scope")
);
--> statement-breakpoint
CREATE TABLE "control_plane"."oauth_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"oauth_client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."oauth_refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"oauth_grant_id" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_hash_algorithm" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."oauth_server_states" (
	"id" text PRIMARY KEY NOT NULL,
	"model_name" text NOT NULL,
	"record_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"grant_id" text,
	"user_code" text,
	"uid" text,
	"expires_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_oauth_grant_id_oauth_grants_id_fk" FOREIGN KEY ("oauth_grant_id") REFERENCES "control_plane"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."oauth_client_grant_types" ADD CONSTRAINT "oauth_client_grant_types_oauth_client_id_oauth_clients_id_fk" FOREIGN KEY ("oauth_client_id") REFERENCES "control_plane"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."oauth_client_redirect_uris" ADD CONSTRAINT "oauth_client_redirect_uris_oauth_client_id_oauth_clients_id_fk" FOREIGN KEY ("oauth_client_id") REFERENCES "control_plane"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."oauth_client_scopes" ADD CONSTRAINT "oauth_client_scopes_oauth_client_id_oauth_clients_id_fk" FOREIGN KEY ("oauth_client_id") REFERENCES "control_plane"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."oauth_grant_scopes" ADD CONSTRAINT "oauth_grant_scopes_oauth_grant_id_oauth_grants_id_fk" FOREIGN KEY ("oauth_grant_id") REFERENCES "control_plane"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."oauth_grants" ADD CONSTRAINT "oauth_grants_oauth_client_id_oauth_clients_id_fk" FOREIGN KEY ("oauth_client_id") REFERENCES "control_plane"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."oauth_grants" ADD CONSTRAINT "oauth_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "control_plane"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."oauth_grants" ADD CONSTRAINT "oauth_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_oauth_grant_id_oauth_grants_id_fk" FOREIGN KEY ("oauth_grant_id") REFERENCES "control_plane"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_access_tokens_token_prefix_uidx" ON "control_plane"."oauth_access_tokens" USING btree ("token_prefix");--> statement-breakpoint
CREATE INDEX "oauth_access_tokens_oauth_grant_id_idx" ON "control_plane"."oauth_access_tokens" USING btree ("oauth_grant_id");--> statement-breakpoint
CREATE INDEX "oauth_access_tokens_expires_at_idx" ON "control_plane"."oauth_access_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_clients_client_id_uidx" ON "control_plane"."oauth_clients" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_grants_user_organization_idx" ON "control_plane"."oauth_grants" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_refresh_tokens_token_prefix_uidx" ON "control_plane"."oauth_refresh_tokens" USING btree ("token_prefix");--> statement-breakpoint
CREATE INDEX "oauth_refresh_tokens_oauth_grant_id_idx" ON "control_plane"."oauth_refresh_tokens" USING btree ("oauth_grant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_server_states_model_name_record_id_uidx" ON "control_plane"."oauth_server_states" USING btree ("model_name","record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_server_states_model_name_user_code_uidx" ON "control_plane"."oauth_server_states" USING btree ("model_name","user_code") WHERE "control_plane"."oauth_server_states"."user_code" is not null;--> statement-breakpoint
CREATE INDEX "oauth_server_states_grant_id_idx" ON "control_plane"."oauth_server_states" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "oauth_server_states_expires_at_idx" ON "control_plane"."oauth_server_states" USING btree ("expires_at");