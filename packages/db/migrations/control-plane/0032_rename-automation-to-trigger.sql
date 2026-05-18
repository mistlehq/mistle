-- squawk-ignore-file renaming-table
-- squawk-ignore-file renaming-column
ALTER TABLE "control_plane"."schedule_automations" RENAME TO "schedule_triggers";--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversation_delivery_processors" RENAME TO "trigger_conversation_delivery_processors";--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversation_delivery_tasks" RENAME TO "trigger_conversation_delivery_tasks";--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversation_routes" RENAME TO "trigger_conversation_routes";--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversations" RENAME TO "trigger_conversations";--> statement-breakpoint
ALTER TABLE "control_plane"."automation_runs" RENAME TO "trigger_runs";--> statement-breakpoint
ALTER TABLE "control_plane"."automation_targets" RENAME TO "trigger_targets";--> statement-breakpoint
ALTER TABLE "control_plane"."automations" RENAME TO "triggers";--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_automations" RENAME TO "webhook_triggers";--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversation_delivery_tasks" RENAME COLUMN "automation_run_id" TO "trigger_run_id";--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_runs" RENAME COLUMN "automation_id" TO "trigger_id";--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_runs" RENAME COLUMN "automation_target_id" TO "trigger_target_id";--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_targets" RENAME COLUMN "automation_id" TO "trigger_id";--> statement-breakpoint
ALTER TABLE "control_plane"."schedule_triggers" RENAME COLUMN "automation_id" TO "trigger_id";--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_triggers" RENAME COLUMN "automation_id" TO "trigger_id";--> statement-breakpoint
UPDATE "control_plane"."schedules"
SET "target_type" = 'trigger_run'
WHERE "target_type" = 'automation_run';--> statement-breakpoint
UPDATE "control_plane"."scheduled_actions"
SET
  "target_type" = 'trigger_run',
  "target_payload" = CASE
    WHEN "target_payload" ? 'automationId' THEN
      ("target_payload" - 'automationId') || jsonb_build_object('triggerId', "target_payload"->'automationId')
    WHEN "target_payload" ? 'automation_id' THEN
      ("target_payload" - 'automation_id') || jsonb_build_object('triggerId', "target_payload"->'automation_id')
    ELSE
      "target_payload"
  END
WHERE "target_type" = 'automation_run';--> statement-breakpoint
UPDATE "control_plane"."trigger_conversations"
SET "owner_kind" = 'trigger_target'
WHERE "owner_kind" = 'automation_target';--> statement-breakpoint
INSERT INTO "control_plane"."api_key_permissions" ("api_key_id", "permission", "created_at")
SELECT
  "api_key_id",
  CASE "permission"
    WHEN 'automationWebhook:read' THEN 'triggerWebhook:read'
    WHEN 'automationWebhook:create' THEN 'triggerWebhook:create'
    WHEN 'automationWebhook:update' THEN 'triggerWebhook:update'
    WHEN 'automationWebhook:delete' THEN 'triggerWebhook:delete'
  END,
  "created_at"
FROM "control_plane"."api_key_permissions"
WHERE "permission" IN (
  'automationWebhook:read',
  'automationWebhook:create',
  'automationWebhook:update',
  'automationWebhook:delete'
)
ON CONFLICT DO NOTHING;--> statement-breakpoint
DELETE FROM "control_plane"."api_key_permissions"
WHERE "permission" IN (
  'automationWebhook:read',
  'automationWebhook:create',
  'automationWebhook:update',
  'automationWebhook:delete'
);--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversation_delivery_tasks" DROP CONSTRAINT "automation_conversation_delivery_tasks_exactly_one_source_check";--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversation_delivery_processors" DROP CONSTRAINT "automation_conversation_delivery_processors_conversation_id_automation_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversation_delivery_tasks" DROP CONSTRAINT "automation_conversation_delivery_tasks_conversation_id_automation_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversation_delivery_tasks" DROP CONSTRAINT "automation_conversation_delivery_tasks_automation_run_id_automation_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversation_delivery_tasks" DROP CONSTRAINT "automation_conversation_delivery_tasks_source_webhook_event_id_integration_webhook_events_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversation_delivery_tasks" DROP CONSTRAINT "automation_conversation_delivery_tasks_source_scheduled_action_id_scheduled_actions_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversation_routes" DROP CONSTRAINT "automation_conversation_routes_conversation_id_automation_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversations" DROP CONSTRAINT "automation_conversations_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversations" DROP CONSTRAINT "automation_conversations_sandbox_profile_id_sandbox_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversations" DROP CONSTRAINT "automation_conversations_last_processed_webhook_event_id_integration_webhook_events_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_runs" DROP CONSTRAINT "automation_runs_automation_id_automations_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_runs" DROP CONSTRAINT "automation_runs_automation_target_id_automation_targets_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_runs" DROP CONSTRAINT "automation_runs_source_webhook_event_id_integration_webhook_events_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_runs" DROP CONSTRAINT "automation_runs_source_scheduled_action_id_scheduled_actions_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_runs" DROP CONSTRAINT "automation_runs_conversation_id_automation_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_targets" DROP CONSTRAINT "automation_targets_automation_id_automations_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_targets" DROP CONSTRAINT "automation_targets_sandbox_profile_id_sandbox_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."triggers" DROP CONSTRAINT "automations_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."schedule_triggers" DROP CONSTRAINT "schedule_automations_schedule_id_schedules_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."schedule_triggers" DROP CONSTRAINT "schedule_automations_automation_id_automations_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_triggers" DROP CONSTRAINT "webhook_automations_automation_id_automations_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_triggers" DROP CONSTRAINT "webhook_automations_integration_webhook_source_id_integration_webhook_sources_id_fk";
--> statement-breakpoint
DROP INDEX "control_plane"."automation_conversation_delivery_tasks_automation_run_id_uidx";--> statement-breakpoint
DROP INDEX "control_plane"."automation_conversation_delivery_tasks_source_webhook_event_id_idx";--> statement-breakpoint
DROP INDEX "control_plane"."automation_conversation_delivery_tasks_source_scheduled_action_id_idx";--> statement-breakpoint
DROP INDEX "control_plane"."automation_conversation_delivery_tasks_status_idx";--> statement-breakpoint
DROP INDEX "control_plane"."automation_conversation_delivery_tasks_dequeue_idx";--> statement-breakpoint
DROP INDEX "control_plane"."automation_conversation_routes_sandbox_instance_id_idx";--> statement-breakpoint
DROP INDEX "control_plane"."automation_conversation_routes_automation_conversation_id_uidx";--> statement-breakpoint
DROP INDEX "control_plane"."automation_conversations_org_owner_key_uidx";--> statement-breakpoint
DROP INDEX "control_plane"."automation_conversations_sandbox_profile_id_idx";--> statement-breakpoint
DROP INDEX "control_plane"."automation_runs_automation_target_id_source_webhook_event_id_uidx";--> statement-breakpoint
DROP INDEX "control_plane"."automation_runs_automation_id_idx";--> statement-breakpoint
DROP INDEX "control_plane"."automation_runs_source_webhook_event_id_idx";--> statement-breakpoint
DROP INDEX "control_plane"."automation_runs_source_scheduled_action_id_uidx";--> statement-breakpoint
DROP INDEX "control_plane"."automation_runs_conversation_id_idx";--> statement-breakpoint
DROP INDEX "control_plane"."automation_runs_status_idx";--> statement-breakpoint
DROP INDEX "control_plane"."automation_runs_created_at_idx";--> statement-breakpoint
DROP INDEX "control_plane"."automation_targets_sandbox_profile_id_idx";--> statement-breakpoint
DROP INDEX "control_plane"."automation_targets_automation_id_idx";--> statement-breakpoint
DROP INDEX "control_plane"."automations_organization_id_kind_idx";--> statement-breakpoint
DROP INDEX "control_plane"."automations_organization_id_enabled_idx";--> statement-breakpoint
DROP INDEX "control_plane"."automations_organization_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "control_plane"."schedule_automations_automation_id_uidx";--> statement-breakpoint
DROP INDEX "control_plane"."webhook_automations_integration_webhook_source_id_idx";--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversation_delivery_processors" ADD CONSTRAINT "trigger_conversation_delivery_processors_conversation_id_trigger_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "control_plane"."trigger_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversation_delivery_tasks" ADD CONSTRAINT "trigger_conversation_delivery_tasks_conversation_id_trigger_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "control_plane"."trigger_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversation_delivery_tasks" ADD CONSTRAINT "trigger_conversation_delivery_tasks_trigger_run_id_trigger_runs_id_fk" FOREIGN KEY ("trigger_run_id") REFERENCES "control_plane"."trigger_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversation_delivery_tasks" ADD CONSTRAINT "trigger_conversation_delivery_tasks_source_webhook_event_id_integration_webhook_events_id_fk" FOREIGN KEY ("source_webhook_event_id") REFERENCES "control_plane"."integration_webhook_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversation_delivery_tasks" ADD CONSTRAINT "trigger_conversation_delivery_tasks_source_scheduled_action_id_scheduled_actions_id_fk" FOREIGN KEY ("source_scheduled_action_id") REFERENCES "control_plane"."scheduled_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversation_routes" ADD CONSTRAINT "trigger_conversation_routes_conversation_id_trigger_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "control_plane"."trigger_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversations" ADD CONSTRAINT "trigger_conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversations" ADD CONSTRAINT "trigger_conversations_sandbox_profile_id_sandbox_profiles_id_fk" FOREIGN KEY ("sandbox_profile_id") REFERENCES "control_plane"."sandbox_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversations" ADD CONSTRAINT "trigger_conversations_last_processed_webhook_event_id_integration_webhook_events_id_fk" FOREIGN KEY ("last_processed_webhook_event_id") REFERENCES "control_plane"."integration_webhook_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_runs" ADD CONSTRAINT "trigger_runs_trigger_id_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "control_plane"."triggers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_runs" ADD CONSTRAINT "trigger_runs_trigger_target_id_trigger_targets_id_fk" FOREIGN KEY ("trigger_target_id") REFERENCES "control_plane"."trigger_targets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_runs" ADD CONSTRAINT "trigger_runs_source_webhook_event_id_integration_webhook_events_id_fk" FOREIGN KEY ("source_webhook_event_id") REFERENCES "control_plane"."integration_webhook_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_runs" ADD CONSTRAINT "trigger_runs_source_scheduled_action_id_scheduled_actions_id_fk" FOREIGN KEY ("source_scheduled_action_id") REFERENCES "control_plane"."scheduled_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_runs" ADD CONSTRAINT "trigger_runs_conversation_id_trigger_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "control_plane"."trigger_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_targets" ADD CONSTRAINT "trigger_targets_trigger_id_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "control_plane"."triggers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_targets" ADD CONSTRAINT "trigger_targets_sandbox_profile_id_sandbox_profiles_id_fk" FOREIGN KEY ("sandbox_profile_id") REFERENCES "control_plane"."sandbox_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."triggers" ADD CONSTRAINT "triggers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."schedule_triggers" ADD CONSTRAINT "schedule_triggers_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "control_plane"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."schedule_triggers" ADD CONSTRAINT "schedule_triggers_trigger_id_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "control_plane"."triggers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_triggers" ADD CONSTRAINT "webhook_triggers_trigger_id_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "control_plane"."triggers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_triggers" ADD CONSTRAINT "webhook_triggers_integration_webhook_source_id_integration_webhook_sources_id_fk" FOREIGN KEY ("integration_webhook_source_id") REFERENCES "control_plane"."integration_webhook_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trigger_conversation_delivery_tasks_trigger_run_id_uidx" ON "control_plane"."trigger_conversation_delivery_tasks" USING btree ("trigger_run_id");--> statement-breakpoint
CREATE INDEX "trigger_conversation_delivery_tasks_source_webhook_event_id_idx" ON "control_plane"."trigger_conversation_delivery_tasks" USING btree ("source_webhook_event_id");--> statement-breakpoint
CREATE INDEX "trigger_conversation_delivery_tasks_source_scheduled_action_id_idx" ON "control_plane"."trigger_conversation_delivery_tasks" USING btree ("source_scheduled_action_id") WHERE "control_plane"."trigger_conversation_delivery_tasks"."source_scheduled_action_id" is not null;--> statement-breakpoint
CREATE INDEX "trigger_conversation_delivery_tasks_status_idx" ON "control_plane"."trigger_conversation_delivery_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trigger_conversation_delivery_tasks_dequeue_idx" ON "control_plane"."trigger_conversation_delivery_tasks" USING btree ("conversation_id","status","source_order_key","created_at","id");--> statement-breakpoint
CREATE INDEX "trigger_conversation_routes_sandbox_instance_id_idx" ON "control_plane"."trigger_conversation_routes" USING btree ("sandbox_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trigger_conversation_routes_trigger_conversation_id_uidx" ON "control_plane"."trigger_conversation_routes" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trigger_conversations_org_owner_key_uidx" ON "control_plane"."trigger_conversations" USING btree ("organization_id","owner_kind","owner_id","conversation_key");--> statement-breakpoint
CREATE INDEX "trigger_conversations_sandbox_profile_id_idx" ON "control_plane"."trigger_conversations" USING btree ("sandbox_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trigger_runs_trigger_target_id_source_webhook_event_id_uidx" ON "control_plane"."trigger_runs" USING btree ("trigger_target_id","source_webhook_event_id");--> statement-breakpoint
CREATE INDEX "trigger_runs_trigger_id_idx" ON "control_plane"."trigger_runs" USING btree ("trigger_id");--> statement-breakpoint
CREATE INDEX "trigger_runs_source_webhook_event_id_idx" ON "control_plane"."trigger_runs" USING btree ("source_webhook_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trigger_runs_source_scheduled_action_id_uidx" ON "control_plane"."trigger_runs" USING btree ("source_scheduled_action_id") WHERE "control_plane"."trigger_runs"."source_scheduled_action_id" is not null;--> statement-breakpoint
CREATE INDEX "trigger_runs_conversation_id_idx" ON "control_plane"."trigger_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "trigger_runs_status_idx" ON "control_plane"."trigger_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trigger_runs_created_at_idx" ON "control_plane"."trigger_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "trigger_targets_sandbox_profile_id_idx" ON "control_plane"."trigger_targets" USING btree ("sandbox_profile_id");--> statement-breakpoint
CREATE INDEX "trigger_targets_trigger_id_idx" ON "control_plane"."trigger_targets" USING btree ("trigger_id");--> statement-breakpoint
CREATE INDEX "triggers_organization_id_kind_idx" ON "control_plane"."triggers" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE INDEX "triggers_organization_id_enabled_idx" ON "control_plane"."triggers" USING btree ("organization_id","enabled");--> statement-breakpoint
CREATE INDEX "triggers_organization_id_created_at_id_idx" ON "control_plane"."triggers" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_triggers_trigger_id_uidx" ON "control_plane"."schedule_triggers" USING btree ("trigger_id");--> statement-breakpoint
CREATE INDEX "webhook_triggers_integration_webhook_source_id_idx" ON "control_plane"."webhook_triggers" USING btree ("integration_webhook_source_id");--> statement-breakpoint
ALTER TABLE "control_plane"."trigger_conversation_delivery_tasks" ADD CONSTRAINT "trigger_conversation_delivery_tasks_exactly_one_source_check" CHECK (("control_plane"."trigger_conversation_delivery_tasks"."source_webhook_event_id" is not null and "control_plane"."trigger_conversation_delivery_tasks"."source_scheduled_action_id" is null) or ("control_plane"."trigger_conversation_delivery_tasks"."source_webhook_event_id" is null and "control_plane"."trigger_conversation_delivery_tasks"."source_scheduled_action_id" is not null));
