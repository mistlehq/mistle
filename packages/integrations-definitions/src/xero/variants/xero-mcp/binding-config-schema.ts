import { z } from "zod";

import { XeroToolIds } from "./tool-ids.js";

const XeroToolSchema = z.enum([XeroToolIds.XERO_MCP]);

export const XeroBindingConfigSchema = z
  .object({
    tools: z.array(XeroToolSchema).default([XeroToolIds.XERO_MCP]),
  })
  .strict();

export type XeroBindingConfig = z.output<typeof XeroBindingConfigSchema>;
