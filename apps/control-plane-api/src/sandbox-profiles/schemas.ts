import { z } from "@hono/zod-openapi";
import {
  IntegrationBindingKinds,
  SandboxProfileStatuses,
  sandboxProfileSetupChecks,
  SandboxProfileSetupCheckFailurePhases,
  SandboxProfileSetupCheckStatuses,
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

import { SandboxProfilePublishabilityIssueCodes } from "./errors.js";

const sandboxProfileStatusSchema = z.enum([
  SandboxProfileStatuses.ACTIVE,
  SandboxProfileStatuses.INACTIVE,
]);
const integrationBindingKindSchema = z.enum([
  IntegrationBindingKinds.AGENT,
  IntegrationBindingKinds.GIT,
  IntegrationBindingKinds.CONNECTOR,
]);
const sandboxProfileVersionStateSchema = z.enum([
  SandboxProfileVersionStates.DRAFT,
  SandboxProfileVersionStates.PUBLISHED,
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
const sandboxProfileSetupCheckStatusSchema = z.enum([
  SandboxProfileSetupCheckStatuses.QUEUED,
  SandboxProfileSetupCheckStatuses.COMPILING_PROFILE,
  SandboxProfileSetupCheckStatuses.STARTING_SANDBOX,
  SandboxProfileSetupCheckStatuses.WAITING_FOR_RUNTIME,
  SandboxProfileSetupCheckStatuses.RUNNING_SCRIPT,
  SandboxProfileSetupCheckStatuses.CLEANING_UP,
  SandboxProfileSetupCheckStatuses.SUCCEEDED,
  SandboxProfileSetupCheckStatuses.FAILED,
  SandboxProfileSetupCheckStatuses.CLEANUP_FAILED,
]);
const sandboxProfileSetupCheckFailurePhaseSchema = z.enum([
  SandboxProfileSetupCheckFailurePhases.COMPILE,
  SandboxProfileSetupCheckFailurePhases.START,
  SandboxProfileSetupCheckFailurePhases.RUNTIME_READY,
  SandboxProfileSetupCheckFailurePhases.SCRIPT,
  SandboxProfileSetupCheckFailurePhases.CLEANUP,
]);
const sandboxProfileVersionSnapshotJobSummarySchema = z
  .object({
    id: z.string().min(1),
    trigger: sandboxProfileVersionSnapshotJobTriggerSchema,
    state: sandboxProfileVersionSnapshotJobStateSchema,
    errorCode: z.string().min(1).nullable(),
    errorMessage: z.string().min(1).nullable(),
    createdAt: z.string().min(1),
    startedAt: z.string().min(1).nullable(),
    finishedAt: z.string().min(1).nullable(),
  })
  .strict();

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
  publishedAt: z.string().min(1).nullable(),
  version: z.number().int().min(1),
})
  .pick({
    sandboxProfileId: true,
    version: true,
    state: true,
  })
  .extend({
    isActive: z.boolean(),
    usable: z.boolean(),
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

export const sandboxProfileSetupCheckSchema = createSelectSchema(sandboxProfileSetupChecks, {
  sandboxProfileVersion: z.number().int().min(1),
  status: sandboxProfileSetupCheckStatusSchema,
  failurePhase: sandboxProfileSetupCheckFailurePhaseSchema.nullable(),
  requestedByUserId: z.string().min(1).nullable(),
  setupScript: z.string().nullable(),
  primaryRepositoryId: z.string().min(1).nullable(),
  idempotencyKey: z.string().min(1).nullable(),
  failureCode: z.string().min(1).nullable(),
  failureMessage: z.string().min(1).nullable(),
  sandboxInstanceId: z.string().min(1).nullable(),
  workflowRunId: z.string().min(1).nullable(),
  startedAt: z.string().min(1).nullable(),
  finishedAt: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})
  .pick({
    id: true,
    sandboxProfileId: true,
    sandboxProfileVersion: true,
    requestedByUserId: true,
    setupScript: true,
    primaryRepositoryId: true,
    status: true,
    failurePhase: true,
    failureCode: true,
    failureMessage: true,
    sandboxInstanceId: true,
    workflowRunId: true,
    startedAt: true,
    finishedAt: true,
    createdAt: true,
    updatedAt: true,
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

export const createSandboxProfileVersionResponseSchema = sandboxProfileVersionSchema;

export const publishSandboxProfileVersionResponseSchema = z
  .object({
    version: sandboxProfileVersionSchema,
    activeVersion: z.number().int().min(1).nullable(),
    snapshotJob: z
      .object({
        id: z.string().min(1),
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

export const discardSandboxProfileVersionDraftResponseSchema = z
  .object({
    discardedVersion: z.number().int().min(1),
    hasDraft: z.boolean(),
  })
  .strict();

export const putSandboxProfileVersionIntegrationBindingsBodySchema = z
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

export const putSandboxProfileVersionIntegrationBindingsResponseSchema = z
  .object({
    bindings: z.array(sandboxProfileVersionIntegrationBindingSchema),
  })
  .strict();

export const getSandboxProfileVersionIntegrationBindingsResponseSchema =
  putSandboxProfileVersionIntegrationBindingsResponseSchema;

export const getSandboxProfileVersionAutomationConfigResponseSchema = z
  .object({
    bindings: z.array(sandboxProfileVersionIntegrationBindingSchema),
    repositoryOptions: z.array(sandboxProfileRepositoryOptionSchema),
  })
  .strict();

export const putSandboxProfileVersionSetupScriptBodySchema = z
  .object({
    setupScript: z.string().min(1).nullable(),
  })
  .strict();

export const getSandboxProfileVersionSetupScriptResponseSchema =
  sandboxProfileVersionSetupScriptSchema;

export const putSandboxProfileVersionSetupScriptResponseSchema =
  sandboxProfileVersionSetupScriptSchema;

export const createSandboxProfileVersionSetupCheckBodySchema = z
  .object({
    setupScript: z.string().nullable(),
    primaryRepositoryId: z.string().min(1).nullable().optional(),
    idempotencyKey: z.string().min(1).max(255).optional(),
  })
  .strict();

export const createSandboxProfileVersionSetupCheckResponseSchema = sandboxProfileSetupCheckSchema;

export const getSandboxProfileVersionSetupCheckResponseSchema = sandboxProfileSetupCheckSchema;

export const putSandboxProfileVersionRefreshScheduleBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    cronExpression: z.string().min(1),
    timezone: z.string().min(1),
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

export const sandboxProfileVersionSetupCheckParamsSchema = sandboxProfileVersionParamsSchema.extend(
  {
    setupCheckId: z
      .string()
      .min(1)
      .regex(/^spc_[a-zA-Z0-9_-]+$/, {
        message: "`setupCheckId` must be a setup check id.",
      }),
  },
);

export const startSandboxProfileInstanceBodySchema = z
  .object({
    primaryRepositoryId: z.string().min(1).nullable().optional(),
    idempotencyKey: z.string().min(1).max(255).optional(),
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
