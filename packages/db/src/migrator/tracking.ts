export const MigrationTracking = Object.freeze({
  CONTROL_PLANE: Object.freeze({
    SCHEMA_NAME: "control_plane_meta",
    TABLE_NAME: "schema_migrations",
  }),
  DATA_PLANE: Object.freeze({
    SCHEMA_NAME: "data_plane_meta",
    TABLE_NAME: "schema_migrations",
  }),
});
