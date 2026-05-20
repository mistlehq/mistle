import { z } from "@hono/zod-openapi";
import {
  TriggerKinds,
  IntegrationBindingKinds,
  SandboxProfileStatuses,
  SandboxProfileVersionAgentRuntimeIds,
  SandboxProfileVersionDefaultPersistenceModes,
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  SandboxProfileVersionStates,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
  sandboxProfiles,
} from "@mistle/db/control-plane";
import {
  createKeysetPaginationEnvelopeSchema,
  createKeysetPaginationQuerySchema,
} from "@mistle/http/pagination";
import { createSelectSchema } from "drizzle-zod";

import {
  SandboxProfileTriggerImpactIssueCodes,
  SandboxProfilePublishabilityIssueCodes,
} from "./errors.js";

const sandboxProfileStatusSchema = z.enum([
  SandboxProfileStatuses.ACTIVE,
  SandboxProfileStatuses.INACTIVE,
]);
const integrationBindingKindSchema = z.enum([
  IntegrationBindingKinds.AGENT,
  IntegrationBindingKinds.GIT,
  IntegrationBindingKinds.CONNECTOR,
  IntegrationBindingKinds.SANDBOX,
]);
const sandboxProfileVersionStateSchema = z.enum([
  SandboxProfileVersionStates.DRAFT,
  SandboxProfileVersionStates.PUBLISHED,
]);
const sandboxProfileVersionDefaultPersistenceModeSchema = z.enum([
  SandboxProfileVersionDefaultPersistenceModes.EPHEMERAL,
  SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
]);
const sandboxProfileVersionAgentRuntimeIdSchema = z.enum([
  SandboxProfileVersionAgentRuntimeIds.CODEX,
  SandboxProfileVersionAgentRuntimeIds.OPENCODE,
  SandboxProfileVersionAgentRuntimeIds.PI,
]);
const sandboxProfileVersionSnapshotJobTriggerSchema = z.enum([
  SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
  SandboxProfileVersionSnapshotJobTriggers.MANUAL_REFRESH,
  SandboxProfileVersionSnapshotJobTriggers.SCHEDULED_REFRESH,
]);
const sandboxProfileVersionSnapshotJobStateSchema = z.enum([
  SandboxProfileVersionSnapshotJobStates.QUEUED,
  SandboxProfileVersionSnapshotJobStates.RUNNING,
  SandboxProfileVersionSnapshotJobStates.SUCCEEDED,
  SandboxProfileVersionSnapshotJobStates.FAILED,
]);
const sandboxProfileVersionResourcesSchema = z
  .object({
    vcpuCount: z.number().int().min(1),
    memoryMb: z.number().int().min(1),
    storageMb: z.number().int().min(1).optional(),
  })
  .strict();
const sandboxProfileVersionSnapshotJobSummarySchema = z
  .object({
    id: z.string().min(1),
    sandboxInstanceId: z.string().min(1).nullable(),
    trigger: sandboxProfileVersionSnapshotJobTriggerSchema,
    state: sandboxProfileVersionSnapshotJobStateSchema,
    errorCode: z.string().min(1).nullable(),
    errorMessage: z.string().min(1).nullable(),
    createdAt: z.string().min(1),
    startedAt: z.string().min(1).nullable(),
    finishedAt: z.string().min(1).nullable(),
  })
  .strict();
const sandboxProfileVersionRefreshScheduleSummarySchema = z
  .object({
    scheduleId: z.string().min(1),
    name: z.string().min(1),
    cronExpression: z.string().min(1),
    timezone: z.string().min(1),
    enabled: z.boolean(),
    nextScheduledAt: z.string().min(1).nullable(),
  })
  .strict();
const triggerKindSchema = z.enum([TriggerKinds.WEBHOOK, TriggerKinds.SCHEDULE]);

export const sandboxProfileSchema = createSelectSchema(sandboxProfiles, {
  activeVersion: z.number().int().min(1).nullable(),
  status: sandboxProfileStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict();

export const launchableSandboxProfileSchema = sandboxProfileSchema
  .extend({
    latestVersion: z.number().int().min(1),
    repositoryOptions: z.array(
      z
        .object({
          id: z.string().min(1),
          label: z.string().min(1),
          path: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export const sandboxProfileRepositoryOptionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    path: z.string().min(1),
  })
  .strict();

export const sandboxProfileVersionIntegrationBindingSchema = createSelectSchema(
  sandboxProfileVersionIntegrationBindings,
  {
    kind: integrationBindingKindSchema,
    config: z.record(z.string(), z.unknown()),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  },
).strict();

export const sandboxProfileVersionSchema = createSelectSchema(sandboxProfileVersions, {
  state: sandboxProfileVersionStateSchema,
  defaultPersistenceMode: sandboxProfileVersionDefaultPersistenceModeSchema,
  publishedAt: z.string().min(1).nullable(),
  version: z.number().int().min(1),
  agentRuntimeId: sandboxProfileVersionAgentRuntimeIdSchema,
  sandboxProvider: z.string().min(1).nullable(),
  sandboxConnectionId: z.string().min(1).nullable(),
})
  .pick({
    sandboxProfileId: true,
    version: true,
    state: true,
    defaultPersistenceMode: true,
    agentRuntimeId: true,
    mistleMcpEnabled: true,
    mistleMcpApiKeyId: true,
    sandboxProvider: true,
    sandboxConnectionId: true,
    maintenanceScript: true,
  })
  .extend({
    maintenanceScript: z.string().nullable(),
    sandboxResources: sandboxProfileVersionResourcesSchema.nullable(),
    isActive: z.boolean(),
    usable: z.boolean(),
    refreshSchedule: sandboxProfileVersionRefreshScheduleSummarySchema.nullable(),
    latestSnapshotJob: sandboxProfileVersionSnapshotJobSummarySchema.nullable(),
  })
  .strict();

export const sandboxProfileVersionSetupScriptSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    version: z.number().int().min(1),
    setupScript: z.string().min(1).nullable(),
  })
  .strict();

export const sandboxProfileVersionPersistenceModeSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    version: z.number().int().min(1),
    defaultPersistenceMode: sandboxProfileVersionDefaultPersistenceModeSchema,
  })
  .strict();

export const listSandboxProfileVersionsResponseSchema = z
  .object({
    versions: z.array(sandboxProfileVersionSchema),
  })
  .strict();

export const getSandboxProfileVersionPublishabilityResponseSchema = z
  .object({
    publishable: z.boolean(),
    issues: z.array(
      z
        .object({
          code: z.enum([
            SandboxProfilePublishabilityIssueCodes.PROFILE_VERSION_NOT_DRAFT,
            SandboxProfilePublishabilityIssueCodes.AGENT_BINDING_REQUIRED,
            SandboxProfilePublishabilityIssueCodes.INVALID_BINDING_CONNECTION_REFERENCE,
            SandboxProfilePublishabilityIssueCodes.CONNECTION_NOT_ACTIVE,
            SandboxProfilePublishabilityIssueCodes.TARGET_DISABLED,
            SandboxProfilePublishabilityIssueCodes.SANDBOX_PROVIDER_REQUIRED,
            SandboxProfilePublishabilityIssueCodes.INVALID_SANDBOX_PROVIDER,
            SandboxProfilePublishabilityIssueCodes.SANDBOX_MANAGED_PROVIDER_UNAVAILABLE,
            SandboxProfilePublishabilityIssueCodes.INVALID_SANDBOX_CONNECTION_REFERENCE,
            SandboxProfilePublishabilityIssueCodes.SANDBOX_CONNECTION_NOT_ACTIVE,
            SandboxProfilePublishabilityIssueCodes.SANDBOX_CONNECTION_KIND_MISMATCH,
            SandboxProfilePublishabilityIssueCodes.SANDBOX_CONNECTION_PROVIDER_MISMATCH,
            SandboxProfilePublishabilityIssueCodes.INVALID_SANDBOX_RESOURCES,
          ]),
          message: z.string().min(1),
          bindingId: z.string().min(1).optional(),
          connectionId: z.string().min(1).optional(),
          targetKey: z.string().min(1).optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const getSandboxProfileVersionDraftTriggerImpactResponseSchema = z
  .object({
    hasBreakingChanges: z.boolean(),
    affectedTriggers: z.array(
      z
        .object({
          id: z.string().min(1),
          name: z.string().min(1),
          kind: triggerKindSchema,
          enabled: z.boolean(),
          issues: z.array(
            z
              .object({
                code: z.enum([
                  SandboxProfileTriggerImpactIssueCodes.AGENT_BINDING_REQUIRED,
                  SandboxProfileTriggerImpactIssueCodes.AGENT_BINDING_PRIMARY_REQUIRED,
                  SandboxProfileTriggerImpactIssueCodes.AGENT_BINDING_AMBIGUOUS,
                  SandboxProfileTriggerImpactIssueCodes.AGENT_BINDING_RUNTIME_INCOMPATIBLE,
                  SandboxProfileTriggerImpactIssueCodes.INVALID_BINDING_CONNECTION_REFERENCE,
                  SandboxProfileTriggerImpactIssueCodes.CONNECTION_NOT_ACTIVE,
                  SandboxProfileTriggerImpactIssueCodes.TARGET_DISABLED,
                  SandboxProfileTriggerImpactIssueCodes.TARGET_MISSING,
                  SandboxProfileTriggerImpactIssueCodes.WEBHOOK_SOURCE_CONNECTION_NOT_BOUND,
                  SandboxProfileTriggerImpactIssueCodes.PRIMARY_REPOSITORY_UNAVAILABLE,
                ]),
                message: z.string().min(1),
                bindingId: z.string().min(1).optional(),
                connectionId: z.string().min(1).optional(),
                targetKey: z.string().min(1).optional(),
                primaryRepositoryId: z.string().min(1).optional(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export const createSandboxProfileVersionResponseSchema = sandboxProfileVersionSchema;

export const publishSandboxProfileVersionResponseSchema = z
  .object({
    version: sandboxProfileVersionSchema,
    activeVersion: z.number().int().min(1).nullable(),
    snapshotJob: z
      .object({
        id: z.string().min(1),
        sandboxInstanceId: z.string().min(1).nullable(),
        trigger: sandboxProfileVersionSnapshotJobTriggerSchema,
        state: sandboxProfileVersionSnapshotJobStateSchema,
        errorCode: z.string().min(1).nullable(),
        errorMessage: z.string().min(1).nullable(),
        createdAt: z.string().min(1),
        startedAt: z.string().min(1).nullable(),
        finishedAt: z.string().min(1).nullable(),
      })
      .strict(),
  })
  .strict();

export const refreshSandboxProfileVersionBodySchema = z
  .object({
    refreshKind: z.enum(["setup", "maintenance"]).optional(),
  })
  .strict();

export const discardSandboxProfileVersionDraftResponseSchema = z
  .object({
    discardedVersion: z.number().int().min(1),
    hasDraft: z.boolean(),
  })
  .strict();

export const sandboxProfileVersionIntegrationBindingsWriteBodySchema = z
  .object({
    bindings: z.array(
      z
        .object({
          id: z.string().min(1).optional(),
          clientRef: z.string().min(1).optional(),
          connectionId: z.string().min(1),
          kind: integrationBindingKindSchema,
          config: z.record(z.string(), z.unknown()),
        })
        .strict(),
    ),
  })
  .strict();

export const sandboxProfileVersionIntegrationBindingsResponseSchema = z
  .object({
    bindings: z.array(sandboxProfileVersionIntegrationBindingSchema),
  })
  .strict();

export const getSandboxProfileVersionIntegrationBindingsResponseSchema =
  sandboxProfileVersionIntegrationBindingsResponseSchema;

export const getSandboxProfileVersionTriggerConfigResponseSchema = z
  .object({
    bindings: z.array(sandboxProfileVersionIntegrationBindingSchema),
    repositoryOptions: z.array(sandboxProfileRepositoryOptionSchema),
  })
  .strict();

export const getSandboxProfileVersionSetupScriptResponseSchema =
  sandboxProfileVersionSetupScriptSchema;

export const putSandboxProfileVersionDraftBodySchema = z
  .object({
    setupScript: z.string().min(1).nullable().optional(),
    defaultPersistenceMode: sandboxProfileVersionDefaultPersistenceModeSchema.optional(),
    agentRuntimeId: sandboxProfileVersionAgentRuntimeIdSchema.optional(),
    mistleMcpEnabled: z.boolean().optional(),
    mistleMcpApiKeyId: z.string().min(1).nullable().optional(),
    sandboxProvider: z.string().min(1).optional(),
    sandboxConnectionId: z.string().min(1).nullable().optional(),
    sandboxResources: sandboxProfileVersionResourcesSchema.nullable().optional(),
    integrationBindings: sandboxProfileVersionIntegrationBindingsWriteBodySchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.setupScript !== undefined ||
      value.defaultPersistenceMode !== undefined ||
      value.agentRuntimeId !== undefined ||
      value.mistleMcpEnabled !== undefined ||
      value.mistleMcpApiKeyId !== undefined ||
      value.sandboxProvider !== undefined ||
      value.sandboxConnectionId !== undefined ||
      value.sandboxResources !== undefined ||
      value.integrationBindings !== undefined,
    {
      message: "At least one draft field must be provided.",
    },
  );

export const putSandboxProfileVersionDraftResponseSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    version: z.number().int().min(1),
    setupScript: z.string().nullable(),
    defaultPersistenceMode: sandboxProfileVersionDefaultPersistenceModeSchema,
    agentRuntimeId: sandboxProfileVersionAgentRuntimeIdSchema,
    mistleMcpEnabled: z.boolean(),
    mistleMcpApiKeyId: z.string().min(1).nullable(),
    sandboxProvider: z.string().min(1).nullable(),
    sandboxConnectionId: z.string().min(1).nullable(),
    sandboxResources: sandboxProfileVersionResourcesSchema.nullable(),
    integrationBindings: sandboxProfileVersionIntegrationBindingsResponseSchema,
  })
  .strict();

export const putSandboxProfileVersionRefreshScheduleBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    cronExpression: z.string().min(1),
    timezone: z.string().min(1),
    maintenanceScript: z.string().nullable().optional(),
  })
  .strict();

export const sandboxProfileVersionRefreshScheduleResponseSchema = z
  .object({
    scheduleId: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    name: z.string().min(1),
    cronExpression: z.string().min(1),
    timezone: z.string().min(1),
    enabled: z.boolean(),
    nextScheduledAt: z.string().min(1).nullable(),
  })
  .strict();

export const deleteSandboxProfileVersionRefreshScheduleResponseSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    deleted: z.boolean(),
  })
  .strict();

export const createSandboxProfileBodySchema = z
  .object({
    displayName: z.string().min(1),
  })
  .strict();

export const updateSandboxProfileBodySchema = z
  .object({
    displayName: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => value.displayName !== undefined, {
    message: "At least one field must be provided.",
  });

export const sandboxProfileIdParamsSchema = z
  .object({
    profileId: z
      .string()
      .min(1)
      .regex(/^sbp_[a-zA-Z0-9_-]+$/, {
        message: "`profileId` must be a sandbox profile id.",
      }),
  })
  .strict();

export const sandboxProfileVersionParamsSchema = z
  .object({
    profileId: z
      .string()
      .min(1)
      .regex(/^sbp_[a-zA-Z0-9_-]+$/, {
        message: "`profileId` must be a sandbox profile id.",
      }),
    version: z.coerce.number().int().min(1),
  })
  .strict();

export const startSandboxProfileInstanceBodySchema = z
  .object({
    primaryRepositoryId: z.string().min(1).nullable().optional(),
    idempotencyKey: z.string().min(1).max(255).optional(),
  })
  .strict();

export const startSandboxProfileSetupScriptTestRunBodySchema = z
  .object({
    setupScript: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "Setup script must not be blank.",
      }),
    idempotencyKey: z.string().min(1).max(255).optional(),
    agentRuntimeId: sandboxProfileVersionAgentRuntimeIdSchema.optional(),
    sandboxProvider: z.string().min(1).optional(),
    sandboxConnectionId: z.string().min(1).nullable().optional(),
    sandboxResources: sandboxProfileVersionResourcesSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.sandboxConnectionId === undefined && value.sandboxResources === undefined) ||
      value.sandboxProvider !== undefined,
    {
      message: "Sandbox provider is required when sandbox runtime override fields are provided.",
    },
  );

export const startSandboxProfileMaintenanceScriptTestRunBodySchema = z
  .object({
    maintenanceScript: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: "Maintenance script must not be blank.",
      }),
    idempotencyKey: z.string().min(1).max(255).optional(),
    agentRuntimeId: sandboxProfileVersionAgentRuntimeIdSchema.optional(),
    sandboxProvider: z.string().min(1).optional(),
    sandboxConnectionId: z.string().min(1).nullable().optional(),
    sandboxResources: sandboxProfileVersionResourcesSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.sandboxConnectionId === undefined && value.sandboxResources === undefined) ||
      value.sandboxProvider !== undefined,
    {
      message: "Sandbox provider is required when sandbox runtime override fields are provided.",
    },
  );

export const startSandboxProfileSetupAssistantBodySchema = z
  .object({
    idempotencyKey: z.string().min(1).max(255).optional(),
    scriptKind: z.enum(["setup", "maintenance"]).optional(),
  })
  .strict();

export const sandboxProfileDeletionAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    profileId: z.string().min(1),
  })
  .strict();

export const startSandboxProfileInstanceResponseSchema = z
  .object({
    status: z.literal("accepted"),
    workflowRunId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
  })
  .strict();

export const startSandboxProfileSetupScriptTestRunResponseSchema =
  startSandboxProfileInstanceResponseSchema;

export const startSandboxProfileSetupAssistantResponseSchema =
  startSandboxProfileInstanceResponseSchema;

export const listSandboxProfilesQuerySchema = createKeysetPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
});

export const listSandboxProfilesResponseSchema = createKeysetPaginationEnvelopeSchema(
  sandboxProfileSchema,
  {
    maxLimit: 100,
  },
);

export const listLaunchableSandboxProfilesResponseSchema = z
  .object({
    items: z.array(launchableSandboxProfileSchema),
  })
  .strict();
