import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

import { INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH } from "../internal-sandbox-instances/constants.js";
import type { AppContextBindings } from "../types.js";
import { DATA_PLANE_INTERNAL_OPENAPI_INFO } from "./constants.js";

const InternalSandboxInstancesErrorResponseSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

const InternalSandboxInstancesValidationErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.looseObject({
      name: z.string().min(1),
      message: z.string().min(1),
    }),
  })
  .strict();

const InternalSandboxInstancesBadRequestResponseSchema = z.union([
  InternalSandboxInstancesErrorResponseSchema,
  InternalSandboxInstancesValidationErrorResponseSchema,
]);

const StartSandboxInstanceRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    idempotencyKey: z.string().min(1).max(255).optional(),
    runtimePlan: z.record(z.string(), z.unknown()),
    startedBy: z
      .object({
        kind: z.union([z.literal("user"), z.literal("system")]),
        id: z.string().min(1),
      })
      .strict(),
    source: z.union([z.literal("dashboard"), z.literal("webhook")]),
    image: z
      .object({
        imageId: z.string().min(1),
        createdAt: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const StartSandboxInstanceResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

const GetSandboxInstanceRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    instanceId: z.string().min(1),
  })
  .strict();

const GetSandboxInstanceResponseSchema = z
  .object({
    id: z.string().min(1),
    status: z.union([
      z.literal("starting"),
      z.literal("running"),
      z.literal("stopped"),
      z.literal("failed"),
    ]),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
  })
  .strict()
  .nullable();

const ListSandboxInstancesRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    limit: z.number().int().min(1).max(100).optional(),
    after: z.string().min(1).optional(),
    before: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => !(value.after !== undefined && value.before !== undefined), {
    message: "Only one of `after` or `before` can be provided.",
  });

const ListSandboxInstancesItemSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    status: z.union([
      z.literal("starting"),
      z.literal("running"),
      z.literal("stopped"),
      z.literal("failed"),
    ]),
    startedBy: z
      .object({
        kind: z.union([z.literal("user"), z.literal("system")]),
        id: z.string().min(1),
      })
      .strict(),
    source: z.union([z.literal("dashboard"), z.literal("webhook")]),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
  })
  .strict();

const ListSandboxInstancesPageCursorSchema = z
  .object({
    after: z.string().min(1),
    limit: z.number().int().min(1).max(100),
  })
  .strict();

const ListSandboxInstancesResponseSchema = z
  .object({
    totalResults: z.number().int().nonnegative(),
    items: z.array(ListSandboxInstancesItemSchema),
    nextPage: ListSandboxInstancesPageCursorSchema.nullable(),
    previousPage: ListSandboxInstancesPageCursorSchema.nullable(),
  })
  .strict();

const StartSandboxInstanceRoute = createRoute({
  method: "post",
  path: `${INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH}/start`,
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: StartSandboxInstanceRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Queue sandbox instance startup for internal callers.",
      content: {
        "application/json": {
          schema: StartSandboxInstanceResponseSchema,
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

const GetSandboxInstanceRoute = createRoute({
  method: "post",
  path: `${INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH}/get`,
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: GetSandboxInstanceRequestSchema,
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

const ListSandboxInstancesRoute = createRoute({
  method: "post",
  path: `${INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH}/list`,
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ListSandboxInstancesRequestSchema,
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

export function createDataPlaneInternalOpenApiDocument(): ReturnType<
  OpenAPIHono<AppContextBindings>["getOpenAPI31Document"]
> {
  const app = new OpenAPIHono<AppContextBindings>();

  app.openapi(StartSandboxInstanceRoute, () => {
    throw new Error("OpenAPI route is documentation-only.");
  });
  app.openapi(GetSandboxInstanceRoute, () => {
    throw new Error("OpenAPI route is documentation-only.");
  });
  app.openapi(ListSandboxInstancesRoute, () => {
    throw new Error("OpenAPI route is documentation-only.");
  });

  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: DATA_PLANE_INTERNAL_OPENAPI_INFO,
  });
}
