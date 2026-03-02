import { createRoute, z } from "@hono/zod-openapi";
import {
  IntegrationBindingKinds,
  SandboxProfileStatuses,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfiles,
} from "@mistle/db/control-plane";
import {
  createKeysetPaginationEnvelopeSchema,
  createKeysetPaginationQuerySchema,
} from "@mistle/http/pagination";
import { createSelectSchema } from "drizzle-zod";

import {
  SandboxProfilesAuthErrorCodes,
  SandboxProfilesBadRequestCodes,
  SandboxProfilesCompileErrorCodes,
  SandboxProfilesIntegrationBindingsBadRequestCodes,
  SandboxProfilesNotFoundCodes,
} from "./services/errors.js";

const SandboxProfileStatusSchema = z.enum([
  SandboxProfileStatuses.ACTIVE,
  SandboxProfileStatuses.INACTIVE,
]);
const IntegrationBindingKindSchema = z.enum([
  IntegrationBindingKinds.AGENT,
  IntegrationBindingKinds.GIT,
  IntegrationBindingKinds.CONNECTOR,
]);

export const SandboxProfileSchema = createSelectSchema(sandboxProfiles, {
  status: SandboxProfileStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict();
export const SandboxProfileVersionIntegrationBindingSchema = createSelectSchema(
  sandboxProfileVersionIntegrationBindings,
  {
    kind: IntegrationBindingKindSchema,
    config: z.record(z.string(), z.unknown()),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  },
).strict();

export const PutSandboxProfileVersionIntegrationBindingsBodySchema = z
  .object({
    bindings: z.array(
      z
        .object({
          id: z.string().min(1).optional(),
          connectionId: z.string().min(1),
          kind: IntegrationBindingKindSchema,
          config: z.record(z.string(), z.unknown()),
        })
        .strict(),
    ),
  })
  .strict();

export const PutSandboxProfileVersionIntegrationBindingsResponseSchema = z
  .object({
    bindings: z.array(SandboxProfileVersionIntegrationBindingSchema),
  })
  .strict();

export const CreateSandboxProfileBodySchema = z
  .object({
    displayName: z.string().min(1),
    status: SandboxProfileStatusSchema.optional(),
  })
  .strict();

export const UpdateSandboxProfileBodySchema = z
  .object({
    displayName: z.string().min(1).optional(),
    status: SandboxProfileStatusSchema.optional(),
  })
  .strict()
  .refine((value) => value.displayName !== undefined || value.status !== undefined, {
    message: "At least one field must be provided.",
  });

export const SandboxProfileIdParamsSchema = z
  .object({
    profileId: z
      .string()
      .min(1)
      .regex(/^sbp_[a-zA-Z0-9_-]+$/, {
        message: "`profileId` must be a sandbox profile id.",
      }),
  })
  .strict();

export const SandboxProfileVersionParamsSchema = z
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

export const StartSandboxProfileInstanceBodySchema = z
  .object({
    issueConnectionToken: z.boolean().optional(),
  })
  .strict();

const BadRequestCodeSchema = z.enum([
  SandboxProfilesBadRequestCodes.INVALID_LIST_PROFILES_INPUT,
  SandboxProfilesBadRequestCodes.INVALID_PAGINATION_CURSOR,
]);
const NotFoundCodeSchema = z.enum([SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND]);
const SandboxProfileVersionNotFoundCodeSchema = z.enum([
  SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
  SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
]);
const StartSandboxProfileInstanceBadRequestCodeSchema = z.enum([
  SandboxProfilesCompileErrorCodes.INVALID_BINDING_CONNECTION_REFERENCE,
  SandboxProfilesCompileErrorCodes.INVALID_CONNECTION_TARGET_REFERENCE,
  SandboxProfilesCompileErrorCodes.CONNECTION_MISMATCH,
  SandboxProfilesCompileErrorCodes.TARGET_DISABLED,
  SandboxProfilesCompileErrorCodes.CONNECTION_NOT_ACTIVE,
  SandboxProfilesCompileErrorCodes.KIND_MISMATCH,
  SandboxProfilesCompileErrorCodes.INVALID_TARGET_CONFIG,
  SandboxProfilesCompileErrorCodes.INVALID_BINDING_CONFIG,
  SandboxProfilesCompileErrorCodes.ROUTE_CONFLICT,
  SandboxProfilesCompileErrorCodes.ARTIFACT_CONFLICT,
  SandboxProfilesCompileErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
  SandboxProfilesCompileErrorCodes.RUNTIME_CLIENT_SETUP_INVALID_REF,
]);
const PutSandboxProfileVersionIntegrationBindingsBadRequestCodeSchema = z.enum([
  SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_REFERENCE,
  SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_CONNECTION_REFERENCE,
]);

export const BadRequestResponseSchema = z
  .object({
    code: BadRequestCodeSchema,
    message: z.string().min(1),
  })
  .strict();
export const ValidationErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.looseObject({
      name: z.string().min(1),
      message: z.string().min(1),
    }),
  })
  .strict();
export const InternalServerErrorResponseSchema = z.string().min(1);

export const ListSandboxProfilesBadRequestResponseSchema = z.union([
  BadRequestResponseSchema,
  ValidationErrorResponseSchema,
]);
export const NotFoundResponseSchema = z
  .object({
    code: NotFoundCodeSchema,
    message: z.string().min(1),
  })
  .strict();
export const SandboxProfileVersionNotFoundResponseSchema = z
  .object({
    code: SandboxProfileVersionNotFoundCodeSchema,
    message: z.string().min(1),
  })
  .strict();
export const StartSandboxProfileInstanceNotFoundResponseSchema =
  SandboxProfileVersionNotFoundResponseSchema;
export const StartSandboxProfileInstanceBadRequestResponseSchema = z.union([
  z
    .object({
      code: StartSandboxProfileInstanceBadRequestCodeSchema,
      message: z.string().min(1),
    })
    .strict(),
  ValidationErrorResponseSchema,
]);
export const PutSandboxProfileVersionIntegrationBindingsBadRequestResponseSchema = z.union([
  z
    .object({
      code: PutSandboxProfileVersionIntegrationBindingsBadRequestCodeSchema,
      message: z.string().min(1),
    })
    .strict(),
  ValidationErrorResponseSchema,
]);

export const UnauthorizedResponseSchema = z
  .object({
    code: z.literal(SandboxProfilesAuthErrorCodes.UNAUTHORIZED),
    message: z.string().min(1),
  })
  .strict();

export const ForbiddenResponseSchema = z
  .object({
    code: z.literal(SandboxProfilesAuthErrorCodes.ACTIVE_ORGANIZATION_REQUIRED),
    message: z.string().min(1),
  })
  .strict();

export const SandboxProfileDeletionAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    profileId: z.string().min(1),
  })
  .strict();
export const SandboxInstanceConnectionSchema = z
  .object({
    url: z.url(),
    token: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();
export const StartSandboxProfileInstanceResponseSchema = z
  .object({
    status: z.literal("completed"),
    workflowRunId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
    providerSandboxId: z.string().min(1),
    connection: SandboxInstanceConnectionSchema.optional(),
  })
  .strict();

export const ListSandboxProfilesQuerySchema = createKeysetPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
});

export const ListSandboxProfilesResponseSchema = createKeysetPaginationEnvelopeSchema(
  SandboxProfileSchema,
  {
    maxLimit: 100,
  },
);

export const listSandboxProfilesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Sandbox Profiles"],
  request: {
    query: ListSandboxProfilesQuerySchema,
  },
  responses: {
    200: {
      description: "List sandbox profiles.",
      content: {
        "application/json": {
          schema: ListSandboxProfilesResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ListSandboxProfilesBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error.",
      content: {
        "text/plain": {
          schema: InternalServerErrorResponseSchema,
        },
      },
    },
  },
});

export const createSandboxProfileRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Sandbox Profiles"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateSandboxProfileBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Create a sandbox profile.",
      content: {
        "application/json": {
          schema: SandboxProfileSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ValidationErrorResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error.",
      content: {
        "text/plain": {
          schema: InternalServerErrorResponseSchema,
        },
      },
    },
  },
});

export const getSandboxProfileRoute = createRoute({
  method: "get",
  path: "/{profileId}",
  tags: ["Sandbox Profiles"],
  request: {
    params: SandboxProfileIdParamsSchema,
  },
  responses: {
    200: {
      description: "Get a sandbox profile.",
      content: {
        "application/json": {
          schema: SandboxProfileSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ValidationErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Sandbox profile was not found.",
      content: {
        "application/json": {
          schema: NotFoundResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error.",
      content: {
        "text/plain": {
          schema: InternalServerErrorResponseSchema,
        },
      },
    },
  },
});

export const updateSandboxProfileRoute = createRoute({
  method: "patch",
  path: "/{profileId}",
  tags: ["Sandbox Profiles"],
  request: {
    params: SandboxProfileIdParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateSandboxProfileBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Update a sandbox profile.",
      content: {
        "application/json": {
          schema: SandboxProfileSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ValidationErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Sandbox profile was not found.",
      content: {
        "application/json": {
          schema: NotFoundResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error.",
      content: {
        "text/plain": {
          schema: InternalServerErrorResponseSchema,
        },
      },
    },
  },
});

export const deleteSandboxProfileRoute = createRoute({
  method: "delete",
  path: "/{profileId}",
  tags: ["Sandbox Profiles"],
  request: {
    params: SandboxProfileIdParamsSchema,
  },
  responses: {
    202: {
      description:
        "Accept deletion and enqueue asynchronous sandbox profile resource cleanup workflow.",
      content: {
        "application/json": {
          schema: SandboxProfileDeletionAcceptedResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ValidationErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Sandbox profile was not found.",
      content: {
        "application/json": {
          schema: NotFoundResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error.",
      content: {
        "text/plain": {
          schema: InternalServerErrorResponseSchema,
        },
      },
    },
  },
});

export const putSandboxProfileVersionIntegrationBindingsRoute = createRoute({
  method: "put",
  path: "/{profileId}/versions/{version}/integration-bindings",
  tags: ["Sandbox Profiles"],
  request: {
    params: SandboxProfileVersionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: PutSandboxProfileVersionIntegrationBindingsBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Replace integration bindings for the specified sandbox profile version.",
      content: {
        "application/json": {
          schema: PutSandboxProfileVersionIntegrationBindingsResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: PutSandboxProfileVersionIntegrationBindingsBadRequestResponseSchema,
        },
      },
    },
    404: {
      description: "Sandbox profile or profile version was not found.",
      content: {
        "application/json": {
          schema: SandboxProfileVersionNotFoundResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error.",
      content: {
        "text/plain": {
          schema: InternalServerErrorResponseSchema,
        },
      },
    },
  },
});

export const startSandboxProfileInstanceRoute = createRoute({
  method: "post",
  path: "/{profileId}/versions/{version}/instances",
  tags: ["Sandbox Profiles"],
  request: {
    params: SandboxProfileVersionParamsSchema,
    body: {
      required: false,
      content: {
        "application/json": {
          schema: StartSandboxProfileInstanceBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Start a sandbox instance for the specified sandbox profile version.",
      content: {
        "application/json": {
          schema: StartSandboxProfileInstanceResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: StartSandboxProfileInstanceBadRequestResponseSchema,
        },
      },
    },
    404: {
      description: "Sandbox profile or profile version was not found.",
      content: {
        "application/json": {
          schema: StartSandboxProfileInstanceNotFoundResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error.",
      content: {
        "text/plain": {
          schema: InternalServerErrorResponseSchema,
        },
      },
    },
  },
});
