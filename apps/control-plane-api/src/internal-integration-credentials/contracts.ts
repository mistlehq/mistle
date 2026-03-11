import { createRoute, z } from "@hono/zod-openapi";

import { InternalIntegrationCredentialsErrorCodes } from "./services/errors.js";

export const ResolveIntegrationCredentialRequestSchema = z
  .object({
    connectionId: z.string().min(1),
    bindingId: z.string().min(1).optional(),
    secretType: z.string().min(1),
    purpose: z.string().min(1).optional(),
    resolverKey: z.string().min(1).optional(),
  })
  .strict();

const IntegrationTargetEncryptedSecretsSchema = z
  .object({
    ciphertext: z.string().min(1),
    nonce: z.string().min(1),
    masterKeyVersion: z.number().int().min(1),
  })
  .strict();

export const ResolveIntegrationTargetSecretsRequestSchema = z
  .object({
    targets: z
      .array(
        z
          .object({
            targetKey: z.string().min(1),
            encryptedSecrets: IntegrationTargetEncryptedSecretsSchema.nullable(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const ResolveIntegrationTargetSecretsResponseSchema = z
  .object({
    targets: z.array(
      z
        .object({
          targetKey: z.string().min(1),
          secrets: z.record(z.string(), z.string()),
        })
        .strict(),
    ),
  })
  .strict();

export const ResolveIntegrationCredentialResponseSchema = z
  .object({
    value: z.string().min(1),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const InternalIntegrationCredentialErrorResponseSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export const InternalIntegrationCredentialUnauthorizedResponseSchema = z
  .object({
    code: z.literal(InternalIntegrationCredentialsErrorCodes.UNAUTHORIZED),
    message: z.string().min(1),
  })
  .strict();

export const resolveIntegrationCredentialRoute = createRoute({
  method: "post",
  path: "/resolve",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ResolveIntegrationCredentialRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Resolve integration credential for internal callers.",
      content: {
        "application/json": {
          schema: ResolveIntegrationCredentialResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid resolve request.",
      content: {
        "application/json": {
          schema: InternalIntegrationCredentialErrorResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: InternalIntegrationCredentialUnauthorizedResponseSchema,
        },
      },
    },
    404: {
      description: "Credential resolver dependency was not found.",
      content: {
        "application/json": {
          schema: InternalIntegrationCredentialErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error.",
      content: {
        "text/plain": {
          schema: z.string().min(1),
        },
      },
    },
  },
});

export const resolveIntegrationTargetSecretsRoute = createRoute({
  method: "post",
  path: "/resolve-target-secrets",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ResolveIntegrationTargetSecretsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Resolve integration target secrets for internal callers.",
      content: {
        "application/json": {
          schema: ResolveIntegrationTargetSecretsResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid target secret resolution request.",
      content: {
        "application/json": {
          schema: InternalIntegrationCredentialErrorResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: InternalIntegrationCredentialUnauthorizedResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error.",
      content: {
        "text/plain": {
          schema: z.string().min(1),
        },
      },
    },
  },
});
