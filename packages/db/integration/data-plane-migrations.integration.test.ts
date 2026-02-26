import { getTableName, isTable } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import * as dataPlaneSchema from "../src/data-plane/schema/index.js";
import { DATA_PLANE_SCHEMA_NAME } from "../src/data-plane/schema/namespace.js";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "../src/migrator/index.js";
import { it } from "./test-context.js";

describe("data-plane migrations integration", () => {
  it("applies data-plane migrations and can rerun safely", async ({ databaseStack }) => {
    const dataPlaneMigrationInput = {
      connectionString: databaseStack.directUrl,
      schemaName: DATA_PLANE_SCHEMA_NAME,
      migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
    };

    await runDataPlaneMigrations(dataPlaneMigrationInput);

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
        [DATA_PLANE_SCHEMA_NAME],
      );

      const expectedTableNames = Object.values(dataPlaneSchema)
        .flatMap((value) => (isTable(value) ? [getTableName(value)] : []))
        .sort((left, right) => left.localeCompare(right));
      const actualTableNames = tablesResult.rows
        .map((row) => row.table_name)
        .sort((left, right) => left.localeCompare(right));
      expect(actualTableNames).toEqual(expectedTableNames);

      const expectedMigrationCount = readMigrationFiles({
        migrationsFolder: dataPlaneMigrationInput.migrationsFolder,
      }).length;
      const migrationTableRowCountQuery = `select count(*)::int as migration_count from "${dataPlaneMigrationInput.migrationsSchema}"."${dataPlaneMigrationInput.migrationsTable}"`;

      const migrationRowsAfterFirstRunResult = await pool.query<{ migration_count: number }>(
        migrationTableRowCountQuery,
      );
      expect(migrationRowsAfterFirstRunResult.rows[0]?.migration_count).toBe(
        expectedMigrationCount,
      );

      await runDataPlaneMigrations(dataPlaneMigrationInput);

      const migrationRowsResult = await pool.query<{ migration_count: number }>(
        migrationTableRowCountQuery,
      );
      expect(migrationRowsResult.rows[0]?.migration_count).toBe(expectedMigrationCount);
    } finally {
      await pool.end();
    }
  }, 60_000);
});
