CREATE TABLE "control_plane"."integration_connection_device_authorization_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"target_key" text NOT NULL,
	"connection_method_id" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_state_encrypted" text NOT NULL,
	"verification_url" text NOT NULL,
	"user_code" text NOT NULL,
	"expires_at" timestamp with time zone,
	"poll_after_at" timestamp with time zone,
	"connection_id" text,
	"error_code" text,
	"error_message" text,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_device_authorization_attempts" ADD CONSTRAINT "integration_connection_device_authorization_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_device_authorization_attempts" ADD CONSTRAINT "integration_connection_device_authorization_attempts_target_key_integration_targets_target_key_fk" FOREIGN KEY ("target_key") REFERENCES "control_plane"."integration_targets"("target_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_device_authorization_attempts" ADD CONSTRAINT "integration_connection_device_authorization_attempts_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "int_conn_dev_auth_attempts_org_idx" ON "control_plane"."integration_connection_device_authorization_attempts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "int_conn_dev_auth_attempts_org_target_idx" ON "control_plane"."integration_connection_device_authorization_attempts" USING btree ("organization_id","target_key");--> statement-breakpoint
CREATE INDEX "int_conn_dev_auth_attempts_org_status_idx" ON "control_plane"."integration_connection_device_authorization_attempts" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "int_conn_dev_auth_attempts_expires_at_idx" ON "control_plane"."integration_connection_device_authorization_attempts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "int_conn_dev_auth_attempts_poll_after_at_idx" ON "control_plane"."integration_connection_device_authorization_attempts" USING btree ("poll_after_at");--> statement-breakpoint
CREATE INDEX "int_conn_dev_auth_attempts_connection_id_idx" ON "control_plane"."integration_connection_device_authorization_attempts" USING btree ("connection_id");
