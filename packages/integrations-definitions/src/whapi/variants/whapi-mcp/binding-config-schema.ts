import { z } from "zod";

import { WhapiToolIds } from "./tool-ids.js";

const WhapiToolSchema = z.literal(WhapiToolIds.WHAPI_MCP);

export const WhapiBindingConfigSchema = z
  .object({
    tools: z.array(WhapiToolSchema).default([WhapiToolIds.WHAPI_MCP]),
  })
  .strict();

export type WhapiBindingConfig = z.output<typeof WhapiBindingConfigSchema>;
