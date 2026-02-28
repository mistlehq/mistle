CREATE TABLE "control_plane"."organization_credential_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"version" bigint NOT NULL,
	"master_key_version" bigint NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."organization_credential_keys" ADD CONSTRAINT "organization_credential_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_credential_keys_organization_id_idx" ON "control_plane"."organization_credential_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_credential_keys_organization_id_version_uidx" ON "control_plane"."organization_credential_keys" USING btree ("organization_id","version");