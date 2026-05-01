import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import { createDataPlaneDbSchema, type DataPlaneDbSchema } from "./schema/factory.js";
import { DATA_PLANE_SCHEMA_NAME } from "./schema/index.js";

export type DataPlaneDatabase = NodePgDatabase<DataPlaneDbSchema>;
export type DataPlaneTables = DataPlaneDbSchema;

const DataPlaneDatabaseSchemas = new WeakMap<DataPlaneDatabase, DataPlaneDbSchema>();

export function createDataPlaneDatabase(
  pool: Pool,
  options: {
    schemaName?: string;
  } = {},
): DataPlaneDatabase {
  const schema = createDataPlaneDbSchema(options.schemaName ?? DATA_PLANE_SCHEMA_NAME);

  const database = drizzle(pool, {
    schema,
  });
  DataPlaneDatabaseSchemas.set(database, schema);

  return database;
}

export function getDataPlaneDatabaseSchema(database: DataPlaneDatabase): DataPlaneDbSchema {
  const schema = DataPlaneDatabaseSchemas.get(database);
  if (schema === undefined) {
    throw new Error("Expected data-plane database to have a bound schema.");
  }

  return schema;
}
