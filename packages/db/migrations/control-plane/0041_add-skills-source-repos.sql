CREATE TABLE "control_plane"."skills_source_repos" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"origin_url" text NOT NULL,
	"commit_sha" text,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."skills_source_repos" ADD CONSTRAINT "skills_source_repos_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skills_source_repos_organization_id_origin_url_uidx" ON "control_plane"."skills_source_repos" USING btree ("organization_id","origin_url");--> statement-breakpoint
CREATE INDEX "skills_source_repos_organization_id_idx" ON "control_plane"."skills_source_repos" USING btree ("organization_id");