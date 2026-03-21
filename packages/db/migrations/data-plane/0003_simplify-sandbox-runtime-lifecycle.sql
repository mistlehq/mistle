DROP TABLE "data_plane"."sandbox_execution_leases" CASCADE;--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_instances" ADD COLUMN "stop_reason" text;--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_instances" DROP COLUMN "tunnel_connected_at";--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_instances" DROP COLUMN "last_tunnel_seen_at";--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_instances" DROP COLUMN "active_tunnel_lease_id";--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_instances" DROP COLUMN "tunnel_disconnected_at";