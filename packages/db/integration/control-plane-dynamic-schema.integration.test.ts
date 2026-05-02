/* eslint-disable jest/no-standalone-expect --
 * This file uses the package's fixture-bound `it` helper.
 */

import { Pool } from "pg";
import { describe, expect } from "vitest";

import {
  createControlPlaneDatabase,
  createControlPlaneDbSchema,
} from "../src/control-plane/index.js";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  runControlPlaneMigrations,
} from "../src/migrator/index.js";
import { it } from "./test-context.js";

const OrganizationId = "org_dynamic_schema_shared";
const IntegrationConnectionId = "icn_dynamic_schema_shared";
const IntegrationTargetKey = "dynamic-schema-target";
const SchemaNameA = "test_env_a_control_plane";
const SchemaNameB = "test_env_b_control_plane";

describe("control-plane dynamic schema integration", () => {
  it("migrates dynamic schemas and keeps data isolated across schema-specific clients", async ({
    databaseStack,
  }) => {
    await runControlPlaneMigrations({
      connectionString: databaseStack.directUrl,
      schemaName: SchemaNameA,
      migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: `${SchemaNameA}_meta`,
      migrationsTable: "schema_migrations",
    });
    await runControlPlaneMigrations({
      connectionString: databaseStack.directUrl,
      schemaName: SchemaNameB,
      migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: `${SchemaNameB}_meta`,
      migrationsTable: "schema_migrations",
    });
    await runControlPlaneMigrations({
      connectionString: databaseStack.directUrl,
      schemaName: SchemaNameA,
      migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: `${SchemaNameA}_meta`,
      migrationsTable: "schema_migrations",
    });

    const pool = new Pool({
      connectionString: databaseStack.directUrl,
    });
    const schemaA = createControlPlaneDbSchema(SchemaNameA);
    const schemaB = createControlPlaneDbSchema(SchemaNameB);
    const dbA = createControlPlaneDatabase(pool, {
      schemaName: SchemaNameA,
    });
    const dbB = createControlPlaneDatabase(pool, {
      schemaName: SchemaNameB,
    });

    try {
      await dbA.insert(schemaA.organizations).values({
        id: OrganizationId,
        name: "Dynamic Schema A",
        slug: "dynamic-schema-a",
      });
      await dbB.insert(schemaB.organizations).values({
        id: OrganizationId,
        name: "Dynamic Schema B",
        slug: "dynamic-schema-b",
      });
      await dbA.insert(schemaA.integrationTargets).values({
        targetKey: IntegrationTargetKey,
        familyId: "dynamic-schema",
        variantId: "a",
        config: {},
        displayNameOverride: "Target A",
      });
      await dbB.insert(schemaB.integrationTargets).values({
        targetKey: IntegrationTargetKey,
        familyId: "dynamic-schema",
        variantId: "b",
        config: {},
        displayNameOverride: "Target B",
      });
      await dbA.insert(schemaA.integrationConnections).values({
        id: IntegrationConnectionId,
        organizationId: OrganizationId,
        targetKey: IntegrationTargetKey,
        displayName: "Connection A",
      });
      await dbB.insert(schemaB.integrationConnections).values({
        id: IntegrationConnectionId,
        organizationId: OrganizationId,
        targetKey: IntegrationTargetKey,
        displayName: "Connection B",
      });

      const rowA = await dbA.query.organizations.findFirst({
        columns: {
          name: true,
          slug: true,
        },
        where: (table, { eq }) => eq(table.id, OrganizationId),
      });
      const rowB = await dbB.query.organizations.findFirst({
        columns: {
          name: true,
          slug: true,
        },
        where: (table, { eq }) => eq(table.id, OrganizationId),
      });
      const connectionA = await dbA.query.integrationConnections.findFirst({
        columns: {
          displayName: true,
        },
        where: (table, { eq }) => eq(table.id, IntegrationConnectionId),
        with: {
          target: {
            columns: {
              displayNameOverride: true,
              variantId: true,
            },
          },
        },
      });
      const connectionB = await dbB.query.integrationConnections.findFirst({
        columns: {
          displayName: true,
        },
        where: (table, { eq }) => eq(table.id, IntegrationConnectionId),
        with: {
          target: {
            columns: {
              displayNameOverride: true,
              variantId: true,
            },
          },
        },
      });

      expect(rowA).toEqual({
        name: "Dynamic Schema A",
        slug: "dynamic-schema-a",
      });
      expect(rowB).toEqual({
        name: "Dynamic Schema B",
        slug: "dynamic-schema-b",
      });
      expect(connectionA).toEqual({
        displayName: "Connection A",
        target: {
          displayNameOverride: "Target A",
          variantId: "a",
        },
      });
      expect(connectionB).toEqual({
        displayName: "Connection B",
        target: {
          displayNameOverride: "Target B",
          variantId: "b",
        },
      });
    } finally {
      await pool.end();
    }
  });
});
