CREATE TABLE "control_plane"."integration_webhook_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_scope" text NOT NULL,
	"organization_id" text,
	"integration_connection_id" text,
	"target_key" text,
	"display_name" text,
	"routing_strategy" text NOT NULL,
	"endpoint_key" text,
	"webhook_secret_credential_id" text,
	"remote_registration_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."integration_webhook_sources" ADD CONSTRAINT "integration_webhook_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_webhook_sources" ADD CONSTRAINT "integration_webhook_sources_integration_connection_id_integration_connections_id_fk" FOREIGN KEY ("integration_connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_webhook_sources" ADD CONSTRAINT "integration_webhook_sources_target_key_integration_targets_target_key_fk" FOREIGN KEY ("target_key") REFERENCES "control_plane"."integration_targets"("target_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_webhook_sources" ADD CONSTRAINT "integration_webhook_sources_webhook_secret_credential_id_integration_credentials_id_fk" FOREIGN KEY ("webhook_secret_credential_id") REFERENCES "control_plane"."integration_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_webhook_sources_endpoint_key_uidx" ON "control_plane"."integration_webhook_sources" USING btree ("endpoint_key");--> statement-breakpoint
CREATE INDEX "integration_webhook_sources_organization_id_idx" ON "control_plane"."integration_webhook_sources" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_webhook_sources_integration_connection_id_idx" ON "control_plane"."integration_webhook_sources" USING btree ("integration_connection_id");--> statement-breakpoint
CREATE INDEX "integration_webhook_sources_target_key_idx" ON "control_plane"."integration_webhook_sources" USING btree ("target_key");--> statement-breakpoint
CREATE INDEX "integration_webhook_sources_owner_scope_idx" ON "control_plane"."integration_webhook_sources" USING btree ("owner_scope");--> statement-breakpoint
CREATE INDEX "integration_webhook_sources_status_idx" ON "control_plane"."integration_webhook_sources" USING btree ("status");--> statement-breakpoint
CREATE INDEX "integration_webhook_sources_webhook_secret_credential_id_idx" ON "control_plane"."integration_webhook_sources" USING btree ("webhook_secret_credential_id");--> statement-breakpoint
ALTER TABLE "control_plane"."integration_webhook_events" ADD CONSTRAINT "integration_webhook_events_integration_webhook_source_id_integration_webhook_sources_id_fk" FOREIGN KEY ("integration_webhook_source_id") REFERENCES "control_plane"."integration_webhook_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_webhook_events_integration_webhook_source_id_idx" ON "control_plane"."integration_webhook_events" USING btree ("integration_webhook_source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_webhook_events_source_id_external_event_id_uidx" ON "control_plane"."integration_webhook_events" USING btree ("integration_webhook_source_id","external_event_id");
--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_automations" ADD CONSTRAINT "webhook_automations_integration_webhook_source_id_integration_webhook_sources_id_fk" FOREIGN KEY ("integration_webhook_source_id") REFERENCES "control_plane"."integration_webhook_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
