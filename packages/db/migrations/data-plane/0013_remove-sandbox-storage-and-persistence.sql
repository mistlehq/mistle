-- squawk-ignore-file ban-drop-table
-- squawk-ignore-file ban-drop-column
drop table if exists "data_plane"."sandbox_instance_storages";

alter table "data_plane"."sandbox_instances"
  drop column if exists "persistence_mode";
