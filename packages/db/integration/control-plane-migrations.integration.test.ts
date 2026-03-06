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

      const conversationColumnsResult = await pool.query<{
        column_name: string;
      }>(
        `
          select column_name
          from information_schema.columns
          where table_schema = $1 and table_name = 'conversations'
          order by ordinal_position asc
        `,
        [CONTROL_PLANE_SCHEMA_NAME],
      );
      expect(conversationColumnsResult.rows.map((row) => row.column_name)).toEqual([
        "id",
        "organization_id",
        "owner_kind",
        "owner_id",
        "created_by_kind",
        "created_by_id",
        "sandbox_profile_id",
        "provider_family",
        "conversation_key",
        "title",
        "preview",
        "status",
        "created_at",
        "updated_at",
        "last_activity_at",
      ]);

      const conversationRouteColumnsResult = await pool.query<{
        column_name: string;
      }>(
        `
          select column_name
          from information_schema.columns
          where table_schema = $1 and table_name = 'conversation_routes'
          order by ordinal_position asc
        `,
        [CONTROL_PLANE_SCHEMA_NAME],
      );
      expect(conversationRouteColumnsResult.rows.map((row) => row.column_name)).toEqual([
        "id",
        "conversation_id",
        "sandbox_instance_id",
        "provider_conversation_id",
        "provider_execution_id",
        "provider_state",
        "status",
        "created_at",
        "updated_at",
      ]);

      const conversationsIndexResult = await pool.query<{
        indexname: string;
      }>(
        `
          select indexname
          from pg_indexes
          where schemaname = $1 and tablename = 'conversations'
          order by indexname asc
        `,
        [CONTROL_PLANE_SCHEMA_NAME],
      );
      expect(conversationsIndexResult.rows.map((row) => row.indexname)).toEqual(
        expect.arrayContaining([
          "conversations_org_owner_idx",
          "conversations_org_owner_key_uidx",
          "conversations_organization_id_idx",
          "conversations_sandbox_profile_id_idx",
        ]),
      );

      const conversationRoutesIndexResult = await pool.query<{
        indexname: string;
      }>(
        `
          select indexname
          from pg_indexes
          where schemaname = $1 and tablename = 'conversation_routes'
          order by indexname asc
        `,
        [CONTROL_PLANE_SCHEMA_NAME],
      );
      expect(conversationRoutesIndexResult.rows.map((row) => row.indexname)).toEqual(
        expect.arrayContaining([
          "conversation_routes_conversation_id_idx",
          "conversation_routes_conversation_id_uidx",
          "conversation_routes_sandbox_instance_id_idx",
        ]),
      );

      const conversationRouteForeignKeysResult = await pool.query<{
        constraint_name: string;
        column_name: string;
        foreign_table_name: string;
        foreign_column_name: string;
      }>(
        `
          select
            tc.constraint_name,
            kcu.column_name,
            ccu.table_name as foreign_table_name,
            ccu.column_name as foreign_column_name
          from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu
            on tc.constraint_name = kcu.constraint_name
            and tc.table_schema = kcu.table_schema
          join information_schema.constraint_column_usage ccu
            on tc.constraint_name = ccu.constraint_name
            and tc.table_schema = ccu.table_schema
          where tc.constraint_type = 'FOREIGN KEY'
            and tc.table_schema = $1
            and tc.table_name = 'conversation_routes'
          order by tc.constraint_name asc
        `,
        [CONTROL_PLANE_SCHEMA_NAME],
      );
      expect(conversationRouteForeignKeysResult.rows).toEqual(
        expect.arrayContaining([
          {
            constraint_name: "conversation_routes_conversation_id_conversations_id_fk",
            column_name: "conversation_id",
            foreign_table_name: "conversations",
            foreign_column_name: "id",
          },
        ]),
      );

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
