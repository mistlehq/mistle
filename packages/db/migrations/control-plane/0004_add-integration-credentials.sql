CREATE TABLE "control_plane"."integration_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"secret_kind" text NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"organization_credential_key_version" bigint NOT NULL,
	"intended_family_id" text,
	"metadata" jsonb,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."integration_credentials" ADD CONSTRAINT "integration_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_credentials" ADD CONSTRAINT "integration_credentials_org_id_org_key_version_fkey" FOREIGN KEY ("organization_id","organization_credential_key_version") REFERENCES "control_plane"."organization_credential_keys"("organization_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_credentials_organization_id_idx" ON "control_plane"."integration_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_credentials_organization_id_secret_kind_idx" ON "control_plane"."integration_credentials" USING btree ("organization_id","secret_kind");--> statement-breakpoint
CREATE INDEX "integration_credentials_organization_id_key_version_idx" ON "control_plane"."integration_credentials" USING btree ("organization_id","organization_credential_key_version");