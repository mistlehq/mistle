import { z } from "@hono/zod-openapi";
import {
  IntegrationConnectionMethodDetailMetadataSchema,
  IntegrationConnectionMethodSandboxProfileBindingMetadataSchema,
  IntegrationFormConnectionMethodPostCreateMetadataSchema,
  IntegrationFormConnectionMethodSetupFlowMetadataSchema,
} from "@mistle/integrations-core";

const IntegrationConnectionMethodSecretFieldSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().min(1),
    placeholder: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    optional: z.boolean().optional(),
    inputType: z.enum(["password", "text", "textarea"]),
    slotKey: z.string().min(1),
  })
  .strict();

const IntegrationConnectionMethodCreateUiSchema = z
  .object({
    submitLabel: z.string().min(1),
    helperText: z.string().min(1),
    showCallbackUrl: z.boolean().optional(),
    showIdentityLinkingCallbackUrl: z.boolean().optional(),
  })
  .strict();

const IntegrationConnectionMethodReauthorizeUiSchema = z
  .object({
    actionLabel: z.string().min(1),
    pendingLabel: z.string().min(1),
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

const IntegrationConnectionMethodSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: z.string().min(1),
      label: z.string().min(1),
      kind: z.literal("form"),
      connectionDetail: IntegrationConnectionMethodDetailMetadataSchema.optional(),
      sandboxProfileBinding:
        IntegrationConnectionMethodSandboxProfileBindingMetadataSchema.optional(),
      createBehavior: z.enum(["single-step", "draft-then-setup"]).optional(),
      postCreate: IntegrationFormConnectionMethodPostCreateMetadataSchema.optional(),
      setupFlow: IntegrationFormConnectionMethodSetupFlowMetadataSchema.optional(),
      secretFields: z.array(IntegrationConnectionMethodSecretFieldSchema).min(1),
      ui: z
        .object({
          create: IntegrationConnectionMethodCreateUiSchema.optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      label: z.string().min(1),
      kind: z.literal("redirect"),
      connectionDetail: IntegrationConnectionMethodDetailMetadataSchema.optional(),
      sandboxProfileBinding:
        IntegrationConnectionMethodSandboxProfileBindingMetadataSchema.optional(),
      ui: z
        .object({
          create: IntegrationConnectionMethodCreateUiSchema,
          reauthorize: IntegrationConnectionMethodReauthorizeUiSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      label: z.string().min(1),
      kind: z.literal("device-authorization"),
      connectionDetail: IntegrationConnectionMethodDetailMetadataSchema.optional(),
      sandboxProfileBinding:
        IntegrationConnectionMethodSandboxProfileBindingMetadataSchema.optional(),
      ui: z
        .object({
          create: IntegrationDeviceAuthorizationConnectionMethodCreateUiSchema,
          pending: IntegrationConnectionMethodPendingUiSchema.optional(),
          reauthorize: IntegrationConnectionMethodReauthorizeUiSchema.optional(),
        })
        .strict(),
    })
    .strict(),
]);

const IntegrationWebhookTriggerRequirementsSchema = z
  .object({
    anyOf: z
      .array(
        z
          .object({
            label: z.string().min(1).optional(),
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

const WebhookPayloadFilterTransportSchema = z.record(z.string(), z.unknown());

const IntegrationWebhookEventParameterDefinitionSchema = z.union([
  z
    .object({
      id: z.string().min(1),
      label: z.string().min(1),
      kind: z.literal("resource-select"),
      resourceKind: z.string().min(1),
      payloadPath: z.array(z.string().min(1)).min(1),
      matchMode: z.enum(["eq", "contains", "contains_token"]).optional(),
      matchValuePrefix: z.string().min(1).optional(),
      multiValue: z.boolean().optional(),
      negatedMatchRequiresExists: z.boolean().optional(),
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
      negatedMatchRequiresExists: z.boolean().optional(),
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
      matchMode: z.enum(["eq", "exists", "payload_filter"]),
      options: z
        .array(
          z
            .object({
              value: z.string().min(1),
              label: z.string().min(1),
              payloadFilter: WebhookPayloadFilterTransportSchema.optional(),
            })
            .strict(),
        )
        .min(1),
      negatedMatchRequiresExists: z.boolean().optional(),
      prefix: z.string().min(1).optional(),
      placeholder: z.string().min(1).optional(),
    })
    .strict(),
]);

const IntegrationWebhookEventParameterGroupDefinitionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    kind: z.literal("oneOf"),
    options: z
      .array(
        z
          .object({
            parameterId: z.string().min(1),
            label: z.string().min(1),
          })
          .strict(),
      )
      .min(2),
  })
  .strict();

const IntegrationWebhookEventActorReferenceConditionSchema = z
  .object({
    payloadPath: z.array(z.string().min(1)).min(1),
    equals: z.string().min(1),
  })
  .strict();

const IntegrationWebhookEventActorResourceReferenceSchema = z
  .object({
    resourceKind: z.string().min(1),
    externalIdPayloadPath: z.array(z.string().min(1)).min(1).optional(),
    handlePayloadPath: z.array(z.string().min(1)).min(1).optional(),
    when: IntegrationWebhookEventActorReferenceConditionSchema.optional(),
  })
  .strict();

const IntegrationWebhookEventActorDefinitionSchema = z
  .object({
    resourceReferences: z.array(IntegrationWebhookEventActorResourceReferenceSchema).min(1),
  })
  .strict();

export const IntegrationWebhookEventDefinitionSchema = z
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
    parameters: z.array(IntegrationWebhookEventParameterDefinitionSchema).optional(),
    parameterGroups: z.array(IntegrationWebhookEventParameterGroupDefinitionSchema).optional(),
    actor: IntegrationWebhookEventActorDefinitionSchema.optional(),
  })
  .strict();

export const IntegrationAssociatedResourceEventDefinitionSchema = z
  .object({
    resourceKind: z.string().min(1),
    eventType: z.string().min(1),
    displayName: z.string().min(1),
    parameters: z.array(IntegrationWebhookEventParameterDefinitionSchema).optional(),
    parameterGroups: z.array(IntegrationWebhookEventParameterGroupDefinitionSchema).optional(),
  })
  .strict();

const IntegrationWebhookSourceMetadataSchema = z
  .object({
    lifecycle: z.enum(["implicit", "managed"]),
    requiresSourceSelection: z.boolean(),
  })
  .strict();

const IntegrationResourceAttributeDefinitionSchema = z
  .object({
    key: z.string().min(1),
    valueType: z.enum(["boolean", "number", "string"]),
    displayName: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    actorPolicyEligible: z.boolean().optional(),
  })
  .strict();

const IntegrationResourceDefinitionSchema = z
  .object({
    kind: z.string().min(1),
    selectionMode: z.enum(["single", "multi"]),
    bindingField: z.string().min(1),
    displayNameSingular: z.string().min(1),
    displayNamePlural: z.string().min(1),
    description: z.string().min(1).optional(),
    attributeDefinitions: z.array(IntegrationResourceAttributeDefinitionSchema).optional(),
  })
  .strict();

const IntegrationResourceRelationshipScopeDefinitionSchema = z
  .object({
    scopeKind: z.string().min(1),
    displayName: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
  })
  .strict();

const IntegrationResourceRelationshipDefinitionSchema = z
  .object({
    relationshipKind: z.string().min(1),
    subjectResourceKind: z.string().min(1),
    objectResourceKind: z.string().min(1),
    displayName: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    scopeDefinitions: z.array(IntegrationResourceRelationshipScopeDefinitionSchema).min(1),
  })
  .strict();

export const IntegrationTargetSchema = z
  .object({
    targetKey: z.string().min(1),
    familyId: z.string().min(1),
    variantId: z.string().min(1),
    kind: z.enum(["agent", "git", "connector", "sandbox"]),
    enabled: z.boolean(),
    config: z.record(z.string(), z.unknown()),
    displayName: z.string().min(1),
    description: z.string().min(1),
    logoKey: z.string().min(1).optional(),
    connectionMethods: z.array(IntegrationConnectionMethodSchema).min(1).optional(),
    webhookSource: IntegrationWebhookSourceMetadataSchema.optional(),
    resourceDefinitions: z.array(IntegrationResourceDefinitionSchema).optional(),
    resourceRelationshipDefinitions: z
      .array(IntegrationResourceRelationshipDefinitionSchema)
      .optional(),
    supportedWebhookEvents: z.array(IntegrationWebhookEventDefinitionSchema).optional(),
    supportedAssociatedResourceEvents: z
      .array(IntegrationAssociatedResourceEventDefinitionSchema)
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
