import { createRoute, z } from "@hono/zod-openapi";
import {
  createKeysetPaginationEnvelopeSchema,
  createKeysetPaginationQuerySchema,
} from "@mistle/http/pagination";

import { IntegrationTargetsBadRequestCodes } from "./services/errors.js";

const OpenAiReasoningSchema = z.enum(["low", "medium", "high", "xhigh"]);
const OpenAiAuthSchemeSchema = z.enum(["api-key", "oauth"]);
const OpenAiBindingUiSchema = z
  .object({
    kind: z.literal("agent"),
    runtime: z.literal("codex-cli"),
    familyId: z.literal("openai"),
    variantId: z.literal("openai-default"),
    byAuthScheme: z.record(
      OpenAiAuthSchemeSchema,
      z
        .object({
          models: z.array(z.string().min(1)),
          allowedReasoningByModel: z.record(
            z.string().min(1),
            z.array(OpenAiReasoningSchema).min(1),
          ),
          defaultReasoningByModel: z.record(z.string().min(1), OpenAiReasoningSchema),
          reasoningLabels: z.record(OpenAiReasoningSchema, z.string().min(1)),
        })
        .strict(),
    ),
  })
  .strict();

export const IntegrationTargetSchema = z
  .object({
    targetKey: z.string().min(1),
    familyId: z.string().min(1),
    variantId: z.string().min(1),
    enabled: z.boolean(),
    config: z.record(z.string(), z.unknown()),
    displayName: z.string().min(1),
    description: z.string().min(1),
    displayNameOverride: z.string().min(1).optional(),
    descriptionOverride: z.string().min(1).optional(),
    targetHealth: z
      .object({
        configStatus: z.enum(["valid", "invalid"]),
      })
      .strict(),
    resolvedBindingUi: z
      .object({
        openaiAgent: OpenAiBindingUiSchema.optional(),
      })
      .strict()
      .optional(),
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
  IntegrationTargetsBadRequestCodes.INVALID_LIST_TARGETS_INPUT,
  IntegrationTargetsBadRequestCodes.INVALID_PAGINATION_CURSOR,
]);

export const IntegrationTargetsBadRequestResponseSchema = z
  .object({
    code: BadRequestCodeSchema,
    message: z.string().min(1),
  })
  .strict();

export const ListIntegrationTargetsBadRequestResponseSchema = z.union([
  IntegrationTargetsBadRequestResponseSchema,
  ValidationErrorResponseSchema,
]);

export const ListIntegrationTargetsQuerySchema = createKeysetPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
});

export const ListIntegrationTargetsResponseSchema = createKeysetPaginationEnvelopeSchema(
  IntegrationTargetSchema,
  {
    maxLimit: 100,
  },
);

export const IntegrationTargetsUnauthorizedResponseSchema = z
  .object({
    code: z.literal("UNAUTHORIZED"),
    message: z.string().min(1),
  })
  .strict();

export const IntegrationTargetsForbiddenResponseSchema = z
  .object({
    code: z.literal("ACTIVE_ORGANIZATION_REQUIRED"),
    message: z.string().min(1),
  })
  .strict();

export const listIntegrationTargetsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Integrations"],
  request: {
    query: ListIntegrationTargetsQuerySchema,
  },
  responses: {
    200: {
      description: "List effective integration targets from control-plane storage.",
      content: {
        "application/json": {
          schema: ListIntegrationTargetsResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ListIntegrationTargetsBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: IntegrationTargetsUnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: IntegrationTargetsForbiddenResponseSchema,
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
