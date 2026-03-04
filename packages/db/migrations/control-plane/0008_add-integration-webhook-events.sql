CREATE TABLE "control_plane"."integration_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"integration_connection_id" text NOT NULL,
	"target_key" text NOT NULL,
	"external_event_id" text NOT NULL,
	"external_delivery_id" text,
	"event_type" text NOT NULL,
	"provider_event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_webhook_events_target_key_external_event_id_uidx" ON "control_plane"."integration_webhook_events" USING btree ("target_key","external_event_id");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_organization_id_idx" ON "control_plane"."integration_webhook_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_integration_connection_id_idx" ON "control_plane"."integration_webhook_events" USING btree ("integration_connection_id");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_target_key_idx" ON "control_plane"."integration_webhook_events" USING btree ("target_key");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_status_idx" ON "control_plane"."integration_webhook_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_event_type_idx" ON "control_plane"."integration_webhook_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_external_delivery_id_idx" ON "control_plane"."integration_webhook_events" USING btree ("external_delivery_id");
--> statement-breakpoint
ALTER TABLE "control_plane"."integration_webhook_events" ADD CONSTRAINT "integration_webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "control_plane"."integration_webhook_events" ADD CONSTRAINT "integration_webhook_events_integration_connection_id_integration_connections_id_fk" FOREIGN KEY ("integration_connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;
