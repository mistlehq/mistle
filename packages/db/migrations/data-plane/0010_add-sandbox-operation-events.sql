CREATE TABLE "data_plane"."sandbox_operation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"sandbox_instance_id" text NOT NULL,
	"operation_kind" text NOT NULL,
	"operation_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"record_kind" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"phase" text,
	"status" text,
	"stream" text,
	"message" text NOT NULL,
	"payload_bytes" "bytea",
	"attributes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_operation_events" ADD CONSTRAINT "sandbox_operation_events_sandbox_instance_id_sandbox_instances_id_fk" FOREIGN KEY ("sandbox_instance_id") REFERENCES "data_plane"."sandbox_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_operation_events_operation_sequence_uidx" ON "data_plane"."sandbox_operation_events" USING btree ("sandbox_instance_id","operation_id","sequence");--> statement-breakpoint
CREATE INDEX "sandbox_operation_events_instance_operation_idx" ON "data_plane"."sandbox_operation_events" USING btree ("sandbox_instance_id","operation_id");--> statement-breakpoint
CREATE INDEX "sandbox_operation_events_instance_created_idx" ON "data_plane"."sandbox_operation_events" USING btree ("sandbox_instance_id","created_at");