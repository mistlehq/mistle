import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { ApiKeysBadRequestCodes } from "../constants.js";
import { ApiKeyPermissionSchema, ApiKeySchema } from "../schemas.js";

export const CreateApiKeyRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    permissions: z
      .array(ApiKeyPermissionSchema)
      .min(1)
      .max(100)
      .refine((permissions) => new Set(permissions).size === permissions.length, {
        message: "Permissions must be unique.",
      }),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const CreateApiKeyResponseSchema = z
  .object({
    apiKey: ApiKeySchema,
    token: z.string().min(1),
  })
  .strict();

export const CreateApiKeyDomainBadRequestResponseSchema = createCodeMessageErrorSchema(
  z.literal(ApiKeysBadRequestCodes.INVALID_CREATE_API_KEY_INPUT),
);

export const CreateApiKeyBadRequestResponseSchema = z.union([
  CreateApiKeyDomainBadRequestResponseSchema,
  ValidationErrorResponseSchema,
]);
