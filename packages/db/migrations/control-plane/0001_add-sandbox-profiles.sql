CREATE TABLE "control_plane"."sandbox_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profiles" ADD CONSTRAINT "sandbox_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sandbox_profiles_organization_id_idx" ON "control_plane"."sandbox_profiles" USING btree ("organization_id");