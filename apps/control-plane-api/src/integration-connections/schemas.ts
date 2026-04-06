import { z } from "@hono/zod-openapi";
import {
  IntegrationConnectionResourceStatuses,
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
  IntegrationWebhookSourceOwnerScopes,
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

export const IntegrationWebhookSourceOwnerScopeSchema = z.enum([
  IntegrationWebhookSourceOwnerScopes.TARGET,
  IntegrationWebhookSourceOwnerScopes.CONNECTION,
]);

export const IntegrationWebhookSourceStatusSchema = z.enum([
  IntegrationWebhookSourceStatuses.ACTIVE,
  IntegrationWebhookSourceStatuses.ERROR,
  IntegrationWebhookSourceStatuses.DISABLED,
]);

export const IntegrationWebhookSourceSchema = z
  .object({
    id: z.string().min(1),
    targetKey: z.string().min(1),
    ownerScope: IntegrationWebhookSourceOwnerScopeSchema,
    integrationConnectionId: z.string().min(1).optional(),
    displayName: z.string().min(1),
    endpointKey: z.string().min(1).optional(),
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

export const RedirectLocationHeaderSchema = z
  .object({
    Location: z.string().min(1),
  })
  .strict();
