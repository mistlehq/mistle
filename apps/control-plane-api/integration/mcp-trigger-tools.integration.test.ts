/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  ScheduleKinds,
  ScheduleTargetTypes,
  TriggerKinds,
  type ControlPlaneTables,
  type ScheduleKind,
} from "@mistle/db/control-plane";
import { mintMcpToken } from "@mistle/gateway-tunnel-auth";
import { IntegrationWebhookTriggerCapabilitiesProviderMetadataKey } from "@mistle/integrations-core";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";
import { z } from "zod";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import { ListTriggersResponseSchema } from "../src/triggers/list-triggers/schema.js";
import { createApiKeyToken } from "./helpers/api-keys.js";
import { callMcpTool, listMcpTools } from "./helpers/mcp-json-rpc.js";
import { sandboxProfileRow, sandboxProfileVersionRow } from "./helpers/sandbox-profiles.js";
import {
  GitHubIssueCommentCreatedEventType,
  GitHubTriggerTargetKey,
  seedPersistedWebhookTrigger,
  seedTriggerWebhookTargets,
  seedWebhookTriggerFixture,
} from "./helpers/trigger-webhooks.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

const McpTokenConfig = {
  tokenSecret: "integration-new-mcp-auth-secret",
  tokenIssuer: "integration-new-control-plane-api",
  tokenAudience: "integration-new-mistle-mcp",
};

const ListTriggerWebhookEventsResultSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    sandboxProfileName: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    events: z.array(
      z
        .object({
          eventType: z.string().min(1),
          displayName: z.string().min(1),
          webhookSourceId: z.string().min(1),
          webhookSourceName: z.string().min(1).nullable(),
          integrationConnectionId: z.string().min(1),
          integrationConnectionName: z.string().min(1),
          integrationTargetKey: z.string().min(1),
          integrationName: z.string().min(1),
          logoKey: z.string().min(1).optional(),
          category: z.string().min(1).optional(),
        })
        .strict(),
    ),
  })
  .strict();

const McpTriggerTargetSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    primaryRepositoryId: z.string().min(1).nullable(),
  })
  .strict();

const McpTriggerEventConditionSchema = z
  .object({
    eventType: z.string().min(1),
    payloadFilter: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

const McpWebhookTriggerConfigSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal(TriggerKinds.WEBHOOK),
    name: z.string().min(1),
    enabled: z.boolean(),
    integrationWebhookSourceId: z.string().min(1),
    eventConditions: z.array(McpTriggerEventConditionSchema).min(1),
    inputTemplate: z.string().min(1),
    instructions: z.string().min(1).nullable(),
    conversationKeyTemplate: z.string().min(1),
    idempotencyKeyTemplate: z.string().min(1).nullable(),
    target: McpTriggerTargetSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

const McpScheduleTriggerConfigSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal(TriggerKinds.SCHEDULE),
    name: z.string().min(1),
    enabled: z.boolean(),
    schedule: z
      .object({
        kind: z.enum([ScheduleKinds.RECURRING, ScheduleKinds.ONE_OFF]),
        name: z.string().min(1),
        cronExpression: z.string().min(1).nullable(),
        timezone: z.string().min(1).nullable(),
        enabled: z.boolean(),
        nextScheduledAt: z.string().min(1).nullable(),
        lastScheduledAt: z.string().min(1).nullable(),
        startAt: z.string().min(1).nullable(),
      })
      .strict(),
    inputTemplate: z.string().min(1),
    conversationKeyTemplate: z.string().min(1),
    idempotencyKeyTemplate: z.string().min(1).nullable(),
    target: McpTriggerTargetSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

const McpTriggerConfigSchema = z.discriminatedUnion("kind", [
  McpWebhookTriggerConfigSchema,
  McpScheduleTriggerConfigSchema,
]);

describe.concurrent("MCP trigger tools integration", () => {
  it("exposes canonical trigger lifecycle tools without narrow mutation tools", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-tools-list@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP trigger tool lister",
      permissions: [
        OrganizationPermissions.TRIGGER_READ,
        OrganizationPermissions.TRIGGER_CREATE,
        OrganizationPermissions.TRIGGER_UPDATE,
      ],
    });

    const tools = await listMcpTools({ env, token });
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "list_triggers",
        "get_trigger",
        "create_trigger",
        "update_trigger",
        "list_trigger_webhook_events",
      ]),
    );
    expect(toolNames).not.toEqual(
      expect.arrayContaining([
        "create_scheduled_trigger",
        "create_webhook_trigger",
        "set_trigger_schedule",
        "set_trigger_webhook_events",
        "set_trigger_enabled",
        "rename_trigger",
        "update_trigger_user_message",
      ]),
    );
    expect(tools.find((tool) => tool.name === "update_trigger")?.annotations).toEqual(
      expect.objectContaining({
        idempotentHint: false,
      }),
    );
  });

  it("lists trigger summaries and gets full trigger configuration", async ({ env }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-mcp-trigger-list-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-mcp-trigger-list-b@example.com",
    });
    const token = await createApiKeyToken({
      cookie: firstOrgSession.cookie,
      env,
      name: "MCP trigger reader",
      permissions: [OrganizationPermissions.TRIGGER_READ],
    });

    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: firstOrgSession.organizationId,
      connectionId: "icn_mcp_trigger_list_a",
      webhookSourceId: "iws_mcp_trigger_list_a",
      profileId: "sbp_mcp_trigger_list_a",
      profileVersion: 2,
    });
    await seedWebhookTriggerFixture(env, {
      organizationId: secondOrgSession.organizationId,
      connectionId: "icn_mcp_trigger_list_other_org",
      webhookSourceId: "iws_mcp_trigger_list_other_org",
      profileId: "sbp_mcp_trigger_list_other_org",
      profileVersion: 1,
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_mcp_trigger_list_a",
      organizationId: firstOrgSession.organizationId,
      webhookSourceId: "iws_mcp_trigger_list_a",
      profileId: "sbp_mcp_trigger_list_a",
      profileVersion: 2,
      targetId: "atg_mcp_trigger_list_a",
      name: "MCP trigger list visible",
      createdAt: "2026-06-01T00:00:00.000Z",
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_mcp_trigger_list_other_org",
      organizationId: secondOrgSession.organizationId,
      webhookSourceId: "iws_mcp_trigger_list_other_org",
      profileId: "sbp_mcp_trigger_list_other_org",
      profileVersion: 1,
      targetId: "atg_mcp_trigger_list_other_org",
      name: "MCP trigger list hidden",
      createdAt: "2026-06-02T00:00:00.000Z",
    });

    const listResult = await callMcpTool({
      env,
      token,
      name: "list_triggers",
      arguments: {
        limit: 10,
      },
    });
    const getResult = await callMcpTool({
      env,
      token,
      name: "get_trigger",
      arguments: {
        triggerId: "atm_mcp_trigger_list_a",
      },
    });

    expect(listResult.isError).toBeUndefined();
    expect(getResult.isError).toBeUndefined();
    const triggerList = ListTriggersResponseSchema.parse(listResult.structuredContent);
    const trigger = McpTriggerConfigSchema.parse(getResult.structuredContent);
    expect(triggerList.totalResults).toBe(1);
    expect(triggerList.items.map((item) => item.id)).toEqual(["atm_mcp_trigger_list_a"]);
    expect(trigger).toMatchObject({
      id: "atm_mcp_trigger_list_a",
      kind: TriggerKinds.WEBHOOK,
      name: "MCP trigger list visible",
      integrationWebhookSourceId: "iws_mcp_trigger_list_a",
      eventConditions: [
        {
          eventType: GitHubIssueCommentCreatedEventType,
          payloadFilter: {
            op: "eq",
            path: ["action"],
            value: "created",
          },
        },
      ],
      target: {
        sandboxProfileId: "sbp_mcp_trigger_list_a",
        sandboxProfileVersion: 2,
        primaryRepositoryId: null,
      },
      inputTemplate: "Handle payload",
    });
    expect(trigger).not.toHaveProperty("source");
    expect(trigger.target).not.toHaveProperty("id");
  });

  it("accepts legacy webhook trigger read permission for trigger read tools", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-legacy-read@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP legacy webhook trigger reader",
      permissions: [OrganizationPermissions.TRIGGER_WEBHOOK_READ],
    });

    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_mcp_trigger_legacy_read",
      webhookSourceId: "iws_mcp_trigger_legacy_read",
      profileId: "sbp_mcp_trigger_legacy_read",
      profileVersion: 1,
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_mcp_trigger_legacy_read",
      organizationId: session.organizationId,
      webhookSourceId: "iws_mcp_trigger_legacy_read",
      profileId: "sbp_mcp_trigger_legacy_read",
      profileVersion: 1,
      targetId: "atg_mcp_trigger_legacy_read",
      name: "MCP legacy trigger read",
    });

    const result = await callMcpTool({
      env,
      token,
      name: "get_trigger",
      arguments: {
        triggerId: "atm_mcp_trigger_legacy_read",
      },
    });

    expect(result.isError).toBeUndefined();
    const trigger = McpTriggerConfigSchema.parse(result.structuredContent);
    expect(trigger.id).toBe("atm_mcp_trigger_legacy_read");
  });

  it("returns a tool error without trigger read permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-read-forbidden@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP organization reader",
      permissions: [OrganizationPermissions.ORGANIZATION_READ],
    });

    const result = await callMcpTool({
      env,
      token,
      name: "list_triggers",
      arguments: {},
    });

    expect(result.isError).toBe(true);
  });

  it("creates recurring scheduled triggers with generic trigger create permission", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-schedule-create@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP schedule trigger creator",
      permissions: [OrganizationPermissions.TRIGGER_CREATE],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_mcp_trigger_schedule_create",
        organizationId: session.organizationId,
        displayName: "MCP schedule create profile",
        activeVersion: 1,
        createdAt: "2026-06-03T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_mcp_trigger_schedule_create",
        version: 1,
      }),
    );

    const result = await callMcpTool({
      env,
      token,
      name: "create_trigger",
      arguments: {
        kind: TriggerKinds.SCHEDULE,
        name: "MCP created recurring schedule",
        enabled: true,
        schedule: {
          kind: ScheduleKinds.RECURRING,
          cronExpression: "15 8 * * *",
          timezone: "UTC",
        },
        inputTemplate: "Run the scheduled maintenance check",
        target: {
          sandboxProfileId: "sbp_mcp_trigger_schedule_create",
        },
      },
    });

    expect(result.isError).toBeUndefined();
    const trigger = McpTriggerConfigSchema.parse(result.structuredContent);
    expect(trigger).toMatchObject({
      kind: TriggerKinds.SCHEDULE,
      name: "MCP created recurring schedule",
      enabled: true,
      target: {
        sandboxProfileId: "sbp_mcp_trigger_schedule_create",
        sandboxProfileVersion: 1,
        primaryRepositoryId: null,
      },
      schedule: {
        kind: ScheduleKinds.RECURRING,
        cronExpression: "15 8 * * *",
        timezone: "UTC",
      },
      inputTemplate: "Run the scheduled maintenance check",
      conversationKeyTemplate: "{{schedule.id}}",
      idempotencyKeyTemplate: "{{schedule.scheduledActionId}}",
    });
    expect(trigger.target).not.toHaveProperty("id");
    if (trigger.kind !== TriggerKinds.SCHEDULE) {
      throw new Error("Expected scheduled trigger config.");
    }
    expect(trigger.schedule).not.toHaveProperty("id");

    const persistedScheduleTrigger = await env.controlPlaneDb.query.scheduleTriggers.findFirst({
      columns: {
        scheduleId: true,
        inputTemplate: true,
        conversationKeyTemplate: true,
        idempotencyKeyTemplate: true,
      },
      where: (table, { eq }) => eq(table.triggerId, trigger.id),
    });
    if (persistedScheduleTrigger === undefined) {
      throw new Error("Expected created scheduled trigger to have a schedule trigger row.");
    }
    const persistedSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      columns: {
        kind: true,
        cronExpression: true,
        timezone: true,
        nextScheduledAt: true,
      },
      where: (table, { eq }) => eq(table.id, persistedScheduleTrigger.scheduleId),
    });

    expect(persistedScheduleTrigger).toMatchObject({
      inputTemplate: "Run the scheduled maintenance check",
      conversationKeyTemplate: "{{schedule.id}}",
      idempotencyKeyTemplate: "{{schedule.scheduledActionId}}",
    });
    expect(persistedSchedule).toMatchObject({
      kind: ScheduleKinds.RECURRING,
      cronExpression: "15 8 * * *",
      timezone: "UTC",
    });
    expect(persistedSchedule?.nextScheduledAt).not.toBeNull();
  });

  it("creates and updates one-off scheduled triggers with canonical trigger tools", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-one-off-create-update@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP one-off schedule trigger owner",
      permissions: [OrganizationPermissions.TRIGGER_CREATE, OrganizationPermissions.TRIGGER_UPDATE],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_mcp_trigger_one_off_create_update",
        organizationId: session.organizationId,
        displayName: "MCP one-off schedule profile",
        activeVersion: 1,
        createdAt: "2026-06-03T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_mcp_trigger_one_off_create_update",
        version: 1,
      }),
    );

    const createResult = await callMcpTool({
      env,
      token,
      name: "create_trigger",
      arguments: {
        kind: TriggerKinds.SCHEDULE,
        name: "MCP created one-off schedule",
        enabled: true,
        schedule: {
          kind: ScheduleKinds.ONE_OFF,
          name: "Initial one-off launch",
          startAt: "2099-07-01T10:00:00.000Z",
        },
        inputTemplate: "Run the one-off launch check",
        target: {
          sandboxProfileId: "sbp_mcp_trigger_one_off_create_update",
        },
      },
    });

    expect(createResult.isError).toBeUndefined();
    const created = McpTriggerConfigSchema.parse(createResult.structuredContent);
    if (created.kind !== TriggerKinds.SCHEDULE) {
      throw new Error("Expected scheduled trigger config.");
    }
    expect(created.schedule).toMatchObject({
      kind: ScheduleKinds.ONE_OFF,
      name: "Initial one-off launch",
      startAt: "2099-07-01T10:00:00.000Z",
      nextScheduledAt: "2099-07-01T10:00:00.000Z",
      cronExpression: null,
      timezone: null,
    });
    expect(created.schedule).not.toHaveProperty("id");

    const updateResult = await callMcpTool({
      env,
      token,
      name: "update_trigger",
      arguments: {
        kind: TriggerKinds.SCHEDULE,
        triggerId: created.id,
        schedule: {
          kind: ScheduleKinds.ONE_OFF,
          name: "Updated one-off launch",
          startAt: "2099-07-02T11:30:00.000Z",
        },
      },
    });

    expect(updateResult.isError).toBeUndefined();
    const updated = McpTriggerConfigSchema.parse(updateResult.structuredContent);
    if (updated.kind !== TriggerKinds.SCHEDULE) {
      throw new Error("Expected scheduled trigger config.");
    }
    expect(updated.schedule).toMatchObject({
      kind: ScheduleKinds.ONE_OFF,
      name: "Updated one-off launch",
      startAt: "2099-07-02T11:30:00.000Z",
      nextScheduledAt: "2099-07-02T11:30:00.000Z",
    });
  });

  it("rejects legacy webhook create permission for scheduled trigger creation", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-schedule-create-legacy-webhook-forbidden@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP legacy webhook schedule creator",
      permissions: [OrganizationPermissions.TRIGGER_WEBHOOK_CREATE],
    });

    const result = await callMcpTool({
      env,
      token,
      name: "create_trigger",
      arguments: {
        kind: TriggerKinds.SCHEDULE,
        name: "Forbidden scheduled trigger",
        schedule: {
          kind: ScheduleKinds.RECURRING,
          cronExpression: "15 8 * * *",
          timezone: "UTC",
        },
        inputTemplate: "This should not be created",
        target: {
          sandboxProfileId: "sbp_mcp_trigger_schedule_create_forbidden",
        },
      },
    });

    expect(result.isError).toBe(true);
  });

  it("creates webhook triggers with legacy webhook create permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-webhook-create@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP webhook trigger creator",
      permissions: [OrganizationPermissions.TRIGGER_WEBHOOK_CREATE],
    });

    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_mcp_trigger_webhook_create",
      webhookSourceId: "iws_mcp_trigger_webhook_create",
      profileId: "sbp_mcp_trigger_webhook_create",
      profileVersion: 1,
      profileActiveVersion: 1,
    });

    const result = await callMcpTool({
      env,
      token,
      name: "create_trigger",
      arguments: {
        kind: TriggerKinds.WEBHOOK,
        name: "MCP created webhook trigger",
        enabled: true,
        integrationWebhookSourceId: "iws_mcp_trigger_webhook_create",
        eventConditions: [
          {
            eventType: GitHubIssueCommentCreatedEventType,
          },
        ],
        inputTemplate: "Triage {{payload.comment.body}}",
        instructions: "Prefer concise triage summaries.",
        conversationKeyTemplate: "{{payload.issue.node_id}}",
        idempotencyKeyTemplate: "{{payload.comment.node_id}}",
        target: {
          sandboxProfileId: "sbp_mcp_trigger_webhook_create",
        },
      },
    });

    expect(result.isError).toBeUndefined();
    const trigger = McpTriggerConfigSchema.parse(result.structuredContent);
    expect(trigger).toMatchObject({
      kind: TriggerKinds.WEBHOOK,
      name: "MCP created webhook trigger",
      enabled: true,
      integrationWebhookSourceId: "iws_mcp_trigger_webhook_create",
      eventConditions: [
        {
          eventType: GitHubIssueCommentCreatedEventType,
        },
      ],
      target: {
        sandboxProfileId: "sbp_mcp_trigger_webhook_create",
        sandboxProfileVersion: 1,
        primaryRepositoryId: null,
      },
    });
    expect(trigger).not.toHaveProperty("source");
    expect(trigger.target).not.toHaveProperty("id");

    const persistedWebhook = await env.controlPlaneDb.query.webhookTriggers.findFirst({
      columns: {
        eventConditions: true,
        inputTemplate: true,
        instructions: true,
        conversationKeyTemplate: true,
        idempotencyKeyTemplate: true,
      },
      where: (table, { eq }) => eq(table.triggerId, trigger.id),
    });
    expect(persistedWebhook).toMatchObject({
      eventConditions: [{ eventType: GitHubIssueCommentCreatedEventType }],
      inputTemplate: "Triage {{payload.comment.body}}",
      instructions: "Prefer concise triage summaries.",
      conversationKeyTemplate: "{{payload.issue.node_id}}",
      idempotencyKeyTemplate: "{{payload.comment.node_id}}",
    });
  });

  it("updates shared webhook trigger fields with generic trigger update permission", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-webhook-shared-update@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP trigger updater",
      permissions: [OrganizationPermissions.TRIGGER_UPDATE],
    });

    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_mcp_trigger_webhook_shared_update",
      webhookSourceId: "iws_mcp_trigger_webhook_shared_update",
      profileId: "sbp_mcp_trigger_webhook_shared_update",
      profileVersion: 1,
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_mcp_trigger_webhook_shared_update",
      organizationId: session.organizationId,
      webhookSourceId: "iws_mcp_trigger_webhook_shared_update",
      profileId: "sbp_mcp_trigger_webhook_shared_update",
      profileVersion: 1,
      targetId: "atg_mcp_trigger_webhook_shared_update",
      name: "MCP webhook before shared update",
    });

    const updateResult = await callMcpTool({
      env,
      token,
      name: "update_trigger",
      arguments: {
        kind: TriggerKinds.WEBHOOK,
        triggerId: "atm_mcp_trigger_webhook_shared_update",
        name: "MCP webhook after rename",
        enabled: false,
        inputTemplate: "Handle this webhook from MCP",
      },
    });

    expect(updateResult.isError).toBeUndefined();
    const updatedTrigger = McpTriggerConfigSchema.parse(updateResult.structuredContent);
    expect(updatedTrigger).toMatchObject({
      kind: TriggerKinds.WEBHOOK,
      name: "MCP webhook after rename",
      enabled: false,
      inputTemplate: "Handle this webhook from MCP",
    });

    const persistedWebhook = await env.controlPlaneDb.query.webhookTriggers.findFirst({
      columns: {
        inputTemplate: true,
        eventConditions: true,
      },
      where: (table, { eq }) => eq(table.triggerId, "atm_mcp_trigger_webhook_shared_update"),
    });
    expect(persistedWebhook?.inputTemplate).toBe("Handle this webhook from MCP");
    expect(persistedWebhook?.eventConditions).toEqual([
      {
        eventType: GitHubIssueCommentCreatedEventType,
        payloadFilter: {
          op: "eq",
          path: ["action"],
          value: "created",
        },
      },
    ]);
  });

  it("lists webhook trigger events available to a sandbox profile", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-webhook-events-list@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP trigger event reader",
      permissions: [OrganizationPermissions.TRIGGER_READ],
    });

    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_mcp_trigger_webhook_events_list",
      webhookSourceId: "iws_mcp_trigger_webhook_events_list",
      profileId: "sbp_mcp_trigger_webhook_events_list",
      profileVersion: 1,
      profileActiveVersion: 1,
    });

    const result = await callMcpTool({
      env,
      token,
      name: "list_trigger_webhook_events",
      arguments: {
        sandboxProfileId: "sbp_mcp_trigger_webhook_events_list",
      },
    });

    expect(result.isError).toBeUndefined();
    const eventOptions = ListTriggerWebhookEventsResultSchema.parse(result.structuredContent);
    expect(eventOptions).toMatchObject({
      sandboxProfileId: "sbp_mcp_trigger_webhook_events_list",
      sandboxProfileName: "sbp_mcp_trigger_webhook_events_list display",
      sandboxProfileVersion: 1,
    });
    expect(eventOptions.events.map((event) => event.eventType)).toContain(
      GitHubIssueCommentCreatedEventType,
    );
    expect(eventOptions.events).toContainEqual(
      expect.objectContaining({
        eventType: GitHubIssueCommentCreatedEventType,
        displayName: "Issue comment created",
        webhookSourceId: "iws_mcp_trigger_webhook_events_list",
        integrationConnectionId: "icn_mcp_trigger_webhook_events_list",
        integrationTargetKey: GitHubTriggerTargetKey,
        integrationName: "GitHub",
        category: "Issues",
      }),
    );
  });

  it("updates webhook trigger event conditions including payload filters", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-webhook-events-set@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP trigger event updater",
      permissions: [OrganizationPermissions.TRIGGER_UPDATE],
    });

    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_mcp_trigger_webhook_events_set",
      webhookSourceId: "iws_mcp_trigger_webhook_events_set",
      profileId: "sbp_mcp_trigger_webhook_events_set",
      profileVersion: 1,
      profileActiveVersion: 1,
    });
    await env.controlPlaneDb
      .update(env.controlPlaneTables.integrationWebhookSources)
      .set({
        providerMetadata: {
          [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
            events: ["issue_comment", "pull_request"],
            permissions: [
              { permission: "issues", access: "read" },
              { permission: "pull_requests", access: "read" },
            ],
          },
        },
      })
      .where(
        eq(
          env.controlPlaneTables.integrationWebhookSources.id,
          "iws_mcp_trigger_webhook_events_set",
        ),
      );
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_mcp_trigger_webhook_events_set",
      organizationId: session.organizationId,
      webhookSourceId: "iws_mcp_trigger_webhook_events_set",
      profileId: "sbp_mcp_trigger_webhook_events_set",
      profileVersion: 1,
      targetId: "atg_mcp_trigger_webhook_events_set",
      name: "MCP webhook event update",
    });

    const result = await callMcpTool({
      env,
      token,
      name: "update_trigger",
      arguments: {
        kind: TriggerKinds.WEBHOOK,
        triggerId: "atm_mcp_trigger_webhook_events_set",
        eventConditions: [
          {
            eventType: "github.pull_request.opened",
            payloadFilter: {
              op: "eq",
              path: ["action"],
              value: "opened",
            },
          },
        ],
      },
    });

    expect(result.isError).toBeUndefined();
    const trigger = McpTriggerConfigSchema.parse(result.structuredContent);
    expect(trigger).toMatchObject({
      kind: TriggerKinds.WEBHOOK,
      eventConditions: [
        {
          eventType: "github.pull_request.opened",
          payloadFilter: {
            op: "eq",
            path: ["action"],
            value: "opened",
          },
        },
      ],
    });

    const persistedWebhook = await env.controlPlaneDb.query.webhookTriggers.findFirst({
      columns: {
        eventConditions: true,
      },
      where: (table, { eq }) => eq(table.triggerId, "atm_mcp_trigger_webhook_events_set"),
    });
    expect(persistedWebhook?.eventConditions).toEqual([
      {
        eventType: "github.pull_request.opened",
        payloadFilter: {
          op: "eq",
          path: ["action"],
          value: "opened",
        },
      },
    ]);
  });

  it("rejects webhook trigger events that the current webhook source does not support", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-webhook-events-invalid@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP trigger invalid event updater",
      permissions: [OrganizationPermissions.TRIGGER_UPDATE],
    });

    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_mcp_trigger_webhook_events_invalid",
      webhookSourceId: "iws_mcp_trigger_webhook_events_invalid",
      profileId: "sbp_mcp_trigger_webhook_events_invalid",
      profileVersion: 1,
      profileActiveVersion: 1,
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_mcp_trigger_webhook_events_invalid",
      organizationId: session.organizationId,
      webhookSourceId: "iws_mcp_trigger_webhook_events_invalid",
      profileId: "sbp_mcp_trigger_webhook_events_invalid",
      profileVersion: 1,
      targetId: "atg_mcp_trigger_webhook_events_invalid",
      name: "MCP webhook invalid event update",
    });

    const result = await callMcpTool({
      env,
      token,
      name: "update_trigger",
      arguments: {
        kind: TriggerKinds.WEBHOOK,
        triggerId: "atm_mcp_trigger_webhook_events_invalid",
        eventConditions: [
          {
            eventType: "github.not_a_real_event",
          },
        ],
      },
    });

    expect(result.isError).toBe(true);
    const persistedWebhook = await env.controlPlaneDb.query.webhookTriggers.findFirst({
      columns: {
        eventConditions: true,
      },
      where: (table, { eq }) => eq(table.triggerId, "atm_mcp_trigger_webhook_events_invalid"),
    });
    expect(persistedWebhook?.eventConditions).toEqual([
      {
        eventType: GitHubIssueCommentCreatedEventType,
        payloadFilter: {
          op: "eq",
          path: ["action"],
          value: "created",
        },
      },
    ]);
  });

  it("updates shared scheduled trigger fields with generic trigger update permission", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-schedule-shared-update@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP schedule trigger updater",
      permissions: [OrganizationPermissions.TRIGGER_UPDATE],
    });

    await seedScheduledTrigger(env, {
      organizationId: session.organizationId,
      triggerId: "atm_mcp_trigger_schedule_shared_update",
      scheduleId: "sch_mcp_trigger_schedule_shared_update",
      targetId: "atg_mcp_trigger_schedule_shared_update",
      profileId: "sbp_mcp_trigger_schedule_shared_update",
      name: "MCP schedule before shared update",
      createdAt: "2026-06-02T00:00:00.000Z",
    });

    const updateResult = await callMcpTool({
      env,
      token,
      name: "update_trigger",
      arguments: {
        kind: TriggerKinds.SCHEDULE,
        triggerId: "atm_mcp_trigger_schedule_shared_update",
        name: "MCP schedule after rename",
        enabled: false,
        inputTemplate: "Handle this schedule from MCP",
      },
    });

    expect(updateResult.isError).toBeUndefined();
    const updatedTrigger = McpTriggerConfigSchema.parse(updateResult.structuredContent);
    expect(updatedTrigger).toMatchObject({
      kind: TriggerKinds.SCHEDULE,
      name: "MCP schedule after rename",
      enabled: false,
      inputTemplate: "Handle this schedule from MCP",
    });

    const persistedSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      columns: {
        enabled: true,
      },
      where: (table, { eq }) => eq(table.id, "sch_mcp_trigger_schedule_shared_update"),
    });
    const persistedScheduleTrigger = await env.controlPlaneDb.query.scheduleTriggers.findFirst({
      columns: {
        inputTemplate: true,
      },
      where: (table, { eq }) => eq(table.triggerId, "atm_mcp_trigger_schedule_shared_update"),
    });
    expect(persistedSchedule?.enabled).toBe(false);
    expect(persistedScheduleTrigger?.inputTemplate).toBe("Handle this schedule from MCP");
  });

  it("sets recurring scheduled trigger timing with generic trigger update permission", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-schedule-set-timing@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP schedule trigger timing updater",
      permissions: [OrganizationPermissions.TRIGGER_UPDATE],
    });

    await seedScheduledTrigger(env, {
      organizationId: session.organizationId,
      triggerId: "atm_mcp_trigger_schedule_set_timing",
      scheduleId: "sch_mcp_trigger_schedule_set_timing",
      targetId: "atg_mcp_trigger_schedule_set_timing",
      profileId: "sbp_mcp_trigger_schedule_set_timing",
      name: "MCP schedule before timing update",
      createdAt: "2026-06-02T00:00:00.000Z",
    });

    const result = await callMcpTool({
      env,
      token,
      name: "update_trigger",
      arguments: {
        kind: TriggerKinds.SCHEDULE,
        triggerId: "atm_mcp_trigger_schedule_set_timing",
        schedule: {
          kind: ScheduleKinds.RECURRING,
          cronExpression: "30 10 * * *",
          timezone: "UTC",
        },
      },
    });

    expect(result.isError).toBeUndefined();
    const trigger = McpTriggerConfigSchema.parse(result.structuredContent);
    if (trigger.kind !== TriggerKinds.SCHEDULE) {
      throw new Error("Expected scheduled trigger config.");
    }
    expect(trigger.schedule).toMatchObject({
      kind: ScheduleKinds.RECURRING,
      cronExpression: "30 10 * * *",
      timezone: "UTC",
    });

    const persistedSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      columns: {
        cronExpression: true,
        timezone: true,
        nextScheduledAt: true,
      },
      where: (table, { eq }) => eq(table.id, "sch_mcp_trigger_schedule_set_timing"),
    });
    expect(persistedSchedule).toMatchObject({
      cronExpression: "30 10 * * *",
      timezone: "UTC",
    });
    expect(persistedSchedule?.nextScheduledAt).not.toBeNull();
    expect(persistedSchedule?.nextScheduledAt).not.toBe("2026-06-03T01:00:00.000Z");
  });

  it("rejects legacy webhook update permission for scheduled trigger timing updates", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-schedule-legacy-webhook-forbidden@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP legacy webhook schedule updater",
      permissions: [OrganizationPermissions.TRIGGER_WEBHOOK_UPDATE],
    });

    await seedScheduledTrigger(env, {
      organizationId: session.organizationId,
      triggerId: "atm_mcp_trigger_schedule_legacy_webhook_forbidden",
      scheduleId: "sch_mcp_trigger_schedule_legacy_webhook_forbidden",
      targetId: "atg_mcp_trigger_schedule_legacy_webhook_forbidden",
      profileId: "sbp_mcp_trigger_schedule_legacy_webhook_forbidden",
      name: "MCP schedule legacy webhook forbidden",
      createdAt: "2026-06-02T00:00:00.000Z",
    });

    const result = await callMcpTool({
      env,
      token,
      name: "update_trigger",
      arguments: {
        kind: TriggerKinds.SCHEDULE,
        triggerId: "atm_mcp_trigger_schedule_legacy_webhook_forbidden",
        schedule: {
          kind: ScheduleKinds.RECURRING,
          cronExpression: "30 10 * * *",
          timezone: "UTC",
        },
      },
    });

    expect(result.isError).toBe(true);

    const persistedSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      columns: {
        cronExpression: true,
        timezone: true,
      },
      where: (table, { eq }) => eq(table.id, "sch_mcp_trigger_schedule_legacy_webhook_forbidden"),
    });
    expect(persistedSchedule).toMatchObject({
      cronExpression: "0 9 * * *",
      timezone: "Asia/Singapore",
    });
  });

  it("accepts legacy webhook trigger update permission for shared trigger write tools", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-legacy-update@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP legacy trigger updater",
      permissions: [OrganizationPermissions.TRIGGER_WEBHOOK_UPDATE],
    });

    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_mcp_trigger_legacy_update",
      webhookSourceId: "iws_mcp_trigger_legacy_update",
      profileId: "sbp_mcp_trigger_legacy_update",
      profileVersion: 1,
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_mcp_trigger_legacy_update",
      organizationId: session.organizationId,
      webhookSourceId: "iws_mcp_trigger_legacy_update",
      profileId: "sbp_mcp_trigger_legacy_update",
      profileVersion: 1,
      targetId: "atg_mcp_trigger_legacy_update",
      name: "MCP legacy update before rename",
    });

    const result = await callMcpTool({
      env,
      token,
      name: "update_trigger",
      arguments: {
        kind: TriggerKinds.WEBHOOK,
        triggerId: "atm_mcp_trigger_legacy_update",
        name: "MCP legacy update after rename",
      },
    });

    expect(result.isError).toBeUndefined();
    const trigger = McpTriggerConfigSchema.parse(result.structuredContent);
    expect(trigger.name).toBe("MCP legacy update after rename");
  });

  it("returns a tool error without trigger update permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-update-forbidden@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP trigger reader",
      permissions: [OrganizationPermissions.TRIGGER_READ],
    });

    const result = await callMcpTool({
      env,
      token,
      name: "update_trigger",
      arguments: {
        kind: TriggerKinds.WEBHOOK,
        triggerId: "atm_mcp_trigger_update_forbidden",
        name: "Forbidden rename",
      },
    });

    expect(result.isError).toBe(true);
  });

  it("allows designer MCP tokens to create and update triggers", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-designer-trigger-mutation@example.com",
    });
    const token = await mintMcpToken({
      config: McpTokenConfig,
      claims: {
        kind: "designer",
        sub: "sbi_mcp_designer_trigger_mutation",
        organizationId: session.organizationId,
        designerSessionId: "dsn_mcp_designer_trigger_mutation",
      },
      ttlSeconds: 300,
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.designerSessions).values({
      id: "dsn_mcp_designer_trigger_mutation",
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_mcp_designer_trigger_mutation",
      initialPrompt: null,
      canvasTabs: [],
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_mcp_designer_trigger_mutation",
      webhookSourceId: "iws_mcp_designer_trigger_mutation",
      profileId: "sbp_mcp_designer_trigger_mutation",
      profileVersion: 1,
      profileActiveVersion: 1,
    });

    const createResult = await callMcpTool({
      env,
      token: token.token,
      name: "create_trigger",
      arguments: {
        kind: TriggerKinds.WEBHOOK,
        name: "Designer GitHub issue triage",
        enabled: true,
        integrationWebhookSourceId: "iws_mcp_designer_trigger_mutation",
        eventConditions: [
          {
            eventType: GitHubIssueCommentCreatedEventType,
          },
        ],
        inputTemplate: "Triage {{payload.issue.title}}",
        instructions: "Classify issue severity and propose owner/component.",
        conversationKeyTemplate: "{{payload.issue.node_id}}",
        idempotencyKeyTemplate: "{{payload.comment.node_id}}",
        target: {
          sandboxProfileId: "sbp_mcp_designer_trigger_mutation",
        },
      },
    });
    expect(createResult.isError).toBeUndefined();
    const createdTrigger = McpTriggerConfigSchema.parse(createResult.structuredContent);

    const updateResult = await callMcpTool({
      env,
      token: token.token,
      name: "update_trigger",
      arguments: {
        kind: TriggerKinds.WEBHOOK,
        triggerId: createdTrigger.id,
        name: "Designer GitHub issue triage renamed",
      },
    });

    expect(updateResult.isError).toBeUndefined();
    const updatedTrigger = McpTriggerConfigSchema.parse(updateResult.structuredContent);
    expect(updatedTrigger.name).toBe("Designer GitHub issue triage renamed");
  });
});

async function seedScheduledTrigger(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    triggerId: string;
    scheduleId: string;
    targetId: string;
    profileId: string;
    profileVersion?: number;
    name: string;
    createdAt: string;
    primaryRepositoryId?: string | null;
    scheduleKind?: ScheduleKind;
  },
): Promise<void> {
  const profileVersion = input.profileVersion ?? 1;
  const scheduleKind = input.scheduleKind ?? ScheduleKinds.RECURRING;

  await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
    sandboxProfileRow({
      id: input.profileId,
      organizationId: input.organizationId,
      displayName: `${input.profileId} display`,
      activeVersion: profileVersion,
      createdAt: input.createdAt,
    }),
  );
  await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
    sandboxProfileVersionRow({
      sandboxProfileId: input.profileId,
      version: profileVersion,
    }),
  );
  await env.controlPlaneDb.insert(env.controlPlaneTables.triggers).values({
    id: input.triggerId,
    organizationId: input.organizationId,
    kind: TriggerKinds.SCHEDULE,
    name: input.name,
    enabled: true,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.schedules).values({
    id: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.TRIGGER_RUN,
    kind: scheduleKind,
    name: `${input.name} trigger`,
    ...(scheduleKind === ScheduleKinds.RECURRING
      ? {
          cronExpression: "0 9 * * *",
          timezone: "Asia/Singapore",
          nextScheduledAt: "2026-06-03T01:00:00.000Z",
        }
      : {
          cronExpression: null,
          timezone: null,
          startAt: "2099-06-03T01:00:00.000Z",
          nextScheduledAt: "2099-06-03T01:00:00.000Z",
        }),
    enabled: true,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  } satisfies ControlPlaneTables["schedules"]["$inferInsert"]);
  await env.controlPlaneDb.insert(env.controlPlaneTables.scheduleTriggers).values({
    scheduleId: input.scheduleId,
    triggerId: input.triggerId,
    inputTemplate: "Run schedule",
    conversationKeyTemplate: "{{schedule.id}}",
    idempotencyKeyTemplate: "{{schedule.scheduledActionId}}",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.triggerTargets).values({
    id: input.targetId,
    triggerId: input.triggerId,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: profileVersion,
    primaryRepositoryId: input.primaryRepositoryId ?? null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}
