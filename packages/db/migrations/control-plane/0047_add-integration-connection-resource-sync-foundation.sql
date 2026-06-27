CREATE TABLE "control_plane"."integration_connection_resource_attributes" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"family_id" text NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_external_id" text,
	"resource_handle" text NOT NULL,
	"attribute_key" text NOT NULL,
	"attribute_value" text NOT NULL,
	"value_type" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "control_plane"."integration_connection_resource_relationship_states" (
	"connection_id" text NOT NULL,
	"family_id" text NOT NULL,
	"relationship_kind" text NOT NULL,
	"scope_resource_id" text,
	"scope_kind" text NOT NULL,
	"scope_external_id" text,
	"scope_handle" text NOT NULL,
	"sync_state" text DEFAULT 'never-synced' NOT NULL,
	"total_count" bigint DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_started_at" timestamp with time zone,
	"last_sync_finished_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ic_resource_relationship_states_pk" PRIMARY KEY("connection_id","relationship_kind","scope_kind","scope_handle")
);
--> statement-breakpoint
CREATE TABLE "control_plane"."integration_connection_resource_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"family_id" text NOT NULL,
	"relationship_kind" text NOT NULL,
	"subject_resource_id" text,
	"subject_resource_kind" text NOT NULL,
	"subject_external_id" text,
	"subject_handle" text NOT NULL,
	"object_resource_id" text,
	"object_resource_kind" text NOT NULL,
	"object_external_id" text,
	"object_handle" text NOT NULL,
	"scope_resource_id" text,
	"scope_kind" text NOT NULL,
	"scope_external_id" text,
	"scope_handle" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connection_resources_connection_id_id_unique" ON "control_plane"."integration_connection_resources" USING btree ("connection_id","id");--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_resource_attributes" ADD CONSTRAINT "ic_resource_attributes_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_resource_relationship_states" ADD CONSTRAINT "ic_resource_relationship_states_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_resource_relationship_states" ADD CONSTRAINT "ic_resource_relationship_states_scope_resource_id_fkey" FOREIGN KEY ("connection_id","scope_resource_id") REFERENCES "control_plane"."integration_connection_resources"("connection_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_resource_relationships" ADD CONSTRAINT "ic_resource_relationships_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_resource_relationships" ADD CONSTRAINT "ic_resource_relationships_subject_resource_id_fkey" FOREIGN KEY ("connection_id","subject_resource_id") REFERENCES "control_plane"."integration_connection_resources"("connection_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_resource_relationships" ADD CONSTRAINT "ic_resource_relationships_object_resource_id_fkey" FOREIGN KEY ("connection_id","object_resource_id") REFERENCES "control_plane"."integration_connection_resources"("connection_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connection_resource_relationships" ADD CONSTRAINT "ic_resource_relationships_scope_resource_id_fkey" FOREIGN KEY ("connection_id","scope_resource_id") REFERENCES "control_plane"."integration_connection_resources"("connection_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ic_resource_attributes_connection_kind_handle_key_uidx" ON "control_plane"."integration_connection_resource_attributes" USING btree ("connection_id","resource_kind","resource_handle","attribute_key");--> statement-breakpoint
CREATE INDEX "ic_resource_attributes_external_lookup_idx" ON "control_plane"."integration_connection_resource_attributes" USING btree ("connection_id","resource_kind","resource_external_id","attribute_key","removed_at");--> statement-breakpoint
CREATE INDEX "ic_resource_attributes_value_lookup_idx" ON "control_plane"."integration_connection_resource_attributes" USING btree ("connection_id","resource_kind","attribute_key","attribute_value","removed_at");--> statement-breakpoint
CREATE INDEX "ic_resource_attributes_handle_lookup_idx" ON "control_plane"."integration_connection_resource_attributes" USING btree ("connection_id","resource_kind","resource_handle","attribute_key","removed_at");--> statement-breakpoint
CREATE INDEX "ic_resource_attributes_scope_cleanup_idx" ON "control_plane"."integration_connection_resource_attributes" USING btree ("connection_id","family_id","resource_kind","removed_at");--> statement-breakpoint
CREATE INDEX "ic_resource_relationship_states_external_scope_idx" ON "control_plane"."integration_connection_resource_relationship_states" USING btree ("connection_id","relationship_kind","scope_kind","scope_external_id");--> statement-breakpoint
CREATE INDEX "ic_resource_relationship_states_scope_resource_idx" ON "control_plane"."integration_connection_resource_relationship_states" USING btree ("connection_id","relationship_kind","scope_resource_id");--> statement-breakpoint
CREATE INDEX "ic_resource_relationship_states_family_kind_idx" ON "control_plane"."integration_connection_resource_relationship_states" USING btree ("connection_id","family_id","relationship_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "ic_resource_relationships_connection_edge_scope_uidx" ON "control_plane"."integration_connection_resource_relationships" USING btree ("connection_id","relationship_kind","subject_resource_kind","subject_handle","object_resource_kind","object_handle","scope_kind","scope_handle");--> statement-breakpoint
CREATE INDEX "ic_resource_relationships_subject_lookup_idx" ON "control_plane"."integration_connection_resource_relationships" USING btree ("connection_id","relationship_kind","subject_resource_kind","subject_external_id","removed_at");--> statement-breakpoint
CREATE INDEX "ic_resource_relationships_exact_external_idx" ON "control_plane"."integration_connection_resource_relationships" USING btree ("connection_id","relationship_kind","subject_resource_kind","subject_external_id","object_resource_kind","object_external_id","removed_at");--> statement-breakpoint
CREATE INDEX "ic_resource_relationships_exact_resource_idx" ON "control_plane"."integration_connection_resource_relationships" USING btree ("connection_id","relationship_kind","subject_resource_id","object_resource_id","removed_at");--> statement-breakpoint
CREATE INDEX "ic_resource_relationships_object_lookup_idx" ON "control_plane"."integration_connection_resource_relationships" USING btree ("connection_id","relationship_kind","object_resource_kind","object_external_id","removed_at");--> statement-breakpoint
CREATE INDEX "ic_resource_relationships_scope_cleanup_idx" ON "control_plane"."integration_connection_resource_relationships" USING btree ("connection_id","relationship_kind","scope_kind","scope_external_id","removed_at");--> statement-breakpoint
CREATE INDEX "ic_resource_relationships_scope_resource_cleanup_idx" ON "control_plane"."integration_connection_resource_relationships" USING btree ("connection_id","relationship_kind","scope_resource_id","removed_at");--> statement-breakpoint
CREATE INDEX "ic_resource_relationships_handle_lookup_idx" ON "control_plane"."integration_connection_resource_relationships" USING btree ("connection_id","relationship_kind","subject_resource_kind","subject_handle","object_resource_kind","object_handle","removed_at");
