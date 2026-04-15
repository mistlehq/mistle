CREATE TABLE "control_plane"."organization_sandbox_storage_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"persistent_sandboxes_enabled" boolean DEFAULT false NOT NULL,
	"storage_backend" text,
	"storage_config_source" text DEFAULT 'managed' NOT NULL,
	"storage_config_version" bigint,
	"storage_config_ciphertext" text,
	"storage_config_nonce" text,
	"organization_credential_key_version" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."organization_sandbox_storage_settings" ADD CONSTRAINT "organization_sandbox_storage_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_sandbox_storage_settings_organization_id_uidx" ON "control_plane"."organization_sandbox_storage_settings" USING btree ("organization_id");