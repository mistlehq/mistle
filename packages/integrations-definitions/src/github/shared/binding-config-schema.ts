import { z } from "zod";

import { GitHubToolIds } from "./tool-ids.js";

const GitHubRepositorySchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Repository must be in <owner>/<repo> format.");
const GitHubToolSchema = z.enum([GitHubToolIds.GITHUB_CLI]);

export const GitHubBindingConfigSchema = z
  .object({
    repositories: z.array(GitHubRepositorySchema).default([]),
    tools: z.array(GitHubToolSchema).default([]),
  })
  .strict();

export type GitHubBindingConfig = z.output<typeof GitHubBindingConfigSchema>;
