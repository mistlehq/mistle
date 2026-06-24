import { z } from "zod";

import { DataForSeoToolIds } from "./tool-ids.js";

export const DataForSeoBindingConfigSchema = z
  .object({
    tools: z
      .array(z.enum([DataForSeoToolIds.DATAFORSEO_MCP]))
      .default([DataForSeoToolIds.DATAFORSEO_MCP]),
  })
  .strict();

export type DataForSeoBindingConfig = z.output<typeof DataForSeoBindingConfigSchema>;
