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
ALTER TABLE "control_plane"."sandbox_profile_version_integration_bindings" ADD CONSTRAINT "sandbox_profile_version_integration_bindings_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_version_integration_bindings" ADD CONSTRAINT "spv_integration_bindings_sandbox_profile_version_fkey" FOREIGN KEY ("sandbox_profile_id","sandbox_profile_version") REFERENCES "control_plane"."sandbox_profile_versions"("sandbox_profile_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spv_integration_bindings_profile_id_version_idx" ON "control_plane"."sandbox_profile_version_integration_bindings" USING btree ("sandbox_profile_id","sandbox_profile_version");--> statement-breakpoint
CREATE INDEX "spv_integration_bindings_connection_id_idx" ON "control_plane"."sandbox_profile_version_integration_bindings" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "spv_integration_bindings_profile_id_version_kind_idx" ON "control_plane"."sandbox_profile_version_integration_bindings" USING btree ("sandbox_profile_id","sandbox_profile_version","kind");
