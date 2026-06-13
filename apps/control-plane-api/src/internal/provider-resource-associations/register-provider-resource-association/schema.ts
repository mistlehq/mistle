import { z } from "@hono/zod-openapi";
import { AssociatedProviderResourceKinds } from "@mistle/integrations-core";

export const InternalRegisterProviderResourceAssociationRequestSchema = z
  .object({
    integrationConnectionId: z.string().min(1),
    resourceKind: z.enum([
      AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      AssociatedProviderResourceKinds.SLACK_THREAD,
    ]),
    providerResourceId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
  })
  .strict();

export const InternalRegisterProviderResourceAssociationResponseSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("created"),
        associationId: z.string().min(1),
      })
      .strict(),
    z
      .object({
        status: z.literal("already_exists"),
        associationId: z.string().min(1),
      })
      .strict(),
    z
      .object({
        status: z.literal("not_applicable"),
        reason: z.enum(["provider_actor_not_configured", "resource_kind_not_enabled"]),
      })
      .strict(),
  ],
);

export const InternalRegisterProviderResourceAssociationNotFoundResponseSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
