import {
  sandboxProfiles,
  sandboxProfileVersions,
  ScheduleTargetTypes,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  createSandboxProfileFixture,
  createSandboxProfileVersionFixture,
} from "./helpers/sandbox-profiles.js";
import { it } from "./test-context.js";

describe("sandbox profile version refresh schedule integration", () => {
  it("creates and updates a snapshot refresh schedule for a profile version", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-refresh-schedule@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values(
      createSandboxProfileFixture({
        id: "sbp_refresh_schedule_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Refresh Schedule Profile",
        activeVersion: 1,
        createdAt: "2026-04-28T00:00:00.000Z",
      }),
    );
    await fixture.db.insert(sandboxProfileVersions).values(
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_refresh_schedule_001",
        version: 1,
        publishedAt: "2026-04-28T00:01:00.000Z",
      }),
    );

    const createResponse = await fixture.request(
      "/v1/sandbox/profiles/sbp_refresh_schedule_001/versions/1/refresh-schedule",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          name: "Daily refresh",
          cronExpression: "0 9 * * *",
          timezone: "Asia/Singapore",
        }),
      },
    );

    expect(createResponse.status).toBe(200);
    await expect(createResponse.json()).resolves.toMatchObject({
      sandboxProfileId: "sbp_refresh_schedule_001",
      sandboxProfileVersion: 1,
      name: "Daily refresh",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Singapore",
      enabled: true,
      nextScheduledAt: expect.any(String),
    });

    const createdTargets =
      await fixture.db.query.sandboxProfileSnapshotRefreshScheduleTargets.findMany({
        where: (table, { eq }) => eq(table.sandboxProfileId, "sbp_refresh_schedule_001"),
      });
    expect(createdTargets).toHaveLength(1);
    const createdTarget = createdTargets[0];
    if (createdTarget === undefined) {
      throw new Error("Expected refresh schedule target to be created.");
    }
    const createdSchedule = await fixture.db.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, createdTarget.scheduleId),
    });
    if (createdSchedule === undefined) {
      throw new Error("Expected refresh schedule to be created.");
    }
    expect(createdTarget.sandboxProfileVersion).toBe(1);
    expect(createdSchedule).toMatchObject({
      organizationId: authenticatedSession.organizationId,
      targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
      name: "Daily refresh",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Singapore",
      enabled: true,
      deletedAt: null,
    });
    expect(new Date(String(createdSchedule.nextScheduledAt)).toISOString()).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/u,
    );

    const updateResponse = await fixture.request(
      "/v1/sandbox/profiles/sbp_refresh_schedule_001/versions/1/refresh-schedule",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          cronExpression: "30 10 * * *",
          timezone: "Asia/Singapore",
        }),
      },
    );

    expect(updateResponse.status).toBe(200);

    const updatedTargets =
      await fixture.db.query.sandboxProfileSnapshotRefreshScheduleTargets.findMany({
        where: (table, { eq }) => eq(table.sandboxProfileId, "sbp_refresh_schedule_001"),
      });
    expect(updatedTargets).toHaveLength(1);
    const updatedSchedule = await fixture.db.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, createdTarget.scheduleId),
    });
    expect(updatedSchedule).toMatchObject({
      targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
      name: "Sandbox profile version refresh",
      cronExpression: "30 10 * * *",
      timezone: "Asia/Singapore",
      enabled: true,
      deletedAt: null,
    });
  });

  it("rejects invalid cron and timezone before persistence", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-refresh-schedule-invalid@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values(
      createSandboxProfileFixture({
        id: "sbp_refresh_schedule_invalid",
        organizationId: authenticatedSession.organizationId,
        displayName: "Invalid Refresh Schedule Profile",
        activeVersion: 1,
        createdAt: "2026-04-28T00:00:00.000Z",
      }),
    );
    await fixture.db.insert(sandboxProfileVersions).values(
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_refresh_schedule_invalid",
        version: 1,
        publishedAt: "2026-04-28T00:01:00.000Z",
      }),
    );

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_refresh_schedule_invalid/versions/1/refresh-schedule",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          cronExpression: "*/15 9 * * *",
          timezone: "Mars/Olympus_Mons",
        }),
      },
    );

    expect(response.status).toBe(400);

    const persistedSchedules = await fixture.db.query.schedules.findMany({
      where: (table, { eq }) => eq(table.organizationId, authenticatedSession.organizationId),
    });
    expect(persistedSchedules).toHaveLength(0);
  });

  it("soft-deletes an existing snapshot refresh schedule", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-refresh-schedule-delete@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values(
      createSandboxProfileFixture({
        id: "sbp_refresh_schedule_delete",
        organizationId: authenticatedSession.organizationId,
        displayName: "Delete Refresh Schedule Profile",
        activeVersion: 1,
        createdAt: "2026-04-28T00:00:00.000Z",
      }),
    );
    await fixture.db.insert(sandboxProfileVersions).values(
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_refresh_schedule_delete",
        version: 1,
        publishedAt: "2026-04-28T00:01:00.000Z",
      }),
    );

    await fixture.request(
      "/v1/sandbox/profiles/sbp_refresh_schedule_delete/versions/1/refresh-schedule",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          cronExpression: "0 9 * * *",
          timezone: "Asia/Singapore",
        }),
      },
    );

    const deleteResponse = await fixture.request(
      "/v1/sandbox/profiles/sbp_refresh_schedule_delete/versions/1/refresh-schedule",
      {
        method: "DELETE",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({
      sandboxProfileId: "sbp_refresh_schedule_delete",
      sandboxProfileVersion: 1,
      deleted: true,
    });

    const persistedSchedule = await fixture.db.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.organizationId, authenticatedSession.organizationId),
    });
    expect(persistedSchedule).toMatchObject({
      enabled: false,
      nextScheduledAt: null,
    });
    expect(persistedSchedule?.deletedAt).not.toBeNull();
  });
});
