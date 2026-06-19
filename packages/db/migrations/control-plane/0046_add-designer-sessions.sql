CREATE TABLE "control_plane"."designer_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"sandbox_instance_id" text NOT NULL,
	"initial_prompt" text,
	"canvas_tabs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."designer_sessions" ADD CONSTRAINT "designer_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "designer_sessions_sandbox_instance_uidx" ON "control_plane"."designer_sessions" USING btree ("sandbox_instance_id");--> statement-breakpoint
CREATE INDEX "designer_sessions_org_updated_idx" ON "control_plane"."designer_sessions" USING btree ("organization_id","updated_at");