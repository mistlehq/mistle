import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import { createControlPlaneDbSchema, type ControlPlaneDbSchema } from "./schema/factory.js";
import { CONTROL_PLANE_SCHEMA_NAME } from "./schema/index.js";

export type ControlPlaneDatabase = NodePgDatabase<ControlPlaneDbSchema>;
export type ControlPlaneTables = ControlPlaneDbSchema;
export type ControlPlaneTransaction = Parameters<ControlPlaneDatabase["transaction"]>[0] extends (
  tx: infer T,
) => Promise<unknown>
  ? T
  : never;

const ControlPlaneDatabaseSchemas = new WeakMap<ControlPlaneDatabase, ControlPlaneDbSchema>();

export function createControlPlaneDatabase(
  pool: Pool,
  options: {
    schemaName?: string;
  } = {},
): ControlPlaneDatabase {
  const schema = createControlPlaneDbSchema(options.schemaName ?? CONTROL_PLANE_SCHEMA_NAME);

  const database = drizzle(pool, {
    schema,
  });
  ControlPlaneDatabaseSchemas.set(database, schema);

  return database;
}

export function getControlPlaneDatabaseSchema(
  database: ControlPlaneDatabase,
): ControlPlaneDbSchema {
  const schema = ControlPlaneDatabaseSchemas.get(database);
  if (schema === undefined) {
    throw new Error("Expected control-plane database to have a bound schema.");
  }

  return schema;
}
