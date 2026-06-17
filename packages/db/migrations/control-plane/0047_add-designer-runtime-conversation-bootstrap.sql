ALTER TABLE "control_plane"."designer_sessions" ADD COLUMN "runtime_provider_conversation_id" text;--> statement-breakpoint
ALTER TABLE "control_plane"."designer_sessions" ADD COLUMN "initial_prompt_provider_execution_id" text;--> statement-breakpoint
ALTER TABLE "control_plane"."designer_sessions" ADD COLUMN "initial_prompt_submitted_at" timestamp with time zone;