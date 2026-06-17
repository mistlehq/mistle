import { SandboxProfileVersionAgentRuntimeIds, TriggerKinds } from "@mistle/db/control-plane";
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

const mcpCreateTriggerTargetInputSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1).optional(),
    primaryRepositoryId: z.string().min(1).nullable().optional(),
  })
  .strict();

export const mcpCreateScheduledTriggerInputSchema = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean().optional(),
    cronExpression: z.string().min(1),
    timezone: z.string().min(1),
    userMessage: z.string().min(1),
    conversationKeyTemplate: z.string().min(1).optional(),
    idempotencyKeyTemplate: z.string().min(1).nullable().optional(),
    target: mcpCreateTriggerTargetInputSchema,
  })
  .strict();

export const mcpCreateWebhookTriggerInputSchema = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean().optional(),
    integrationWebhookSourceId: z.string().min(1),
    eventTypes: z.array(z.string().min(1)).min(1),
    userMessage: z.string().min(1),
    instructions: z.string().min(1).nullable().optional(),
    conversationKeyTemplate: z.string().min(1),
    idempotencyKeyTemplate: z.string().min(1).nullable().optional(),
    target: mcpCreateTriggerTargetInputSchema,
  })
  .strict();

export const mcpSetTriggerEnabledInputSchema = mcpTriggerIdParamsSchema
  .extend({
    enabled: z.boolean(),
  })
  .strict();

export const mcpRenameTriggerInputSchema = mcpTriggerIdParamsSchema
  .extend({
    name: z.string().min(1),
  })
  .strict();

export const mcpUpdateTriggerUserMessageInputSchema = mcpTriggerIdParamsSchema
  .extend({
    userMessage: z.string().min(1),
  })
  .strict();

export const mcpSetTriggerScheduleInputSchema = mcpTriggerIdParamsSchema
  .extend({
    cronExpression: z.string().min(1),
    timezone: z.string().min(1),
  })
  .strict();

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

export const mcpSetTriggerWebhookEventsInputSchema = mcpTriggerIdParamsSchema
  .extend({
    eventTypes: z.array(z.string().min(1)).min(1),
  })
  .strict();
