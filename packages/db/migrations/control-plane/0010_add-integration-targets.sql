CREATE TABLE "control_plane"."integration_targets" (
	"target_key" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"display_name_override" text,
	"description_override" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "integration_targets_family_id_variant_id_idx" ON "control_plane"."integration_targets" USING btree ("family_id","variant_id");--> statement-breakpoint
CREATE INDEX "integration_targets_enabled_idx" ON "control_plane"."integration_targets" USING btree ("enabled");--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connections" ADD CONSTRAINT "integration_connections_target_key_integration_targets_target_key_fk" FOREIGN KEY ("target_key") REFERENCES "control_plane"."integration_targets"("target_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_oauth_sessions" ADD CONSTRAINT "integration_oauth_sessions_target_key_integration_targets_target_key_fk" FOREIGN KEY ("target_key") REFERENCES "control_plane"."integration_targets"("target_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_webhook_events" ADD CONSTRAINT "integration_webhook_events_target_key_integration_targets_target_key_fk" FOREIGN KEY ("target_key") REFERENCES "control_plane"."integration_targets"("target_key") ON DELETE restrict ON UPDATE no action;