import { z } from "zod";

import { MetaAdsToolIds } from "./tool-ids.js";

const MetaAdsToolSchema = z.enum([MetaAdsToolIds.METAADS_CLI, MetaAdsToolIds.METAADS_MCP]);

export const MetaAdsBindingConfigSchema = z
  .object({
    tools: z.array(MetaAdsToolSchema).default([]),
  })
  .strict();

export type MetaAdsBindingConfig = z.output<typeof MetaAdsBindingConfigSchema>;
