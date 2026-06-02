-- squawk-ignore-file ban-drop-table
-- squawk-ignore-file ban-drop-column
drop table if exists "control_plane"."organization_sandbox_storage_settings";

alter table "control_plane"."sandbox_profile_versions"
  drop column if exists "default_persistence_mode";
