ALTER TABLE "control_plane"."conversation_delivery_tasks" DROP CONSTRAINT "conversation_delivery_tasks_source_webhook_event_id_integration_webhook_events_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."conversation_delivery_tasks" ALTER COLUMN "source_webhook_event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "control_plane"."conversation_delivery_tasks" ADD CONSTRAINT "conversation_delivery_tasks_source_webhook_event_id_integration_webhook_events_id_fk" FOREIGN KEY ("source_webhook_event_id") REFERENCES "control_plane"."integration_webhook_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_last_processed_webhook_event_id_idx" ON "control_plane"."conversations" USING btree ("last_processed_webhook_event_id");