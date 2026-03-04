CREATE TABLE "control_plane"."automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"automation_target_id" text,
	"source_webhook_event_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."automation_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"sandbox_profile_id" text NOT NULL,
	"sandbox_profile_version" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."automations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."webhook_automations" (
	"automation_id" text PRIMARY KEY NOT NULL,
	"integration_connection_id" text NOT NULL,
	"event_types" jsonb,
	"payload_filter" jsonb,
	"input_template" text NOT NULL,
	"conversation_key_template" text NOT NULL,
	"idempotency_key_template" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "control_plane"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_runs" ADD CONSTRAINT "automation_runs_automation_target_id_automation_targets_id_fk" FOREIGN KEY ("automation_target_id") REFERENCES "control_plane"."automation_targets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_runs" ADD CONSTRAINT "automation_runs_source_webhook_event_id_integration_webhook_events_id_fk" FOREIGN KEY ("source_webhook_event_id") REFERENCES "control_plane"."integration_webhook_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_targets" ADD CONSTRAINT "automation_targets_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "control_plane"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_targets" ADD CONSTRAINT "automation_targets_sandbox_profile_id_sandbox_profiles_id_fk" FOREIGN KEY ("sandbox_profile_id") REFERENCES "control_plane"."sandbox_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automations" ADD CONSTRAINT "automations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_automations" ADD CONSTRAINT "webhook_automations_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "control_plane"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_automations" ADD CONSTRAINT "webhook_automations_integration_connection_id_integration_connections_id_fk" FOREIGN KEY ("integration_connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_automation_target_id_source_webhook_event_id_uidx" ON "control_plane"."automation_runs" USING btree ("automation_target_id","source_webhook_event_id");--> statement-breakpoint
CREATE INDEX "automation_runs_automation_id_idx" ON "control_plane"."automation_runs" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "automation_runs_automation_target_id_idx" ON "control_plane"."automation_runs" USING btree ("automation_target_id");--> statement-breakpoint
CREATE INDEX "automation_runs_source_webhook_event_id_idx" ON "control_plane"."automation_runs" USING btree ("source_webhook_event_id");--> statement-breakpoint
CREATE INDEX "automation_runs_status_idx" ON "control_plane"."automation_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "automation_runs_created_at_idx" ON "control_plane"."automation_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "automation_targets_sandbox_profile_id_idx" ON "control_plane"."automation_targets" USING btree ("sandbox_profile_id");--> statement-breakpoint
CREATE INDEX "automation_targets_automation_id_idx" ON "control_plane"."automation_targets" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "automations_organization_id_idx" ON "control_plane"."automations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "automations_organization_id_kind_idx" ON "control_plane"."automations" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE INDEX "automations_organization_id_enabled_idx" ON "control_plane"."automations" USING btree ("organization_id","enabled");--> statement-breakpoint
CREATE INDEX "webhook_automations_integration_connection_id_idx" ON "control_plane"."webhook_automations" USING btree ("integration_connection_id");--> statement-breakpoint
CREATE INDEX "webhook_automations_automation_id_idx" ON "control_plane"."webhook_automations" USING btree ("automation_id");
