import { z } from "@hono/zod-openapi";
import {
  IntegrationConnectionResourceStatuses,
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
  IntegrationDeviceAuthorizationAttemptStatuses,
  IntegrationWebhookSourceStatuses,
} from "@mistle/db/control-plane";
import { IntegrationResourceSelectionModes } from "@mistle/integrations-core";

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
    bindingCount: z.number().int().min(0).optional(),
    automationCount: z.number().int().min(0).optional(),
    isIdentityLinked: z.boolean().optional(),
    externalSubjectId: z.string().min(1).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    targetSnapshotConfig: z.record(z.string(), z.unknown()).optional(),
    connectionMethodId: z.string().min(1).optional(),
    connectionMethodLabel: z.string().min(1).optional(),
    resources: z.array(IntegrationConnectionResourceSummarySchema).optional(),
    supportsWebhookSources: z.boolean().optional(),
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

export const IntegrationWebhookSourceStatusSchema = z.enum([
  IntegrationWebhookSourceStatuses.ACTIVE,
  IntegrationWebhookSourceStatuses.ERROR,
  IntegrationWebhookSourceStatuses.DISABLED,
]);

export const IntegrationWebhookSourceSchema = z
  .object({
    id: z.string().min(1),
    targetKey: z.string().min(1),
    integrationConnectionId: z.string().min(1),
    displayName: z.string().min(1),
    endpointKey: z.string().min(1),
    callbackUrl: z.string().min(1).optional(),
    remoteRegistrationId: z.string().min(1).optional(),
    status: IntegrationWebhookSourceStatusSchema,
    providerMetadata: z.record(z.string(), z.unknown()),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const CreatedIntegrationWebhookSourceSchema = IntegrationWebhookSourceSchema.extend({
  webhookSecret: z.string().min(1).optional(),
}).strict();

export const IntegrationDeviceAuthorizationAttemptStatusSchema = z.enum([
  IntegrationDeviceAuthorizationAttemptStatuses.PENDING,
  IntegrationDeviceAuthorizationAttemptStatuses.COMPLETED,
  IntegrationDeviceAuthorizationAttemptStatuses.FAILED,
  IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED,
]);

export const IntegrationDeviceAuthorizationAttemptErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export const PendingIntegrationDeviceAuthorizationAttemptSchema = z
  .object({
    attemptId: z.string().min(1),
    status: z.literal(IntegrationDeviceAuthorizationAttemptStatuses.PENDING),
    verificationUrl: z.url(),
    userCode: z.string().min(1),
    expiresAt: z.string().min(1).optional(),
    pollAfterMs: z.number().int().min(0).optional(),
  })
  .strict();

export const CompletedIntegrationDeviceAuthorizationAttemptSchema = z
  .object({
    attemptId: z.string().min(1),
    status: z.literal(IntegrationDeviceAuthorizationAttemptStatuses.COMPLETED),
    connectionId: z.string().min(1),
  })
  .strict();

export const FailedIntegrationDeviceAuthorizationAttemptSchema = z
  .object({
    attemptId: z.string().min(1),
    status: z.literal(IntegrationDeviceAuthorizationAttemptStatuses.FAILED),
    error: IntegrationDeviceAuthorizationAttemptErrorSchema,
  })
  .strict();

export const CancelledIntegrationDeviceAuthorizationAttemptSchema = z
  .object({
    attemptId: z.string().min(1),
    status: z.literal(IntegrationDeviceAuthorizationAttemptStatuses.CANCELLED),
  })
  .strict();

export const IntegrationDeviceAuthorizationAttemptSchema = z.discriminatedUnion("status", [
  PendingIntegrationDeviceAuthorizationAttemptSchema,
  CompletedIntegrationDeviceAuthorizationAttemptSchema,
  FailedIntegrationDeviceAuthorizationAttemptSchema,
  CancelledIntegrationDeviceAuthorizationAttemptSchema,
]);

export const RedirectLocationHeaderSchema = z
  .object({
    Location: z.string().min(1),
  })
  .strict();
