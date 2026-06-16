import { z } from "zod";

import { RenderToolIds } from "./tool-ids.js";

const RenderToolSchema = z.enum([RenderToolIds.RENDER_MCP]);

export const RenderBindingConfigSchema = z
  .object({
    tools: z.array(RenderToolSchema).default([RenderToolIds.RENDER_MCP]),
  })
  .strict();

export type RenderBindingConfig = z.output<typeof RenderBindingConfigSchema>;
