import { pgSchema } from "drizzle-orm/pg-core";

export const CONTROL_PLANE_SCHEMA_NAME = "control_plane";

export const controlPlaneSchema = pgSchema(CONTROL_PLANE_SCHEMA_NAME);
