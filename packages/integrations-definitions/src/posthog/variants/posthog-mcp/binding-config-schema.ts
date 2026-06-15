import { z } from "zod";

import { PostHogToolIds } from "./tool-ids.js";

export const PostHogBindingConfigSchema = z
  .object({
    tools: z.array(z.enum([PostHogToolIds.POSTHOG_MCP])).default([PostHogToolIds.POSTHOG_MCP]),
  })
  .strict();

export type PostHogBindingConfig = z.output<typeof PostHogBindingConfigSchema>;
