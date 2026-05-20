CREATE TABLE "data_plane"."sandbox_usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"organization_id" text NOT NULL,
	"sandbox_instance_id" text NOT NULL,
	"compute_generation" bigint,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"runtime_provider" text,
	"provider_sandbox_id" text,
	"storage_provider" text,
	"provider_storage_id" text,
	"vcpu_count" bigint,
	"memory_mb" bigint,
	"storage_mb" bigint,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_usage_events" ADD CONSTRAINT "sandbox_usage_events_sandbox_instance_id_sandbox_instances_id_fk" FOREIGN KEY ("sandbox_instance_id") REFERENCES "data_plane"."sandbox_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_usage_events_idempotency_key_uidx" ON "data_plane"."sandbox_usage_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sandbox_usage_events_org_occurred_idx" ON "data_plane"."sandbox_usage_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sandbox_usage_events_instance_occurred_idx" ON "data_plane"."sandbox_usage_events" USING btree ("sandbox_instance_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sandbox_usage_events_type_occurred_idx" ON "data_plane"."sandbox_usage_events" USING btree ("event_type","occurred_at");