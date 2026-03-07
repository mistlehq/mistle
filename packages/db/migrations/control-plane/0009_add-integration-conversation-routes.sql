CREATE TABLE "control_plane"."conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" text NOT NULL,
	"created_by_kind" text NOT NULL,
	"created_by_id" text NOT NULL,
	"sandbox_profile_id" text NOT NULL,
	"provider_family" text NOT NULL,
	"conversation_key" text NOT NULL,
	"title" text,
	"preview" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."conversation_routes" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"sandbox_instance_id" text NOT NULL,
	"provider_conversation_id" text,
	"provider_execution_id" text,
	"provider_state" jsonb,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."conversations" ADD CONSTRAINT "conversations_sandbox_profile_id_sandbox_profiles_id_fk" FOREIGN KEY ("sandbox_profile_id") REFERENCES "control_plane"."sandbox_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."conversation_routes" ADD CONSTRAINT "conversation_routes_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "control_plane"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_org_owner_key_uidx" ON "control_plane"."conversations" USING btree ("organization_id","owner_kind","owner_id","conversation_key");--> statement-breakpoint
CREATE INDEX "conversations_organization_id_idx" ON "control_plane"."conversations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "conversations_sandbox_profile_id_idx" ON "control_plane"."conversations" USING btree ("sandbox_profile_id");--> statement-breakpoint
CREATE INDEX "conversations_org_owner_idx" ON "control_plane"."conversations" USING btree ("organization_id","owner_kind","owner_id");--> statement-breakpoint
CREATE INDEX "conversation_routes_conversation_id_idx" ON "control_plane"."conversation_routes" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_routes_sandbox_instance_id_idx" ON "control_plane"."conversation_routes" USING btree ("sandbox_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_routes_conversation_id_uidx" ON "control_plane"."conversation_routes" USING btree ("conversation_id");
