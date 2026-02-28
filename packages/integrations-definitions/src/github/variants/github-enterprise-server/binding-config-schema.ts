import { z } from "zod";

const GitHubRepositorySchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Repository must be in <owner>/<repo> format.");

export const GitHubEnterpriseServerBindingConfigSchema = z
  .object({
    repositories: z.array(GitHubRepositorySchema).min(1),
    includeGhCli: z.boolean(),
  })
  .strict();

export type GitHubEnterpriseServerBindingConfig = z.output<
  typeof GitHubEnterpriseServerBindingConfigSchema
>;
