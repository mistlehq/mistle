import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import { createDataPlaneDbSchema, type DataPlaneDbSchema } from "./schema/factory.js";
import { DATA_PLANE_SCHEMA_NAME } from "./schema/index.js";

export type DataPlaneDatabase = NodePgDatabase<DataPlaneDbSchema>;
export type DataPlaneTables = DataPlaneDbSchema;

type DataPlaneTransaction = Parameters<DataPlaneDatabase["transaction"]>[0] extends (
  tx: infer T,
) => Promise<unknown>
  ? T
  : never;
type DataPlaneSchemaBoundDatabase = DataPlaneDatabase | DataPlaneTransaction;
type DataPlaneTransactionConfig = Parameters<DataPlaneDatabase["transaction"]>[1];

const DataPlaneDatabaseSchemas = new WeakMap<DataPlaneSchemaBoundDatabase, DataPlaneDbSchema>();

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
  bindDataPlaneTransactionSchema(database, schema);

  return database;
}

export function getDataPlaneDatabaseSchema(
  database: DataPlaneSchemaBoundDatabase,
): DataPlaneDbSchema {
  const schema = DataPlaneDatabaseSchemas.get(database);
  if (schema === undefined) {
    throw new Error("Expected data-plane database to have a bound schema.");
  }

  return schema;
}

function bindDataPlaneTransactionSchema(
  database: DataPlaneSchemaBoundDatabase,
  schema: DataPlaneDbSchema,
): void {
  const transaction = database.transaction.bind(database);

  database.transaction = async <T>(
    callback: (tx: DataPlaneTransaction) => Promise<T>,
    config?: DataPlaneTransactionConfig,
  ): Promise<T> =>
    transaction(async (tx) => {
      // Drizzle creates a new transaction object for each transaction and
      // savepoint. Carry the schema binding forward so runtime code can resolve
      // schema-bound tables from either the root database or the active tx.
      DataPlaneDatabaseSchemas.set(tx, schema);
      bindDataPlaneTransactionSchema(tx, schema);

      return callback(tx);
    }, config);
}
