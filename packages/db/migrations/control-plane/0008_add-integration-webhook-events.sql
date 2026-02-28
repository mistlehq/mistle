CREATE TABLE "control_plane"."integration_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE INDEX "integration_webhook_events_target_key_idx" ON "control_plane"."integration_webhook_events" USING btree ("target_key");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_status_idx" ON "control_plane"."integration_webhook_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_event_type_idx" ON "control_plane"."integration_webhook_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_external_delivery_id_idx" ON "control_plane"."integration_webhook_events" USING btree ("external_delivery_id");