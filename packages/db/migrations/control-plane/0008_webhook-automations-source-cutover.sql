ALTER TABLE "control_plane"."webhook_automations" DROP CONSTRAINT "webhook_automations_integration_connection_id_integration_connections_id_fk";
--> statement-breakpoint
DROP INDEX "control_plane"."webhook_automations_integration_connection_id_idx";--> statement-breakpoint
-- squawk-ignore renaming-column
ALTER TABLE "control_plane"."webhook_automations" RENAME COLUMN "integration_connection_id" TO "integration_webhook_source_id";--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_automations" ADD CONSTRAINT "webhook_automations_integration_webhook_source_id_integration_webhook_sources_id_fk" FOREIGN KEY ("integration_webhook_source_id") REFERENCES "control_plane"."integration_webhook_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_automations_integration_webhook_source_id_idx" ON "control_plane"."webhook_automations" USING btree ("integration_webhook_source_id");
