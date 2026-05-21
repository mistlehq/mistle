import {
  TriggerKinds,
  IntegrationConnectionStatuses,
  IntegrationBindingKinds,
  ScheduledActionStatuses,
  ScheduleKinds,
  ScheduleTargetTypes,
} from "@mistle/db/control-plane";
import { createControlPlaneWorkflowNamespaceId } from "@mistle/db/test-environment";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { DispatchOneOffScheduleWorkflowName } from "@mistle/workflow-registry/control-plane";
import { eq, sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import { z } from "zod";

import { ScheduleActionFailureCodes } from "../src/trigger-schedules/constants.js";
import { CreateTriggerScheduleBadRequestResponseSchema } from "../src/trigger-schedules/create-trigger-schedule/index.js";
import { DeleteTriggerScheduleResponseSchema } from "../src/trigger-schedules/delete-trigger-schedule/index.js";
import { TriggerScheduleSchema } from "../src/trigger-schedules/schemas.js";

type ControlPlaneApiIntegrationFixture = Readonly<{
  authSession: IntegrationTestEnvironment["auth"]["createSession"];
  db: IntegrationTestEnvironment["controlPlaneDb"];
  envId: string;
  request: IntegrationTestEnvironment["controlPlaneApi"]["http"]["fetch"];
  tables: IntegrationTestEnvironment["controlPlaneTables"];
}>;

type PersistedOneOffWorkflowRun = Readonly<{
  id: string;
  status: string;
  input: {
    scheduleId: string;
  };
  availableAt: string | null;
}>;

const PersistedOneOffWorkflowRunRowSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    input: z
      .object({
        scheduleId: z.string(),
      })
      .strict(),
    available_at: z.string().nullable(),
  })
  .strict();

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
        envId: env.id,
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

describe("trigger schedules CRUD integration", () => {
  it("creates and gets a scheduled trigger aggregate in the active organization", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "trigger-schedules-create@example.com",
    });

    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_create_001",
      version: 3,
    });

    const response = await fixture.request("/v1/triggers/schedules", {
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
          cronExpression: "*/30 * * * *",
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
    const body = TriggerScheduleSchema.parse(await response.json());
    expect(body.kind).toBe("schedule");
    expect(body.name).toBe("Daily issue triage");
    expect(body.enabled).toBe(true);
    expect(body.schedule.name).toBe("Daily morning schedule");
    expect(body.schedule.cronExpression).toBe("*/30 * * * *");
    expect(body.schedule.timezone).toBe("Asia/Singapore");
    expect(body.schedule.enabled).toBe(true);
    expect(body.schedule.nextScheduledAt).not.toBeNull();
    expect(body.inputTemplate).toBe("Summarize open issues for {{schedule.localScheduledDate}}");
    expect(body.conversationKeyTemplate).toBe("{{schedule.id}}");
    expect(body.idempotencyKeyTemplate).toBe("{{schedule.scheduledActionId}}");
    expect(body.target.sandboxProfileId).toBe("sbp_schedule_create_001");
    expect(body.target.sandboxProfileVersion).toBe(3);
    expect(body.target.primaryRepositoryId).toBeNull();

    const persistedScheduleTrigger = await fixture.db.query.scheduleTriggers.findFirst({
      where: (table, { eq }) => eq(table.triggerId, body.id),
    });
    expect(persistedScheduleTrigger).toBeDefined();
    if (persistedScheduleTrigger === undefined) {
      throw new Error("Expected created schedule trigger config to be persisted.");
    }

    const persistedSchedule = await fixture.db.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, persistedScheduleTrigger.scheduleId),
    });
    expect(persistedSchedule).toBeDefined();
    if (persistedSchedule === undefined) {
      throw new Error("Expected created schedule to be persisted.");
    }
    expect(persistedSchedule.organizationId).toBe(authenticatedSession.organizationId);
    expect(persistedSchedule.targetType).toBe(ScheduleTargetTypes.TRIGGER_RUN);
    expect(persistedSchedule.enabled).toBe(true);
    expect(persistedSchedule.nextScheduledAt).not.toBeNull();

    const getResponse = await fixture.request(`/v1/triggers/schedules/${body.id}`, {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(getResponse.status).toBe(200);
    expect(TriggerScheduleSchema.parse(await getResponse.json())).toEqual(body);
  });

  it("persists the active sandbox profile version when the target version is omitted", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "trigger-schedules-active-version@example.com",
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

    const response = await fixture.request("/v1/triggers/schedules", {
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
    const body = TriggerScheduleSchema.parse(await response.json());
    expect(body.target.sandboxProfileVersion).toBe(2);
  });

  it("creates enabled one-off schedules with a future workflow run", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "trigger-schedules-one-off-create@example.com",
    });

    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_one_off_create_001",
      version: 1,
    });

    const response = await fixture.request("/v1/triggers/schedules", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        name: "One-off launch",
        schedule: {
          kind: "one_off",
          name: "One-off schedule",
          startAt: "2099-05-01T01:00:00.000Z",
        },
        inputTemplate: "Run once",
        target: {
          sandboxProfileId: "sbp_schedule_one_off_create_001",
        },
      }),
    });

    expect(response.status).toBe(201);
    const body = TriggerScheduleSchema.parse(await response.json());
    expect(body.schedule.kind).toBe(ScheduleKinds.ONE_OFF);
    expect(body.schedule.cronExpression).toBeNull();
    expect(body.schedule.timezone).toBeNull();
    expect(body.schedule.startAt).toBe("2099-05-01T01:00:00.000Z");
    expect(body.schedule.nextScheduledAt).toBe("2099-05-01T01:00:00.000Z");

    const persistedSchedule = await fixture.db.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, body.schedule.id),
    });
    expect(persistedSchedule?.kind).toBe(ScheduleKinds.ONE_OFF);
    expect(persistedSchedule?.oneOffWorkflowRunId).not.toBeNull();

    const workflowRun = await readOneOffWorkflowRun(fixture, body.schedule.id);
    expect(workflowRun.id).toBe(persistedSchedule?.oneOffWorkflowRunId);
    expect(workflowRun.status).toBe("pending");
    expect(workflowRun.input).toEqual({
      scheduleId: body.schedule.id,
    });
    expect(normalizePersistedTimestamp(workflowRun.availableAt)).toBe("2099-05-01T01:00:00.000Z");
  });

  it("does not enqueue disabled one-off schedules until they are enabled", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "trigger-schedules-one-off-enable@example.com",
    });

    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_one_off_enable_001",
      version: 1,
    });

    const createResponse = await fixture.request("/v1/triggers/schedules", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        name: "Disabled one-off launch",
        enabled: false,
        schedule: {
          kind: "one_off",
          startAt: "2099-05-02T01:00:00.000Z",
        },
        inputTemplate: "Run once after enabling",
        target: {
          sandboxProfileId: "sbp_schedule_one_off_enable_001",
        },
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = TriggerScheduleSchema.parse(await createResponse.json());
    expect(created.schedule.nextScheduledAt).toBeNull();
    expect(await countOneOffWorkflowRuns(fixture, created.schedule.id)).toBe(0);

    const enableResponse = await fixture.request(`/v1/triggers/schedules/${created.id}`, {
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
    const enabled = TriggerScheduleSchema.parse(await enableResponse.json());
    expect(enabled.schedule.nextScheduledAt).toBe("2099-05-02T01:00:00.000Z");
    const workflowRun = await readOneOffWorkflowRun(fixture, enabled.schedule.id);
    expect(workflowRun.status).toBe("pending");
    expect(normalizePersistedTimestamp(workflowRun.availableAt)).toBe("2099-05-02T01:00:00.000Z");
  });

  it("cancels a pending one-off workflow when disabling the schedule", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "trigger-schedules-one-off-disable@example.com",
    });

    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_one_off_disable_001",
      version: 1,
    });
    const created = await createOneOffScheduleTrigger(fixture, authenticatedSession.cookie, {
      profileId: "sbp_schedule_one_off_disable_001",
      startAt: "2099-05-03T01:00:00.000Z",
    });
    const queuedWorkflowRun = await readOneOffWorkflowRun(fixture, created.schedule.id);

    const disableResponse = await fixture.request(`/v1/triggers/schedules/${created.id}`, {
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
    const disabled = TriggerScheduleSchema.parse(await disableResponse.json());
    expect(disabled.schedule.nextScheduledAt).toBeNull();

    const canceledWorkflowRun = await readOneOffWorkflowRun(fixture, created.schedule.id);
    expect(canceledWorkflowRun.id).toBe(queuedWorkflowRun.id);
    expect(canceledWorkflowRun.status).toBe("canceled");
  });

  it("cancels a pending one-off workflow when deleting the schedule", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "trigger-schedules-one-off-delete@example.com",
    });

    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_one_off_delete_001",
      version: 1,
    });
    const created = await createOneOffScheduleTrigger(fixture, authenticatedSession.cookie, {
      profileId: "sbp_schedule_one_off_delete_001",
      startAt: "2099-05-04T01:00:00.000Z",
    });
    const queuedWorkflowRun = await readOneOffWorkflowRun(fixture, created.schedule.id);

    const deleteResponse = await fixture.request(`/v1/triggers/schedules/${created.id}`, {
      method: "DELETE",
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(deleteResponse.status).toBe(200);

    const persistedSchedule = await fixture.db.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, created.schedule.id),
    });
    expect(persistedSchedule?.deletedAt).not.toBeNull();
    expect(persistedSchedule?.nextScheduledAt).toBeNull();

    const canceledWorkflowRun = await readOneOffWorkflowRun(fixture, created.schedule.id);
    expect(canceledWorkflowRun.id).toBe(queuedWorkflowRun.id);
    expect(canceledWorkflowRun.status).toBe("canceled");
  });

  it("updates schedule timing from request time and keeps template-only updates from moving the cursor", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "trigger-schedules-update@example.com",
    });

    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_update_001",
      version: 1,
    });
    const created = await createScheduleTrigger(fixture, authenticatedSession.cookie, {
      profileId: "sbp_schedule_update_001",
    });

    await fixture.db
      .update(fixture.tables.schedules)
      .set({
        lastScheduledAt: "2099-01-01T00:00:00.000Z",
      })
      .where(eq(fixture.tables.schedules.id, created.schedule.id));

    const updateResponse = await fixture.request(`/v1/triggers/schedules/${created.id}`, {
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
    const updated = TriggerScheduleSchema.parse(await updateResponse.json());
    expect(updated.schedule.cronExpression).toBe("30 10 * * *");
    expect(updated.schedule.nextScheduledAt).not.toBeNull();
    if (updated.schedule.nextScheduledAt === null) {
      throw new Error("Expected schedule cursor to be recomputed.");
    }
    expect(new Date(updated.schedule.nextScheduledAt).getTime()).toBeLessThan(
      new Date("2099-01-01T00:00:00.000Z").getTime(),
    );

    const cursorAfterTimingUpdate = updated.schedule.nextScheduledAt;
    const templateOnlyResponse = await fixture.request(`/v1/triggers/schedules/${created.id}`, {
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
    const templateOnlyUpdate = TriggerScheduleSchema.parse(await templateOnlyResponse.json());
    expect(templateOnlyUpdate.inputTemplate).toBe("Updated template only");
    expect(templateOnlyUpdate.schedule.nextScheduledAt).toBe(cursorAfterTimingUpdate);
  });

  it("disables and re-enables schedules with coherent schedule cursors", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "trigger-schedules-enable-disable@example.com",
    });

    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_enable_disable_001",
      version: 1,
    });
    const created = await createScheduleTrigger(fixture, authenticatedSession.cookie, {
      profileId: "sbp_schedule_enable_disable_001",
    });
    await fixture.db.insert(fixture.tables.scheduledActions).values({
      id: "sca_schedule_disable_pending_001",
      scheduleId: created.schedule.id,
      organizationId: authenticatedSession.organizationId,
      targetType: ScheduleTargetTypes.TRIGGER_RUN,
      targetPayload: {
        triggerId: created.id,
      },
      scheduledAt: "2026-05-01T01:00:00.000Z",
      localScheduledDate: "2026-05-01",
      localScheduledTime: "09:00",
      status: ScheduledActionStatuses.PENDING,
    });

    const disableResponse = await fixture.request(`/v1/triggers/schedules/${created.id}`, {
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
    const disabled = TriggerScheduleSchema.parse(await disableResponse.json());
    expect(disabled.enabled).toBe(false);
    expect(disabled.schedule.enabled).toBe(false);
    expect(disabled.schedule.nextScheduledAt).toBeNull();

    const failedAction = await fixture.db.query.scheduledActions.findFirst({
      where: (table, { eq }) => eq(table.id, "sca_schedule_disable_pending_001"),
    });
    expect(failedAction?.status).toBe(ScheduledActionStatuses.FAILED);
    expect(failedAction?.failureCode).toBe(ScheduleActionFailureCodes.SCHEDULE_DISABLED);

    const enableResponse = await fixture.request(`/v1/triggers/schedules/${created.id}`, {
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
    const enabled = TriggerScheduleSchema.parse(await enableResponse.json());
    expect(enabled.enabled).toBe(true);
    expect(enabled.schedule.enabled).toBe(true);
    expect(enabled.schedule.nextScheduledAt).not.toBeNull();
  });

  it("soft deletes schedules and marks pending scheduled actions failed", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "trigger-schedules-delete@example.com",
    });

    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_delete_001",
      version: 1,
    });
    const created = await createScheduleTrigger(fixture, authenticatedSession.cookie, {
      profileId: "sbp_schedule_delete_001",
    });
    await fixture.db.insert(fixture.tables.scheduledActions).values({
      id: "sca_schedule_delete_pending_001",
      scheduleId: created.schedule.id,
      organizationId: authenticatedSession.organizationId,
      targetType: ScheduleTargetTypes.TRIGGER_RUN,
      targetPayload: {
        triggerId: created.id,
      },
      scheduledAt: "2026-05-01T01:00:00.000Z",
      localScheduledDate: "2026-05-01",
      localScheduledTime: "09:00",
      status: ScheduledActionStatuses.PENDING,
    });

    const deleteResponse = await fixture.request(`/v1/triggers/schedules/${created.id}`, {
      method: "DELETE",
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(deleteResponse.status).toBe(200);
    expect(DeleteTriggerScheduleResponseSchema.parse(await deleteResponse.json())).toEqual({
      triggerId: created.id,
    });

    const persistedTrigger = await fixture.db.query.triggers.findFirst({
      where: (table, { eq }) => eq(table.id, created.id),
    });
    expect(persistedTrigger?.enabled).toBe(false);

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

    const getResponse = await fixture.request(`/v1/triggers/schedules/${created.id}`, {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(getResponse.status).toBe(404);
  });

  it("rejects invalid schedule and target references", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "trigger-schedules-invalid@example.com",
    });

    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_invalid_001",
      version: 1,
    });

    const invalidScheduleResponse = await fixture.request("/v1/triggers/schedules", {
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
    const invalidScheduleError = CreateTriggerScheduleBadRequestResponseSchema.parse(
      await invalidScheduleResponse.json(),
    );
    expect(invalidScheduleError).toMatchObject({
      code: "INVALID_SCHEDULE",
    });

    const invalidRepositoryResponse = await fixture.request("/v1/triggers/schedules", {
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
    const invalidRepositoryError = CreateTriggerScheduleBadRequestResponseSchema.parse(
      await invalidRepositoryResponse.json(),
    );
    expect(invalidRepositoryError).toMatchObject({
      code: "INVALID_PRIMARY_REPOSITORY",
    });
  });

  it("persists valid primary repository selections", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "trigger-schedules-primary-repository@example.com",
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

    const response = await fixture.request("/v1/triggers/schedules", {
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
    const body = TriggerScheduleSchema.parse(await response.json());
    expect(body.target.primaryRepositoryId).toBe("mistlehq/platform");
  });

  it("preserves the pinned profile version when updating only the primary repository", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "trigger-schedules-pinned-version-repository-update@example.com",
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

    const createdResponse = await fixture.request("/v1/triggers/schedules", {
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
    const created = TriggerScheduleSchema.parse(await createdResponse.json());
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

    const updateResponse = await fixture.request(`/v1/triggers/schedules/${created.id}`, {
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
    const updated = TriggerScheduleSchema.parse(await updateResponse.json());
    expect(updated.target.sandboxProfileVersion).toBe(1);
    expect(updated.target.primaryRepositoryId).toBe("mistlehq/pinned-only");

    const persistedTarget = await fixture.db.query.triggerTargets.findFirst({
      where: (table, { eq }) => eq(table.id, updated.target.id),
    });
    expect(persistedTarget?.sandboxProfileVersion).toBe(1);
    expect(persistedTarget?.primaryRepositoryId).toBe("mistlehq/pinned-only");
  });

  it("fails explicitly when a schedule trigger aggregate is malformed", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "trigger-schedules-malformed@example.com",
    });

    await insertSandboxProfileWithVersion(fixture, {
      organizationId: authenticatedSession.organizationId,
      profileId: "sbp_schedule_malformed_001",
      version: 1,
    });
    await fixture.db.insert(fixture.tables.triggers).values({
      id: "atm_schedule_malformed_001",
      organizationId: authenticatedSession.organizationId,
      kind: TriggerKinds.SCHEDULE,
      name: "Malformed schedule",
      enabled: true,
    });
    await fixture.db.insert(fixture.tables.schedules).values({
      id: "sch_schedule_malformed_001",
      organizationId: authenticatedSession.organizationId,
      targetType: ScheduleTargetTypes.TRIGGER_RUN,
      name: "Malformed schedule",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Singapore",
      enabled: true,
      nextScheduledAt: "2026-05-01T01:00:00.000Z",
    });
    await fixture.db.insert(fixture.tables.scheduleTriggers).values({
      scheduleId: "sch_schedule_malformed_001",
      triggerId: "atm_schedule_malformed_001",
      inputTemplate: "Run",
      conversationKeyTemplate: "{{schedule.id}}",
      idempotencyKeyTemplate: "{{schedule.scheduledActionId}}",
    });

    const response = await fixture.request("/v1/triggers/schedules/atm_schedule_malformed_001", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(response.status).toBe(500);
  });
});

async function createScheduleTrigger(
  fixture: ControlPlaneApiIntegrationFixture,
  cookie: string,
  input: {
    profileId: string;
  },
) {
  const response = await fixture.request("/v1/triggers/schedules", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify({
      name: "Scheduled trigger",
      schedule: {
        cronExpression: "0 9 * * *",
        timezone: "Asia/Singapore",
      },
      inputTemplate: "Run scheduled trigger",
      target: {
        sandboxProfileId: input.profileId,
      },
    }),
  });

  expect(response.status).toBe(201);
  return TriggerScheduleSchema.parse(await response.json());
}

async function createOneOffScheduleTrigger(
  fixture: ControlPlaneApiIntegrationFixture,
  cookie: string,
  input: {
    profileId: string;
    startAt: string;
  },
) {
  const response = await fixture.request("/v1/triggers/schedules", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify({
      name: "One-off scheduled trigger",
      schedule: {
        kind: "one_off",
        startAt: input.startAt,
      },
      inputTemplate: "Run one-off scheduled trigger",
      target: {
        sandboxProfileId: input.profileId,
      },
    }),
  });

  expect(response.status).toBe(201);
  return TriggerScheduleSchema.parse(await response.json());
}

async function readOneOffWorkflowRun(
  fixture: ControlPlaneApiIntegrationFixture,
  scheduleId: string,
): Promise<PersistedOneOffWorkflowRun> {
  const workflowRuns = await listOneOffWorkflowRuns(fixture, scheduleId);
  expect(workflowRuns).toHaveLength(1);
  const workflowRun = workflowRuns[0];
  if (workflowRun === undefined) {
    throw new Error("Expected one-off workflow run.");
  }

  return workflowRun;
}

async function countOneOffWorkflowRuns(
  fixture: ControlPlaneApiIntegrationFixture,
  scheduleId: string,
): Promise<number> {
  return (await listOneOffWorkflowRuns(fixture, scheduleId)).length;
}

async function listOneOffWorkflowRuns(
  fixture: ControlPlaneApiIntegrationFixture,
  scheduleId: string,
): Promise<ReadonlyArray<PersistedOneOffWorkflowRun>> {
  const namespaceId = createControlPlaneWorkflowNamespaceId(fixture.envId);
  const result = await fixture.db.execute(sql<{
    id: string;
    status: string;
    input: unknown;
    available_at: string | null;
  }>`
    select
      id,
      status,
      input,
      available_at
    from control_plane_openworkflow.workflow_runs
    where namespace_id = ${namespaceId}
      and workflow_name = ${DispatchOneOffScheduleWorkflowName}
      and input @> ${JSON.stringify({ scheduleId })}::jsonb
    order by created_at asc
  `);

  return result.rows.map((row) => {
    const parsed = PersistedOneOffWorkflowRunRowSchema.parse(row);
    return {
      id: parsed.id,
      status: parsed.status,
      input: parsed.input,
      availableAt: parsed.available_at,
    };
  });
}

function normalizePersistedTimestamp(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  return new Date(value).toISOString();
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
