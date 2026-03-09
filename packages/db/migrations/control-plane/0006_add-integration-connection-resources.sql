CREATE TABLE "control_plane"."integration_connection_resource_states" (
	"connection_id" text NOT NULL,
	"family_id" text NOT NULL,
	"kind" text NOT NULL,
	"sync_state" text DEFAULT 'never-synced' NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_started_at" timestamp with time zone,
	"last_sync_finished_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connection_resource_states_pk" PRIMARY KEY("connection_id","kind")
);
--> statement-breakpoint
CREATE TABLE "control_plane"."integration_connection_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"family_id" text NOT NULL,
	"kind" text NOT NULL,
	"external_id" text,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'accessible' NOT NULL,
	"unavailable_reason" text,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_resource_states" ADD CONSTRAINT "integration_connection_resource_states_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_resources" ADD CONSTRAINT "integration_connection_resources_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_connection_resource_states_connection_id_family_id_kind_idx" ON "control_plane"."integration_connection_resource_states" USING btree ("connection_id","family_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connection_resources_connection_id_kind_handle_unique" ON "control_plane"."integration_connection_resources" USING btree ("connection_id","kind","handle");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connection_resources_connection_id_kind_external_id_unique" ON "control_plane"."integration_connection_resources" USING btree ("connection_id","kind","external_id");--> statement-breakpoint
CREATE INDEX "integration_connection_resources_connection_id_kind_status_idx" ON "control_plane"."integration_connection_resources" USING btree ("connection_id","kind","status");--> statement-breakpoint
CREATE INDEX "integration_connection_resources_connection_id_family_id_kind_idx" ON "control_plane"."integration_connection_resources" USING btree ("connection_id","family_id","kind");--> statement-breakpoint
CREATE INDEX "integration_connection_resources_connection_id_kind_display_name_idx" ON "control_plane"."integration_connection_resources" USING btree ("connection_id","kind","display_name");