/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  ApiKeyActorKinds,
  IntegrationBindingKinds,
  ScheduleKinds,
  ScheduleTargetTypes,
  SandboxProfileVersionStates,
  TriggerKinds,
  type ScheduleKind,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { and, eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { DuplicateSandboxProfileResponseSchema } from "../src/sandbox-profiles/index.js";
import {
  sandboxProfileRow,
  sandboxProfileVersionIntegrationBindingRow,
  sandboxProfileVersionRow,
} from "./helpers/sandbox-profiles.js";
import {
  seedPersistedWebhookTrigger,
  seedTriggerWebhookTargets,
  seedWebhookTriggerFixture,
} from "./helpers/trigger-webhooks.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("sandbox profiles duplicate integration", () => {
  it("duplicates the active usable snapshot, carries the draft, copies refresh schedule, and creates disabled reusable triggers", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-duplicate@example.com",
    });

    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_duplicate_github",
      webhookSourceId: "iws_duplicate_github",
      profileId: "sbp_duplicate_source",
      profileVersion: 2,
      profileActiveVersion: 2,
    });
    await env.controlPlaneDb
      .update(env.controlPlaneTables.sandboxProfileVersions)
      .set({
        setupScript: "echo active setup",
        maintenanceScript: "echo active maintain",
        snapshotImageProvider: "docker",
        snapshotImageId: "sha256:duplicate-active",
      })
      .where(
        and(
          eq(
            env.controlPlaneTables.sandboxProfileVersions.sandboxProfileId,
            "sbp_duplicate_source",
          ),
          eq(env.controlPlaneTables.sandboxProfileVersions.version, 2),
        ),
      );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_duplicate_source",
        version: 3,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "echo draft setup",
        maintenanceScript: "echo draft maintain",
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_duplicate_github_draft",
          sandboxProfileId: "sbp_duplicate_source",
          sandboxProfileVersion: 3,
          connectionId: "icn_duplicate_github",
          kind: IntegrationBindingKinds.CONNECTOR,
        }),
      );

    await env.controlPlaneDb.insert(env.controlPlaneTables.schedules).values({
      id: "sch_duplicate_refresh_source",
      organizationId: session.organizationId,
      targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
      kind: ScheduleKinds.RECURRING,
      name: "Source refresh",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Singapore",
      enabled: true,
      nextScheduledAt: "2026-01-01T01:00:00.000Z",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileSnapshotRefreshScheduleTargets)
      .values({
        scheduleId: "sch_duplicate_refresh_source",
        sandboxProfileId: "sbp_duplicate_source",
        sandboxProfileVersion: 2,
      });

    await seedPersistedWebhookTrigger(env, {
      triggerId: "trg_duplicate_webhook_source",
      organizationId: session.organizationId,
      webhookSourceId: "iws_duplicate_github",
      profileId: "sbp_duplicate_source",
      profileVersion: 2,
      targetId: "tgt_duplicate_webhook_source",
      name: "Source webhook",
      enabled: true,
    });
    await seedScheduleTrigger(env, {
      organizationId: session.organizationId,
      profileId: "sbp_duplicate_source",
      profileVersion: 2,
      triggerId: "trg_duplicate_schedule_source",
      targetId: "tgt_duplicate_schedule_source",
      scheduleId: "sch_duplicate_schedule_source",
      name: "Source recurring schedule",
    });
    await seedScheduleTrigger(env, {
      organizationId: session.organizationId,
      profileId: "sbp_duplicate_source",
      profileVersion: 2,
      triggerId: "trg_duplicate_one_off_source",
      targetId: "tgt_duplicate_one_off_source",
      scheduleId: "sch_duplicate_one_off_source",
      name: "Source one-off schedule",
      scheduleKind: ScheduleKinds.ONE_OFF,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_duplicate_source/duplicate",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          displayName: "Duplicated profile",
          includeTriggers: true,
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = DuplicateSandboxProfileResponseSchema.parse(await response.json());
    expect(body.profile.displayName).toBe("Duplicated profile");
    expect(body.profile.activeVersion).toBe(1);
    expect(body.activeVersion).toBe(1);
    expect(body.draftVersion).toBe(2);
    expect(body.duplicatedTriggerCount).toBe(2);

    const duplicatedVersions = await env.controlPlaneDb.query.sandboxProfileVersions.findMany({
      where: (table, { eq }) => eq(table.sandboxProfileId, body.profile.id),
      orderBy: (table, { asc }) => [asc(table.version)],
    });
    expect(duplicatedVersions).toHaveLength(2);
    expect(duplicatedVersions[0]).toMatchObject({
      sandboxProfileId: body.profile.id,
      version: 1,
      state: SandboxProfileVersionStates.PUBLISHED,
      setupScript: "echo active setup",
      maintenanceScript: "echo active maintain",
      snapshotImageProvider: "docker",
      snapshotImageId: "sha256:duplicate-active",
    });
    expect(duplicatedVersions[1]).toMatchObject({
      sandboxProfileId: body.profile.id,
      version: 2,
      state: SandboxProfileVersionStates.DRAFT,
      setupScript: "echo draft setup",
      maintenanceScript: "echo draft maintain",
      snapshotImageProvider: null,
      snapshotImageId: null,
    });

    const duplicatedRefreshTarget =
      await env.controlPlaneDb.query.sandboxProfileSnapshotRefreshScheduleTargets.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.sandboxProfileId, body.profile.id), eq(table.sandboxProfileVersion, 1)),
      });
    expect(duplicatedRefreshTarget).toBeDefined();
    if (duplicatedRefreshTarget === undefined) {
      throw new Error("Expected duplicated refresh schedule target.");
    }
    const duplicatedRefreshSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, duplicatedRefreshTarget.scheduleId),
    });
    expect(duplicatedRefreshSchedule).toMatchObject({
      name: "Source refresh",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Singapore",
      enabled: true,
      targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
    });
    expect(duplicatedRefreshSchedule?.nextScheduledAt).not.toBe("2026-01-01T01:00:00.000Z");

    const duplicatedTargets = await env.controlPlaneDb.query.triggerTargets.findMany({
      where: (table, { eq }) => eq(table.sandboxProfileId, body.profile.id),
      orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
    });
    expect(duplicatedTargets).toHaveLength(2);

    const duplicatedTriggers = await env.controlPlaneDb.query.triggers.findMany({
      where: (table, { inArray }) =>
        inArray(
          table.id,
          duplicatedTargets.map((target) => target.triggerId),
        ),
      orderBy: (table, { asc }) => [asc(table.name)],
    });
    expect(duplicatedTriggers.map((trigger) => trigger.name)).toEqual([
      "Source recurring schedule copy",
      "Source webhook copy",
    ]);
    expect(duplicatedTriggers.every((trigger) => trigger.enabled === false)).toBe(true);

    const duplicatedScheduleTrigger = duplicatedTriggers.find(
      (trigger) => trigger.kind === TriggerKinds.SCHEDULE,
    );
    if (duplicatedScheduleTrigger === undefined) {
      throw new Error("Expected duplicated scheduled trigger.");
    }
    const duplicatedScheduleJoin = await env.controlPlaneDb.query.scheduleTriggers.findFirst({
      where: (table, { eq }) => eq(table.triggerId, duplicatedScheduleTrigger.id),
    });
    if (duplicatedScheduleJoin === undefined) {
      throw new Error("Expected duplicated schedule trigger join.");
    }
    const duplicatedSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, duplicatedScheduleJoin.scheduleId),
    });
    expect(duplicatedSchedule).toMatchObject({
      enabled: false,
      nextScheduledAt: null,
      kind: ScheduleKinds.RECURRING,
      targetType: ScheduleTargetTypes.TRIGGER_RUN,
    });
  });

  it("rejects duplication when the source active version has no usable snapshot", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-duplicate-no-snapshot@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_duplicate_no_snapshot",
        organizationId: session.organizationId,
        displayName: "No Snapshot Source",
        activeVersion: 1,
        createdAt: "2026-05-21T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_duplicate_no_snapshot",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_duplicate_no_snapshot/duplicate",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          displayName: "Should not duplicate",
        }),
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "PROFILE_VERSION_NOT_USABLE",
    });
  });

  it("allows duplicated profiles to reuse the source display name", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-duplicate-same-name@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_duplicate_same_name_source",
        organizationId: session.organizationId,
        displayName: "Reusable profile name",
        activeVersion: 1,
        createdAt: "2026-05-21T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_duplicate_same_name_source",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
      }),
    );
    await env.controlPlaneDb
      .update(env.controlPlaneTables.sandboxProfileVersions)
      .set({
        snapshotImageProvider: "docker",
        snapshotImageId: "sha256:duplicate-same-name",
      })
      .where(
        and(
          eq(
            env.controlPlaneTables.sandboxProfileVersions.sandboxProfileId,
            "sbp_duplicate_same_name_source",
          ),
          eq(env.controlPlaneTables.sandboxProfileVersions.version, 1),
        ),
      );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_duplicate_same_name_source/duplicate",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          displayName: "Reusable profile name",
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = DuplicateSandboxProfileResponseSchema.parse(await response.json());
    expect(body.profile.displayName).toBe("Reusable profile name");
    expect(body.profile.id).not.toBe("sbp_duplicate_same_name_source");
  });

  it("rejects duplication when a copied Mistle MCP API key is unavailable", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-duplicate-unavailable-api-key@example.com",
    });

    await seedMistleMcpApiKey(env, {
      organizationId: session.organizationId,
      apiKeyId: "apk_duplicate_revoked",
      revokedAt: "2026-05-01T00:00:00.000Z",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_duplicate_unavailable_api_key",
        organizationId: session.organizationId,
        displayName: "Unavailable API Key Source",
        activeVersion: 1,
        createdAt: "2026-05-21T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_duplicate_unavailable_api_key",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        mistleMcpEnabled: true,
        mistleMcpApiKeyId: "apk_duplicate_revoked",
      }),
    );
    await env.controlPlaneDb
      .update(env.controlPlaneTables.sandboxProfileVersions)
      .set({
        snapshotImageProvider: "docker",
        snapshotImageId: "sha256:duplicate-unavailable-api-key",
      })
      .where(
        and(
          eq(
            env.controlPlaneTables.sandboxProfileVersions.sandboxProfileId,
            "sbp_duplicate_unavailable_api_key",
          ),
          eq(env.controlPlaneTables.sandboxProfileVersions.version, 1),
        ),
      );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_duplicate_unavailable_api_key/duplicate",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          displayName: "Should not duplicate",
        }),
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_DUPLICATE_REFERENCE",
    });
  });

  it("duplicates disabled Mistle MCP config with an unavailable remembered API key", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-duplicate-disabled-mcp-key@example.com",
    });

    await seedMistleMcpApiKey(env, {
      organizationId: session.organizationId,
      apiKeyId: "apk_duplicate_disabled_revoked",
      revokedAt: "2026-05-01T00:00:00.000Z",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_duplicate_disabled_mcp_key",
        organizationId: session.organizationId,
        displayName: "Disabled MCP Key Source",
        activeVersion: 1,
        createdAt: "2026-05-21T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_duplicate_disabled_mcp_key",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        mistleMcpEnabled: false,
        mistleMcpApiKeyId: "apk_duplicate_disabled_revoked",
      }),
    );
    await env.controlPlaneDb
      .update(env.controlPlaneTables.sandboxProfileVersions)
      .set({
        snapshotImageProvider: "docker",
        snapshotImageId: "sha256:duplicate-disabled-mcp-key",
      })
      .where(
        and(
          eq(
            env.controlPlaneTables.sandboxProfileVersions.sandboxProfileId,
            "sbp_duplicate_disabled_mcp_key",
          ),
          eq(env.controlPlaneTables.sandboxProfileVersions.version, 1),
        ),
      );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_duplicate_disabled_mcp_key/duplicate",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          displayName: "Disabled MCP Key Copy",
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = DuplicateSandboxProfileResponseSchema.parse(await response.json());
    const duplicatedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, body.profile.id), eq(table.version, 1)),
    });
    expect(duplicatedVersion).toMatchObject({
      mistleMcpEnabled: false,
      mistleMcpApiKeyId: "apk_duplicate_disabled_revoked",
    });
  });
});

async function seedMistleMcpApiKey(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    apiKeyId: string;
    revokedAt?: string | undefined;
    expiresAt?: string | undefined;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.apiKeys).values({
    id: input.apiKeyId,
    name: "Duplicate Mistle MCP API Key",
    organizationId: input.organizationId,
    secretPrefix: `prefix_${input.apiKeyId}`,
    secretHash: "sha256-test-hash",
    secretHashAlgorithm: "sha256-v1",
    createdByActorKind: ApiKeyActorKinds.USER,
    createdByActorId: "usr_duplicate_mistle_mcp",
    ...(input.revokedAt === undefined ? {} : { revokedAt: input.revokedAt }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  });
}

async function seedScheduleTrigger(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
    triggerId: string;
    targetId: string;
    scheduleId: string;
    name: string;
    scheduleKind?: ScheduleKind;
  },
): Promise<void> {
  const scheduleKind = input.scheduleKind ?? ScheduleKinds.RECURRING;

  await env.controlPlaneDb.insert(env.controlPlaneTables.triggers).values({
    id: input.triggerId,
    organizationId: input.organizationId,
    kind: TriggerKinds.SCHEDULE,
    name: input.name,
    enabled: true,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.schedules).values({
    id: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.TRIGGER_RUN,
    kind: scheduleKind,
    name: `${input.name} schedule`,
    enabled: true,
    ...(scheduleKind === ScheduleKinds.RECURRING
      ? {
          cronExpression: "*/15 * * * *",
          timezone: "Asia/Singapore",
          nextScheduledAt: "2026-01-01T00:15:00.000Z",
        }
      : {
          startAt: "2099-01-01T00:00:00.000Z",
          nextScheduledAt: "2099-01-01T00:00:00.000Z",
        }),
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.scheduleTriggers).values({
    scheduleId: input.scheduleId,
    triggerId: input.triggerId,
    inputTemplate:
      scheduleKind === ScheduleKinds.RECURRING ? "Run recurring source" : "Run one-off source",
    conversationKeyTemplate: "{{schedule.id}}",
    idempotencyKeyTemplate: "{{schedule.scheduledActionId}}",
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.triggerTargets).values({
    id: input.targetId,
    triggerId: input.triggerId,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: input.profileVersion,
    primaryRepositoryId: null,
  });
}
