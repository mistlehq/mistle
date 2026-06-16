import { z } from "zod";

import { AgentMailToolIds } from "./tool-ids.js";

export const AgentMailBindingConfigSchema = z
  .object({
    tools: z
      .array(z.enum([AgentMailToolIds.AGENTMAIL_MCP]))
      .default([AgentMailToolIds.AGENTMAIL_MCP]),
  })
  .strict();

export type AgentMailBindingConfig = z.output<typeof AgentMailBindingConfigSchema>;
