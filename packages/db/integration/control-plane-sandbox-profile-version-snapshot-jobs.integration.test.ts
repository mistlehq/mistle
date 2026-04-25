import { Pool } from "pg";
import { describe } from "vitest";

import { CONTROL_PLANE_SCHEMA_NAME } from "../src/control-plane/schema/namespace.js";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "../src/migrator/index.js";
import { it } from "./test-context.js";

describe("control-plane sandbox profile version snapshot jobs integration", () => {
  it("enforces one active snapshot job per profile version while allowing terminal jobs", async ({
    databaseStack,
  }) => {
    await runControlPlaneMigrations({
      connectionString: databaseStack.directUrl,
      schemaName: CONTROL_PLANE_SCHEMA_NAME,
      migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
    });

    const pool = new Pool({
      connectionString: databaseStack.directUrl,
    });

    try {
      await pool.query(
        `
          insert into control_plane.organizations (id, name, slug)
          values ($1, $2, $3)
        `,
        ["org_snapshot_jobs_unique", "Snapshot Jobs Org", "snapshot-jobs-org"],
      );
      await pool.query(
        `
          insert into control_plane.sandbox_profiles (id, organization_id, display_name, status)
          values ($1, $2, $3, $4)
        `,
        ["sbp_snapshot_jobs_unique", "org_snapshot_jobs_unique", "Snapshot Jobs Profile", "active"],
      );
      await pool.query(
        `
          insert into control_plane.sandbox_profile_versions
            (sandbox_profile_id, version, state, published_at)
          values ($1, $2, $3, $4)
        `,
        ["sbp_snapshot_jobs_unique", 1, "published", "2026-04-01T00:00:00.000Z"],
      );
      await pool.query(
        `
          insert into control_plane.sandbox_profile_version_snapshot_jobs
            (id, sandbox_profile_id, sandbox_profile_version, trigger, state)
          values ($1, $2, $3, $4, $5)
        `,
        ["ssj_snapshot_jobs_unique_queued", "sbp_snapshot_jobs_unique", 1, "publish", "queued"],
      );

      let duplicateJobError: { code?: string } | undefined;
      try {
        await pool.query(
          `
            insert into control_plane.sandbox_profile_version_snapshot_jobs
              (id, sandbox_profile_id, sandbox_profile_version, trigger, state)
            values ($1, $2, $3, $4, $5)
          `,
          [
            "ssj_snapshot_jobs_unique_running",
            "sbp_snapshot_jobs_unique",
            1,
            "manual_refresh",
            "running",
          ],
        );
      } catch (error) {
        duplicateJobError = error as { code?: string };
      }

      if (duplicateJobError?.code !== "23505") {
        throw new Error(
          `Expected duplicate active snapshot job insert to fail with code 23505, got '${duplicateJobError?.code ?? "no_error"}'.`,
        );
      }

      await pool.query(
        `
          insert into control_plane.sandbox_profile_version_snapshot_jobs
            (id, sandbox_profile_id, sandbox_profile_version, trigger, state)
          values ($1, $2, $3, $4, $5)
        `,
        [
          "ssj_snapshot_jobs_unique_failed",
          "sbp_snapshot_jobs_unique",
          1,
          "manual_refresh",
          "failed",
        ],
      );
    } finally {
      await pool.end();
    }
  });
});
