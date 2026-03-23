import { z } from "@hono/zod-openapi";
import {
  IntegrationConnectionResourceStatuses,
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";
import { IntegrationResourceSelectionModes } from "@mistle/integrations-core";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsConflictCodes,
  IntegrationConnectionsNotFoundCodes,
} from "./constants.js";

export const IntegrationConnectionStatusSchema = z.enum([
  IntegrationConnectionStatuses.ACTIVE,
  IntegrationConnectionStatuses.ERROR,
  IntegrationConnectionStatuses.REVOKED,
]);

export const IntegrationConnectionResourceSummarySchema = z
  .object({
    kind: z.string().min(1),
    selectionMode: z.enum([
      IntegrationResourceSelectionModes.SINGLE,
      IntegrationResourceSelectionModes.MULTI,
    ]),
    count: z.number().int().min(0),
    syncState: z.enum([
      IntegrationConnectionResourceSyncStates.NEVER_SYNCED,
      IntegrationConnectionResourceSyncStates.SYNCING,
      IntegrationConnectionResourceSyncStates.READY,
      IntegrationConnectionResourceSyncStates.ERROR,
    ]),
    lastSyncedAt: z.string().min(1).optional(),
  })
  .strict();

export const IntegrationConnectionSchema = z
  .object({
    id: z.string().min(1),
    targetKey: z.string().min(1),
    displayName: z.string().min(1),
    status: IntegrationConnectionStatusSchema,
    externalSubjectId: z.string().min(1).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    targetSnapshotConfig: z.record(z.string(), z.unknown()).optional(),
    resources: z.array(IntegrationConnectionResourceSummarySchema).optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const IntegrationConnectionResourceSchema = z
  .object({
    id: z.string().min(1),
    familyId: z.string().min(1),
    kind: z.string().min(1),
    externalId: z.string().min(1).optional(),
    handle: z.string().min(1),
    displayName: z.string().min(1),
    status: z.enum([IntegrationConnectionResourceStatuses.ACCESSIBLE]),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();

export const RedirectLocationHeaderSchema = z
  .object({
    Location: z.string().min(1),
  })
  .strict();

export const IntegrationConnectionsBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_LIST_CONNECTIONS_INPUT,
      IntegrationConnectionsBadRequestCodes.INVALID_PAGINATION_CURSOR,
      IntegrationConnectionsBadRequestCodes.INVALID_LIST_CONNECTION_RESOURCES_INPUT,
      IntegrationConnectionsBadRequestCodes.INVALID_RESOURCE_PAGINATION_CURSOR,
      IntegrationConnectionsBadRequestCodes.RESOURCE_KIND_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
      IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
      IntegrationConnectionsBadRequestCodes.API_KEY_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.API_KEY_CONNECTION_REQUIRED,
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT,
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_COMPLETE_INPUT,
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_HANDLER_NOT_CONFIGURED,
      IntegrationConnectionsBadRequestCodes.INVALID_OAUTH2_START_INPUT,
      IntegrationConnectionsBadRequestCodes.INVALID_OAUTH2_COMPLETE_INPUT,
      IntegrationConnectionsBadRequestCodes.OAUTH2_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.OAUTH2_CAPABILITY_NOT_CONFIGURED,
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_EXPIRED,
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const IntegrationConnectionsNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND,
    IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
  ]),
);

export const IntegrationConnectionsConflictResponseSchema = z
  .object({
    code: z.enum([
      IntegrationConnectionsConflictCodes.RESOURCE_SYNC_REQUIRED,
      IntegrationConnectionsConflictCodes.RESOURCE_SYNC_IN_PROGRESS,
      IntegrationConnectionsConflictCodes.RESOURCE_SYNC_FAILED,
    ]),
    message: z.string().min(1),
    lastErrorCode: z.string().min(1).optional(),
    lastErrorMessage: z.string().min(1).optional(),
  })
  .strict();
