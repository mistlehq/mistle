import { createRoute, z } from "@hono/zod-openapi";

const ConversationIdSchema = z
  .string()
  .min(1)
  .regex(/^cnv_[a-zA-Z0-9_-]+$/, {
    message: "`conversationId` must be a conversation id.",
  });

const IntegrationBindingIdSchema = z
  .string()
  .min(1)
  .regex(/^ibd_[a-zA-Z0-9_-]+$/, {
    message: "`integrationBindingId` must be an integration binding id.",
  });

const ProfileIdSchema = z
  .string()
  .min(1)
  .regex(/^sbp_[a-zA-Z0-9_-]+$/, {
    message: "`profileId` must be a sandbox profile id.",
  });

export const StartSandboxConversationSessionBodySchema = z
  .object({
    profileId: ProfileIdSchema,
    profileVersion: z.coerce.number().int().min(1),
    integrationBindingId: IntegrationBindingIdSchema,
  })
  .strict();

export const ContinueSandboxConversationSessionParamsSchema = z
  .object({
    conversationId: ConversationIdSchema,
  })
  .strict();

export const ContinueSandboxConversationSessionBodySchema = z.object({}).strict();

export const SandboxConversationSessionResponseSchema = z
  .object({
    status: z.literal("accepted"),
    conversationId: ConversationIdSchema,
    routeId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1).nullable(),
  })
  .strict();

const SandboxConversationsBadRequestCodeSchema = z.enum([
  "INTEGRATION_BINDING_PROFILE_MISMATCH",
  "INTEGRATION_BINDING_INVALID",
  "CONVERSATION_OWNER_UNSUPPORTED",
  "AUTOMATION_TARGET_PROFILE_VERSION_MISSING",
]);

const SandboxConversationsNotFoundCodeSchema = z.enum([
  "PROFILE_NOT_FOUND",
  "PROFILE_VERSION_NOT_FOUND",
  "INTEGRATION_BINDING_NOT_FOUND",
  "AUTOMATION_TARGET_NOT_FOUND",
  "CONVERSATION_NOT_FOUND",
  "CONVERSATION_ROUTE_NOT_FOUND",
  "conversation_snapshot_missing",
]);

const SandboxConversationsConflictCodeSchema = z.enum([
  "conversation_closed",
  "conversation_route_closed",
  "conversation_recovery_failed",
]);

export const ValidationErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.looseObject({
      name: z.string().min(1),
      message: z.string().min(1),
    }),
  })
  .strict();

export const SandboxConversationsBadRequestResponseSchema = z.union([
  z
    .object({
      code: SandboxConversationsBadRequestCodeSchema,
      message: z.string().min(1),
    })
    .strict(),
  ValidationErrorResponseSchema,
]);

export const SandboxConversationsNotFoundResponseSchema = z
  .object({
    code: SandboxConversationsNotFoundCodeSchema,
    message: z.string().min(1),
  })
  .strict();

export const SandboxConversationsConflictResponseSchema = z
  .object({
    code: SandboxConversationsConflictCodeSchema,
    message: z.string().min(1),
  })
  .strict();

export const SandboxConversationsUnauthorizedResponseSchema = z
  .object({
    code: z.literal("UNAUTHORIZED"),
    message: z.string().min(1),
  })
  .strict();

export const SandboxConversationsForbiddenResponseSchema = z
  .object({
    code: z.literal("ACTIVE_ORGANIZATION_REQUIRED"),
    message: z.string().min(1),
  })
  .strict();

export const startSandboxConversationSessionRoute = createRoute({
  method: "post",
  path: "/sessions",
  tags: ["Sandbox Conversations"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: StartSandboxConversationSessionBodySchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: "Start a new dashboard conversation session from a profile version.",
      content: {
        "application/json": {
          schema: SandboxConversationSessionResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: SandboxConversationsBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: SandboxConversationsUnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: SandboxConversationsForbiddenResponseSchema,
        },
      },
    },
    404: {
      description: "Required profile or binding resource was not found.",
      content: {
        "application/json": {
          schema: SandboxConversationsNotFoundResponseSchema,
        },
      },
    },
    409: {
      description: "Conversation session could not be started due to state conflict.",
      content: {
        "application/json": {
          schema: SandboxConversationsConflictResponseSchema,
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

export const continueSandboxConversationSessionRoute = createRoute({
  method: "post",
  path: "/{conversationId}/sessions",
  tags: ["Sandbox Conversations"],
  request: {
    params: ContinueSandboxConversationSessionParamsSchema,
    body: {
      required: false,
      content: {
        "application/json": {
          schema: ContinueSandboxConversationSessionBodySchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: "Continue a previously created conversation session by conversation id.",
      content: {
        "application/json": {
          schema: SandboxConversationSessionResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: SandboxConversationsBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: SandboxConversationsUnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: SandboxConversationsForbiddenResponseSchema,
        },
      },
    },
    404: {
      description: "Conversation, route, or restore snapshot was not found.",
      content: {
        "application/json": {
          schema: SandboxConversationsNotFoundResponseSchema,
        },
      },
    },
    409: {
      description: "Conversation session could not continue due to state conflict.",
      content: {
        "application/json": {
          schema: SandboxConversationsConflictResponseSchema,
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
