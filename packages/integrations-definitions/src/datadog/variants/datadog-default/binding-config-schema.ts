import { z } from "zod";

import { DatadogToolIds } from "./tool-ids.js";

const DatadogToolSchema = z.enum([DatadogToolIds.DATADOG_MCP]);

export const DatadogBindingConfigSchema = z
  .object({
    tools: z.array(DatadogToolSchema).default([DatadogToolIds.DATADOG_MCP]),
  })
  .strict();

export type DatadogBindingConfig = z.output<typeof DatadogBindingConfigSchema>;
