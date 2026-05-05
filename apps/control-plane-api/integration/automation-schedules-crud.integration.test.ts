import {
  AutomationKinds,
  IntegrationConnectionStatuses,
  IntegrationBindingKinds,
  ScheduledActionStatuses,
  ScheduleTargetTypes,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { ScheduleActionFailureCodes } from "../src/automation-schedules/constants.js";
import { CreateAutomationScheduleBadRequestResponseSchema } from "../src/automation-schedules/create-automation-schedule/index.js";
import { DeleteAutomationScheduleResponseSchema } from "../src/automation-schedules/delete-automation-schedule/index.js";
import { AutomationScheduleSchema } from "../src/automation-schedules/schemas.js";

type ControlPlaneApiIntegrationFixture = Readonly<{
  authSession: IntegrationTestEnvironment["auth"]["createSession"];
  db: IntegrationTestEnvironment["controlPlaneDb"];
  request: IntegrationTestEnvironment["controlPlaneApi"]["http"]["fetch"];
  tables: IntegrationTestEnvironment["controlPlaneTables"];
}>;

const integrationIt = createIntegrationTest({
  services: ["control-plane-api"],
});

function it(
  name: string,
  test: (input: { fixture: ControlPlaneApiIntegrationFixture }) => Promise<void>,
): void {
  integrationIt(name, async ({ env }) => {
    await test({
      fixture: {
        authSession: env.auth.createSession,
        db: env.controlPlaneDb,
        request: env.controlPlaneApi.http.fetch,
        tables: env.controlPlaneTables,
      },
    });
  });
}

const GitHubTarget = {
  targetKey: "github_cloud",
  familyId: "github",
  variantId: "github-cloud",
  enabled: true,
  config: {
    base_url: "https://github.com",
  },
};

describe("automation schedules CRUD integration", () => {
  it("creates and gets a scheduled automation aggregate in the active organization", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "automation-schedules-create@example.com",
    });

    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_create_001",
      version: 3,
    });

    const response = await fixture.request("/v1/automations/schedules", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        name: "Daily issue triage",
        enabled: true,
        schedule: {
          name: "Daily morning schedule",
          cronExpression: "0 9 * * *",
          timezone: "Asia/Singapore",
        },
        inputTemplate: "Summarize open issues for {{schedule.localScheduledDate}}",
        target: {
          sandboxProfileId: "sbp_schedule_create_001",
          sandboxProfileVersion: 3,
        },
      }),
    });

    expect(response.status).toBe(201);
    const body = AutomationScheduleSchema.parse(await response.json());
    expect(body.kind).toBe("schedule");
    expect(body.name).toBe("Daily issue triage");
    expect(body.enabled).toBe(true);
    expect(body.schedule.name).toBe("Daily morning schedule");
    expect(body.schedule.cronExpression).toBe("0 9 * * *");
    expect(body.schedule.timezone).toBe("Asia/Singapore");
    expect(body.schedule.enabled).toBe(true);
    expect(body.schedule.nextScheduledAt).not.toBeNull();
    expect(body.inputTemplate).toBe("Summarize open issues for {{schedule.localScheduledDate}}");
    expect(body.conversationKeyTemplate).toBe("{{schedule.id}}");
    expect(body.idempotencyKeyTemplate).toBe("{{schedule.scheduledActionId}}");
    expect(body.target.sandboxProfileId).toBe("sbp_schedule_create_001");
    expect(body.target.sandboxProfileVersion).toBe(3);
    expect(body.target.primaryRepositoryId).toBeNull();

    const persistedScheduleAutomation = await fixture.db.query.scheduleAutomations.findFirst({
      where: (table, { eq }) => eq(table.automationId, body.id),
    });
    expect(persistedScheduleAutomation).toBeDefined();
    if (persistedScheduleAutomation === undefined) {
      throw new Error("Expected created schedule automation config to be persisted.");
    }

    const persistedSchedule = await fixture.db.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, persistedScheduleAutomation.scheduleId),
    });
    expect(persistedSchedule).toBeDefined();
    if (persistedSchedule === undefined) {
      throw new Error("Expected created schedule to be persisted.");
    }
    expect(persistedSchedule.organizationId).toBe(authenticatedSession.organizationId);
    expect(persistedSchedule.targetType).toBe(ScheduleTargetTypes.AUTOMATION_RUN);
    expect(persistedSchedule.enabled).toBe(true);
    expect(persistedSchedule.nextScheduledAt).not.toBeNull();

    const getResponse = await fixture.request(`/v1/automations/schedules/${body.id}`, {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(getResponse.status).toBe(200);
    expect(AutomationScheduleSchema.parse(await getResponse.json())).toEqual(body);
  });

  it("persists the active sandbox profile version when the target version is omitted", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "automation-schedules-active-version@example.com",
    });

    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_active_version_001",
      version: 2,
    });
    await fixture.db.insert(fixture.tables.sandboxProfileVersions).values({
      sandboxProfileId: "sbp_schedule_active_version_001",
      version: 5,
    });

    const response = await fixture.request("/v1/automations/schedules", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        name: "Active version schedule",
        schedule: {
          cronExpression: "0 9 * * *",
          timezone: "Asia/Singapore",
        },
        inputTemplate: "Run from active version",
        target: {
          sandboxProfileId: "sbp_schedule_active_version_001",
        },
      }),
    });

    expect(response.status).toBe(201);
    const body = AutomationScheduleSchema.parse(await response.json());
    expect(body.target.sandboxProfileVersion).toBe(2);
  });

  it("updates schedule timing from request time and keeps template-only updates from moving the cursor", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "automation-schedules-update@example.com",
    });

    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_update_001",
      version: 1,
    });
    const created = await createScheduleAutomation(fixture, authenticatedSession.cookie, {
      profileId: "sbp_schedule_update_001",
    });

    await fixture.db
      .update(fixture.tables.schedules)
      .set({
        lastScheduledAt: "2099-01-01T00:00:00.000Z",
      })
      .where(eq(fixture.tables.schedules.id, created.schedule.id));

    const updateResponse = await fixture.request(`/v1/automations/schedules/${created.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        schedule: {
          cronExpression: "30 10 * * *",
          timezone: "Asia/Singapore",
        },
      }),
    });

    expect(updateResponse.status).toBe(200);
    const updated = AutomationScheduleSchema.parse(await updateResponse.json());
    expect(updated.schedule.cronExpression).toBe("30 10 * * *");
    expect(updated.schedule.nextScheduledAt).not.toBeNull();
    if (updated.schedule.nextScheduledAt === null) {
      throw new Error("Expected schedule cursor to be recomputed.");
    }
    expect(new Date(updated.schedule.nextScheduledAt).getTime()).toBeLessThan(
      new Date("2099-01-01T00:00:00.000Z").getTime(),
    );

    const cursorAfterTimingUpdate = updated.schedule.nextScheduledAt;
    const templateOnlyResponse = await fixture.request(`/v1/automations/schedules/${created.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        inputTemplate: "Updated template only",
      }),
    });

    expect(templateOnlyResponse.status).toBe(200);
    const templateOnlyUpdate = AutomationScheduleSchema.parse(await templateOnlyResponse.json());
    expect(templateOnlyUpdate.inputTemplate).toBe("Updated template only");
    expect(templateOnlyUpdate.schedule.nextScheduledAt).toBe(cursorAfterTimingUpdate);
  });

  it("disables and re-enables schedules with coherent schedule cursors", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "automation-schedules-enable-disable@example.com",
    });

    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_enable_disable_001",
      version: 1,
    });
    const created = await createScheduleAutomation(fixture, authenticatedSession.cookie, {
      profileId: "sbp_schedule_enable_disable_001",
    });
    await fixture.db.insert(fixture.tables.scheduledActions).values({
      id: "sca_schedule_disable_pending_001",
      scheduleId: created.schedule.id,
      organizationId: authenticatedSession.organizationId,
      targetType: ScheduleTargetTypes.AUTOMATION_RUN,
      targetPayload: {
        automationId: created.id,
      },
      scheduledAt: "2026-05-01T01:00:00.000Z",
      localScheduledDate: "2026-05-01",
      localScheduledTime: "09:00",
      status: ScheduledActionStatuses.PENDING,
    });

    const disableResponse = await fixture.request(`/v1/automations/schedules/${created.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        enabled: false,
      }),
    });

    expect(disableResponse.status).toBe(200);
    const disabled = AutomationScheduleSchema.parse(await disableResponse.json());
    expect(disabled.enabled).toBe(false);
    expect(disabled.schedule.enabled).toBe(false);
    expect(disabled.schedule.nextScheduledAt).toBeNull();

    const failedAction = await fixture.db.query.scheduledActions.findFirst({
      where: (table, { eq }) => eq(table.id, "sca_schedule_disable_pending_001"),
    });
    expect(failedAction?.status).toBe(ScheduledActionStatuses.FAILED);
    expect(failedAction?.failureCode).toBe(ScheduleActionFailureCodes.SCHEDULE_DISABLED);

    const enableResponse = await fixture.request(`/v1/automations/schedules/${created.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        enabled: true,
      }),
    });

    expect(enableResponse.status).toBe(200);
    const enabled = AutomationScheduleSchema.parse(await enableResponse.json());
    expect(enabled.enabled).toBe(true);
    expect(enabled.schedule.enabled).toBe(true);
    expect(enabled.schedule.nextScheduledAt).not.toBeNull();
  });

  it("soft deletes schedules and marks pending scheduled actions failed", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "automation-schedules-delete@example.com",
    });

    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_delete_001",
      version: 1,
    });
    const created = await createScheduleAutomation(fixture, authenticatedSession.cookie, {
      profileId: "sbp_schedule_delete_001",
    });
    await fixture.db.insert(fixture.tables.scheduledActions).values({
      id: "sca_schedule_delete_pending_001",
      scheduleId: created.schedule.id,
      organizationId: authenticatedSession.organizationId,
      targetType: ScheduleTargetTypes.AUTOMATION_RUN,
      targetPayload: {
        automationId: created.id,
      },
      scheduledAt: "2026-05-01T01:00:00.000Z",
      localScheduledDate: "2026-05-01",
      localScheduledTime: "09:00",
      status: ScheduledActionStatuses.PENDING,
    });

    const deleteResponse = await fixture.request(`/v1/automations/schedules/${created.id}`, {
      method: "DELETE",
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(deleteResponse.status).toBe(200);
    expect(DeleteAutomationScheduleResponseSchema.parse(await deleteResponse.json())).toEqual({
      automationId: created.id,
    });

    const persistedAutomation = await fixture.db.query.automations.findFirst({
      where: (table, { eq }) => eq(table.id, created.id),
    });
    expect(persistedAutomation?.enabled).toBe(false);

    const persistedSchedule = await fixture.db.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, created.schedule.id),
    });
    expect(persistedSchedule?.enabled).toBe(false);
    expect(persistedSchedule?.nextScheduledAt).toBeNull();
    expect(persistedSchedule?.deletedAt).not.toBeNull();

    const failedAction = await fixture.db.query.scheduledActions.findFirst({
      where: (table, { eq }) => eq(table.id, "sca_schedule_delete_pending_001"),
    });
    expect(failedAction?.status).toBe(ScheduledActionStatuses.FAILED);
    expect(failedAction?.failureCode).toBe(ScheduleActionFailureCodes.SCHEDULE_DELETED);

    const getResponse = await fixture.request(`/v1/automations/schedules/${created.id}`, {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(getResponse.status).toBe(404);
  });

  it("rejects invalid schedule and target references", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "automation-schedules-invalid@example.com",
    });

    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_invalid_001",
      version: 1,
    });

    const invalidScheduleResponse = await fixture.request("/v1/automations/schedules", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        name: "Invalid schedule",
        schedule: {
          cronExpression: "* * * * *",
          timezone: "Not/A_Zone",
        },
        inputTemplate: "Run",
        target: {
          sandboxProfileId: "sbp_schedule_invalid_001",
        },
      }),
    });
    expect(invalidScheduleResponse.status).toBe(400);
    const invalidScheduleError = CreateAutomationScheduleBadRequestResponseSchema.parse(
      await invalidScheduleResponse.json(),
    );
    expect(invalidScheduleError).toMatchObject({
      code: "INVALID_SCHEDULE",
    });

    const invalidRepositoryResponse = await fixture.request("/v1/automations/schedules", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        name: "Invalid repo",
        schedule: {
          cronExpression: "0 9 * * *",
          timezone: "Asia/Singapore",
        },
        inputTemplate: "Run",
        target: {
          sandboxProfileId: "sbp_schedule_invalid_001",
          primaryRepositoryId: "mistlehq/mistle",
        },
      }),
    });
    expect(invalidRepositoryResponse.status).toBe(400);
    const invalidRepositoryError = CreateAutomationScheduleBadRequestResponseSchema.parse(
      await invalidRepositoryResponse.json(),
    );
    expect(invalidRepositoryError).toMatchObject({
      code: "INVALID_PRIMARY_REPOSITORY",
    });
  });

  it("persists valid primary repository selections", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "automation-schedules-primary-repository@example.com",
    });

    await insertIntegrationTargets(fixture);
    await fixture.db.insert(fixture.tables.integrationConnections).values({
      id: "icn_schedule_primary_repo_001",
      organizationId: authenticatedSession.organizationId,
      targetKey: GitHubTarget.targetKey,
      status: IntegrationConnectionStatuses.ACTIVE,
      displayName: "GitHub",
      externalSubjectId: "acct_schedule_primary_repo_001",
      config: {},
      targetSnapshotConfig: {},
    });
    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_primary_repo_001",
      version: 1,
    });
    await fixture.db.insert(fixture.tables.sandboxProfileVersionIntegrationBindings).values({
      id: "spvib_schedule_primary_repo_001",
      sandboxProfileId: "sbp_schedule_primary_repo_001",
      sandboxProfileVersion: 1,
      kind: IntegrationBindingKinds.GIT,
      connectionId: "icn_schedule_primary_repo_001",
      config: {
        repositories: ["mistlehq/mistle", "mistlehq/platform"],
      },
    });

    const response = await fixture.request("/v1/automations/schedules", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        name: "Repo scoped schedule",
        schedule: {
          cronExpression: "0 9 * * *",
          timezone: "Asia/Singapore",
        },
        inputTemplate: "Run",
        target: {
          sandboxProfileId: "sbp_schedule_primary_repo_001",
          primaryRepositoryId: "mistlehq/platform",
        },
      }),
    });

    expect(response.status).toBe(201);
    const body = AutomationScheduleSchema.parse(await response.json());
    expect(body.target.primaryRepositoryId).toBe("mistlehq/platform");
  });

  it("preserves the pinned profile version when updating only the primary repository", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "automation-schedules-pinned-version-repository-update@example.com",
    });

    await insertIntegrationTargets(fixture);
    await fixture.db.insert(fixture.tables.integrationConnections).values({
      id: "icn_schedule_pinned_repo_update_001",
      organizationId: authenticatedSession.organizationId,
      targetKey: GitHubTarget.targetKey,
      status: IntegrationConnectionStatuses.ACTIVE,
      displayName: "GitHub",
      externalSubjectId: "acct_schedule_pinned_repo_update_001",
      config: {},
      targetSnapshotConfig: {},
    });
    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_pinned_repo_update_001",
      version: 1,
    });
    await fixture.db.insert(fixture.tables.sandboxProfileVersionIntegrationBindings).values([
      {
        id: "spvib_schedule_pinned_repo_update_v1_001",
        sandboxProfileId: "sbp_schedule_pinned_repo_update_001",
        sandboxProfileVersion: 1,
        kind: IntegrationBindingKinds.GIT,
        connectionId: "icn_schedule_pinned_repo_update_001",
        config: {
          repositories: ["mistlehq/original", "mistlehq/pinned-only"],
        },
      },
    ]);

    const createdResponse = await fixture.request("/v1/automations/schedules", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        name: "Pinned version schedule",
        schedule: {
          cronExpression: "0 9 * * *",
          timezone: "Asia/Singapore",
        },
        inputTemplate: "Run",
        target: {
          sandboxProfileId: "sbp_schedule_pinned_repo_update_001",
          primaryRepositoryId: "mistlehq/original",
        },
      }),
    });

    expect(createdResponse.status).toBe(201);
    const created = AutomationScheduleSchema.parse(await createdResponse.json());
    expect(created.target.sandboxProfileVersion).toBe(1);

    await fixture.db.insert(fixture.tables.sandboxProfileVersions).values({
      sandboxProfileId: "sbp_schedule_pinned_repo_update_001",
      version: 2,
    });
    await fixture.db
      .update(fixture.tables.sandboxProfiles)
      .set({
        activeVersion: 2,
      })
      .where(eq(fixture.tables.sandboxProfiles.id, "sbp_schedule_pinned_repo_update_001"));
    await fixture.db.insert(fixture.tables.sandboxProfileVersionIntegrationBindings).values({
      id: "spvib_schedule_pinned_repo_update_v2_001",
      sandboxProfileId: "sbp_schedule_pinned_repo_update_001",
      sandboxProfileVersion: 2,
      kind: IntegrationBindingKinds.GIT,
      connectionId: "icn_schedule_pinned_repo_update_001",
      config: {
        repositories: ["mistlehq/original"],
      },
    });

    const updateResponse = await fixture.request(`/v1/automations/schedules/${created.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        target: {
          sandboxProfileId: "sbp_schedule_pinned_repo_update_001",
          primaryRepositoryId: "mistlehq/pinned-only",
        },
      }),
    });

    expect(updateResponse.status).toBe(200);
    const updated = AutomationScheduleSchema.parse(await updateResponse.json());
    expect(updated.target.sandboxProfileVersion).toBe(1);
    expect(updated.target.primaryRepositoryId).toBe("mistlehq/pinned-only");

    const persistedTarget = await fixture.db.query.automationTargets.findFirst({
      where: (table, { eq }) => eq(table.id, updated.target.id),
    });
    expect(persistedTarget?.sandboxProfileVersion).toBe(1);
    expect(persistedTarget?.primaryRepositoryId).toBe("mistlehq/pinned-only");
  });

  it("fails explicitly when a schedule automation aggregate is malformed", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "automation-schedules-malformed@example.com",
    });

    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_malformed_001",
      version: 1,
    });
    await fixture.db.insert(fixture.tables.automations).values({
      id: "atm_schedule_malformed_001",
      organizationId: authenticatedSession.organizationId,
      kind: AutomationKinds.SCHEDULE,
      name: "Malformed schedule",
      enabled: true,
    });
    await fixture.db.insert(fixture.tables.schedules).values({
      id: "sch_schedule_malformed_001",
      organizationId: authenticatedSession.organizationId,
      targetType: ScheduleTargetTypes.AUTOMATION_RUN,
      name: "Malformed schedule",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Singapore",
      enabled: true,
      nextScheduledAt: "2026-05-01T01:00:00.000Z",
    });
    await fixture.db.insert(fixture.tables.scheduleAutomations).values({
      scheduleId: "sch_schedule_malformed_001",
      automationId: "atm_schedule_malformed_001",
      inputTemplate: "Run",
      conversationKeyTemplate: "{{schedule.id}}",
      idempotencyKeyTemplate: "{{schedule.scheduledActionId}}",
    });

    const response = await fixture.request("/v1/automations/schedules/atm_schedule_malformed_001", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(response.status).toBe(500);
  });
});

async function createScheduleAutomation(
  fixture: ControlPlaneApiIntegrationFixture,
  cookie: string,
  input: {
    profileId: string;
  },
) {
  const response = await fixture.request("/v1/automations/schedules", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify({
      name: "Scheduled automation",
      schedule: {
        cronExpression: "0 9 * * *",
        timezone: "Asia/Singapore",
      },
      inputTemplate: "Run scheduled automation",
      target: {
        sandboxProfileId: input.profileId,
      },
    }),
  });

  expect(response.status).toBe(201);
  return AutomationScheduleSchema.parse(await response.json());
}

async function insertSandboxProfileWithVersion(
  fixture: ControlPlaneApiIntegrationFixture,
  input: {
    organizationId: string;
    profileId: string;
    version: number;
  },
): Promise<void> {
  await fixture.db.insert(fixture.tables.sandboxProfiles).values({
    id: input.profileId,
    organizationId: input.organizationId,
    displayName: input.profileId,
    activeVersion: input.version,
  });
  await fixture.db.insert(fixture.tables.sandboxProfileVersions).values({
    sandboxProfileId: input.profileId,
    version: input.version,
  });
}

async function insertIntegrationTargets(fixture: ControlPlaneApiIntegrationFixture): Promise<void> {
  await fixture.db
    .insert(fixture.tables.integrationTargets)
    .values({
      ...GitHubTarget,
      displayNameOverride: null,
      descriptionOverride: null,
    })
    .onConflictDoNothing();
}
