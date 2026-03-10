import { createRoute, z } from "@hono/zod-openapi";
import { createKeysetPaginationEnvelopeSchema } from "@mistle/http/pagination";

import {
  AutomationWebhooksBadRequestCodes,
  AutomationWebhooksNotFoundCodes,
} from "./services/errors.js";
import { ListWebhookAutomationsQuerySchema } from "./services/list-webhook-automations.js";

export const AutomationWebhookTargetSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1).nullable(),
  })
  .strict();

export const AutomationWebhookSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("webhook"),
    name: z.string().min(1),
    enabled: z.boolean(),
    integrationConnectionId: z.string().min(1),
    eventTypes: z.array(z.string().min(1)).nullable(),
    payloadFilter: z.record(z.string(), z.unknown()).nullable(),
    inputTemplate: z.string().min(1),
    conversationKeyTemplate: z.string().min(1),
    idempotencyKeyTemplate: z.string().min(1).nullable(),
    target: AutomationWebhookTargetSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const CreateAutomationWebhookBodySchema = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean().optional(),
    integrationConnectionId: z.string().min(1),
    eventTypes: z.array(z.string().min(1)).min(1).nullable().optional(),
    payloadFilter: z.record(z.string(), z.unknown()).nullable().optional(),
    inputTemplate: z.string().min(1),
    conversationKeyTemplate: z.string().min(1),
    idempotencyKeyTemplate: z.string().min(1).nullable().optional(),
    target: z
      .object({
        sandboxProfileId: z.string().min(1),
        sandboxProfileVersion: z.number().int().min(1).nullable().optional(),
      })
      .strict(),
  })
  .strict();

export const UpdateAutomationWebhookBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    integrationConnectionId: z.string().min(1).optional(),
    eventTypes: z.array(z.string().min(1)).min(1).nullable().optional(),
    payloadFilter: z.record(z.string(), z.unknown()).nullable().optional(),
    inputTemplate: z.string().min(1).optional(),
    conversationKeyTemplate: z.string().min(1).optional(),
    idempotencyKeyTemplate: z.string().min(1).nullable().optional(),
    target: z
      .object({
        sandboxProfileId: z.string().min(1).optional(),
        sandboxProfileVersion: z.number().int().min(1).nullable().optional(),
      })
      .strict()
      .refine(
        (value) =>
          value.sandboxProfileId !== undefined || value.sandboxProfileVersion !== undefined,
        {
          message: "At least one target field must be provided.",
        },
      )
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.enabled !== undefined ||
      value.integrationConnectionId !== undefined ||
      value.eventTypes !== undefined ||
      value.payloadFilter !== undefined ||
      value.inputTemplate !== undefined ||
      value.conversationKeyTemplate !== undefined ||
      value.idempotencyKeyTemplate !== undefined ||
      value.target !== undefined,
    {
      message: "At least one field must be provided.",
    },
  );

export const AutomationWebhookParamsSchema = z
  .object({
    automationId: z
      .string()
      .min(1)
      .regex(/^atm_[a-zA-Z0-9_-]+$/, {
        message: "`automationId` must be an automation id.",
      }),
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

const BadRequestCodeSchema = z.enum([
  AutomationWebhooksBadRequestCodes.INVALID_LIST_WEBHOOK_AUTOMATIONS_INPUT,
  AutomationWebhooksBadRequestCodes.INVALID_PAGINATION_CURSOR,
  AutomationWebhooksBadRequestCodes.INVALID_CONNECTION_REFERENCE,
  AutomationWebhooksBadRequestCodes.CONNECTION_TARGET_NOT_WEBHOOK_CAPABLE,
  AutomationWebhooksBadRequestCodes.INVALID_SANDBOX_PROFILE_REFERENCE,
]);

export const AutomationWebhooksBadRequestResponseSchema = z
  .object({
    code: BadRequestCodeSchema,
    message: z.string().min(1),
  })
  .strict();

export const ListAutomationWebhooksBadRequestResponseSchema = z.union([
  AutomationWebhooksBadRequestResponseSchema,
  ValidationErrorResponseSchema,
]);

export const CreateAutomationWebhookBadRequestResponseSchema = z.union([
  AutomationWebhooksBadRequestResponseSchema,
  ValidationErrorResponseSchema,
]);

export const UpdateAutomationWebhookBadRequestResponseSchema = z.union([
  AutomationWebhooksBadRequestResponseSchema,
  ValidationErrorResponseSchema,
]);

export const AutomationWebhooksNotFoundResponseSchema = z
  .object({
    code: z.literal(AutomationWebhooksNotFoundCodes.AUTOMATION_NOT_FOUND),
    message: z.string().min(1),
  })
  .strict();

export const AutomationWebhooksUnauthorizedResponseSchema = z
  .object({
    code: z.literal("UNAUTHORIZED"),
    message: z.string().min(1),
  })
  .strict();

export const AutomationWebhooksForbiddenResponseSchema = z
  .object({
    code: z.literal("ACTIVE_ORGANIZATION_REQUIRED"),
    message: z.string().min(1),
  })
  .strict();

export const ListAutomationWebhooksResponseSchema = createKeysetPaginationEnvelopeSchema(
  AutomationWebhookSchema,
  {
    maxLimit: 100,
  },
);

export const DeleteAutomationWebhookResponseSchema = z
  .object({
    status: z.literal("deleted"),
    automationId: z.string().min(1),
  })
  .strict();

export const listAutomationWebhooksRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Automations"],
  request: {
    query: ListWebhookAutomationsQuerySchema,
  },
  responses: {
    200: {
      description: "List webhook automations for the active organization.",
      content: {
        "application/json": {
          schema: ListAutomationWebhooksResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ListAutomationWebhooksBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: AutomationWebhooksUnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: AutomationWebhooksForbiddenResponseSchema,
        },
      },
    },
  },
});

export const createAutomationWebhookRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Automations"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateAutomationWebhookBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Create a webhook automation.",
      content: {
        "application/json": {
          schema: AutomationWebhookSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: CreateAutomationWebhookBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: AutomationWebhooksUnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: AutomationWebhooksForbiddenResponseSchema,
        },
      },
    },
  },
});

export const getAutomationWebhookRoute = createRoute({
  method: "get",
  path: "/{automationId}",
  tags: ["Automations"],
  request: {
    params: AutomationWebhookParamsSchema,
  },
  responses: {
    200: {
      description: "Get a webhook automation.",
      content: {
        "application/json": {
          schema: AutomationWebhookSchema,
        },
      },
    },
    404: {
      description: "Webhook automation was not found.",
      content: {
        "application/json": {
          schema: AutomationWebhooksNotFoundResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: AutomationWebhooksUnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: AutomationWebhooksForbiddenResponseSchema,
        },
      },
    },
  },
});

export const updateAutomationWebhookRoute = createRoute({
  method: "patch",
  path: "/{automationId}",
  tags: ["Automations"],
  request: {
    params: AutomationWebhookParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateAutomationWebhookBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Update a webhook automation.",
      content: {
        "application/json": {
          schema: AutomationWebhookSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: UpdateAutomationWebhookBadRequestResponseSchema,
        },
      },
    },
    404: {
      description: "Webhook automation was not found.",
      content: {
        "application/json": {
          schema: AutomationWebhooksNotFoundResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: AutomationWebhooksUnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: AutomationWebhooksForbiddenResponseSchema,
        },
      },
    },
  },
});

export const deleteAutomationWebhookRoute = createRoute({
  method: "delete",
  path: "/{automationId}",
  tags: ["Automations"],
  request: {
    params: AutomationWebhookParamsSchema,
  },
  responses: {
    200: {
      description: "Delete a webhook automation.",
      content: {
        "application/json": {
          schema: DeleteAutomationWebhookResponseSchema,
        },
      },
    },
    404: {
      description: "Webhook automation was not found.",
      content: {
        "application/json": {
          schema: AutomationWebhooksNotFoundResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: AutomationWebhooksUnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: AutomationWebhooksForbiddenResponseSchema,
        },
      },
    },
  },
});
