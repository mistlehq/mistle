import { z } from "zod";

export const GitHubTargetSecretSchema = z
  .object({
    app_private_key_pem: z.string().min(1).optional(),
    webhook_secret: z.string().min(1).optional(),
  })
  .strict()
  .transform((input) => ({
    ...(input.app_private_key_pem === undefined
      ? {}
      : { appPrivateKeyPem: input.app_private_key_pem }),
    ...(input.webhook_secret === undefined ? {} : { webhookSecret: input.webhook_secret }),
  }));

export type GitHubTargetSecrets = z.output<typeof GitHubTargetSecretSchema>;
