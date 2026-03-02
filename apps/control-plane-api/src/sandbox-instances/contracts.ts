import { createRoute, z } from "@hono/zod-openapi";

export const SandboxInstanceIdParamsSchema = z
  .object({
    instanceId: z
      .string()
      .min(1)
      .regex(/^sbi_[a-zA-Z0-9_-]+$/, {
        message: "`instanceId` must be a sandbox instance id.",
      }),
  })
  .strict();

export const MintSandboxInstanceConnectionTokenBodySchema = z.object({}).strict();

export const SandboxInstanceConnectionTokenSchema = z
  .object({
    instanceId: z.string().min(1),
    url: z.url(),
    token: z.string().min(1),
    expiresAt: z.string().min(1),
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

const SandboxInstancesBadRequestCodeSchema = z.enum(["INVALID_INSTANCE_ID"]);
const SandboxInstancesNotFoundCodeSchema = z.enum(["INSTANCE_NOT_FOUND"]);
const SandboxInstancesConflictCodeSchema = z.enum(["INSTANCE_NOT_RUNNING"]);

export const SandboxInstancesBadRequestResponseSchema = z.union([
  z
    .object({
      code: SandboxInstancesBadRequestCodeSchema,
      message: z.string().min(1),
    })
    .strict(),
  ValidationErrorResponseSchema,
]);

export const SandboxInstancesNotFoundResponseSchema = z
  .object({
    code: SandboxInstancesNotFoundCodeSchema,
    message: z.string().min(1),
  })
  .strict();

export const SandboxInstancesConflictResponseSchema = z
  .object({
    code: SandboxInstancesConflictCodeSchema,
    message: z.string().min(1),
  })
  .strict();

export const SandboxInstancesUnauthorizedResponseSchema = z
  .object({
    code: z.literal("UNAUTHORIZED"),
    message: z.string().min(1),
  })
  .strict();

export const SandboxInstancesForbiddenResponseSchema = z
  .object({
    code: z.literal("ACTIVE_ORGANIZATION_REQUIRED"),
    message: z.string().min(1),
  })
  .strict();

export const createSandboxInstanceConnectionTokenRoute = createRoute({
  method: "post",
  path: "/{instanceId}/connection-tokens",
  tags: ["Sandbox Instances"],
  request: {
    params: SandboxInstanceIdParamsSchema,
    body: {
      required: false,
      content: {
        "application/json": {
          schema: MintSandboxInstanceConnectionTokenBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Issue a short-lived connection token for a running sandbox instance.",
      content: {
        "application/json": {
          schema: SandboxInstanceConnectionTokenSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: SandboxInstancesBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: SandboxInstancesUnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: SandboxInstancesForbiddenResponseSchema,
        },
      },
    },
    404: {
      description: "Sandbox instance was not found.",
      content: {
        "application/json": {
          schema: SandboxInstancesNotFoundResponseSchema,
        },
      },
    },
    409: {
      description: "Sandbox instance is not running.",
      content: {
        "application/json": {
          schema: SandboxInstancesConflictResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error.",
      content: {
        "text/plain": {
          schema: z.string().min(1),
        },
      },
    },
  },
});
