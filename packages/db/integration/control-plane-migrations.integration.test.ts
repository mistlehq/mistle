import { getTableName, isTable } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import * as controlPlaneSchema from "../src/control-plane/schema/index.js";
import { CONTROL_PLANE_SCHEMA_NAME } from "../src/control-plane/schema/namespace.js";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "../src/migrator/index.js";
import { it } from "./test-context.js";

describe("control-plane migrations integration", () => {
  it("applies control-plane migrations and can rerun safely", async ({ databaseStack }) => {
    const controlPlaneMigrationInput = {
      connectionString: databaseStack.directUrl,
      schemaName: CONTROL_PLANE_SCHEMA_NAME,
      migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
    };

    await runControlPlaneMigrations(controlPlaneMigrationInput);

    const pool = new Pool({
      connectionString: databaseStack.directUrl,
    });

    try {
      const tablesResult = await pool.query<{ table_name: string }>(
        `
          select table_name
          from information_schema.tables
          where table_schema = $1
          order by table_name asc
        `,
        [CONTROL_PLANE_SCHEMA_NAME],
      );

      const expectedTableNames = Object.values(controlPlaneSchema)
        .flatMap((value) => (isTable(value) ? [getTableName(value)] : []))
        .sort((left, right) => left.localeCompare(right));
      const actualTableNames = tablesResult.rows
        .map((row) => row.table_name)
        .sort((left, right) => left.localeCompare(right));
      expect(actualTableNames).toEqual(expectedTableNames);

      const expectedMigrationCount = readMigrationFiles({
        migrationsFolder: controlPlaneMigrationInput.migrationsFolder,
      }).length;
      const migrationTableRowCountQuery = `select count(*)::int as migration_count from "${controlPlaneMigrationInput.migrationsSchema}"."${controlPlaneMigrationInput.migrationsTable}"`;

      const migrationRowsAfterFirstRunResult = await pool.query<{ migration_count: number }>(
        migrationTableRowCountQuery,
      );
      expect(migrationRowsAfterFirstRunResult.rows[0]?.migration_count).toBe(
        expectedMigrationCount,
      );

      await runControlPlaneMigrations(controlPlaneMigrationInput);

      const migrationRowsResult = await pool.query<{ migration_count: number }>(
        migrationTableRowCountQuery,
      );
      expect(migrationRowsResult.rows[0]?.migration_count).toBe(expectedMigrationCount);
    } finally {
      await pool.end();
    }
  }, 60_000);
});
