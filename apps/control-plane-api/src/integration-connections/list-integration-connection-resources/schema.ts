import { z } from "@hono/zod-openapi";
import { IntegrationConnectionResourceSyncStates } from "@mistle/db/control-plane";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";
import { createKeysetPageSizeSchema } from "@mistle/http/pagination";

import { IntegrationConnectionsBadRequestCodes } from "../constants.js";
import {
  IntegrationConnectionResourceSchema,
  IntegrationConnectionsConflictResponseSchema,
} from "../schemas.js";

export const ListIntegrationConnectionResourcesParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const ListIntegrationConnectionResourcesQuerySchema = z
  .object({
    kind: z.string().min(1),
    search: z.string().min(1).optional(),
    limit: z.preprocess(
      (rawValue) => {
        if (rawValue === undefined) {
          return undefined;
        }

        if (typeof rawValue === "number") {
          return rawValue;
        }

        if (typeof rawValue === "string") {
          return Number(rawValue);
        }

        return rawValue;
      },
      createKeysetPageSizeSchema({ defaultLimit: 20, maxLimit: 100 }),
    ),
    after: z.string().min(1).optional(),
    before: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => !(value.after !== undefined && value.before !== undefined), {
    message: "Only one of `after` or `before` can be provided.",
  });

export const ListIntegrationConnectionResourcesResponseSchema = z
  .object({
    connectionId: z.string().min(1),
    familyId: z.string().min(1),
    kind: z.string().min(1),
    syncState: z.enum([
      IntegrationConnectionResourceSyncStates.NEVER_SYNCED,
      IntegrationConnectionResourceSyncStates.SYNCING,
      IntegrationConnectionResourceSyncStates.READY,
      IntegrationConnectionResourceSyncStates.ERROR,
    ]),
    lastSyncedAt: z.string().min(1).optional(),
    lastErrorCode: z.string().min(1).optional(),
    lastErrorMessage: z.string().min(1).optional(),
    items: z.array(IntegrationConnectionResourceSchema),
    page: z
      .object({
        totalResults: z.number().int().nonnegative(),
        nextCursor: z.string().min(1).nullable(),
        previousCursor: z.string().min(1).nullable(),
      })
      .strict(),
  })
  .strict();

export const ListIntegrationConnectionResourcesBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_LIST_CONNECTION_RESOURCES_INPUT,
      IntegrationConnectionsBadRequestCodes.INVALID_RESOURCE_PAGINATION_CURSOR,
      IntegrationConnectionsBadRequestCodes.RESOURCE_KIND_NOT_SUPPORTED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export { IntegrationConnectionsConflictResponseSchema };
