import { z } from "@hono/zod-openapi";

export const InternalRegisterProviderResourceAssociationRequestSchema = z
  .object({
    integrationConnectionId: z.string().min(1),
    resourceKind: z.string().min(1),
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
        reason: z.enum(["resource_kind_not_enabled", "resource_registration_not_supported"]),
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
