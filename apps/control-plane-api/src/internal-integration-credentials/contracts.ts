import { z } from "zod";

export const ResolveIntegrationCredentialRequestSchema = z
  .object({
    connectionId: z.string().min(1),
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
