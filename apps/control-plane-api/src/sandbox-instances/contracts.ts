import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";
import {
  createKeysetPaginationEnvelopeSchema,
  createKeysetPaginationQuerySchema,
} from "@mistle/http/pagination";

const SandboxInstanceStatusSchema = z.enum(["starting", "running", "stopped", "failed"]);
const SandboxInstanceSourceSchema = z.enum(["dashboard", "webhook"]);
const SandboxInstanceStartedBySchema = z
  .object({
    kind: z.enum(["user", "system"]),
    id: z.string().min(1),
    name: z.string().min(1).nullable(),
  })
  .strict();

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

export const SandboxInstanceStatusResponseSchema = z
  .object({
    id: z.string().min(1),
    status: SandboxInstanceStatusSchema,
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
    automationConversation: z
      .object({
        conversationId: z.string().min(1),
        routeId: z.string().min(1).nullable(),
        providerConversationId: z.string().min(1).nullable(),
      })
      .nullable(),
  })
  .strict();

export const SandboxInstanceListItemSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    status: SandboxInstanceStatusSchema,
    startedBy: SandboxInstanceStartedBySchema,
    source: SandboxInstanceSourceSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
  })
  .strict();

export const ListSandboxInstancesQuerySchema = createKeysetPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
});

export const ListSandboxInstancesResponseSchema = createKeysetPaginationEnvelopeSchema(
  SandboxInstanceListItemSchema,
  {
    defaultLimit: 20,
    maxLimit: 100,
  },
);

export const ValidationErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.looseObject({
      name: z.string().min(1),
      message: z.string().min(1),
    }),
  })
  .strict();

const SandboxInstancesBadRequestCodeSchema = z.enum([
  "INVALID_INSTANCE_ID",
  "INVALID_LIST_INSTANCES_INPUT",
]);
const SandboxInstancesNotFoundCodeSchema = z.enum(["INSTANCE_NOT_FOUND"]);
const SandboxInstancesConflictCodeSchema = z.enum([
  "INSTANCE_NOT_RESUMABLE",
  "INSTANCE_FAILED",
  "MULTIPLE_ACTIVE_AUTOMATION_CONVERSATIONS",
]);

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

export const listSandboxInstancesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Sandbox Instances"],
  request: {
    query: ListSandboxInstancesQuerySchema,
  },
  responses: {
    200: {
      description: "List sandbox instances.",
      content: {
        "application/json": {
          schema: ListSandboxInstancesResponseSchema,
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
          schema: z.string().min(1),
        },
      },
    },
  },
});

export const getSandboxInstanceRoute = createRoute({
  method: "get",
  path: "/{instanceId}",
  tags: ["Sandbox Instances"],
  request: {
    params: SandboxInstanceIdParamsSchema,
  },
  responses: {
    200: {
      description: "Get sandbox instance provisioning/runtime status.",
      content: {
        "application/json": {
          schema: SandboxInstanceStatusResponseSchema,
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
    404: {
      description: "Sandbox instance was not found.",
      content: {
        "application/json": {
          schema: SandboxInstancesNotFoundResponseSchema,
        },
      },
    },
    409: {
      description: "Sandbox instance state conflicts with the requested operation.",
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
