import { z } from "zod";

import { KlaviyoToolIds } from "./tool-ids.js";

export const KlaviyoBindingConfigSchema = z
  .object({
    tools: z.array(z.enum([KlaviyoToolIds.KLAVIYO_MCP])).default([KlaviyoToolIds.KLAVIYO_MCP]),
  })
  .strict();

export type KlaviyoBindingConfig = z.output<typeof KlaviyoBindingConfigSchema>;
