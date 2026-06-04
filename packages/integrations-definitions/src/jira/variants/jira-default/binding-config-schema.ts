import { z } from "zod";

import { JiraToolIds } from "./tool-ids.js";

const JiraToolSchema = z.enum([JiraToolIds.JIRA_CLI, JiraToolIds.JIRA_MCP]);

export const JiraBindingConfigSchema = z
  .object({
    tools: z.array(JiraToolSchema).default([]),
  })
  .strict();

export type JiraBindingConfig = z.output<typeof JiraBindingConfigSchema>;
