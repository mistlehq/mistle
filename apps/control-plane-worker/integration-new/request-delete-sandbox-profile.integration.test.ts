/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import {
  AutomationKinds,
  SandboxProfileStatuses,
  ScheduleTargetTypes,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";

const it = createIntegrationTest({
  services: ["control-plane-api", "control-plane-worker"],
  extraInfra: ["mailpit"],
  __dangerouslyIsolatedServices: {
    services: ["control-plane-api"],
    reason:
      "This test verifies control-plane API writes are consumed by the worker in the same logical environment.",
  },
});

const PollIntervalMs = 100;
const WorkflowTimeoutMs = 15_000;

describe.concurrent("request delete sandbox profile integration", () => {
  it("deletes the profile and disables dependent records through the worker workflow", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      organizationName: "Control Plane Worker Delete Test",
      organizationSlug: `cp-worker-delete-${randomUUID()}`,
    });
    const ids = createDeleteProfileIds();

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: ids.profileId,
      organizationId: session.organizationId,
      displayName: "Delete Profile Worker",
      status: SandboxProfileStatuses.ACTIVE,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
      sandboxProfileId: ids.profileId,
      version: 1,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.schedules).values({
      id: ids.scheduleId,
      organizationId: session.organizationId,
      targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
      name: "Delete Profile Worker Refresh",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Singapore",
      enabled: true,
      nextScheduledAt: "2026-04-28T01:00:00.000Z",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileSnapshotRefreshScheduleTargets)
      .values({
        scheduleId: ids.scheduleId,
        sandboxProfileId: ids.profileId,
        sandboxProfileVersion: 1,
      });
    await env.controlPlaneDb.insert(env.controlPlaneTables.automations).values({
      id: ids.automationId,
      organizationId: session.organizationId,
      kind: AutomationKinds.WEBHOOK,
      name: "Delete Profile Worker Automation",
      enabled: true,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.automationTargets).values({
      id: ids.automationTargetId,
      automationId: ids.automationId,
      sandboxProfileId: ids.profileId,
      sandboxProfileVersion: 1,
    });

    const response = await env.controlPlaneApi.http.fetch(`/v1/sandbox/profiles/${ids.profileId}`, {
      method: "DELETE",
      headers: {
        cookie: session.cookie,
      },
    });
    expect(response.status).toBe(202);

    await waitForProfileDeletion({
      env,
      profileId: ids.profileId,
    });

    const persistedAutomation = await env.controlPlaneDb.query.automations.findFirst({
      where: (table, { eq }) => eq(table.id, ids.automationId),
    });
    const persistedTarget = await env.controlPlaneDb.query.automationTargets.findFirst({
      where: (table, { eq }) => eq(table.id, ids.automationTargetId),
    });
    const persistedSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, ids.scheduleId),
    });

    expect(persistedAutomation).toEqual(
      expect.objectContaining({
        id: ids.automationId,
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
  });
});

function createDeleteProfileIds(): {
  profileId: string;
  scheduleId: string;
  automationId: string;
  automationTargetId: string;
} {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);

  return {
    profileId: `sbp_delete_${suffix}`,
    scheduleId: `sch_delete_${suffix}`,
    automationId: `atm_delete_${suffix}`,
    automationTargetId: `atg_delete_${suffix}`,
  };
}

async function waitForProfileDeletion(input: {
  env: IntegrationTestEnvironment;
  profileId: string;
}): Promise<void> {
  const deadline = Date.now() + WorkflowTimeoutMs;

  while (Date.now() < deadline) {
    const persistedProfile = await input.env.controlPlaneDb.query.sandboxProfiles.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.id, input.profileId),
    });
    if (persistedProfile === undefined) {
      return;
    }

    await systemSleeper.sleep(PollIntervalMs);
  }

  throw new Error(`Timed out waiting for sandbox profile '${input.profileId}' to be deleted.`);
}
