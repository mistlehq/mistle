import { z } from "@hono/zod-openapi";

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
