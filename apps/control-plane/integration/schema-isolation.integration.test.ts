import { ControlPlaneOpenWorkflow, createControlPlaneBackend } from "@control-plane/workflows";
import postgres from "postgres";
import { describe, expect } from "vitest";

import { DataPlaneOpenWorkflow, createDataPlaneBackend } from "../../data-plane/workflows/index.js";
import { it } from "./test-context.js";

const REQUIRED_OPENWORKFLOW_TABLES: string[] = [
  "openworkflow_migrations",
  "step_attempts",
  "workflow_runs",
];

type SqlClient = ReturnType<typeof postgres>;

async function listSchemaTables(sql: SqlClient, schemaName: string): Promise<string[]> {
  const rows = await sql<{ table_name: string }[]>`
    select table_name
    from information_schema.tables
    where table_schema = ${schemaName}
    order by table_name asc
  `;

  return rows.map((row) => row.table_name);
}

describe("workflow schema isolation integration", () => {
  it("creates dedicated schemas for control-plane and data-plane", async ({ fixture }) => {
    let controlPlaneBackend: Awaited<ReturnType<typeof createControlPlaneBackend>> | undefined;
    let dataPlaneBackend: Awaited<ReturnType<typeof createDataPlaneBackend>> | undefined;
    const sql = postgres(fixture.databaseStack.directUrl, {
      max: 1,
    });

    try {
      controlPlaneBackend = await createControlPlaneBackend({
        url: fixture.databaseStack.directUrl,
        namespaceId: "control-plane-tests",
        runMigrations: true,
      });
      dataPlaneBackend = await createDataPlaneBackend({
        url: fixture.databaseStack.directUrl,
        namespaceId: "data-plane-tests",
        runMigrations: true,
      });

      const controlPlaneSchemaTables = await listSchemaTables(sql, ControlPlaneOpenWorkflow.SCHEMA);
      const dataPlaneSchemaTables = await listSchemaTables(sql, DataPlaneOpenWorkflow.SCHEMA);
      const defaultSchemaTables = await listSchemaTables(sql, "openworkflow");

      expect(controlPlaneSchemaTables).toEqual(
        expect.arrayContaining(REQUIRED_OPENWORKFLOW_TABLES),
      );
      expect(dataPlaneSchemaTables).toEqual(expect.arrayContaining(REQUIRED_OPENWORKFLOW_TABLES));
      expect(defaultSchemaTables).toHaveLength(0);
    } finally {
      await sql.end({ timeout: 5 });

      const stopPromises: Promise<void>[] = [];
      if (controlPlaneBackend !== undefined) {
        stopPromises.push(controlPlaneBackend.stop());
      }
      if (dataPlaneBackend !== undefined) {
        stopPromises.push(dataPlaneBackend.stop());
      }

      await Promise.all(stopPromises);
    }
  }, 60_000);
});
