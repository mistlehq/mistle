import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import { createDataPlaneDbSchema, type DataPlaneDbSchema } from "./schema/factory.js";
import { DATA_PLANE_SCHEMA_NAME } from "./schema/index.js";

export type DataPlaneDatabase = NodePgDatabase<DataPlaneDbSchema>;

export function createDataPlaneDatabase(
  pool: Pool,
  options: {
    schemaName?: string;
  } = {},
): DataPlaneDatabase {
  const schema = createDataPlaneDbSchema(options.schemaName ?? DATA_PLANE_SCHEMA_NAME);

  return drizzle(pool, {
    schema,
  });
}
