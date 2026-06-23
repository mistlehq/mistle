import { z } from "zod";

import { GoogleAnalyticsToolIds } from "./tool-ids.js";

const GoogleAnalyticsToolSchema = z.enum([
  GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_CLI,
  GoogleAnalyticsToolIds.GOOGLE_ANALYTICS_MCP,
]);

export const GoogleAnalyticsBindingConfigSchema = z
  .object({
    tools: z.array(GoogleAnalyticsToolSchema).default([]),
  })
  .strict();

export type GoogleAnalyticsBindingConfig = z.output<typeof GoogleAnalyticsBindingConfigSchema>;
