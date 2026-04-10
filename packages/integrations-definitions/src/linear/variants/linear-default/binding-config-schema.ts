import { z } from "zod";

import { LinearToolIds } from "./tool-ids.js";

const LinearToolSchema = z.enum([LinearToolIds.LINEAR_MCP]);

export const LinearBindingConfigSchema = z
  .object({
    tools: z.array(LinearToolSchema).default([]),
  })
  .strict();

export type LinearBindingConfig = z.output<typeof LinearBindingConfigSchema>;
