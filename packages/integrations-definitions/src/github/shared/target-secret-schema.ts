import { z } from "zod";

export const GitHubTargetSecretSchema = z
  .object({
    app_private_key_pem: z.string().min(1).optional(),
  })
  .strict()
  .transform((input) => {
    if (input.app_private_key_pem === undefined) {
      return {};
    }

    return { appPrivateKeyPem: input.app_private_key_pem };
  });

export type GitHubTargetSecrets = z.output<typeof GitHubTargetSecretSchema>;
