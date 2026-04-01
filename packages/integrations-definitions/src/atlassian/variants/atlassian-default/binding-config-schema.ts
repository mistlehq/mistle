import { z } from "zod";

import { AtlassianToolIds } from "./tool-ids.js";

const AtlassianToolSchema = z.enum([AtlassianToolIds.JIRA_CLI]);

export const AtlassianBindingConfigSchema = z
  .object({
    tools: z.array(AtlassianToolSchema).default([]),
  })
  .strict();

export type AtlassianBindingConfig = z.output<typeof AtlassianBindingConfigSchema>;
