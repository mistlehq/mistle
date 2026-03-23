import { z } from "@hono/zod-openapi";

const IntegrationConnectionMethodSchema = z
  .object({
    id: z.enum(["api-key", "oauth2", "github-app-installation"]),
    label: z.string().min(1),
    kind: z.enum(["api-key", "oauth2", "redirect"]),
  })
  .strict();

export const IntegrationWebhookEventDefinitionSchema = z
  .object({
    eventType: z.string().min(1),
    providerEventType: z.string().min(1),
    displayName: z.string().min(1),
    category: z.string().min(1).optional(),
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
    logoKey: z.string().min(1).optional(),
    connectionMethods: z.array(IntegrationConnectionMethodSchema).min(1).optional(),
    supportedWebhookEvents: z.array(IntegrationWebhookEventDefinitionSchema).optional(),
    displayNameOverride: z.string().min(1).optional(),
    descriptionOverride: z.string().min(1).optional(),
    targetHealth: z
      .object({
        configStatus: z.enum(["valid", "invalid"]),
      })
      .strict(),
  })
  .strict();
