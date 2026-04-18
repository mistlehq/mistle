CREATE TABLE "control_plane"."identity_link_redirect_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider_family" text NOT NULL,
	"organization_provider_config_id" text NOT NULL,
	"integration_connection_id" text NOT NULL,
	"state" text NOT NULL,
	"pkce_verifier_encrypted" text,
	"provider_state_encrypted" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."identity_link_redirect_sessions" ADD CONSTRAINT "identity_link_redirect_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."identity_link_redirect_sessions" ADD CONSTRAINT "identity_link_redirect_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "control_plane"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."identity_link_redirect_sessions" ADD CONSTRAINT "identity_link_redirect_sessions_organization_provider_config_id_organization_identity_link_provider_configs_id_fk" FOREIGN KEY ("organization_provider_config_id") REFERENCES "control_plane"."organization_identity_link_provider_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."identity_link_redirect_sessions" ADD CONSTRAINT "identity_link_redirect_sessions_integration_connection_id_integration_connections_id_fk" FOREIGN KEY ("integration_connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."identity_link_redirect_sessions" ADD CONSTRAINT "identity_link_redirect_sessions_org_provider_conn_cfg_fkey" FOREIGN KEY ("organization_id","provider_family","integration_connection_id","organization_provider_config_id") REFERENCES "control_plane"."organization_identity_link_provider_configs"("organization_id","provider_family","integration_connection_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_link_redirect_sessions_state_uidx" ON "control_plane"."identity_link_redirect_sessions" USING btree ("state");--> statement-breakpoint
CREATE INDEX "identity_link_redirect_sessions_org_user_idx" ON "control_plane"."identity_link_redirect_sessions" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "identity_link_redirect_sessions_org_provider_user_idx" ON "control_plane"."identity_link_redirect_sessions" USING btree ("organization_id","provider_family","user_id");--> statement-breakpoint
CREATE INDEX "identity_link_redirect_sessions_expires_at_idx" ON "control_plane"."identity_link_redirect_sessions" USING btree ("expires_at");