import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import { createControlPlaneDbSchema, type ControlPlaneDbSchema } from "./schema/factory.js";
import { CONTROL_PLANE_SCHEMA_NAME } from "./schema/index.js";

export type ControlPlaneDatabase = NodePgDatabase<ControlPlaneDbSchema>;
export type ControlPlaneTransaction = Parameters<ControlPlaneDatabase["transaction"]>[0] extends (
  tx: infer T,
) => Promise<unknown>
  ? T
  : never;

export function createControlPlaneDatabase(
  pool: Pool,
  options: {
    schemaName?: string;
  } = {},
): ControlPlaneDatabase {
  const schema = createControlPlaneDbSchema(options.schemaName ?? CONTROL_PLANE_SCHEMA_NAME);

  return drizzle(pool, {
    schema,
  });
}
