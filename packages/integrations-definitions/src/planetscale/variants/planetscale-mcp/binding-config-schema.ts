import { z } from "zod";

import { PlanetScaleToolIds } from "./tool-ids.js";

const PlanetScaleToolSchema = z.enum([
  PlanetScaleToolIds.PLANETSCALE_MCP,
  PlanetScaleToolIds.PLANETSCALE_INSIGHTS_MCP,
]);

export const PlanetScaleBindingConfigSchema = z
  .object({
    tools: z.array(PlanetScaleToolSchema).default([]),
  })
  .strict();

export type PlanetScaleBindingConfig = z.output<typeof PlanetScaleBindingConfigSchema>;
