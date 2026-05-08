import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  getSandboxProfileVersionDraftAutomationImpactResponseSchema,
  sandboxProfileVersionParamsSchema,
} from "../schemas.js";
import { notFoundResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/{profileId}/versions/{version}/draft-automation-impact",
  tags: ["Sandbox Profiles"],
  request: {
    params: sandboxProfileVersionParamsSchema,
  },
  responses: {
    200: {
      description:
        "Evaluate whether the specified sandbox profile draft version would break automations that currently use the profile.",
      content: {
        "application/json": {
          schema: getSandboxProfileVersionDraftAutomationImpactResponseSchema,
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
      description: "Sandbox profile or version was not found.",
      content: {
        "application/json": {
          schema: notFoundResponseSchema,
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
