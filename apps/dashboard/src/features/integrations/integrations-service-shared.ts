import { z } from "zod";

import { normalizeHttpApiError } from "../api/http-api-error.js";

export const KeysetPageSchema = z
  .object({
    after: z.string().min(1),
    limit: z.number().int().min(1),
  })
  .strict();

const IntegrationConnectionMethodCreateUiSchema = z
  .object({
    submitLabel: z.string().min(1),
    helperText: z.string().min(1),
  })
  .strict();

const IntegrationDeviceAuthorizationConnectionMethodCreateUiSchema = z
  .object({
    submitLabel: z.string().min(1),
  })
  .strict();

const IntegrationConnectionMethodPendingUiSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
  })
  .strict();

const IntegrationSetupConnectionExternalSubjectRequirementSchema = z
  .object({
    kind: z.literal("connection-external-subject"),
  })
  .strict();

const IntegrationSetupConfigFieldRequirementSchema = z
  .object({
    kind: z.literal("config-field"),
    field: z.string().min(1),
  })
  .strict();

const IntegrationSetupSecretFieldRequirementSchema = z
  .object({
    kind: z.literal("secret-field"),
    field: z.string().min(1),
  })
  .strict();

const IntegrationSetupCompletionRequirementLeafSchema = z.discriminatedUnion("kind", [
  IntegrationSetupConnectionExternalSubjectRequirementSchema,
  IntegrationSetupConfigFieldRequirementSchema,
  IntegrationSetupSecretFieldRequirementSchema,
]);

const IntegrationSetupCompletionRequirementSchema = z.discriminatedUnion("kind", [
  IntegrationSetupConnectionExternalSubjectRequirementSchema,
  IntegrationSetupConfigFieldRequirementSchema,
  IntegrationSetupSecretFieldRequirementSchema,
  z
    .object({
      kind: z.literal("any-of"),
      anyOf: z.array(IntegrationSetupCompletionRequirementLeafSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("all-of"),
      allOf: z.array(IntegrationSetupCompletionRequirementLeafSchema).min(1),
    })
    .strict(),
]);

const IntegrationWebhookTriggerRequirementsSchema = z
  .object({
    anyOf: z
      .array(
        z
          .object({
            event: z.string().min(1).optional(),
            permissions: z
              .array(
                z
                  .object({
                    permission: z.string().min(1),
                    access: z.string().min(1).optional(),
                  })
                  .strict(),
              )
              .optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const IntegrationTargetSchema = z
  .object({
    targetKey: z.string().min(1),
    familyId: z.string().min(1),
    variantId: z.string().min(1),
    enabled: z.boolean(),
    config: z.unknown(),
    displayName: z.string().min(1),
    description: z.string().min(1),
    logoKey: z.string().min(1).optional(),
    connectionMethods: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              id: z.string().min(1),
              label: z.string().min(1),
              kind: z.literal("form"),
              createBehavior: z.enum(["single-step", "draft-then-setup"]).optional(),
              setupFlow: z
                .object({
                  completionRequirements: IntegrationSetupCompletionRequirementSchema.optional(),
                  routeSegment: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
                })
                .strict()
                .optional(),
              secretFields: z
                .array(
                  z
                    .object({
                      name: z.string().min(1),
                      label: z.string().min(1),
                      placeholder: z.string().min(1).optional(),
                      description: z.string().min(1).optional(),
                      optional: z.boolean().optional(),
                      inputType: z.enum(["password", "text", "textarea"]),
                      slotKey: z.string().min(1).optional(),
                    })
                    .strict(),
                )
                .min(1),
            })
            .strict(),
          z
            .object({
              id: z.string().min(1),
              label: z.string().min(1),
              kind: z.literal("redirect"),
              ui: z
                .object({
                  create: IntegrationConnectionMethodCreateUiSchema,
                })
                .strict(),
            })
            .strict(),
          z
            .object({
              id: z.string().min(1),
              label: z.string().min(1),
              kind: z.literal("device-authorization"),
              ui: z
                .object({
                  create: IntegrationDeviceAuthorizationConnectionMethodCreateUiSchema,
                  pending: IntegrationConnectionMethodPendingUiSchema.optional(),
                })
                .strict(),
            })
            .strict(),
        ]),
      )
      .min(1)
      .optional(),
    webhookSource: z
      .object({
        lifecycle: z.enum(["implicit", "managed"]),
        requiresSourceSelection: z.boolean(),
      })
      .strict()
      .optional(),
    supportedWebhookEvents: z
      .array(
        z
          .object({
            eventType: z.string().min(1),
            providerEventType: z.string().min(1),
            displayName: z.string().min(1),
            category: z.string().min(1).optional(),
            requirements: IntegrationWebhookTriggerRequirementsSchema.optional(),
            payloadReferences: z
              .array(
                z
                  .object({
                    path: z.array(z.string().min(1)).min(1),
                    description: z.string().min(1),
                  })
                  .strict(),
              )
              .optional(),
            conversationKeyOptions: z
              .array(
                z
                  .object({
                    id: z.string().min(1),
                    label: z.string().min(1),
                    description: z.string().min(1),
                    template: z.string().min(1),
                  })
                  .strict(),
              )
              .optional(),
            parameters: z
              .array(
                z.union([
                  z
                    .object({
                      id: z.string().min(1),
                      label: z.string().min(1),
                      kind: z.literal("resource-select"),
                      resourceKind: z.string().min(1),
                      payloadPath: z.array(z.string().min(1)).min(1),
                      prefix: z.string().min(1).optional(),
                      placeholder: z.string().min(1).optional(),
                    })
                    .strict(),
                  z
                    .object({
                      id: z.string().min(1),
                      label: z.string().min(1),
                      kind: z.literal("string"),
                      payloadPath: z.array(z.string().min(1)).min(1),
                      matchMode: z.enum(["eq", "contains", "contains_token"]).optional(),
                      defaultValue: z.string().min(1).optional(),
                      defaultEnabled: z.boolean().optional(),
                      controlVariant: z.enum(["invocation-token"]).optional(),
                      prefix: z.string().min(1).optional(),
                      placeholder: z.string().min(1).optional(),
                    })
                    .strict(),
                  z
                    .object({
                      id: z.string().min(1),
                      label: z.string().min(1),
                      kind: z.literal("enum-select"),
                      payloadPath: z.array(z.string().min(1)).min(1),
                      matchMode: z.enum(["eq", "exists"]),
                      options: z
                        .array(
                          z
                            .object({
                              value: z.string().min(1),
                              label: z.string().min(1),
                            })
                            .strict(),
                        )
                        .min(1),
                      prefix: z.string().min(1).optional(),
                      placeholder: z.string().min(1).optional(),
                    })
                    .strict(),
                ]),
              )
              .optional(),
          })
          .strict(),
      )
      .optional(),
    displayNameOverride: z.string().min(1).optional(),
    descriptionOverride: z.string().min(1).optional(),
    targetHealth: z
      .object({
        configStatus: z.enum(["valid", "invalid"]),
      })
      .strict(),
  })
  .strict();

export const IntegrationConnectionSchema = z
  .object({
    id: z.string().min(1),
    targetKey: z.string().min(1),
    displayName: z.string().min(1),
    status: z.enum(["active", "error", "revoked"]),
    bindingCount: z.number().int().min(0).optional(),
    automationCount: z.number().int().min(0).optional(),
    isIdentityLinked: z.boolean().optional(),
    externalSubjectId: z.string().min(1).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    targetSnapshotConfig: z.record(z.string(), z.unknown()).optional(),
    connectionMethodId: z.string().min(1).optional(),
    connectionMethodLabel: z.string().min(1).optional(),
    configuredSecretNames: z.array(z.string().min(1)).optional(),
    resources: z
      .array(
        z
          .object({
            kind: z.string().min(1),
            selectionMode: z.enum(["single", "multi"]),
            count: z.number().int().min(0),
            syncState: z.enum(["never-synced", "syncing", "ready", "error"]),
            lastSyncedAt: z.string().min(1).optional(),
            lastErrorMessage: z.string().min(1).optional(),
          })
          .strict(),
      )
      .optional(),
    supportsWebhookSources: z.boolean().optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const ManagedWebhookSetupResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("created"),
      webhookSourceId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      status: z.literal("failed"),
      message: z.string().min(1),
    })
    .strict(),
]);
export type ManagedWebhookSetupResult = z.output<typeof ManagedWebhookSetupResultSchema>;

export const CreatedFormIntegrationConnectionSchema = IntegrationConnectionSchema.extend({
  managedWebhookSetup: ManagedWebhookSetupResultSchema.optional(),
}).strict();

export type CreatedFormIntegrationConnection = z.output<
  typeof CreatedFormIntegrationConnectionSchema
>;

export const IntegrationConnectionResourceSchema = z
  .object({
    id: z.string().min(1),
    familyId: z.string().min(1),
    kind: z.string().min(1),
    externalId: z.string().min(1).optional(),
    handle: z.string().min(1),
    displayName: z.string().min(1),
    status: z.literal("accessible"),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();

export const IntegrationConnectionResourcesPageSchema = z
  .object({
    connectionId: z.string().min(1),
    familyId: z.string().min(1),
    kind: z.string().min(1),
    syncState: z.enum(["never-synced", "syncing", "ready", "error"]),
    lastSyncedAt: z.string().min(1).optional(),
    lastErrorCode: z.string().min(1).optional(),
    lastErrorMessage: z.string().min(1).optional(),
    items: z.array(IntegrationConnectionResourceSchema),
    page: z
      .object({
        totalResults: z.number().int().min(0),
        nextCursor: z.string().min(1).nullable(),
        previousCursor: z.string().min(1).nullable(),
      })
      .strict(),
  })
  .strict();

export const RefreshedIntegrationConnectionResourcesSchema = z
  .object({
    connectionId: z.string().min(1),
    familyId: z.string().min(1),
    kind: z.string().min(1),
    syncState: z.literal("syncing"),
  })
  .strict();

export const RefreshedAllIntegrationConnectionResourcesSchema = z
  .object({
    connectionId: z.string().min(1),
    familyId: z.string().min(1),
    resources: z.array(
      z
        .object({
          kind: z.string().min(1),
          syncState: z.literal("syncing"),
        })
        .strict(),
    ),
  })
  .strict();

export const IntegrationWebhookSourceSchema = z
  .object({
    id: z.string().min(1),
    targetKey: z.string().min(1),
    integrationConnectionId: z.string().min(1),
    displayName: z.string().min(1),
    endpointKey: z.string().min(1),
    callbackUrl: z.string().min(1).optional(),
    remoteRegistrationId: z.string().min(1).optional(),
    status: z.enum(["active", "error", "disabled"]),
    providerMetadata: z.record(z.string(), z.unknown()),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const CreatedIntegrationWebhookSourceSchema = IntegrationWebhookSourceSchema.extend({
  webhookSecret: z.string().min(1).optional(),
}).strict();

export const IntegrationTargetsPageSchema = z
  .object({
    items: z.array(IntegrationTargetSchema),
    nextPage: KeysetPageSchema.nullable(),
    previousPage: z
      .object({
        before: z.string().min(1),
        limit: z.number().int().min(1),
      })
      .strict()
      .nullable(),
    totalResults: z.number().int().min(0),
  })
  .strict();

export const IntegrationConnectionsPageSchema = z
  .object({
    items: z.array(IntegrationConnectionSchema),
    nextPage: KeysetPageSchema.nullable(),
    previousPage: z
      .object({
        before: z.string().min(1),
        limit: z.number().int().min(1),
      })
      .strict()
      .nullable(),
    totalResults: z.number().int().min(0),
  })
  .strict();

export const StartedRedirectConnectionSchema = z
  .object({
    authorizationUrl: z.url(),
  })
  .strict();

export const StartedGitHubAppManifestConnectionSchema = z
  .object({
    submissionUrl: z.url(),
    fields: z
      .object({
        manifest: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const StartedProviderAppSetupSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("form-post"),
      submissionUrl: z.url(),
      fields: z.record(z.string(), z.string()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("redirect"),
      authorizationUrl: z.url(),
    })
    .strict(),
]);

export const StartedDeviceAuthorizationConnectionSchema = z
  .object({
    attemptId: z.string().min(1),
    status: z.literal("pending"),
    verificationUrl: z.url(),
    userCode: z.string().min(1),
    expiresAt: z.string().min(1).optional(),
    pollAfterMs: z.number().int().min(0).optional(),
  })
  .strict();

export const DeviceAuthorizationAttemptResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      attemptId: z.string().min(1),
      status: z.literal("pending"),
      verificationUrl: z.url(),
      userCode: z.string().min(1),
      expiresAt: z.string().min(1).optional(),
      pollAfterMs: z.number().int().min(0).optional(),
    })
    .strict(),
  z
    .object({
      attemptId: z.string().min(1),
      status: z.literal("completed"),
      connectionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      attemptId: z.string().min(1),
      status: z.literal("failed"),
      error: z
        .object({
          code: z.string().min(1),
          message: z.string().min(1),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      attemptId: z.string().min(1),
      status: z.literal("cancelled"),
    })
    .strict(),
]);

export const DeletedIntegrationConnectionSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export type IntegrationTarget = z.infer<typeof IntegrationTargetSchema>;
export type IntegrationConnectionMethod = NonNullable<
  IntegrationTarget["connectionMethods"]
>[number];
export type IntegrationConnection = z.infer<typeof IntegrationConnectionSchema>;
export type IntegrationConnectionResourceSummary = NonNullable<
  IntegrationConnection["resources"]
>[number];
export type IntegrationConnectionResource = z.infer<typeof IntegrationConnectionResourceSchema>;
export type IntegrationWebhookSource = z.infer<typeof IntegrationWebhookSourceSchema>;
export type CreatedIntegrationWebhookSource = z.infer<typeof CreatedIntegrationWebhookSourceSchema>;
export type CreatedIntegrationConnection = z.infer<typeof IntegrationConnectionSchema>;
export type DeletedIntegrationConnection = z.infer<typeof DeletedIntegrationConnectionSchema>;
export type StartedRedirectConnection = z.infer<typeof StartedRedirectConnectionSchema>;
export type StartedGitHubAppManifestConnection = z.infer<
  typeof StartedGitHubAppManifestConnectionSchema
>;
export type StartedProviderAppSetup = z.infer<typeof StartedProviderAppSetupSchema>;
export type StartedDeviceAuthorizationConnection = z.infer<
  typeof StartedDeviceAuthorizationConnectionSchema
>;
export type DeviceAuthorizationAttemptResponse = z.infer<
  typeof DeviceAuthorizationAttemptResponseSchema
>;
export type IntegrationConnectionResources = Omit<
  z.infer<typeof IntegrationConnectionResourcesPageSchema>,
  "items" | "page"
> & {
  items: readonly IntegrationConnectionResource[];
};
export type RefreshedIntegrationConnectionResources = z.infer<
  typeof RefreshedIntegrationConnectionResourcesSchema
>;
export type RefreshedAllIntegrationConnectionResources = z.infer<
  typeof RefreshedAllIntegrationConnectionResourcesSchema
>;

export class IntegrationsApiError extends Error {
  readonly operation: string;
  readonly status: number;
  readonly body: unknown;
  readonly code: string | null;

  constructor(input: {
    operation: string;
    status: number;
    body: unknown;
    message: string;
    code?: string | null;
  }) {
    super(input.message);
    this.operation = input.operation;
    this.status = input.status;
    this.body = input.body;
    this.code = input.code ?? null;
  }
}

export async function readJsonWithSchema<T>(input: {
  response: Response;
  schema: z.ZodType<T>;
  operation: string;
}): Promise<T> {
  const json = await input.response.json().catch((): unknown => null);
  const parsed = input.schema.safeParse(json);
  if (!parsed.success) {
    throw new IntegrationsApiError({
      operation: input.operation,
      status: 500,
      body: json,
      message: "Integration API response payload is invalid.",
    });
  }

  return parsed.data;
}

export function wrapIntegrationsApiError(input: {
  operation: string;
  error: unknown;
  fallbackMessage: string;
}): IntegrationsApiError {
  return new IntegrationsApiError(
    normalizeHttpApiError({
      operation: input.operation,
      error: input.error,
      fallbackMessage: input.fallbackMessage,
    }),
  );
}
