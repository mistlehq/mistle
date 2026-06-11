CREATE TABLE "control_plane"."provider_resource_association_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_resource_association_id" text NOT NULL,
	"source_webhook_event_id" text NOT NULL,
	"source_order_key" text NOT NULL,
	"rendered_input" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt_count" bigint DEFAULT 0 NOT NULL,
	"processor_generation" bigint,
	"failure_code" text,
	"failure_message" text,
	"claimed_at" timestamp with time zone,
	"delivery_started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."provider_resource_association_delivery_processors" (
	"provider_resource_association_id" text PRIMARY KEY NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"active_workflow_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."provider_resource_associations" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_connection_id" text NOT NULL,
	"resource_kind" text NOT NULL,
	"provider_resource_id" text NOT NULL,
	"sandbox_instance_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_versions" ADD COLUMN "associated_resource_event_routing_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "control_plane"."provider_resource_association_deliveries" ADD CONSTRAINT "provider_resource_association_deliveries_provider_resource_association_id_provider_resource_associations_id_fk" FOREIGN KEY ("provider_resource_association_id") REFERENCES "control_plane"."provider_resource_associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."provider_resource_association_deliveries" ADD CONSTRAINT "provider_resource_association_deliveries_source_webhook_event_id_integration_webhook_events_id_fk" FOREIGN KEY ("source_webhook_event_id") REFERENCES "control_plane"."integration_webhook_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."provider_resource_association_delivery_processors" ADD CONSTRAINT "provider_resource_association_delivery_processors_provider_resource_association_id_provider_resource_associations_id_fk" FOREIGN KEY ("provider_resource_association_id") REFERENCES "control_plane"."provider_resource_associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."provider_resource_associations" ADD CONSTRAINT "provider_resource_associations_integration_connection_id_integration_connections_id_fk" FOREIGN KEY ("integration_connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_resource_association_deliveries_event_uidx" ON "control_plane"."provider_resource_association_deliveries" USING btree ("provider_resource_association_id","source_webhook_event_id");--> statement-breakpoint
CREATE INDEX "provider_resource_association_deliveries_dequeue_idx" ON "control_plane"."provider_resource_association_deliveries" USING btree ("provider_resource_association_id","status","source_order_key","created_at","id");--> statement-breakpoint
CREATE INDEX "provider_resource_association_deliveries_webhook_event_id_idx" ON "control_plane"."provider_resource_association_deliveries" USING btree ("source_webhook_event_id");--> statement-breakpoint
CREATE INDEX "provider_resource_association_deliveries_status_idx" ON "control_plane"."provider_resource_association_deliveries" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_resource_associations_resource_uidx" ON "control_plane"."provider_resource_associations" USING btree ("integration_connection_id","resource_kind","provider_resource_id");--> statement-breakpoint
CREATE INDEX "provider_resource_associations_sandbox_instance_id_idx" ON "control_plane"."provider_resource_associations" USING btree ("sandbox_instance_id");
