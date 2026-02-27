import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import * as dataPlaneSchema from "./schema/index.js";

export type DataPlaneDatabase = NodePgDatabase<typeof dataPlaneSchema>;

export function createDataPlaneDatabase(pool: Pool): DataPlaneDatabase {
  return drizzle(pool, {
    schema: dataPlaneSchema,
  });
}
