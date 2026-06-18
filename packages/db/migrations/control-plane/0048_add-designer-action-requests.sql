CREATE TABLE "control_plane"."designer_action_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"designer_session_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"response" text NOT NULL,
	"response_idempotency_key" text NOT NULL,
	"operation_kind" text NOT NULL,
	"operation" jsonb NOT NULL,
	"status" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"runtime_provider_conversation_id" text NOT NULL,
	"runtime_provider_execution_id" text,
	"response_submitted_at" timestamp with time zone,
	"failure_code" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."designer_action_requests" ADD CONSTRAINT "designer_action_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."designer_action_requests" ADD CONSTRAINT "designer_action_requests_designer_session_id_designer_sessions_id_fk" FOREIGN KEY ("designer_session_id") REFERENCES "control_plane"."designer_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "designer_action_requests_session_proposal_uidx" ON "control_plane"."designer_action_requests" USING btree ("designer_session_id","proposal_id");--> statement-breakpoint
CREATE INDEX "designer_action_requests_org_session_idx" ON "control_plane"."designer_action_requests" USING btree ("organization_id","designer_session_id");--> statement-breakpoint
CREATE INDEX "designer_action_requests_status_idx" ON "control_plane"."designer_action_requests" USING btree ("status");