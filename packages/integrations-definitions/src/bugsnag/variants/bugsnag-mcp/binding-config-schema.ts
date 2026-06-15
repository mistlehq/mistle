import { z } from "zod";

import { BugSnagToolIds } from "./tool-ids.js";

export const BugSnagBindingConfigSchema = z
  .object({
    tools: z.array(z.enum([BugSnagToolIds.BUGSNAG_MCP])).default([BugSnagToolIds.BUGSNAG_MCP]),
  })
  .strict();

export type BugSnagBindingConfig = z.output<typeof BugSnagBindingConfigSchema>;
