import { createRoute, z } from "@hono/zod-openapi";
import { SandboxProfileStatuses, sandboxProfiles } from "@mistle/db/control-plane";
import {
  createKeysetPaginationEnvelopeSchema,
  createKeysetPaginationQuerySchema,
} from "@mistle/http/pagination";
import { createSelectSchema } from "drizzle-zod";

import {
  SandboxProfilesAuthErrorCodes,
  SandboxProfilesBadRequestCodes,
  SandboxProfilesNotFoundCodes,
} from "./services/errors.js";

const SandboxProfileStatusSchema = z.enum([
  SandboxProfileStatuses.ACTIVE,
  SandboxProfileStatuses.INACTIVE,
]);

export const SandboxProfileSchema = createSelectSchema(sandboxProfiles, {
  status: SandboxProfileStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict();

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

const BadRequestCodeSchema = z.enum([
  SandboxProfilesBadRequestCodes.INVALID_LIST_PROFILES_INPUT,
  SandboxProfilesBadRequestCodes.INVALID_PAGINATION_CURSOR,
]);
const NotFoundCodeSchema = z.enum([SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND]);
const StartSandboxProfileInstanceNotFoundCodeSchema = z.enum([
  SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
  SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
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
export const StartSandboxProfileInstanceNotFoundResponseSchema = z
  .object({
    code: StartSandboxProfileInstanceNotFoundCodeSchema,
    message: z.string().min(1),
  })
  .strict();

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
export const StartSandboxProfileInstanceResponseSchema = z
  .object({
    status: z.literal("completed"),
    workflowRunId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
    providerSandboxId: z.string().min(1),
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

export const startSandboxProfileInstanceRoute = createRoute({
  method: "post",
  path: "/{profileId}/versions/{version}/instances",
  tags: ["Sandbox Profiles"],
  request: {
    params: SandboxProfileVersionParamsSchema,
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
          schema: ValidationErrorResponseSchema,
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
