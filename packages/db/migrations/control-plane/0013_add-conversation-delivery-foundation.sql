CREATE TABLE "control_plane"."conversation_delivery_processors" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"active_workflow_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."conversation_delivery_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"automation_run_id" text NOT NULL,
	"source_webhook_event_id" text NOT NULL,
	"source_order_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."automation_runs" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_runs" ADD COLUMN "rendered_input" text;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_runs" ADD COLUMN "rendered_conversation_key" text;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_runs" ADD COLUMN "rendered_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_webhook_events" ADD COLUMN "source_occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_webhook_events" ADD COLUMN "source_order_key" text;--> statement-breakpoint
ALTER TABLE "control_plane"."conversations" ADD COLUMN "last_processed_source_order_key" text;--> statement-breakpoint
ALTER TABLE "control_plane"."conversations" ADD COLUMN "last_processed_webhook_event_id" text;--> statement-breakpoint
ALTER TABLE "control_plane"."conversation_delivery_processors" ADD CONSTRAINT "conversation_delivery_processors_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "control_plane"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."conversation_delivery_tasks" ADD CONSTRAINT "conversation_delivery_tasks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "control_plane"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."conversation_delivery_tasks" ADD CONSTRAINT "conversation_delivery_tasks_automation_run_id_automation_runs_id_fk" FOREIGN KEY ("automation_run_id") REFERENCES "control_plane"."automation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."conversation_delivery_tasks" ADD CONSTRAINT "conversation_delivery_tasks_source_webhook_event_id_integration_webhook_events_id_fk" FOREIGN KEY ("source_webhook_event_id") REFERENCES "control_plane"."integration_webhook_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_delivery_tasks_automation_run_id_uidx" ON "control_plane"."conversation_delivery_tasks" USING btree ("automation_run_id");--> statement-breakpoint
CREATE INDEX "conversation_delivery_tasks_conversation_id_idx" ON "control_plane"."conversation_delivery_tasks" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_delivery_tasks_source_webhook_event_id_idx" ON "control_plane"."conversation_delivery_tasks" USING btree ("source_webhook_event_id");--> statement-breakpoint
CREATE INDEX "conversation_delivery_tasks_status_idx" ON "control_plane"."conversation_delivery_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "conversation_delivery_tasks_dequeue_idx" ON "control_plane"."conversation_delivery_tasks" USING btree ("conversation_id","status","source_order_key","created_at","id");--> statement-breakpoint
ALTER TABLE "control_plane"."automation_runs" ADD CONSTRAINT "automation_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "control_plane"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."conversations" ADD CONSTRAINT "conversations_last_processed_webhook_event_id_integration_webhook_events_id_fk" FOREIGN KEY ("last_processed_webhook_event_id") REFERENCES "control_plane"."integration_webhook_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_runs_conversation_id_idx" ON "control_plane"."automation_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_source_order_key_idx" ON "control_plane"."integration_webhook_events" USING btree ("source_order_key");