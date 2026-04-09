import { z } from "zod";

export const GitHubTargetSecretSchema = z
  .object({})
  .strict()
  .transform(() => ({}));

export type GitHubTargetSecrets = z.output<typeof GitHubTargetSecretSchema>;
