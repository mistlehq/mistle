CREATE TABLE "control_plane"."integration_oauth_sessions" (
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
ALTER TABLE "control_plane"."integration_oauth_sessions" ADD CONSTRAINT "integration_oauth_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_oauth_sessions_organization_id_idx" ON "control_plane"."integration_oauth_sessions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_oauth_sessions_organization_id_target_key_idx" ON "control_plane"."integration_oauth_sessions" USING btree ("organization_id","target_key");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_oauth_sessions_state_uidx" ON "control_plane"."integration_oauth_sessions" USING btree ("state");--> statement-breakpoint
CREATE INDEX "integration_oauth_sessions_expires_at_idx" ON "control_plane"."integration_oauth_sessions" USING btree ("expires_at");