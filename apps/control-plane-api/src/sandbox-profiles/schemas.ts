import { z } from "@hono/zod-openapi";
import {
  IntegrationBindingKinds,
  SandboxProfileStatuses,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
  sandboxProfiles,
} from "@mistle/db/control-plane";
import {
  createKeysetPaginationEnvelopeSchema,
  createKeysetPaginationQuerySchema,
} from "@mistle/http/pagination";
import { createSelectSchema } from "drizzle-zod";

const sandboxProfileStatusSchema = z.enum([
  SandboxProfileStatuses.ACTIVE,
  SandboxProfileStatuses.INACTIVE,
]);
const integrationBindingKindSchema = z.enum([
  IntegrationBindingKinds.AGENT,
  IntegrationBindingKinds.GIT,
  IntegrationBindingKinds.CONNECTOR,
]);

export const sandboxProfileSchema = createSelectSchema(sandboxProfiles, {
  status: sandboxProfileStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict();

export const launchableSandboxProfileSchema = sandboxProfileSchema
  .extend({
    latestVersion: z.number().int().min(1),
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
  version: z.number().int().min(1),
}).strict();

export const listSandboxProfileVersionsResponseSchema = z
  .object({
    versions: z.array(sandboxProfileVersionSchema),
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
