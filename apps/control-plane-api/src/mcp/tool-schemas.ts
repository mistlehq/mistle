import {
  IntegrationBindingKinds,
  SandboxProfileVersionAgentRuntimeIds,
  TriggerKinds,
} from "@mistle/db/control-plane";
import { MistleSupportedCapabilityKinds } from "@mistle/integrations-definitions/server";
import { z } from "zod";

// MCP tool schemas are discovery metadata first: `tools/list` must serialize
// them to JSON Schema before any tool can run. Keep REST parsing transforms,
// coercions, defaults, and response schemas out of this module.

export const mcpSandboxProfileIdParamsSchema = z
  .object({
    profileId: z
      .string()
      .min(1)
      .regex(/^sbp_[a-zA-Z0-9_-]+$/, {
        message: "`profileId` must be a sandbox profile id.",
      }),
  })
  .strict();

export const mcpSandboxProfileVersionParamsSchema = mcpSandboxProfileIdParamsSchema
  .extend({
    version: z.number().int().min(1),
  })
  .strict();

export const mcpSandboxInstanceIdParamsSchema = z
  .object({
    instanceId: z
      .string()
      .min(1)
      .regex(/^sbi_[a-zA-Z0-9_-]+$/, {
        message: "`instanceId` must be a sandbox instance id.",
      }),
  })
  .strict();

export const mcpListSandboxProfilesInputSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    after: z.string().min(1).optional(),
    before: z.string().min(1).optional(),
  })
  .strict();

export const mcpListSupportedCapabilitiesInputSchema = z
  .object({
    providerFamilyId: z.string().min(1).optional(),
    capabilityKind: z.enum(MistleSupportedCapabilityKinds).optional(),
    includeDetails: z.boolean().optional(),
  })
  .strict();

export const mcpUpdateSandboxProfileInputSchema = mcpSandboxProfileIdParamsSchema
  .extend({
    displayName: z.string().min(1),
  })
  .strict();

export const mcpProfileDraftSetupScriptPutInputSchema = mcpSandboxProfileVersionParamsSchema
  .extend({
    setupScript: z.string().min(1).nullable(),
  })
  .strict();

export const mcpProfileMaintenanceScriptPutInputSchema = mcpSandboxProfileVersionParamsSchema
  .extend({
    maintenanceScript: z.string().min(1).nullable(),
  })
  .strict();

const mcpSandboxProfileVersionResourcesSchema = z
  .object({
    vcpuCount: z.number().int().min(1),
    memoryMb: z.number().int().min(1),
    diskMb: z.number().int().min(1).optional(),
  })
  .strict();

export const mcpCreateSandboxProfileInputSchema = z
  .object({
    displayName: z.string().min(1),
    sandboxProvider: z.string().min(1).optional(),
    sandboxResources: mcpSandboxProfileVersionResourcesSchema.nullable().optional(),
  })
  .strict();

const mcpSandboxProfileSkillsConfigSchema = z
  .object({
    originUrl: z.url(),
    selectedSkills: z.array(
      z
        .object({
          name: z.string().min(1),
          relativePath: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

const mcpAssociatedResourceEventRoutingResourceRuleSchema = z
  .object({
    resourceKind: z.string().min(1),
    eventTypes: z.array(z.string().min(1)).min(1),
    messageMode: z.enum(["all", "app_mentions_only"]).optional(),
    payloadFilter: z.record(z.string(), z.unknown()).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const mcpAssociatedResourceEventRoutingConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    resources: z.array(mcpAssociatedResourceEventRoutingResourceRuleSchema).optional(),
  })
  .strict();

const mcpSandboxProfileVersionIntegrationBindingsWriteSchema = z
  .object({
    bindings: z.array(
      z
        .object({
          id: z.string().min(1).optional(),
          clientRef: z.string().min(1).optional(),
          connectionId: z.string().min(1),
          kind: z.enum([
            IntegrationBindingKinds.AGENT,
            IntegrationBindingKinds.GIT,
            IntegrationBindingKinds.CONNECTOR,
            IntegrationBindingKinds.SANDBOX,
          ]),
          config: z.record(z.string(), z.unknown()),
        })
        .strict(),
    ),
  })
  .strict();

export const mcpSandboxProfileDraftUpdateInputSchema = mcpSandboxProfileVersionParamsSchema
  .extend({
    setupScript: z.string().min(1).nullable().optional(),
    agentRuntimeId: z
      .enum([
        SandboxProfileVersionAgentRuntimeIds.CLAUDE_CODE,
        SandboxProfileVersionAgentRuntimeIds.CODEX,
        SandboxProfileVersionAgentRuntimeIds.OPENCODE,
        SandboxProfileVersionAgentRuntimeIds.PI,
      ])
      .optional(),
    gitCommitSigningIntegrationConnectionId: z.string().min(1).nullable().optional(),
    mistleMcpEnabled: z.boolean().optional(),
    mistleMcpApiKeyId: z.string().min(1).nullable().optional(),
    sandboxProvider: z.string().min(1).optional(),
    sandboxConnectionId: z.string().min(1).nullable().optional(),
    sandboxResources: mcpSandboxProfileVersionResourcesSchema.nullable().optional(),
    skillsConfig: mcpSandboxProfileSkillsConfigSchema.nullable().optional(),
    associatedResourceEventRoutingConfig: mcpAssociatedResourceEventRoutingConfigSchema.optional(),
    integrationBindings: mcpSandboxProfileVersionIntegrationBindingsWriteSchema.optional(),
  })
  .strict();

const mcpSandboxRuntimeOverrideInputSchema = z
  .object({
    agentRuntimeId: z
      .enum([
        SandboxProfileVersionAgentRuntimeIds.CODEX,
        SandboxProfileVersionAgentRuntimeIds.OPENCODE,
        SandboxProfileVersionAgentRuntimeIds.PI,
      ])
      .optional(),
    sandboxProvider: z.string().min(1).optional(),
    sandboxConnectionId: z.string().min(1).nullable().optional(),
    sandboxResources: mcpSandboxProfileVersionResourcesSchema.nullable().optional(),
  })
  .strict();

export const mcpProfileSetupScriptTestStartInputSchema = mcpSandboxRuntimeOverrideInputSchema
  .safeExtend({
    ...mcpSandboxProfileVersionParamsSchema.shape,
    setupScript: z.string().min(1),
    idempotencyKey: z.string().min(1).max(255).optional(),
  })
  .strict();

export const mcpProfileMaintenanceScriptTestStartInputSchema = mcpSandboxRuntimeOverrideInputSchema
  .safeExtend({
    ...mcpSandboxProfileVersionParamsSchema.shape,
    maintenanceScript: z.string().min(1),
    idempotencyKey: z.string().min(1).max(255).optional(),
  })
  .strict();

export const mcpSandboxInstancePortAccessCreateInputSchema = mcpSandboxInstanceIdParamsSchema
  .extend({
    port: z.number().int().min(1).max(65_535),
  })
  .strict();

export const mcpSandboxOperationEventsListInputSchema = z
  .object({
    ...mcpSandboxInstanceIdParamsSchema.shape,
    operationId: z.string().min(1),
    afterSequence: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

export const mcpTriggerIdParamsSchema = z
  .object({
    triggerId: z
      .string()
      .min(1)
      .regex(/^(?:atm|trg)_[a-zA-Z0-9_-]+$/, {
        message: "`triggerId` must be a trigger id.",
      }),
  })
  .strict();

export const mcpListTriggersInputSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    after: z.string().min(1).optional(),
    before: z.string().min(1).optional(),
    sandboxProfileId: z.string().min(1).optional(),
    kind: z.enum([TriggerKinds.WEBHOOK, TriggerKinds.SCHEDULE]).optional(),
    enabled: z.boolean().optional(),
    search: z.string().min(1).optional(),
  })
  .strict();

const mcpTriggerTargetCreateInputSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1).optional(),
    primaryRepositoryId: z.string().min(1).nullable().optional(),
  })
  .strict();

const mcpTriggerTargetUpdateInputSchema = z
  .object({
    sandboxProfileId: z.string().min(1).optional(),
    sandboxProfileVersion: z.number().int().min(1).optional(),
    primaryRepositoryId: z.string().min(1).nullable().optional(),
  })
  .strict();

const mcpTriggerEventConditionInputSchema = z
  .object({
    eventType: z.string().min(1),
    payloadFilter: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

const mcpRecurringScheduleCreateInputSchema = z
  .object({
    kind: z.literal("recurring"),
    name: z.string().min(1).optional(),
    cronExpression: z.string().min(1),
    timezone: z.string().min(1),
  })
  .strict();

const mcpOneOffScheduleCreateInputSchema = z
  .object({
    kind: z.literal("one_off"),
    name: z.string().min(1).optional(),
    startAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const mcpRecurringScheduleUpdateInputSchema = z
  .object({
    kind: z.literal("recurring"),
    name: z.string().min(1).optional(),
    cronExpression: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
  })
  .strict();

const mcpOneOffScheduleUpdateInputSchema = z
  .object({
    kind: z.literal("one_off"),
    name: z.string().min(1).optional(),
    startAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

const mcpCreateWebhookTriggerConfigInputSchema = z
  .object({
    kind: z.literal(TriggerKinds.WEBHOOK),
    name: z.string().min(1),
    enabled: z.boolean().optional(),
    integrationWebhookSourceId: z.string().min(1),
    eventConditions: z.array(mcpTriggerEventConditionInputSchema).min(1),
    inputTemplate: z.string().min(1),
    instructions: z.string().min(1).nullable().optional(),
    conversationKeyTemplate: z.string().min(1),
    idempotencyKeyTemplate: z.string().min(1).nullable().optional(),
    target: mcpTriggerTargetCreateInputSchema,
  })
  .strict();

const mcpCreateScheduledTriggerConfigInputSchema = z
  .object({
    kind: z.literal(TriggerKinds.SCHEDULE),
    name: z.string().min(1),
    enabled: z.boolean().optional(),
    schedule: z.discriminatedUnion("kind", [
      mcpRecurringScheduleCreateInputSchema,
      mcpOneOffScheduleCreateInputSchema,
    ]),
    inputTemplate: z.string().min(1),
    conversationKeyTemplate: z.string().min(1).optional(),
    idempotencyKeyTemplate: z.string().min(1).nullable().optional(),
    target: mcpTriggerTargetCreateInputSchema,
  })
  .strict();

export const mcpCreateTriggerInputSchema = z.discriminatedUnion("kind", [
  mcpCreateWebhookTriggerConfigInputSchema,
  mcpCreateScheduledTriggerConfigInputSchema,
]);

const mcpUpdateWebhookTriggerConfigInputSchema = z
  .object({
    ...mcpTriggerIdParamsSchema.shape,
    kind: z.literal(TriggerKinds.WEBHOOK),
    name: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    integrationWebhookSourceId: z.string().min(1).optional(),
    eventConditions: z.array(mcpTriggerEventConditionInputSchema).min(1).optional(),
    inputTemplate: z.string().min(1).optional(),
    instructions: z.string().min(1).nullable().optional(),
    conversationKeyTemplate: z.string().min(1).optional(),
    idempotencyKeyTemplate: z.string().min(1).nullable().optional(),
    target: mcpTriggerTargetUpdateInputSchema.optional(),
  })
  .strict();

const mcpUpdateScheduledTriggerConfigInputSchema = z
  .object({
    ...mcpTriggerIdParamsSchema.shape,
    kind: z.literal(TriggerKinds.SCHEDULE),
    name: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    schedule: z
      .discriminatedUnion("kind", [
        mcpRecurringScheduleUpdateInputSchema,
        mcpOneOffScheduleUpdateInputSchema,
      ])
      .optional(),
    inputTemplate: z.string().min(1).optional(),
    conversationKeyTemplate: z.string().min(1).optional(),
    idempotencyKeyTemplate: z.string().min(1).nullable().optional(),
    target: mcpTriggerTargetUpdateInputSchema.optional(),
  })
  .strict();

export const mcpUpdateTriggerInputSchema = z.discriminatedUnion("kind", [
  mcpUpdateWebhookTriggerConfigInputSchema,
  mcpUpdateScheduledTriggerConfigInputSchema,
]);

export type McpUpdateTriggerInput = z.infer<typeof mcpUpdateTriggerInputSchema>;

export const mcpListTriggerWebhookEventsInputSchema = z
  .object({
    sandboxProfileId: z
      .string()
      .min(1)
      .regex(/^sbp_[a-zA-Z0-9_-]+$/, {
        message: "`sandboxProfileId` must be a sandbox profile id.",
      }),
  })
  .strict();
