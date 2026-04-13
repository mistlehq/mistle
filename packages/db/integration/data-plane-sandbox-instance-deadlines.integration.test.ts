import assert from "node:assert/strict";

import { Pool } from "pg";
import { describe } from "vitest";

import {
  DATA_PLANE_SCHEMA_NAME,
  SandboxInstanceDeadlineKinds,
  SandboxInstanceProviders,
  SandboxInstanceSources,
  SandboxInstanceStarterKinds,
  createDataPlaneDatabase,
  sandboxInstanceDeadlines,
  sandboxInstances,
} from "../src/data-plane/index.js";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "../src/migrator/index.js";
import { it } from "./test-context.js";

describe("sandbox_instance_deadlines integration", () => {
  it("enforces the sandbox foreign key and composite primary key", async ({ databaseStack }) => {
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
    const database = createDataPlaneDatabase(pool);

    try {
      await database.insert(sandboxInstances).values({
        id: "sbi_deadline_test",
        organizationId: "org_deadline_test",
        sandboxProfileId: "sbp_deadline_test",
        sandboxProfileVersion: 1,
        runtimeProvider: SandboxInstanceProviders.E2B,
        startedByKind: SandboxInstanceStarterKinds.SYSTEM,
        startedById: "system_deadline_test",
        source: SandboxInstanceSources.WEBHOOK,
      });

      await database.insert(sandboxInstanceDeadlines).values({
        sandboxInstanceId: "sbi_deadline_test",
        kind: SandboxInstanceDeadlineKinds.IDLE,
        ownerLeaseId: "sle_deadline_test",
        dueAt: "2026-04-14T12:00:00.000Z",
      });

      const persistedDeadline = await database.query.sandboxInstanceDeadlines.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.sandboxInstanceId, "sbi_deadline_test"),
            eq(table.kind, SandboxInstanceDeadlineKinds.IDLE),
          ),
      });
      assert.equal(persistedDeadline?.sandboxInstanceId, "sbi_deadline_test");
      assert.equal(persistedDeadline?.kind, SandboxInstanceDeadlineKinds.IDLE);
      assert.equal(persistedDeadline?.ownerLeaseId, "sle_deadline_test");
      assert.equal(persistedDeadline?.generation, 1);
      assert.equal(persistedDeadline?.clearedAt, null);
      assert.match(persistedDeadline?.dueAt ?? "", /2026-04-14 12:00:00/u);
      assert.ok(persistedDeadline?.createdAt);
      assert.ok(persistedDeadline?.updatedAt);

      let duplicateInsertError: unknown;
      try {
        await database.insert(sandboxInstanceDeadlines).values({
          sandboxInstanceId: "sbi_deadline_test",
          kind: SandboxInstanceDeadlineKinds.IDLE,
          ownerLeaseId: "sle_deadline_test_dup",
          dueAt: "2026-04-14T12:05:00.000Z",
        });
      } catch (error) {
        duplicateInsertError = error;
      }
      assert.ok(duplicateInsertError);
      assert.equal(
        Reflect.get(Reflect.get(duplicateInsertError, "cause") as object, "code"),
        "23505",
      );

      let missingSandboxError: unknown;
      try {
        await database.insert(sandboxInstanceDeadlines).values({
          sandboxInstanceId: "sbi_missing_deadline_test",
          kind: SandboxInstanceDeadlineKinds.DISCONNECT,
          ownerLeaseId: "sle_deadline_missing",
          dueAt: "2026-04-14T12:10:00.000Z",
        });
      } catch (error) {
        missingSandboxError = error;
      }
      assert.ok(missingSandboxError);
      assert.equal(
        Reflect.get(Reflect.get(missingSandboxError, "cause") as object, "code"),
        "23503",
      );

      let invalidKindError: unknown;
      try {
        await pool.query(
          `
              insert into "data_plane"."sandbox_instance_deadlines" (
                "sandbox_instance_id",
                "kind",
                "owner_lease_id",
                "due_at"
              ) values ($1, $2, $3, $4)
            `,
          [
            "sbi_deadline_test",
            "invalid_kind",
            "sle_deadline_invalid_kind",
            "2026-04-14T12:15:00.000Z",
          ],
        );
      } catch (error) {
        invalidKindError = error;
      }
      assert.ok(invalidKindError);
      assert.equal(Reflect.get(invalidKindError as object, "code"), "23514");
    } finally {
      await pool.end();
    }
  }, 60_000);
});
