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

type ControlPlaneSchemaBoundDatabase = ControlPlaneDatabase | ControlPlaneTransaction;
type ControlPlaneTransactionConfig = Parameters<ControlPlaneDatabase["transaction"]>[1];

const ControlPlaneDatabaseSchemas = new WeakMap<
  ControlPlaneSchemaBoundDatabase,
  ControlPlaneDbSchema
>();

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
  bindControlPlaneTransactionSchema(database, schema);

  return database;
}

export function getControlPlaneDatabaseSchema(
  database: ControlPlaneSchemaBoundDatabase,
): ControlPlaneDbSchema {
  const schema = ControlPlaneDatabaseSchemas.get(database);
  if (schema === undefined) {
    throw new Error("Expected control-plane database to have a bound schema.");
  }

  return schema;
}

function bindControlPlaneTransactionSchema(
  database: ControlPlaneSchemaBoundDatabase,
  schema: ControlPlaneDbSchema,
): void {
  const transaction = database.transaction.bind(database);

  database.transaction = async <T>(
    callback: (tx: ControlPlaneTransaction) => Promise<T>,
    config?: ControlPlaneTransactionConfig,
  ): Promise<T> =>
    transaction(async (tx) => {
      // Drizzle creates a new transaction object for each transaction and
      // savepoint. Carry the schema binding forward so runtime code can resolve
      // schema-bound tables from either the root database or the active tx.
      ControlPlaneDatabaseSchemas.set(tx, schema);
      bindControlPlaneTransactionSchema(tx, schema);

      return callback(tx);
    }, config);
}
