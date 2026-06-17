import { z } from "zod";

import { WasenderApiToolIds } from "./tool-ids.js";

const WasenderApiToolSchema = z.enum([WasenderApiToolIds.WASENDERAPI_MCP]);

export const WasenderApiBindingConfigSchema = z
  .object({
    tools: z.array(WasenderApiToolSchema).default([WasenderApiToolIds.WASENDERAPI_MCP]),
  })
  .strict();

export type WasenderApiBindingConfig = z.output<typeof WasenderApiBindingConfigSchema>;
