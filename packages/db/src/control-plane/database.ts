import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import * as controlPlaneSchema from "./schema/index.js";

export type ControlPlaneDatabase = NodePgDatabase<typeof controlPlaneSchema>;

export function createControlPlaneDatabase(pool: Pool): ControlPlaneDatabase {
  return drizzle(pool, {
    schema: controlPlaneSchema,
  });
}
