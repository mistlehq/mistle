/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { ScheduleTargetTypes } from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import {
  deleteSandboxProfileVersionRefreshScheduleResponseSchema,
  sandboxProfileVersionRefreshScheduleResponseSchema,
} from "../src/sandbox-profiles/schemas.js";
import { createApiKeyToken } from "./helpers/api-keys.js";
import { sandboxProfileRow, sandboxProfileVersionRow } from "./helpers/sandbox-profiles.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("sandbox profile version refresh schedule integration", () => {
  it("creates and updates a snapshot refresh schedule for a profile version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-refresh-schedule@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_refresh_schedule_001",
        organizationId: session.organizationId,
        displayName: "Refresh Schedule Profile",
        activeVersion: 1,
        createdAt: "2026-04-28T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_refresh_schedule_001",
        version: 1,
        publishedAt: "2026-04-28T00:01:00.000Z",
      }),
    );

    const createResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_refresh_schedule_001/versions/1/refresh-schedule",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          name: "Daily refresh",
          cronExpression: "0 9 * * *",
          maintenanceScript: "echo maintain",
          timezone: "Asia/Singapore",
        }),
      },
    );

    expect(createResponse.status).toBe(200);
    const createdBody = sandboxProfileVersionRefreshScheduleResponseSchema.parse(
      await createResponse.json(),
    );
    expect(createdBody).toMatchObject({
      sandboxProfileId: "sbp_refresh_schedule_001",
      sandboxProfileVersion: 1,
      name: "Daily refresh",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Singapore",
      enabled: true,
    });
    if (createdBody.nextScheduledAt === null) {
      throw new Error("Expected refresh schedule to expose the next scheduled timestamp.");
    }
    expect(Number.isNaN(Date.parse(createdBody.nextScheduledAt))).toBe(false);

    const createdTarget =
      await env.controlPlaneDb.query.sandboxProfileSnapshotRefreshScheduleTargets.findFirst({
        where: (table, { eq }) => eq(table.sandboxProfileId, "sbp_refresh_schedule_001"),
      });
    if (createdTarget === undefined) {
      throw new Error("Expected refresh schedule target to be created.");
    }

    const createdSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, createdTarget.scheduleId),
    });
    expect(createdSchedule).toMatchObject({
      organizationId: session.organizationId,
      targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
      name: "Daily refresh",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Singapore",
      enabled: true,
      deletedAt: null,
    });
    const createdVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        maintenanceScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_refresh_schedule_001"), eq(table.version, 1)),
    });
    expect(createdVersion?.maintenanceScript).toBe("echo maintain");

    const listVersionsResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_refresh_schedule_001/versions",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(listVersionsResponse.status).toBe(200);
    expect(await listVersionsResponse.json()).toMatchObject({
      versions: [
        {
          sandboxProfileId: "sbp_refresh_schedule_001",
          version: 1,
          refreshSchedule: {
            scheduleId: createdTarget.scheduleId,
            name: "Daily refresh",
            cronExpression: "0 9 * * *",
            timezone: "Asia/Singapore",
            enabled: true,
          },
        },
      ],
    });

    const updateResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_refresh_schedule_001/versions/1/refresh-schedule",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          cronExpression: "30 10 * * *",
          maintenanceScript: null,
          timezone: "Asia/Singapore",
        }),
      },
    );

    expect(updateResponse.status).toBe(200);

    const updatedTargets =
      await env.controlPlaneDb.query.sandboxProfileSnapshotRefreshScheduleTargets.findMany({
        where: (table, { eq }) => eq(table.sandboxProfileId, "sbp_refresh_schedule_001"),
      });
    expect(updatedTargets).toHaveLength(1);

    const updatedSchedule = await env.controlPlaneDb.query.schedules.findFirst({
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
    const updatedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        maintenanceScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_refresh_schedule_001"), eq(table.version, 1)),
    });
    expect(updatedVersion?.maintenanceScript).toBeNull();
  });

  it("rejects invalid cron and timezone before creating a schedule", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-refresh-schedule-invalid@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_refresh_schedule_invalid",
        organizationId: session.organizationId,
        displayName: "Invalid Refresh Schedule Profile",
        activeVersion: 1,
        createdAt: "2026-04-28T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_refresh_schedule_invalid",
        version: 1,
        maintenanceScript: "echo keep after invalid schedule",
        publishedAt: "2026-04-28T00:01:00.000Z",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_refresh_schedule_invalid/versions/1/refresh-schedule",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          cronExpression: "*/15 9 * * *",
          maintenanceScript: null,
          timezone: "Mars/Olympus_Mons",
        }),
      },
    );

    expect(response.status).toBe(400);

    const persistedSchedules = await env.controlPlaneDb.query.schedules.findMany({
      where: (table, { eq }) => eq(table.organizationId, session.organizationId),
    });
    expect(persistedSchedules).toHaveLength(0);
    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        maintenanceScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_refresh_schedule_invalid"), eq(table.version, 1)),
    });
    expect(persistedVersion?.maintenanceScript).toBe("echo keep after invalid schedule");
  });

  it("creates a snapshot refresh schedule with an API key that has update permission", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-refresh-schedule-api-key@example.com",
    });
    const apiKeyToken = await createApiKeyToken({
      env,
      cookie: session.cookie,
      name: "Profile refresh schedule key",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_UPDATE],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_refresh_schedule_api_key",
        organizationId: session.organizationId,
        displayName: "API Key Refresh Schedule Profile",
        activeVersion: 1,
        createdAt: "2026-04-28T02:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_refresh_schedule_api_key",
        version: 1,
        publishedAt: "2026-04-28T02:01:00.000Z",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_refresh_schedule_api_key/versions/1/refresh-schedule",
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${apiKeyToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "API key daily refresh",
          cronExpression: "15 9 * * *",
          timezone: "Asia/Singapore",
        }),
      },
    );

    expect(response.status).toBe(200);
    const responseBody = sandboxProfileVersionRefreshScheduleResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toMatchObject({
      sandboxProfileId: "sbp_refresh_schedule_api_key",
      sandboxProfileVersion: 1,
      name: "API key daily refresh",
      cronExpression: "15 9 * * *",
      timezone: "Asia/Singapore",
      enabled: true,
    });

    const createdSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, responseBody.scheduleId),
    });
    expect(createdSchedule).toMatchObject({
      organizationId: session.organizationId,
      targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
      name: "API key daily refresh",
      deletedAt: null,
    });
  });

  it("preserves the maintenance script when schedule creation omits it", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-refresh-schedule-omit-script@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_refresh_schedule_omit_script",
        organizationId: session.organizationId,
        displayName: "Refresh Schedule Omit Script Profile",
        activeVersion: 1,
        createdAt: "2026-04-28T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_refresh_schedule_omit_script",
        version: 1,
        maintenanceScript: "echo keep",
        publishedAt: "2026-04-28T00:01:00.000Z",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_refresh_schedule_omit_script/versions/1/refresh-schedule",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          cronExpression: "0 9 * * *",
          timezone: "Asia/Singapore",
        }),
      },
    );

    expect(response.status).toBe(200);
    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        maintenanceScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_refresh_schedule_omit_script"), eq(table.version, 1)),
    });
    expect(persistedVersion?.maintenanceScript).toBe("echo keep");
  });

  it("preserves the schedule cursor when only the maintenance script changes", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-refresh-schedule-script-only@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_refresh_schedule_script_only",
        organizationId: session.organizationId,
        displayName: "Refresh Schedule Script Only Profile",
        activeVersion: 1,
        createdAt: "2026-04-28T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_refresh_schedule_script_only",
        version: 1,
        maintenanceScript: "echo old",
        publishedAt: "2026-04-28T00:01:00.000Z",
      }),
    );

    const createResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_refresh_schedule_script_only/versions/1/refresh-schedule",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          cronExpression: "0 9 * * *",
          timezone: "Asia/Singapore",
          maintenanceScript: "echo old",
        }),
      },
    );
    expect(createResponse.status).toBe(200);
    const createdBody = sandboxProfileVersionRefreshScheduleResponseSchema.parse(
      await createResponse.json(),
    );
    const preservedNextScheduledAt = "2026-05-01T01:00:00.000Z";
    await env.controlPlaneDb
      .update(env.controlPlaneTables.schedules)
      .set({
        nextScheduledAt: preservedNextScheduledAt,
      })
      .where(eq(env.controlPlaneTables.schedules.id, createdBody.scheduleId));

    const updateResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_refresh_schedule_script_only/versions/1/refresh-schedule",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          cronExpression: "0 9 * * *",
          timezone: "Asia/Singapore",
          maintenanceScript: "echo updated",
        }),
      },
    );

    expect(updateResponse.status).toBe(200);
    const updatedBody = sandboxProfileVersionRefreshScheduleResponseSchema.parse(
      await updateResponse.json(),
    );
    expect(updatedBody.nextScheduledAt).not.toBeNull();
    expect(Date.parse(updatedBody.nextScheduledAt ?? "")).toBe(
      Date.parse(preservedNextScheduledAt),
    );
    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        maintenanceScript: true,
      },
      where: (table, { and, eq: whereEq }) =>
        and(
          whereEq(table.sandboxProfileId, "sbp_refresh_schedule_script_only"),
          whereEq(table.version, 1),
        ),
    });
    expect(persistedVersion?.maintenanceScript).toBe("echo updated");
  });

  it("soft-deletes an existing snapshot refresh schedule", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-refresh-schedule-delete@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_refresh_schedule_delete",
        organizationId: session.organizationId,
        displayName: "Delete Refresh Schedule Profile",
        activeVersion: 1,
        createdAt: "2026-04-28T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_refresh_schedule_delete",
        version: 1,
        publishedAt: "2026-04-28T00:01:00.000Z",
      }),
    );

    const createResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_refresh_schedule_delete/versions/1/refresh-schedule",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          cronExpression: "0 9 * * *",
          maintenanceScript: "echo keep after schedule delete",
          timezone: "Asia/Singapore",
        }),
      },
    );
    expect(createResponse.status).toBe(200);

    const deleteResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_refresh_schedule_delete/versions/1/refresh-schedule",
      {
        method: "DELETE",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(deleteResponse.status).toBe(200);
    expect(
      deleteSandboxProfileVersionRefreshScheduleResponseSchema.parse(await deleteResponse.json()),
    ).toEqual({
      sandboxProfileId: "sbp_refresh_schedule_delete",
      sandboxProfileVersion: 1,
      deleted: true,
    });

    const persistedSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.organizationId, session.organizationId),
    });
    expect(persistedSchedule).toMatchObject({
      enabled: false,
      nextScheduledAt: null,
    });
    expect(persistedSchedule?.deletedAt).not.toBeNull();
    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        maintenanceScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_refresh_schedule_delete"), eq(table.version, 1)),
    });
    expect(persistedVersion?.maintenanceScript).toBe("echo keep after schedule delete");

    const listVersionsResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_refresh_schedule_delete/versions",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(listVersionsResponse.status).toBe(200);
    expect(await listVersionsResponse.json()).toMatchObject({
      versions: [
        {
          sandboxProfileId: "sbp_refresh_schedule_delete",
          version: 1,
          refreshSchedule: null,
        },
      ],
    });
  });
});
