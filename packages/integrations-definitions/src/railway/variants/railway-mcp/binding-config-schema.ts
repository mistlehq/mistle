import { z } from "zod";

import { RailwayToolIds } from "./tool-ids.js";

export const RailwayBindingConfigSchema = z
  .object({
    tools: z.array(z.enum([RailwayToolIds.RAILWAY_MCP])).default([RailwayToolIds.RAILWAY_MCP]),
  })
  .strict();

export type RailwayBindingConfig = z.output<typeof RailwayBindingConfigSchema>;
