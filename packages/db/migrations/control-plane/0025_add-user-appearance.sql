ALTER TABLE "control_plane"."users" ADD COLUMN "appearance" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "control_plane"."users" ADD CONSTRAINT "users_appearance_check" CHECK ("control_plane"."users"."appearance" in ('system', 'light', 'dark'));
