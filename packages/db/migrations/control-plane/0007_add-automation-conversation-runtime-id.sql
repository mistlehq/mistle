ALTER TABLE "control_plane"."automation_runs" DROP CONSTRAINT "automation_runs_automation_conversation_id_automation_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversation_delivery_processors" DROP CONSTRAINT "automation_conversation_delivery_processors_automation_conversation_id_automation_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversation_delivery_tasks" DROP CONSTRAINT "automation_conversation_delivery_tasks_automation_conversation_id_automation_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversation_routes" DROP CONSTRAINT "automation_conversation_routes_automation_conversation_id_automation_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversation_delivery_tasks" ALTER COLUMN "attempt_count" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversations" ADD COLUMN "runtime_id" text;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversations"
ADD CONSTRAINT "automation_conversations_runtime_id_not_null"
CHECK ("runtime_id" IS NOT NULL) NOT VALID;--> statement-breakpoint
UPDATE "control_plane"."automation_conversations"
SET "runtime_id" = 'codex'
WHERE "integration_family_id" = 'openai'
  AND "runtime_id" IS NULL;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversations"
VALIDATE CONSTRAINT "automation_conversations_runtime_id_not_null";--> statement-breakpoint
ALTER TABLE "control_plane"."automation_runs" ADD CONSTRAINT "automation_runs_conversation_id_automation_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "control_plane"."automation_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversation_delivery_processors" ADD CONSTRAINT "automation_conversation_delivery_processors_conversation_id_automation_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "control_plane"."automation_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversation_delivery_tasks" ADD CONSTRAINT "automation_conversation_delivery_tasks_conversation_id_automation_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "control_plane"."automation_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_conversation_routes" ADD CONSTRAINT "automation_conversation_routes_conversation_id_automation_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "control_plane"."automation_conversations"("id") ON DELETE cascade ON UPDATE no action;
