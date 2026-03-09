import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import * as controlPlaneSchema from "./schema/index.js";

export type ControlPlaneDatabase = NodePgDatabase<typeof controlPlaneSchema>;
export type ControlPlaneTransaction = Parameters<ControlPlaneDatabase["transaction"]>[0] extends (
  tx: infer T,
) => Promise<unknown>
  ? T
  : never;

export function createControlPlaneDatabase(pool: Pool): ControlPlaneDatabase {
  return drizzle(pool, {
    schema: controlPlaneSchema,
  });
}
