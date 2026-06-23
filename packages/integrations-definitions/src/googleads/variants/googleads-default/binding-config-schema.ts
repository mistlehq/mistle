import { z } from "zod";

import { GoogleAdsToolIds } from "./tool-ids.js";

const GoogleAdsToolSchema = z.enum([
  GoogleAdsToolIds.GOOGLEADS_CLI,
  GoogleAdsToolIds.GOOGLEADS_MCP,
]);

export const GoogleAdsBindingConfigSchema = z
  .object({
    tools: z.array(GoogleAdsToolSchema).default([]),
  })
  .strict();

export type GoogleAdsBindingConfig = z.output<typeof GoogleAdsBindingConfigSchema>;
