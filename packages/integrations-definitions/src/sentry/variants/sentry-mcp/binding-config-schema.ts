import { z } from "zod";

import { SentryToolIds } from "./tool-ids.js";

export const SentryBindingConfigSchema = z
  .object({
    tools: z.array(z.enum([SentryToolIds.SENTRY_MCP])).default([SentryToolIds.SENTRY_MCP]),
  })
  .strict();

export type SentryBindingConfig = z.output<typeof SentryBindingConfigSchema>;
