CREATE TABLE "control_plane"."automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"automation_target_id" text,
	"source_webhook_event_id" text,
	"conversation_id" text,
	"rendered_input" text,
	"rendered_conversation_key" text,
	"rendered_idempotency_key" text,
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
CREATE TABLE "control_plane"."automation_conversation_delivery_processors" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"active_workflow_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."automation_conversation_delivery_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"automation_run_id" text NOT NULL,
	"source_webhook_event_id" text NOT NULL,
	"source_order_key" text NOT NULL,
	"processor_generation" integer,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"claimed_at" timestamp with time zone,
	"delivery_started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."automation_conversation_routes" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"sandbox_instance_id" text NOT NULL,
	"provider_conversation_id" text,
	"provider_execution_id" text,
	"provider_state" jsonb,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."automation_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" text NOT NULL,
	"created_by_kind" text NOT NULL,
	"created_by_id" text NOT NULL,
	"sandbox_profile_id" text NOT NULL,
	"integration_family_id" text NOT NULL,
	"conversation_key" text NOT NULL,
	"title" text,
	"preview" text,
	"status" text NOT NULL,
	"last_processed_source_order_key" text,
	"last_processed_webhook_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."integration_connection_credentials" (
	"connection_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"purpose" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connection_credentials_connection_id_purpose_pk" PRIMARY KEY("connection_id","purpose")
);
--> statement-breakpoint
CREATE TABLE "control_plane"."integration_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"target_key" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"external_subject_id" text,
	"config" jsonb,
	"secrets" jsonb,
	"target_snapshot_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."integration_connection_redirect_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"target_key" text NOT NULL,
	"state" text NOT NULL,
	"pkce_verifier_encrypted" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."integration_targets" (
	"target_key" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"secrets" jsonb,
	"display_name_override" text,
	"description_override" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"source_occurred_at" timestamp with time zone,
	"source_order_key" text,
	"status" text DEFAULT 'received' NOT NULL,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "control_plane"."sandbox_profile_version_integration_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"sandbox_profile_id" text NOT NULL,
	"sandbox_profile_version" bigint NOT NULL,
	"connection_id" text NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spv_integration_bindings_profile_id_version_id_uidx" UNIQUE("sandbox_profile_id","sandbox_profile_version","id")
);
--> statement-breakpoint
CREATE TABLE "control_plane"."schedule_automations" (
	"automation_id" text PRIMARY KEY NOT NULL,
	"cron_expression" text NOT NULL,
	"timezone" text NOT NULL,
	"input_template" text NOT NULL,
	"conversation_key_template" text NOT NULL,
	"idempotency_key_template" text,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
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
ALTER TABLE "control_plane"."automation_runs" ADD CONSTRAINT "automation_runs_automation_conversation_id_automation_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "control_plane"."automation_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_targets" ADD CONSTRAINT "automation_targets_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "control_plane"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_targets" ADD CONSTRAINT "automation_targets_sandbox_profile_id_sandbox_profiles_id_fk" FOREIGN KEY ("sandbox_profile_id") REFERENCES "control_plane"."sandbox_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automations" ADD CONSTRAINT "automations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversation_delivery_processors" ADD CONSTRAINT "automation_conversation_delivery_processors_automation_conversation_id_automation_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "control_plane"."automation_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversation_delivery_tasks" ADD CONSTRAINT "automation_conversation_delivery_tasks_automation_conversation_id_automation_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "control_plane"."automation_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversation_delivery_tasks" ADD CONSTRAINT "automation_conversation_delivery_tasks_automation_run_id_automation_runs_id_fk" FOREIGN KEY ("automation_run_id") REFERENCES "control_plane"."automation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversation_delivery_tasks" ADD CONSTRAINT "automation_conversation_delivery_tasks_source_webhook_event_id_integration_webhook_events_id_fk" FOREIGN KEY ("source_webhook_event_id") REFERENCES "control_plane"."integration_webhook_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversation_routes" ADD CONSTRAINT "automation_conversation_routes_automation_conversation_id_automation_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "control_plane"."automation_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversations" ADD CONSTRAINT "automation_conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversations" ADD CONSTRAINT "automation_conversations_sandbox_profile_id_sandbox_profiles_id_fk" FOREIGN KEY ("sandbox_profile_id") REFERENCES "control_plane"."sandbox_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversations" ADD CONSTRAINT "automation_conversations_last_processed_webhook_event_id_integration_webhook_events_id_fk" FOREIGN KEY ("last_processed_webhook_event_id") REFERENCES "control_plane"."integration_webhook_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_credentials" ADD CONSTRAINT "integration_connection_credentials_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_credentials" ADD CONSTRAINT "integration_connection_credentials_credential_id_integration_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "control_plane"."integration_credentials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connections" ADD CONSTRAINT "integration_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connections" ADD CONSTRAINT "integration_connections_target_key_integration_targets_target_key_fk" FOREIGN KEY ("target_key") REFERENCES "control_plane"."integration_targets"("target_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_redirect_sessions" ADD CONSTRAINT "integration_connection_redirect_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_redirect_sessions" ADD CONSTRAINT "integration_connection_redirect_sessions_target_key_integration_targets_target_key_fk" FOREIGN KEY ("target_key") REFERENCES "control_plane"."integration_targets"("target_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_webhook_events" ADD CONSTRAINT "integration_webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_webhook_events" ADD CONSTRAINT "integration_webhook_events_integration_connection_id_integration_connections_id_fk" FOREIGN KEY ("integration_connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_webhook_events" ADD CONSTRAINT "integration_webhook_events_target_key_integration_targets_target_key_fk" FOREIGN KEY ("target_key") REFERENCES "control_plane"."integration_targets"("target_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_version_integration_bindings" ADD CONSTRAINT "sandbox_profile_version_integration_bindings_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_version_integration_bindings" ADD CONSTRAINT "spv_integration_bindings_sandbox_profile_version_fkey" FOREIGN KEY ("sandbox_profile_id","sandbox_profile_version") REFERENCES "control_plane"."sandbox_profile_versions"("sandbox_profile_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."schedule_automations" ADD CONSTRAINT "schedule_automations_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "control_plane"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_automations" ADD CONSTRAINT "webhook_automations_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "control_plane"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_automations" ADD CONSTRAINT "webhook_automations_integration_connection_id_integration_connections_id_fk" FOREIGN KEY ("integration_connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_automation_target_id_source_webhook_event_id_uidx" ON "control_plane"."automation_runs" USING btree ("automation_target_id","source_webhook_event_id");--> statement-breakpoint
CREATE INDEX "automation_runs_automation_id_idx" ON "control_plane"."automation_runs" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "automation_runs_automation_target_id_idx" ON "control_plane"."automation_runs" USING btree ("automation_target_id");--> statement-breakpoint
CREATE INDEX "automation_runs_source_webhook_event_id_idx" ON "control_plane"."automation_runs" USING btree ("source_webhook_event_id");--> statement-breakpoint
CREATE INDEX "automation_runs_conversation_id_idx" ON "control_plane"."automation_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "automation_runs_status_idx" ON "control_plane"."automation_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "automation_runs_created_at_idx" ON "control_plane"."automation_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "automation_targets_sandbox_profile_id_idx" ON "control_plane"."automation_targets" USING btree ("sandbox_profile_id");--> statement-breakpoint
CREATE INDEX "automation_targets_automation_id_idx" ON "control_plane"."automation_targets" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "automations_organization_id_idx" ON "control_plane"."automations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "automations_organization_id_kind_idx" ON "control_plane"."automations" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE INDEX "automations_organization_id_enabled_idx" ON "control_plane"."automations" USING btree ("organization_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_conversation_delivery_tasks_automation_run_id_uidx" ON "control_plane"."automation_conversation_delivery_tasks" USING btree ("automation_run_id");--> statement-breakpoint
CREATE INDEX "automation_conversation_delivery_tasks_automation_conversation_id_idx" ON "control_plane"."automation_conversation_delivery_tasks" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "automation_conversation_delivery_tasks_source_webhook_event_id_idx" ON "control_plane"."automation_conversation_delivery_tasks" USING btree ("source_webhook_event_id");--> statement-breakpoint
CREATE INDEX "automation_conversation_delivery_tasks_status_idx" ON "control_plane"."automation_conversation_delivery_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "automation_conversation_delivery_tasks_dequeue_idx" ON "control_plane"."automation_conversation_delivery_tasks" USING btree ("conversation_id","status","source_order_key","created_at","id");--> statement-breakpoint
CREATE INDEX "automation_conversation_routes_automation_conversation_id_idx" ON "control_plane"."automation_conversation_routes" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "automation_conversation_routes_sandbox_instance_id_idx" ON "control_plane"."automation_conversation_routes" USING btree ("sandbox_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_conversation_routes_automation_conversation_id_uidx" ON "control_plane"."automation_conversation_routes" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_conversations_org_owner_key_uidx" ON "control_plane"."automation_conversations" USING btree ("organization_id","owner_kind","owner_id","conversation_key");--> statement-breakpoint
CREATE INDEX "automation_conversations_organization_id_idx" ON "control_plane"."automation_conversations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "automation_conversations_sandbox_profile_id_idx" ON "control_plane"."automation_conversations" USING btree ("sandbox_profile_id");--> statement-breakpoint
CREATE INDEX "automation_conversations_org_owner_idx" ON "control_plane"."automation_conversations" USING btree ("organization_id","owner_kind","owner_id");--> statement-breakpoint
CREATE INDEX "integration_connection_credentials_credential_id_idx" ON "control_plane"."integration_connection_credentials" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "integration_connections_organization_id_idx" ON "control_plane"."integration_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_connections_organization_id_target_key_idx" ON "control_plane"."integration_connections" USING btree ("organization_id","target_key");--> statement-breakpoint
CREATE INDEX "integration_connections_organization_id_status_idx" ON "control_plane"."integration_connections" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "integration_connection_redirect_sessions_organization_id_idx" ON "control_plane"."integration_connection_redirect_sessions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_connection_redirect_sessions_organization_id_target_key_idx" ON "control_plane"."integration_connection_redirect_sessions" USING btree ("organization_id","target_key");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connection_redirect_sessions_state_uidx" ON "control_plane"."integration_connection_redirect_sessions" USING btree ("state");--> statement-breakpoint
CREATE INDEX "integration_connection_redirect_sessions_expires_at_idx" ON "control_plane"."integration_connection_redirect_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "integration_targets_family_id_variant_id_idx" ON "control_plane"."integration_targets" USING btree ("family_id","variant_id");--> statement-breakpoint
CREATE INDEX "integration_targets_enabled_idx" ON "control_plane"."integration_targets" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_webhook_events_target_key_external_event_id_uidx" ON "control_plane"."integration_webhook_events" USING btree ("target_key","external_event_id");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_organization_id_idx" ON "control_plane"."integration_webhook_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_integration_connection_id_idx" ON "control_plane"."integration_webhook_events" USING btree ("integration_connection_id");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_target_key_idx" ON "control_plane"."integration_webhook_events" USING btree ("target_key");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_status_idx" ON "control_plane"."integration_webhook_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_event_type_idx" ON "control_plane"."integration_webhook_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_external_delivery_id_idx" ON "control_plane"."integration_webhook_events" USING btree ("external_delivery_id");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_source_order_key_idx" ON "control_plane"."integration_webhook_events" USING btree ("source_order_key");--> statement-breakpoint
CREATE INDEX "spv_integration_bindings_profile_id_version_idx" ON "control_plane"."sandbox_profile_version_integration_bindings" USING btree ("sandbox_profile_id","sandbox_profile_version");--> statement-breakpoint
CREATE INDEX "spv_integration_bindings_connection_id_idx" ON "control_plane"."sandbox_profile_version_integration_bindings" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "spv_integration_bindings_profile_id_version_kind_idx" ON "control_plane"."sandbox_profile_version_integration_bindings" USING btree ("sandbox_profile_id","sandbox_profile_version","kind");--> statement-breakpoint
CREATE INDEX "schedule_automations_automation_id_idx" ON "control_plane"."schedule_automations" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "webhook_automations_integration_connection_id_idx" ON "control_plane"."webhook_automations" USING btree ("integration_connection_id");--> statement-breakpoint
CREATE INDEX "webhook_automations_automation_id_idx" ON "control_plane"."webhook_automations" USING btree ("automation_id");
