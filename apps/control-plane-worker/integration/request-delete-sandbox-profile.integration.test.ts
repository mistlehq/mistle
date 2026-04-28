import {
  automationTargets,
  automations,
  AutomationKinds,
  createControlPlaneDatabase,
  organizations,
  sandboxProfileSnapshotRefreshScheduleTargets,
  sandboxProfiles,
  sandboxProfileVersions,
  CONTROL_PLANE_SCHEMA_NAME,
  schedules,
  ScheduleTargetTypes,
} from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import { deleteSandboxProfile } from "../openworkflow/request-delete-sandbox-profile/delete-sandbox-profile.js";
import { it } from "./test-context.js";

async function createTestDatabase(input: { databaseUrl: string }) {
  await runControlPlaneMigrations({
    connectionString: input.databaseUrl,
    schemaName: CONTROL_PLANE_SCHEMA_NAME,
    migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
    migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
    migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
  });

  const pool = new Pool({
    connectionString: input.databaseUrl,
  });
  const db = createControlPlaneDatabase(pool);

  return {
    db,
    stop: async () => {
      await pool.end();
    },
  };
}

describe("request delete sandbox profile", () => {
  it("deletes the sandbox profile and leaves automations that used it broken", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      await database.db.insert(organizations).values({
        id: "org_delete_profile_worker",
        name: "Delete Profile Worker",
        slug: "delete-profile-worker",
      });
      await database.db.insert(sandboxProfiles).values({
        id: "sbp_delete_profile_worker",
        organizationId: "org_delete_profile_worker",
        displayName: "Delete Profile Worker",
        status: "active",
      });
      await database.db.insert(sandboxProfileVersions).values({
        sandboxProfileId: "sbp_delete_profile_worker",
        version: 1,
      });
      await database.db.insert(schedules).values({
        id: "sch_delete_profile_worker_refresh",
        organizationId: "org_delete_profile_worker",
        targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
        name: "Delete Profile Worker Refresh",
        cronExpression: "0 9 * * *",
        timezone: "Asia/Singapore",
        enabled: true,
        nextScheduledAt: "2026-04-28T01:00:00.000Z",
      });
      await database.db.insert(sandboxProfileSnapshotRefreshScheduleTargets).values({
        scheduleId: "sch_delete_profile_worker_refresh",
        sandboxProfileId: "sbp_delete_profile_worker",
        sandboxProfileVersion: 1,
      });
      await database.db.insert(automations).values({
        id: "atm_delete_profile_worker",
        organizationId: "org_delete_profile_worker",
        kind: AutomationKinds.WEBHOOK,
        name: "Delete Profile Worker Automation",
        enabled: true,
      });
      await database.db.insert(automationTargets).values({
        id: "atg_delete_profile_worker",
        automationId: "atm_delete_profile_worker",
        sandboxProfileId: "sbp_delete_profile_worker",
        sandboxProfileVersion: 1,
      });

      await deleteSandboxProfile(
        {
          db: database.db,
        },
        {
          organizationId: "org_delete_profile_worker",
          profileId: "sbp_delete_profile_worker",
        },
      );

      const persistedProfile = await database.db.query.sandboxProfiles.findFirst({
        where: (table, { eq }) => eq(table.id, "sbp_delete_profile_worker"),
      });
      const persistedAutomation = await database.db.query.automations.findFirst({
        where: (table, { eq }) => eq(table.id, "atm_delete_profile_worker"),
      });
      const persistedTarget = await database.db.query.automationTargets.findFirst({
        where: (table, { eq }) => eq(table.id, "atg_delete_profile_worker"),
      });
      const persistedSchedule = await database.db.query.schedules.findFirst({
        where: (table, { eq }) => eq(table.id, "sch_delete_profile_worker_refresh"),
      });

      expect(persistedProfile).toBeUndefined();
      expect(persistedAutomation).toEqual(
        expect.objectContaining({
          id: "atm_delete_profile_worker",
        }),
      );
      expect(persistedTarget).toBeUndefined();
      expect(persistedSchedule).toEqual(
        expect.objectContaining({
          enabled: false,
          nextScheduledAt: null,
        }),
      );
      expect(persistedSchedule?.deletedAt).not.toBeNull();
    } finally {
      await database.stop();
    }
  });
});
