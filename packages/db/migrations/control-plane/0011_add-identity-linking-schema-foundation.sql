CREATE TABLE "control_plane"."organization_identity_link_provider_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider_family" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"integration_target_key" text NOT NULL,
	"integration_connection_id" text NOT NULL,
	"policy" jsonb,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."user_external_principal_credential_secrets" (
	"organization_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"secret_kind" text NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"organization_credential_key_version" bigint NOT NULL,
	"metadata" jsonb,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_external_principal_credential_secrets_credential_id_secret_kind_pk" PRIMARY KEY("credential_id","secret_kind")
);
--> statement-breakpoint
CREATE TABLE "control_plane"."user_external_principal_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"provider_family" text NOT NULL,
	"credential_kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"scopes" jsonb,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."user_external_principal_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"provider_family" text NOT NULL,
	"key_type" text NOT NULL,
	"key_value" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "control_plane"."user_external_principals" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider_family" text NOT NULL,
	"provider_subject_id" text,
	"organization_provider_config_id" text NOT NULL,
	"integration_connection_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"profile" jsonb,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlinked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_org_target_id_uidx" ON "control_plane"."integration_connections" USING btree ("organization_id","target_key","id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_id_link_provider_cfgs_org_provider_conn_id_uidx" ON "control_plane"."organization_identity_link_provider_configs" USING btree ("organization_id","provider_family","integration_connection_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_external_principal_creds_org_id_uidx" ON "control_plane"."user_external_principal_credentials" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_external_principals_org_provider_id_uidx" ON "control_plane"."user_external_principals" USING btree ("organization_id","provider_family","id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_identity_link_provider_cfgs_org_provider_uidx" ON "control_plane"."organization_identity_link_provider_configs" USING btree ("organization_id","provider_family");--> statement-breakpoint
CREATE INDEX "org_identity_link_provider_cfgs_org_status_idx" ON "control_plane"."organization_identity_link_provider_configs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "org_identity_link_provider_cfgs_target_key_idx" ON "control_plane"."organization_identity_link_provider_configs" USING btree ("integration_target_key");--> statement-breakpoint
CREATE INDEX "org_identity_link_provider_cfgs_connection_id_idx" ON "control_plane"."organization_identity_link_provider_configs" USING btree ("integration_connection_id");--> statement-breakpoint
CREATE INDEX "user_ext_principal_cred_secrets_org_id_idx" ON "control_plane"."user_external_principal_credential_secrets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "user_ext_principal_cred_secrets_cred_id_idx" ON "control_plane"."user_external_principal_credential_secrets" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "user_ext_principal_cred_secrets_org_key_version_idx" ON "control_plane"."user_external_principal_credential_secrets" USING btree ("organization_id","organization_credential_key_version");--> statement-breakpoint
CREATE INDEX "user_external_principal_creds_principal_id_idx" ON "control_plane"."user_external_principal_credentials" USING btree ("principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_external_principal_creds_active_kind_uidx" ON "control_plane"."user_external_principal_credentials" USING btree ("principal_id","credential_kind") WHERE "control_plane"."user_external_principal_credentials"."status" = 'active';--> statement-breakpoint
CREATE INDEX "user_external_principal_creds_org_provider_idx" ON "control_plane"."user_external_principal_credentials" USING btree ("organization_id","provider_family");--> statement-breakpoint
CREATE UNIQUE INDEX "user_external_principal_keys_active_uidx" ON "control_plane"."user_external_principal_keys" USING btree ("organization_id","provider_family","key_type","key_value") WHERE "control_plane"."user_external_principal_keys"."status" = 'active';--> statement-breakpoint
CREATE INDEX "user_external_principal_keys_principal_id_idx" ON "control_plane"."user_external_principal_keys" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "user_external_principal_keys_org_provider_idx" ON "control_plane"."user_external_principal_keys" USING btree ("organization_id","provider_family");--> statement-breakpoint
CREATE UNIQUE INDEX "user_external_principals_active_user_uidx" ON "control_plane"."user_external_principals" USING btree ("organization_id","provider_family","user_id") WHERE "control_plane"."user_external_principals"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "user_external_principals_active_subject_uidx" ON "control_plane"."user_external_principals" USING btree ("organization_id","provider_family","provider_subject_id") WHERE "control_plane"."user_external_principals"."status" = 'active' and "control_plane"."user_external_principals"."provider_subject_id" is not null;--> statement-breakpoint
CREATE INDEX "user_external_principals_org_user_provider_idx" ON "control_plane"."user_external_principals" USING btree ("organization_id","user_id","provider_family");--> statement-breakpoint
CREATE INDEX "user_external_principals_provider_config_idx" ON "control_plane"."user_external_principals" USING btree ("organization_provider_config_id");--> statement-breakpoint
CREATE INDEX "user_external_principals_connection_id_idx" ON "control_plane"."user_external_principals" USING btree ("integration_connection_id");--> statement-breakpoint
ALTER TABLE "control_plane"."organization_identity_link_provider_configs" ADD CONSTRAINT "organization_identity_link_provider_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."organization_identity_link_provider_configs" ADD CONSTRAINT "organization_identity_link_provider_configs_integration_target_key_integration_targets_target_key_fk" FOREIGN KEY ("integration_target_key") REFERENCES "control_plane"."integration_targets"("target_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."organization_identity_link_provider_configs" ADD CONSTRAINT "organization_identity_link_provider_configs_integration_connection_id_integration_connections_id_fk" FOREIGN KEY ("integration_connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."organization_identity_link_provider_configs" ADD CONSTRAINT "organization_identity_link_provider_configs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "control_plane"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."organization_identity_link_provider_configs" ADD CONSTRAINT "organization_identity_link_provider_configs_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "control_plane"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."organization_identity_link_provider_configs" ADD CONSTRAINT "org_id_link_provider_cfgs_org_target_connection_fkey" FOREIGN KEY ("organization_id","integration_target_key","integration_connection_id") REFERENCES "control_plane"."integration_connections"("organization_id","target_key","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."user_external_principal_credential_secrets" ADD CONSTRAINT "user_external_principal_credential_secrets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."user_external_principal_credential_secrets" ADD CONSTRAINT "user_external_principal_credential_secrets_credential_id_user_external_principal_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "control_plane"."user_external_principal_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."user_external_principal_credential_secrets" ADD CONSTRAINT "user_ext_principal_cred_secrets_org_credential_fkey" FOREIGN KEY ("organization_id","credential_id") REFERENCES "control_plane"."user_external_principal_credentials"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."user_external_principal_credential_secrets" ADD CONSTRAINT "user_ext_principal_cred_secrets_org_id_key_version_fkey" FOREIGN KEY ("organization_id","organization_credential_key_version") REFERENCES "control_plane"."organization_credential_keys"("organization_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."user_external_principal_credentials" ADD CONSTRAINT "user_external_principal_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."user_external_principal_credentials" ADD CONSTRAINT "user_external_principal_credentials_principal_id_user_external_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "control_plane"."user_external_principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."user_external_principal_credentials" ADD CONSTRAINT "user_ext_principal_creds_org_provider_principal_fkey" FOREIGN KEY ("organization_id","provider_family","principal_id") REFERENCES "control_plane"."user_external_principals"("organization_id","provider_family","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."user_external_principal_keys" ADD CONSTRAINT "user_external_principal_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."user_external_principal_keys" ADD CONSTRAINT "user_external_principal_keys_principal_id_user_external_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "control_plane"."user_external_principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."user_external_principal_keys" ADD CONSTRAINT "user_ext_principal_keys_org_provider_principal_fkey" FOREIGN KEY ("organization_id","provider_family","principal_id") REFERENCES "control_plane"."user_external_principals"("organization_id","provider_family","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."user_external_principals" ADD CONSTRAINT "user_external_principals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."user_external_principals" ADD CONSTRAINT "user_external_principals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "control_plane"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."user_external_principals" ADD CONSTRAINT "user_external_principals_organization_provider_config_id_organization_identity_link_provider_configs_id_fk" FOREIGN KEY ("organization_provider_config_id") REFERENCES "control_plane"."organization_identity_link_provider_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."user_external_principals" ADD CONSTRAINT "user_external_principals_integration_connection_id_integration_connections_id_fk" FOREIGN KEY ("integration_connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."user_external_principals" ADD CONSTRAINT "user_ext_principals_org_provider_conn_cfg_fkey" FOREIGN KEY ("organization_id","provider_family","integration_connection_id","organization_provider_config_id") REFERENCES "control_plane"."organization_identity_link_provider_configs"("organization_id","provider_family","integration_connection_id","id") ON DELETE restrict ON UPDATE no action;
