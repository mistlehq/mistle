import { z } from "@hono/zod-openapi";
import {
  IntegrationBindingKinds,
  SandboxProfileStatuses,
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
  })
  .strict();

export const sandboxProfileVersionSetupScriptSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    version: z.number().int().min(1),
    setupScript: z.string().min(1).nullable(),
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
    activeVersion: z.number().int().min(1),
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
