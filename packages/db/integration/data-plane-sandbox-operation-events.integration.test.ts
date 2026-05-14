/* eslint-disable jest/no-standalone-expect --
 * This file uses the package's fixture-bound `it` helper.
 */

import { Pool } from "pg";
import { describe, expect } from "vitest";

import {
  DATA_PLANE_SCHEMA_NAME,
  SandboxInstanceProviders,
  SandboxInstanceSources,
  SandboxInstanceStarterKinds,
  createDataPlaneDatabase,
  insertSandboxOperationEvent,
  sandboxInstances,
} from "../src/data-plane/index.js";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "../src/migrator/index.js";
import { it } from "./test-context.js";

describe("sandbox operation events integration", () => {
  it("assigns contiguous sequence numbers across mixed event sources for one operation", async ({
    databaseStack,
  }) => {
    await runDataPlaneMigrations({
      connectionString: databaseStack.directUrl,
      schemaName: DATA_PLANE_SCHEMA_NAME,
      migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
    });

    const pool = new Pool({
      connectionString: databaseStack.directUrl,
    });
    const database = createDataPlaneDatabase(pool);

    try {
      await database.insert(sandboxInstances).values({
        id: "sbi_operation_events_test",
        organizationId: "org_operation_events_test",
        sandboxProfileId: "sbp_operation_events_test",
        sandboxProfileVersion: 1,
        runtimeProvider: SandboxInstanceProviders.E2B,
        startedByKind: SandboxInstanceStarterKinds.SYSTEM,
        startedById: "workflow_operation_events_test",
        source: SandboxInstanceSources.SYSTEM,
      });

      await Promise.all([
        insertSandboxOperationEvent(database, {
          attributes: {},
          message: "Provider start completed.",
          observedAt: "2026-05-13T01:00:00.000Z",
          operationId: "workflow_operation_events_test",
          operationKind: "start",
          payloadBytes: null,
          phase: "provider",
          recordKind: "lifecycle",
          sandboxInstanceId: "sbi_operation_events_test",
          source: "worker",
          status: "completed",
          stream: null,
        }),
        insertSandboxOperationEvent(database, {
          attributes: {},
          message: "",
          observedAt: "2026-05-13T01:00:01.000Z",
          operationId: "workflow_operation_events_test",
          operationKind: "start",
          payloadBytes: Buffer.from("Runtime plan output\n", "utf8"),
          phase: "runtime_plan",
          recordKind: "transcript",
          sandboxInstanceId: "sbi_operation_events_test",
          source: "sandboxd",
          status: null,
          stream: "stdout",
        }),
        insertSandboxOperationEvent(database, {
          attributes: {},
          message: "Running status completed.",
          observedAt: "2026-05-13T01:00:02.000Z",
          operationId: "workflow_operation_events_test",
          operationKind: "start",
          payloadBytes: null,
          phase: "running",
          recordKind: "lifecycle",
          sandboxInstanceId: "sbi_operation_events_test",
          source: "worker",
          status: "completed",
          stream: null,
        }),
      ]);

      const events = await database.query.sandboxOperationEvents.findMany({
        columns: {
          operationId: true,
          sequence: true,
          source: true,
        },
        where: (table, { eq }) => eq(table.sandboxInstanceId, "sbi_operation_events_test"),
        orderBy: (table, { asc }) => [asc(table.sequence)],
      });

      expect(events).toEqual([
        {
          operationId: "workflow_operation_events_test",
          sequence: 1,
          source: expect.any(String),
        },
        {
          operationId: "workflow_operation_events_test",
          sequence: 2,
          source: expect.any(String),
        },
        {
          operationId: "workflow_operation_events_test",
          sequence: 3,
          source: expect.any(String),
        },
      ]);
      expect(new Set(events.map((event) => event.source))).toEqual(new Set(["sandboxd", "worker"]));
    } finally {
      await pool.end();
    }
  }, 60_000);
});
