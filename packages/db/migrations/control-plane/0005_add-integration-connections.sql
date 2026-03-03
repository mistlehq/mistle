CREATE TABLE "control_plane"."integration_connection_credentials" (
	"connection_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"purpose" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connection_credentials_connection_id_purpose_pk" PRIMARY KEY("connection_id","purpose")
);
--> statement-breakpoint
CREATE TABLE "control_plane"."integration_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"target_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"external_subject_id" text,
	"config" jsonb,
	"secrets" jsonb,
	"target_snapshot_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_credentials" ADD CONSTRAINT "integration_connection_credentials_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_credentials" ADD CONSTRAINT "integration_connection_credentials_credential_id_integration_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "control_plane"."integration_credentials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connections" ADD CONSTRAINT "integration_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_connection_credentials_credential_id_idx" ON "control_plane"."integration_connection_credentials" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "integration_connections_organization_id_idx" ON "control_plane"."integration_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_connections_organization_id_target_key_idx" ON "control_plane"."integration_connections" USING btree ("organization_id","target_key");--> statement-breakpoint
CREATE INDEX "integration_connections_organization_id_status_idx" ON "control_plane"."integration_connections" USING btree ("organization_id","status");
