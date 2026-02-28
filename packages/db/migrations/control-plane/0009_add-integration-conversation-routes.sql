CREATE TABLE "control_plane"."integration_conversation_routes" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"sandbox_profile_id" text NOT NULL,
	"source_binding_id" text NOT NULL,
	"conversation_key" text NOT NULL,
	"sandbox_instance_id" text NOT NULL,
	"provider_conversation_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."integration_conversation_routes" ADD CONSTRAINT "integration_conversation_routes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_conversation_routes" ADD CONSTRAINT "integration_conversation_routes_sandbox_profile_id_sandbox_profiles_id_fk" FOREIGN KEY ("sandbox_profile_id") REFERENCES "control_plane"."sandbox_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_conversation_routes" ADD CONSTRAINT "integration_conversation_routes_source_binding_id_sandbox_profile_version_integration_bindings_id_fk" FOREIGN KEY ("source_binding_id") REFERENCES "control_plane"."sandbox_profile_version_integration_bindings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_conversation_routes_org_binding_key_uidx" ON "control_plane"."integration_conversation_routes" USING btree ("organization_id","source_binding_id","conversation_key");--> statement-breakpoint
CREATE INDEX "integration_conversation_routes_organization_id_idx" ON "control_plane"."integration_conversation_routes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "integration_conversation_routes_sandbox_profile_id_idx" ON "control_plane"."integration_conversation_routes" USING btree ("sandbox_profile_id");--> statement-breakpoint
CREATE INDEX "integration_conversation_routes_source_binding_id_idx" ON "control_plane"."integration_conversation_routes" USING btree ("source_binding_id");--> statement-breakpoint
CREATE INDEX "integration_conversation_routes_sandbox_instance_id_idx" ON "control_plane"."integration_conversation_routes" USING btree ("sandbox_instance_id");