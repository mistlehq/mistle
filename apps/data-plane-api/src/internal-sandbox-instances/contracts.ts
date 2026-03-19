import { createRoute, z } from "@hono/zod-openapi";
import { createKeysetPaginationEnvelopeSchema } from "@mistle/http/pagination";
import { CompiledRuntimePlanSchema } from "@mistle/integrations-core";

const DataPlaneSandboxInstanceStarterKinds = {
  USER: "user",
  SYSTEM: "system",
} as const;

const DataPlaneSandboxInstanceSources = {
  DASHBOARD: "dashboard",
  WEBHOOK: "webhook",
} as const;

export const DataPlaneSandboxInstanceStatuses = {
  STARTING: "starting",
  RUNNING: "running",
  STOPPED: "stopped",
  FAILED: "failed",
} as const;

export const DataPlaneSandboxConnectStatuses = {
  PENDING: "pending",
  READY: "ready",
  FAILED: "failed",
  NOT_RESUMABLE: "not_resumable",
} as const;

const DefaultListSandboxInstancesLimit = 20;
const MaxListSandboxInstancesLimit = 100;

const StartSandboxInstanceImageSchema = z
  .object({
    imageId: z.string().min(1),
    createdAt: z.string().min(1),
  })
  .strict();

export const StartSandboxInstanceInputValidationSchema = z
  .object({
    organizationId: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    idempotencyKey: z.string().min(1).max(255).optional(),
    runtimePlan: CompiledRuntimePlanSchema,
    startedBy: z
      .object({
        kind: z.enum(DataPlaneSandboxInstanceStarterKinds),
        id: z.string().min(1),
      })
      .strict(),
    source: z.enum(DataPlaneSandboxInstanceSources),
    image: StartSandboxInstanceImageSchema,
  })
  .strict();

export const StartSandboxInstanceAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

export const ResumeSandboxInstanceInputValidationSchema = z
  .object({
    organizationId: z.string().min(1),
    instanceId: z.string().min(1),
    idempotencyKey: z.string().min(1).max(255).optional(),
  })
  .strict();

export const ResumeSandboxInstanceAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

export const ConnectSandboxInstanceInputValidationSchema = z
  .object({
    organizationId: z.string().min(1),
    instanceId: z.string().min(1),
    idempotencyKey: z.string().min(1).max(255).optional(),
  })
  .strict();

export const GetSandboxConnectStatusInputSchema = z
  .object({
    organizationId: z.string().min(1),
    instanceId: z.string().min(1),
  })
  .strict();

export const SandboxConnectStatusResponseSchema = z
  .object({
    instanceId: z.string().min(1),
    status: z.enum(DataPlaneSandboxConnectStatuses),
    code: z.string().min(1).nullable(),
    message: z.string().min(1).nullable(),
  })
  .strict()
  .nullable();

export const GetSandboxInstanceInputSchema = z
  .object({
    organizationId: z.string().min(1),
    instanceId: z.string().min(1),
  })
  .strict();

export const GetSandboxInstanceResponseSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(DataPlaneSandboxInstanceStatuses),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
  })
  .strict()
  .nullable();

export const ListSandboxInstancesInputSchema = z
  .object({
    organizationId: z.string().min(1),
    limit: z.number().int().min(1).max(MaxListSandboxInstancesLimit).optional(),
    after: z.string().min(1).optional(),
    before: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => !(value.after !== undefined && value.before !== undefined), {
    message: "Only one of `after` or `before` can be provided.",
  });

const SandboxInstanceStartedBySchema = z
  .object({
    kind: z.enum(DataPlaneSandboxInstanceStarterKinds),
    id: z.string().min(1),
  })
  .strict();

export const SandboxInstanceListItemSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    status: z.enum(DataPlaneSandboxInstanceStatuses),
    startedBy: SandboxInstanceStartedBySchema,
    source: z.enum(DataPlaneSandboxInstanceSources),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
  })
  .strict();

export const ListSandboxInstancesResponseSchema = createKeysetPaginationEnvelopeSchema(
  SandboxInstanceListItemSchema,
  {
    defaultLimit: DefaultListSandboxInstancesLimit,
    maxLimit: MaxListSandboxInstancesLimit,
  },
);

export const InternalSandboxInstancesErrorResponseSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export const InternalSandboxInstancesValidationErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.looseObject({
      name: z.string().min(1),
      message: z.string().min(1),
    }),
  })
  .strict();

export const InternalSandboxInstancesBadRequestResponseSchema = z.union([
  InternalSandboxInstancesErrorResponseSchema,
  InternalSandboxInstancesValidationErrorResponseSchema,
]);

export const internalStartSandboxInstanceRoute = createRoute({
  method: "post",
  path: "/start",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: StartSandboxInstanceInputValidationSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Queue sandbox instance startup for internal callers.",
      content: {
        "application/json": {
          schema: StartSandboxInstanceAcceptedResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request body.",
      content: {
        "application/json": {
          schema: InternalSandboxInstancesBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: InternalSandboxInstancesErrorResponseSchema,
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

export const internalGetSandboxInstanceRoute = createRoute({
  method: "post",
  path: "/get",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: GetSandboxInstanceInputSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Get sandbox instance status for internal callers.",
      content: {
        "application/json": {
          schema: GetSandboxInstanceResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request body.",
      content: {
        "application/json": {
          schema: InternalSandboxInstancesBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: InternalSandboxInstancesErrorResponseSchema,
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

export const internalResumeSandboxInstanceRoute = createRoute({
  method: "post",
  path: "/resume",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ResumeSandboxInstanceInputValidationSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Queue sandbox instance resume for internal callers.",
      content: {
        "application/json": {
          schema: ResumeSandboxInstanceAcceptedResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request body.",
      content: {
        "application/json": {
          schema: InternalSandboxInstancesBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: InternalSandboxInstancesErrorResponseSchema,
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

export const internalConnectSandboxInstanceRoute = createRoute({
  method: "post",
  path: "/connect",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ConnectSandboxInstanceInputValidationSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Ensure sandbox connect recovery is in progress for internal callers.",
      content: {
        "application/json": {
          schema: SandboxConnectStatusResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request body.",
      content: {
        "application/json": {
          schema: InternalSandboxInstancesBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: InternalSandboxInstancesErrorResponseSchema,
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

export const internalGetSandboxConnectStatusRoute = createRoute({
  method: "post",
  path: "/connect-status",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: GetSandboxConnectStatusInputSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Get sandbox connect status for internal callers.",
      content: {
        "application/json": {
          schema: SandboxConnectStatusResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request body.",
      content: {
        "application/json": {
          schema: InternalSandboxInstancesBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: InternalSandboxInstancesErrorResponseSchema,
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

export const internalListSandboxInstancesRoute = createRoute({
  method: "post",
  path: "/list",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ListSandboxInstancesInputSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "List sandbox instances for internal callers.",
      content: {
        "application/json": {
          schema: ListSandboxInstancesResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request body.",
      content: {
        "application/json": {
          schema: InternalSandboxInstancesBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: InternalSandboxInstancesErrorResponseSchema,
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

export type StartSandboxInstanceInput = z.infer<typeof StartSandboxInstanceInputValidationSchema>;
export type StartSandboxInstanceAcceptedResponse = z.infer<
  typeof StartSandboxInstanceAcceptedResponseSchema
>;
export type ResumeSandboxInstanceInput = z.infer<typeof ResumeSandboxInstanceInputValidationSchema>;
export type ResumeSandboxInstanceAcceptedResponse = z.infer<
  typeof ResumeSandboxInstanceAcceptedResponseSchema
>;
export type GetSandboxInstanceInput = z.infer<typeof GetSandboxInstanceInputSchema>;
export type GetSandboxInstanceResponse = z.infer<typeof GetSandboxInstanceResponseSchema>;
export type ListSandboxInstancesInput = z.infer<typeof ListSandboxInstancesInputSchema>;
export type ListSandboxInstancesResponse = z.infer<typeof ListSandboxInstancesResponseSchema>;
