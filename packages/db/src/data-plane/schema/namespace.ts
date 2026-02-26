import { pgSchema } from "drizzle-orm/pg-core";

export const DATA_PLANE_SCHEMA_NAME = "data_plane";

export const dataPlaneSchema = pgSchema(DATA_PLANE_SCHEMA_NAME);
