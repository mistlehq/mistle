import { createRoute, z } from "@hono/zod-openapi";

export const InternalSandboxRuntimeErrorResponseSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const InternalSandboxRuntimeValidationErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.looseObject({
      name: z.string().min(1),
      message: z.string().min(1),
    }),
  })
  .strict();

export const InternalSandboxRuntimeBadRequestResponseSchema = z.union([
  InternalSandboxRuntimeErrorResponseSchema,
  InternalSandboxRuntimeValidationErrorResponseSchema,
]);

export const InternalSandboxRuntimeStartProfileInstanceRequestSchema = z.object({
  organizationId: z.string().min(1),
  profileId: z.string().min(1),
  profileVersion: z.number().int().min(1),
  startedBy: z.object({
    kind: z.union([z.literal("user"), z.literal("system")]),
    id: z.string().min(1),
  }),
  source: z.union([z.literal("dashboard"), z.literal("webhook")]),
});

export const InternalSandboxRuntimeStartProfileInstanceResponseSchema = z.object({
  status: z.literal("accepted"),
  workflowRunId: z.string().min(1),
  sandboxInstanceId: z.string().min(1),
});

export const InternalSandboxRuntimeGetSandboxInstanceRequestSchema = z.object({
  organizationId: z.string().min(1),
  instanceId: z.string().min(1),
});

export const InternalSandboxRuntimeGetSandboxInstanceResponseSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["starting", "running", "stopped", "failed"]),
  failureCode: z.string().min(1).nullable(),
  failureMessage: z.string().min(1).nullable(),
});

export const InternalSandboxRuntimeMintConnectionRequestSchema = z.object({
  organizationId: z.string().min(1),
  instanceId: z.string().min(1),
});

export const InternalSandboxRuntimeMintConnectionResponseSchema = z.object({
  instanceId: z.string().min(1),
  url: z.url(),
  token: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true }),
});

export const internalSandboxRuntimeStartProfileInstanceRoute = createRoute({
  method: "post",
  path: "/start-profile-instance",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeStartProfileInstanceRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Start sandbox profile instance provisioning for internal callers.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeStartProfileInstanceResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request body.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Referenced sandbox profile version was not found.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeErrorResponseSchema,
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

export const internalSandboxRuntimeGetSandboxInstanceRoute = createRoute({
  method: "post",
  path: "/get-sandbox-instance",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeGetSandboxInstanceRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Get sandbox instance status for internal callers.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeGetSandboxInstanceResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request body.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Referenced sandbox instance was not found.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeErrorResponseSchema,
        },
      },
    },
    409: {
      description: "Sandbox instance state conflicts with the requested operation.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeErrorResponseSchema,
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

export const internalSandboxRuntimeMintConnectionTokenRoute = createRoute({
  method: "post",
  path: "/mint-connection-token",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeMintConnectionRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Mint a sandbox connection token for internal callers.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeMintConnectionResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request body.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Referenced sandbox instance was not found.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeErrorResponseSchema,
        },
      },
    },
    409: {
      description: "Sandbox instance could not be connected.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeErrorResponseSchema,
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
