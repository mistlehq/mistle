/* eslint-disable jest/no-standalone-expect --
 * This file uses the package's fixture-bound `it` helper.
 */

import { Pool } from "pg";
import { describe, expect } from "vitest";

import {
  createDataPlaneDatabase,
  createDataPlaneDbSchema,
  SandboxInstanceStatuses,
} from "../src/data-plane/index.js";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  runDataPlaneMigrations,
} from "../src/migrator/index.js";
import { it } from "./test-context.js";

const SandboxInstanceId = "sbi_dynamic_schema_shared";
const SchemaNameA = "test_env_a_data_plane";
const SchemaNameB = "test_env_b_data_plane";

describe("data-plane dynamic schema integration", () => {
  it("migrates dynamic schemas and keeps data isolated across schema-specific clients", async ({
    databaseStack,
  }) => {
    await runDataPlaneMigrations({
      connectionString: databaseStack.directUrl,
      schemaName: SchemaNameA,
      migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: `${SchemaNameA}_meta`,
      migrationsTable: "schema_migrations",
    });
    await runDataPlaneMigrations({
      connectionString: databaseStack.directUrl,
      schemaName: SchemaNameB,
      migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: `${SchemaNameB}_meta`,
      migrationsTable: "schema_migrations",
    });
    await runDataPlaneMigrations({
      connectionString: databaseStack.directUrl,
      schemaName: SchemaNameA,
      migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: `${SchemaNameA}_meta`,
      migrationsTable: "schema_migrations",
    });

    const pool = new Pool({
      connectionString: databaseStack.directUrl,
    });
    const schemaA = createDataPlaneDbSchema(SchemaNameA);
    const schemaB = createDataPlaneDbSchema(SchemaNameB);
    const dbA = createDataPlaneDatabase(pool, {
      schemaName: SchemaNameA,
    });
    const dbB = createDataPlaneDatabase(pool, {
      schemaName: SchemaNameB,
    });

    try {
      await dbA.insert(schemaA.sandboxInstances).values({
        id: SandboxInstanceId,
        organizationId: "org_dynamic_schema_a",
        sandboxProfileId: "sbp_dynamic_schema",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-dynamic-schema-a",
        status: SandboxInstanceStatuses.STARTING,
        startedByKind: "system",
        startedById: "workflow_dynamic_schema_a",
        source: "webhook",
      });
      await dbB.insert(schemaB.sandboxInstances).values({
        id: SandboxInstanceId,
        organizationId: "org_dynamic_schema_b",
        sandboxProfileId: "sbp_dynamic_schema",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-dynamic-schema-b",
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "system",
        startedById: "workflow_dynamic_schema_b",
        source: "webhook",
      });

      const rowA = await dbA.query.sandboxInstances.findFirst({
        columns: {
          organizationId: true,
          status: true,
        },
        where: (table, { eq }) => eq(table.id, SandboxInstanceId),
      });
      const rowB = await dbB.query.sandboxInstances.findFirst({
        columns: {
          organizationId: true,
          status: true,
        },
        where: (table, { eq }) => eq(table.id, SandboxInstanceId),
      });

      expect(rowA).toEqual({
        organizationId: "org_dynamic_schema_a",
        status: SandboxInstanceStatuses.STARTING,
      });
      expect(rowB).toEqual({
        organizationId: "org_dynamic_schema_b",
        status: SandboxInstanceStatuses.RUNNING,
      });
    } finally {
      await pool.end();
    }
  });
});
